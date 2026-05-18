from __future__ import annotations

import re

SCHEMA_NODE_KEY = "problem_fill"
SCHEMA_TEMPLATE_CODE = "HCS_INCIDENT"
DIRECT_CLOSE_HANDLE_MODES = {"问题解决关闭", "非问题关闭"}
HANDLE_MODE_ROUTE: dict[str, dict[str, str]] = {
    "problem_review": {
        "确认问题": "ops_analysis",
        "提交其他运维审核": "problem_review",
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
        "暂时挂起": "audit_close",
    },
}
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
    "specialSlowSql",
    "specialPerf",
    "specialUpgrade",
    "specialScale",
    "specialBackup",
    "specialDr",
)
_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE: dict[str, str] = {
    "慢SQL（SQL调优）": "specialSlowSql",
    "整体性能": "specialPerf",
    "升级": "specialUpgrade",
    "扩容": "specialScale",
    "备份恢复": "specialBackup",
    "容灾": "specialDr",
    "SQL引擎-其他问题": "kernelRotation",
    "存储引擎-其他问题": "kernelRotation",
    "管控问题": "controlRotation",
    "其他": "kernelRotation",
}
_ROSTER_KIND_BY_ISSUE_TYPE_JUDGE_NORMALIZED: dict[str, str] = {
    "慢sqlsql调优": "specialSlowSql",
    "整体性能": "specialPerf",
    "升级": "specialUpgrade",
    "扩容": "specialScale",
    "备份恢复": "specialBackup",
    "容灾": "specialDr",
    "sql引擎-其他问题": "kernelRotation",
    "存储引擎-其他问题": "kernelRotation",
    "管控问题": "controlRotation",
    "其他": "kernelRotation",
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
_VERSION_BASELINE_OPTION_SET_CODES: frozenset[str] = frozenset({"OS_GAUSS_VERSION", "OS_UPGRADE_BASELINE"})
_DUTY_FIELD_PATH_SEP = "/"
_LEAVE_APP_NO_LOCK = 58_290_412
_REQUIREMENT_NO_LOCK = 58_290_413
_REQUIREMENT_SCHEMA_HINT = "请在数据库执行 db/migrations/0028_requirement_management.sql"
_AI_SCHEMA_HINT = "请在数据库执行 db/migrations/0031_ai_assistant.sql"
REQUIREMENT_STATUSES: tuple[str, ...] = ("待分析", "待RAT决策", "开发中", "已经落地")
REQUIREMENT_CATEGORIES: tuple[str, ...] = ("管控需求", "内核需求", "管控和内核需求", "其他")
REQUIREMENT_VALUES: tuple[str, ...] = ("质量加固", "性能提升", "竞争力提升", "定位能力提升", "恢复能力提升", "感知能力提升")
REQUIREMENT_STATUS_FORWARD: dict[str, str] = {
    "待分析": "待RAT决策",
    "待RAT决策": "开发中",
    "开发中": "已经落地",
}
REQUIREMENT_STATUS_BACKWARD: dict[str, str] = {
    "待RAT决策": "待分析",
    "开发中": "待RAT决策",
    "已经落地": "开发中",
}
LEAVE_APPLICATION_TYPES: frozenset[str] = frozenset(
    {
        "重大问题公关",
        "特性开发",
        "外出公干",
        "请假/调休",
        "在途",
    }
)

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