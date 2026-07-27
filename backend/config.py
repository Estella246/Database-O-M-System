from __future__ import annotations

import logging
import os
import re
import tempfile

from pathlib import Path

logger = logging.getLogger(__name__)

SCHEMA_NODE_KEY = "problem_fill"
SCHEMA_TEMPLATE_CODE = "HCS_INCIDENT"
DIRECT_CLOSE_HANDLE_MODES = {"问题解决关闭", "非问题关闭"}
# 审核关闭「暂时挂起」：节点仍停在 audit_close，ticket.status → suspended（列表当前阶段展示「暂时挂起」）
TEMPORARY_SUSPEND_HANDLE_MODE = "暂时挂起"
HANDLE_MODE_ROUTE: dict[str, dict[str, str]] = {
    "problem_review": {
        "确认问题": "ops_analysis",
        "提交其他运维审核": "problem_review",
        "提交专项轮值表": "problem_review",
        "非问题关闭": "problem_review",
    },
    "ops_analysis": {
        "提交开发分析": "dev_analysis",
        "提交开发闭环": "dev_closure",
        "提交运维闭环": "ops_closure",
        "提交其他运维分析": "ops_analysis",
    },
    "dev_analysis": {
        "提交开发闭环": "dev_closure",
        "提交其他开发分析": "dev_analysis",
        "返回运维分析": "ops_analysis",
    },
    "dev_closure": {
        "提交运维闭环": "ops_closure",
        "提交其他开发闭环": "dev_closure",
        "返回开发分析": "dev_analysis",
        "返回运维分析": "ops_analysis",
    },
    "ops_closure": {
        "提交运维审核关闭": "audit_close",
        "提交其他运维闭环": "ops_closure",
        "返回开发闭环": "dev_closure",
        "返回运维分析": "ops_analysis",
    },
    "audit_close": {
        "问题解决关闭": "audit_close",
        "提交其他审核关闭": "audit_close",
        "返回运维闭环": "ops_closure",
        TEMPORARY_SUSPEND_HANDLE_MODE: "audit_close",
    },
}

OPS_ANALYSIS_QUALITY_YES_VALUES: frozenset[str] = frozenset(
    {
        "是（已知质量问题）",
        "是（新发现质量问题）",
    }
)
OPS_ANALYSIS_EXCLUDED_HANDLE_MODE_WHEN_QUALITY_YES = "提交运维闭环"

# 开发闭环：选「提交运维闭环」或「返回运维分析」时，下一步处理人默认取运维分析阶段最后一次提交人
DEV_CLOSURE_DEFAULT_NEXT_HANDLER_HANDLE_MODES: frozenset[str] = frozenset(
    {
        "提交运维闭环",
        "返回运维分析",
    }
)
DEV_CLOSURE_DEFAULT_NEXT_HANDLER_FROM_NODE = "ops_analysis"

# 运维分析：选「提交运维闭环」时，下一步处理人默认取该工单当前处理人
OPS_ANALYSIS_DEFAULT_NEXT_HANDLER_HANDLE_MODES: frozenset[str] = frozenset(
    {
        "提交运维闭环",
    }
)


def ops_analysis_excludes_ops_closure(is_quality_issue: str) -> bool:
    return str(is_quality_issue or "").strip() in OPS_ANALYSIS_QUALITY_YES_VALUES


HOME_PERSONAL_SLA_STAGE_KEYS: tuple[str, ...] = (
    "problem_review",
    "ops_analysis",
    "dev_analysis",
    "dev_closure",
    "ops_closure",
    "audit_close",
)
HOME_PERSONAL_STAGE_NAME_BY_KEY: dict[str, str] = {
    "problem_fill": "问题填写",
    "problem_review": "问题审核",
    "ops_analysis": "运维分析",
    "dev_analysis": "开发分析",
    "dev_closure": "开发闭环",
    "ops_closure": "运维闭环",
    "audit_close": "审核关闭",
}
HOME_PERSONAL_PASSTHROUGH_EXCLUDED_NODE_KEYS: frozenset[str] = frozenset(
    {"problem_fill", "problem_review", "ops_analysis"}
)

DUTY_ROTATION_ROSTER_KINDS: tuple[str, ...] = (
    "kernelRotation",
    "controlRotation",
    "publicCloudRotation",
    "pocRotation",
    "researchVersionRotation",
    "specialSlowSql",
    "specialPerf",
    "specialUpgrade",
    "specialScale",
    "specialBackup",
    "specialDr",
)
SPECIAL_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE: dict[str, str] = {
    "慢SQL（SQL调优）": "specialSlowSql",
    "整体性能": "specialPerf",
    "升级": "specialUpgrade",
    "扩容": "specialScale",
    "备份恢复": "specialBackup",
    "容灾": "specialDr",
    "管控问题": "controlRotation",
}
SPECIAL_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE_NORMALIZED: dict[str, str] = {
    "慢sqlsql调优": "specialSlowSql",
    "整体性能": "specialPerf",
    "升级": "specialUpgrade",
    "扩容": "specialScale",
    "备份恢复": "specialBackup",
    "容灾": "specialDr",
    "管控问题": "controlRotation",
}
_COMPONENT_TO_KIND: dict[str, str] = {
    "内核问题": "kernel",
    "管控问题": "control",
}
_DUTY_STATUS_ON: frozenset[str] = frozenset({"active", "当值"})
_DUTY_EXTRAS_SCHEMA_HINT = "请在数据库执行 db/migrations/0017_duty_roster_extended.sql"
_HOLIDAY_SCHEMA_HINT = "请在数据库执行 db/migrations/0029_ticket_flow_dispatch_rules.sql"
_LEAVE_SCHEMA_HINT = "请在数据库执行 db/migrations/0018_leave_application.sql"
_DUTY_FIELD_SCHEMA_HINT = "请在数据库执行 db/migrations/0019_duty_field_node.sql"
_VERSION_SCHEMA_HINT = "请在数据库执行 db/migrations/0020_param_release_version.sql"
_GROUP_TEMPLATE_SCHEMA_HINT = "请在数据库执行 db/migrations/0022_param_group_template.sql"
_ISSUE_ROOT_CAUSE_SCHEMA_HINT = "请在数据库执行 db/migrations/0058_param_issue_root_cause_map.sql"
_GROUP_TEMPLATE_KIND_ORDER: tuple[str, ...] = ("major", "urgent", "itr", "general")
_GROUP_TEMPLATE_DEFAULTS: dict[str, dict[str, str]] = {
    "major": {
        "group_name_tpl": "【GaussDB内部】【XX 重大问题】{Ecare单号 客户名称} GaussDB {故障描述}",
        "group_notice_tpl": "",
        "group_members_tpl": "",
        "first_report_tpl": "",
    },
    "urgent": {
        "group_name_tpl": "【GaussDB内部】【XX 紧急问题】{Ecare单号 客户名称} GaussDB {故障描述}",
        "group_notice_tpl": "",
        "group_members_tpl": "",
        "first_report_tpl": "",
    },
    "itr": {
        "group_name_tpl": "【GaussDB内部】【ITR 管理升级】{Ecare单号 客户名称} GaussDB {故障描述}",
        "group_notice_tpl": "",
        "group_members_tpl": "",
        "first_report_tpl": "",
    },
    "general": {
        "group_name_tpl": "【GaussDB内部】【一般问题】{Ecare单号 客户名称} GaussDB {故障描述}",
        "group_notice_tpl": "",
        "group_members_tpl": "",
        "first_report_tpl": "",
    },
}
_DUTY_FIELD_MAX_DEPTH = 32
_DUTY_FIELD_MAX_NODES = 4000
_DUTY_FIELD_OPTION_SET_CODES: frozenset[str] = frozenset({"OS_RESPONSIBILITY_INTRO", "OS_RESPONSIBILITY_OWNER"})
_VERSION_BASELINE_OPTION_SET_CODES: frozenset[str] = frozenset({"OS_GAUSS_VERSION", "OS_UPGRADE_BASELINE", "OS_RELEASE_VERSION"})
# 局点选项集：选项值实时取自「局点档案」(site_profile.site_name)
_SITE_PROFILE_OPTION_SET_CODES: frozenset[str] = frozenset({"LOCATION_SET"})
# 修复版本字段：在基线版本选项之外额外提供「未修复」选项（仅修复版本，引入版本不含）
_FIX_VERSION_FIELD_KEY = "fix_version"
_FIX_VERSION_UNFIXED_OPTION = "未修复"
_DUTY_FIELD_PATH_SEP = "/"
_LEAVE_APP_NO_LOCK = 58_290_412
_REQUIREMENT_NO_LOCK = 58_290_413
_REQUIREMENT_SCHEMA_HINT = "请在数据库执行 db/migrations/0083_requirement_quality_improvement.sql"
_QI_SCHEMA_HINT = "请在数据库执行 db/migrations/0100_qi_workflow.sql"
_AI_SCHEMA_HINT = "请在数据库执行 db/migrations/0031_ai_assistant.sql"
# 质量改进（原需求管理）：接纳状态 / 分类 / 优先级 三组枚举
REQUIREMENT_STATUSES: tuple[str, ...] = ("待评审", "已实现", "已接纳", "部分接纳", "拒绝")
REQUIREMENT_CATEGORIES: tuple[str, ...] = ("定位定界", "测试加固", "快速恢复", "需求", "质量加固和改进")
REQUIREMENT_PRIORITIES: tuple[str, ...] = ("高", "中", "低")
LEAVE_APPLICATION_TYPES: frozenset[str] = frozenset(
    {
        "重大问题公关",
        "特性开发",
        "外出公干",
        "请假/调休",
        "在途",
    }
)

MULTI_PERSON_FIELD_KEYS = frozenset({"collaborator"})

PERSON_VALUE_FIELD_KEYS = frozenset(
    {
        "next_handler",
        "collaborator",
        "hcs_owner",
        "hp_de",
        "hp_se",
        "hp_pl",
        "hp_xm",
        "hp_tse",
        "hp_te",
        "hp_pm",
        "ccb与会人",
        "测试人员",
        "开发人员",
        "工程人员",
        "跨责任田确认人",
    }
)
_PERSON_ACCOUNT_SPACE = re.compile(r"^([A-Za-z][A-Za-z0-9_.-]*)\s+(.+)$")
_PERSON_ACCOUNT_PLUS = re.compile(r"^([A-Za-z0-9_.-]+)\+(.+)$")

# 前端站点公网地址（用于小鲁班等通知中的链接，不含尾部 /）；优先于 XIAOLUBAN_LINK_BASE_URL
APP_PUBLIC_BASE_URL = os.getenv("APP_PUBLIC_BASE_URL", "").strip().rstrip("/")

# 小鲁班通知链接默认公网前缀（不含尾部 /）；APP_PUBLIC_BASE_URL 未配置时使用
XIAOLUBAN_LINK_BASE_URL = os.getenv(
    "XIAOLUBAN_LINK_BASE_URL",
    "https://gaussdb-ops.rnd.huawei.com",
).strip().rstrip("/")

# 小鲁班消息推送配置
XIAOLUBAN_MESSAGE_URL = os.getenv("XIAOLUBAN_MESSAGE_URL", "http://test.xiaoluban-message.com")
XIAOLUBAN_MESSAGE_SEND_TOKEN = os.getenv("XIAOLUBAN_MESSAGE_SEND_TOKEN", "test_UHUGUknkgslfhlskhg")
XIAOLUBAN_GROUP_CHAT_ID = os.getenv("XIAOLUBAN_GROUP_CHAT_ID", "test_group_chat_001")

# 工单流转通知：到达这些节点时推送小鲁班消息给处理人
NOTIFY_ON_ARRIVAL_NODE_KEYS: frozenset[str] = frozenset(
    {"problem_review", "ops_analysis", "dev_analysis"}
)
NOTIFY_NODE_NAME_CN: dict[str, str] = {
    "problem_review": "问题审核",
    "ops_analysis": "运维分析",
    "dev_analysis": "开发分析",
}

# 工单催办通知配置
REMINDER_INTERVAL_MINUTES = 15
REMINDER_SEVERITY_MAX_COUNT: dict[str, int] = {"一般": 1, "严重": 3, "致命": 10}
REMINDER_CHECK_INTERVAL_SECONDS = 60

# 应用日志配置（stdout；可选 LOG_DIR 写本地按日+按大小轮转文件）
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").strip().upper()
UVICORN_LOG_LEVEL = os.getenv("UVICORN_LOG_LEVEL", "WARNING").strip().upper()
LOG_ACCESS = os.getenv("LOG_ACCESS", "0").strip().lower() in ("1", "true", "yes", "on")
LOG_RATE_LIMIT_SECONDS = int(os.getenv("LOG_RATE_LIMIT_SECONDS", "60"))
LOG_DIR = os.getenv("LOG_DIR", "").strip()
LOG_FILE_BASENAME = (os.getenv("LOG_FILE_BASENAME", "yunwei") or "yunwei").strip()
LOG_MAX_BYTES = int(os.getenv("LOG_MAX_BYTES", str(50 * 1024 * 1024)))
LOG_MAX_FILES_PER_DAY = int(os.getenv("LOG_MAX_FILES_PER_DAY", "0"))  # 0=同一自然日不限分段数
LOG_RETENTION_DAYS = int(os.getenv("LOG_RETENTION_DAYS", "30"))
LOG_STDOUT = os.getenv("LOG_STDOUT", "1").strip().lower() in ("1", "true", "yes", "on")

# 工作台 HCS 列表读快照表；设为 0/false 即回退 legacy 全量 merge 列表（见 README 回退说明）
TICKET_LIST_SNAPSHOT_ENABLED = os.getenv("TICKET_LIST_SNAPSHOT_ENABLED", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)

# 历史迁入分批 HTTP：前端单批最长等待（秒）；keepalive 间隔（秒，流式响应防网关超时）
MIGRATE_LEGACY_BATCH_TIMEOUT_SECONDS = max(60, int(os.getenv("MIGRATE_LEGACY_BATCH_TIMEOUT_SECONDS", "300")))
MIGRATE_LEGACY_KEEPALIVE_INTERVAL_SECONDS = max(
    5,
    min(60, int(os.getenv("MIGRATE_LEGACY_KEEPALIVE_INTERVAL_SECONDS", "15"))),
)
# 运维效率 /scores 聚合结果缓存 TTL（秒）；0=禁用
ONCALL_EVA_SCORES_CACHE_SECONDS = max(0, int(os.getenv("ONCALL_EVA_SCORES_CACHE_SECONDS", "120")))
# 迁入全部：未传 max_total 时默认等于 batch_size，禁止单次 HTTP 扫完整库（易 OOM）
MIGRATE_LEGACY_DEFAULT_CAP_BATCH = os.getenv("MIGRATE_LEGACY_DEFAULT_CAP_BATCH", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
# 迁入/快照重建：每批 commit 的工单数；batch_size=0 时回退为此值（避免一次加载全部 ID OOM）
SNAPSHOT_REFRESH_BATCH_SIZE = max(10, min(500, int(os.getenv("SNAPSHOT_REFRESH_BATCH_SIZE", "50"))))
MAJOR_ISSUE_BACKFILL_BATCH_SIZE = max(1, min(500, int(os.getenv("MAJOR_ISSUE_BACKFILL_BATCH_SIZE", "1"))))
# 单次 HTTP 对已存在于 major_issue 的命中工单最多连续跳过条数（避免逐条 HTTP）
MAJOR_ISSUE_BACKFILL_SKIP_BURST = max(1, min(500, int(os.getenv("MAJOR_ISSUE_BACKFILL_SKIP_BURST", "50"))))

# 统计图表日汇总预聚合；设为 0/false 时回退为按快照行实时聚合
TICKET_STATS_DAILY_ENABLED = os.getenv("TICKET_STATS_DAILY_ENABLED", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)

# Welink群创建与消息推送配置
WELINK_APP_ID = os.getenv("WELINK_APP_ID", "***")
WELINK_APP_SECRET = os.getenv("WELINK_APP_SECRET", "***")
WELINK_HIS_APP_ID = os.getenv("WELINK_HIS_APP_ID", "****")
WELINK_HIS_STATIC_TOKEN = os.getenv("WELINK_HIS_STATIC_TOKEN", "****")
WELINK_DYNAMIC_TOKEN_URL = os.getenv("WELINK_DYNAMIC_TOKEN_URL", "***")
WELINK_CREATE_GROUP_URL = os.getenv("WELINK_CREATE_GROUP_URL", "***")
WELINK_CARD_MESSAGE_URL = os.getenv("WELINK_CARD_MESSAGE_URL", "***")

# ── AI Export (深度分析) ──
_AI_EXPORT_SCHEMA_HINT = "请在数据库执行 db/migrations/0080_ai_export.sql"

AI_EXPORT_CLEANUP_INTERVAL_SECONDS = int(os.getenv("AI_EXPORT_CLEANUP_INTERVAL_SECONDS", "21600"))
AI_EXPORT_DRAFT_TIMEOUT_SECONDS = int(os.getenv("AI_EXPORT_DRAFT_TIMEOUT_SECONDS", "7200"))
AI_EXPORT_RETENTION_DAYS = int(os.getenv("AI_EXPORT_RETENTION_DAYS", "7"))
AI_EXPORT_HARD_DELETE_DAYS = int(os.getenv("AI_EXPORT_HARD_DELETE_DAYS", "30"))
AI_EXPORT_PROCESSING_TIMEOUT_SECONDS = int(os.getenv("AI_EXPORT_PROCESSING_TIMEOUT_SECONDS", "3600"))
AI_EXPORT_MAX_CONCURRENT_TASKS = int(os.getenv("AI_EXPORT_MAX_CONCURRENT_TASKS", "3"))
AI_EXPORT_BATCH_SIZE = int(os.getenv("AI_EXPORT_BATCH_SIZE", "50"))
AI_EXPORT_MAX_LLM_CALLS = int(os.getenv("AI_EXPORT_MAX_LLM_CALLS", "200"))
ECHARTS_JS_PATH = os.getenv("ECHARTS_JS_PATH", str(Path(__file__).resolve().parent / "static" / "echarts.min.js"))

# ── 工作台工单异步导出 ──
_TICKET_EXPORT_SCHEMA_HINT = "请在数据库执行 db/migrations/0103_ticket_export_task.sql 与 0104_ticket_export_task_no.sql"
TICKET_EXPORT_DIR = os.getenv(
    "TICKET_EXPORT_DIR",
    str(Path(tempfile.gettempdir()) / "yunwei_ticket_exports"),
)
TICKET_EXPORT_CLEANUP_INTERVAL_SECONDS = int(os.getenv("TICKET_EXPORT_CLEANUP_INTERVAL_SECONDS", "3600"))
# 未下载的 ready 文件最长保留（小时）；下载成功后立即删文件
TICKET_EXPORT_RETENTION_HOURS = int(os.getenv("TICKET_EXPORT_RETENTION_HOURS", "1"))
TICKET_EXPORT_HARD_DELETE_HOURS = int(os.getenv("TICKET_EXPORT_HARD_DELETE_HOURS", "24"))
TICKET_EXPORT_PROCESSING_TIMEOUT_SECONDS = int(os.getenv("TICKET_EXPORT_PROCESSING_TIMEOUT_SECONDS", "3600"))
TICKET_EXPORT_MAX_CONCURRENT_TASKS = int(os.getenv("TICKET_EXPORT_MAX_CONCURRENT_TASKS", "3"))
TICKET_EXPORT_NO_INSERT_BATCH = int(os.getenv("TICKET_EXPORT_NO_INSERT_BATCH", "1000"))

# get_ticket_detail API 鉴权 Key（默认内置测试值；生产环境建议覆盖）
DOER_TICKET_DETAIL_API_KEY = os.getenv("DOER_TICKET_DETAIL_API_KEY", "DOER-7s9kF2pRzG5dQjL8nXbV4cM0tY1").strip()
if DOER_TICKET_DETAIL_API_KEY and len(DOER_TICKET_DETAIL_API_KEY) < 32:
    logger.warning("DOER_TICKET_DETAIL_API_KEY 长度不足 32 位，建议使用更强的 Key")

# DBA Agent 跳转服务
DBA_AGENT_URL = os.getenv("DBA_AGENT_URL", "http://10.30.196.77:18140/api/sessions/from-ticket").strip()
DBA_AGENT_SECRET = os.getenv("DBA_AGENT_SECRET", "0BmegKbSQ27rHcTsOIRhXXUNeDSBb4m6ws2+VaCQpr0=").strip()
