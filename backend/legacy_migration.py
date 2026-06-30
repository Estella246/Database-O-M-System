"""老平台（GaussDB）历史工单 → 新平台工单 的迁移逻辑。

老库三张核心表（见 origin_orders 设计）：
  - t_work_flow_instance     工单基本信息（当前节点/处理人/状态/创建人…）
  - t_work_flow_task         节点流转任务（每次提交一条，含目标节点与下一处理人）
  - t_work_flow_task_parse   字段解析表（column1..column64 固定列，语义见下方映射）

迁移策略：后端直连老库，按 instance.id 游标分批读取、分批提交；以 ticket.legacy_instance_id
做幂等（重复迁入跳过已迁实例，支持中断续跑）。流程 ID 取 instance.process_id（或 task
.instance_process_id）；status 保留 instance.status 原值。按 task 逐节点重建 node_instance /
node_data / flow_log，字段值取自 parse 列与 task.form_data（富文本优先 form_data，按
cnFieldName 映射），并按新平台 node_field_def 的归属节点落位。
"""
from __future__ import annotations

import gc
import logging
import os
import sys
from datetime import datetime
from typing import Any

import psycopg
from psycopg.errors import UndefinedColumn, UndefinedTable
from psycopg.rows import dict_row

from config import (
    SCHEMA_TEMPLATE_CODE,
    PERSON_VALUE_FIELD_KEYS,
    MULTI_PERSON_FIELD_KEYS,
)
from utils.module_cascade_path import (
    MODULE_CASCADE_FIELD_KEYS,
    normalize_module_cascade_path,
)
from utils import (
    canonical_person_display as _canonical_person_display,
    canonical_multi_person_display as _canonical_multi_person_display,
)
from utils.ticket_inherited_values import values_json_as_dict
from utils.ticket_status import (
    ticket_status_is_audit_close_pending,
    ticket_status_is_closed,
    ticket_status_writes_close_flow_log,
)
from legacy_form_data import (
    LEGACY_PLAIN_TEXT_FIELD_KEYS,
    load_cn_label_to_field_key,
    merge_form_values_into,
    merge_parse_with_form_values,
    normalize_legacy_plain_text,
    parse_legacy_form_data,
)

logger = logging.getLogger(__name__)

_LEGACY_NODE_NAMES_CACHE: dict[int, str] | None = None


def _process_rss_mb() -> float | None:
    """当前进程峰值 RSS（MB），用于迁入 OOM 排查。"""
    try:
        import resource

        ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if sys.platform == "darwin":
            return round(ru / (1024 * 1024), 1)
        return round(ru / 1024, 1)
    except Exception:
        return None


def _log_migrate_memory(label: str) -> None:
    rss = _process_rss_mb()
    if rss is not None:
        logger.info("migrate_legacy mem label=%s rss_mb=%s", label, rss)


def _log_repair_failed(
    *,
    ticket_id: int | None,
    legacy_id: int,
    ticket_no: str,
    reason: str,
    exc: BaseException | None = None,
) -> None:
    if exc is not None:
        logger.error(
            "repair_legacy failed ticket_id=%s legacy_instance_id=%s ticket_no=%s reason=%s",
            ticket_id,
            legacy_id,
            ticket_no,
            reason,
            exc_info=exc,
        )
        return
    logger.warning(
        "repair_legacy failed ticket_id=%s legacy_instance_id=%s ticket_no=%s reason=%s",
        ticket_id,
        legacy_id,
        ticket_no,
        reason,
    )


# 老库节点名 → 新平台 node_key（兼容「运维分析/运维人员分析」等别名）
LEGACY_NODE_NAME_TO_KEY: dict[str, str] = {
    "问题填写": "problem_fill",
    # 更老流程里首节点别名（与标准「问题填写」同义）
    "HCS人员填写": "problem_fill",
    "BU人员填写": "problem_fill",
    "问题审核": "problem_review",
    "运维分析": "ops_analysis",
    "运维人员分析": "ops_analysis",
    "开发分析": "dev_analysis",
    "开发人员分析": "dev_analysis",
    "开发闭环": "dev_closure",
    "开发人员闭环": "dev_closure",
    "运维闭环": "ops_closure",
    "运维人员闭环": "ops_closure",
    "审核关闭": "audit_close",
    "问题审核关闭": "audit_close",
    # 部分老库末次关闭 task 的 current_work_flow_node_name 误存为动作名「关闭」
    "关闭": "audit_close",
}

# 老库 t_work_flow_node 主键顺序（gen_legacy_orders / 生产标准流程一致）
LEGACY_NODE_ID_TO_KEY: dict[int, str] = {
    1: "problem_fill",
    8: "problem_fill",  # 更老库 BU/HCS 人员填写节点 id
    2: "problem_review",
    3: "ops_analysis",
    4: "dev_analysis",
    5: "dev_closure",
    6: "ops_closure",
    7: "audit_close",
}

# 标准 HCS 流程顺序（用于纠正老库误存「问题审核」为 next/current）
LEGACY_NODE_ORDER: dict[str, int] = {
    "problem_fill": 0,
    "problem_review": 1,
    "ops_analysis": 2,
    "dev_analysis": 3,
    "dev_closure": 4,
    "ops_closure": 5,
    "audit_close": 6,
}

# 主路径上的默认下一节点（老库 next 误存为「问题审核」时的兜底）
LEGACY_STANDARD_FORWARD_NEXT: dict[str, str] = {
    "problem_fill": "problem_review",
    "problem_review": "ops_analysis",
    "ops_analysis": "dev_analysis",
    "dev_analysis": "dev_closure",
    "dev_closure": "ops_closure",
    "ops_closure": "audit_close",
}

_INSTANCE_COLUMNS = (
    "id, work_flow_info_name, current_work_flow_node_name, current_assignee, "
    "current_assignee_id, status, description, issue_severity, process_id, creator_name, "
    "creator_id, create_time, update_time, deleted"
)
# 语义对照见 origin_orders 设计文档第 5–8 页。
PARSE_COLUMN_TO_FIELD: dict[str, str] = {
    "column1": "start_date",          # 起始日期
    "column2": "location",            # 局点
    "column3": "product_line",        # 产品线
    "column4": "biz_env",             # 业务环境/问题阶段
    "column6": "gauss_version",       # 高斯/内核版本
    "column7": "deploy_mode",         # 部署形态
    "column8": "issue_desc",          # 问题描述
    "column9": "error_text",          # 报错信息
    "column10": "severity",           # 问题严重性
    "column11": "issue_type",         # 问题类型
    "column12": "root_cause_category",# 根因分类
    "column14": "customer_voice",     # 客户声音
    "column17": "close_reason",       # 返回/关闭原因
    "column18": "event_level",        # 事件级别
    "column19": "issue_track",        # 问题进展跟踪
    "column20": "issue_intro_module", # 问题引入模块
    "column21": "issue_owner_module", # 问题归属模块
    "column22": "is_quality_issue",   # 是否质量问题
    "column23": "dts_no",             # DTS 单号
    "column24": "version_pass_reason",# 版本透传原因分析
    "column27": "front_pass_through", # 是否前端透传
    "column28": "dfx_gap",            # DFX 能力 GAP
    "column29": "workaround",         # 规避措施/恢复方法
    "column31": "root_cause",         # 问题根因
    "column32": "warning_needed",     # 是否需要预警
    "column33": "sla_analysis",       # SLA 分析
    "column36": "version_pass_through",# 是否透传版本
    "column38": "collaborator",       # 协同处理人
    "column40": "kernel_upgrade_involved",  # 是否涉及内核升级
    "column41": "upgrade_baseline_version", # 升级前基线版本
    "column42": "upgrade_status",     # 升级状态
    "column43": "error_archive_text", # 报错信息归档
    "column44": "kernel_upgrade_time",# 内核升级时间
    "column45": "fault_recovery_involved",   # 是否涉及故障恢复
    "column46": "fault_to_recovery_duration",# 故障恢复用时
    "column47": "issue_type_judge",   # 专项轮值表（原问题类型初判断）
    "column49": "is_consult_issue",   # 是否咨询问题
    "column50": "component",          # 问题组件
    "column51": "hcs_version",        # HCS 版本号
    "column52": "hcs_mode",           # HCS/轻量化
    "column53": "ecare_ticket_no",    # eCare 单号
    "column54": "hcs_owner",          # HCS 负责人/提单人
    "column56": "control_version",    # 管控版本
    "column58": "has_core_stack",     # 是否有 core 堆栈
    "column59": "core_stack_text",    # Core 堆栈（文字版）
    "column60": "impact_level",       # 业务影响程度
    "column61": "use_doer_assist",    # 是否使用 Doer 辅助
    "column62": "doer_no_help_reason",# Doer 无帮助原因
}


def get_legacy_dsn() -> str:
    """老库连接串：优先 LEGACY_DATABASE_URL；本地验证默认回退当前库（读模拟老表）。"""
    return (
        os.getenv("LEGACY_DATABASE_URL")
        or os.getenv("DATABASE_URL", "postgresql://estella@localhost:5432/yunwei_ticket")
    )


def legacy_conn() -> psycopg.Connection:
    return psycopg.connect(get_legacy_dsn(), row_factory=dict_row)


def _is_deleted(raw: Any) -> bool:
    return str(raw or "0").strip() not in ("", "0")


def _legacy_status_raw(raw: Any) -> str:
    """迁入后 ticket.status 保留老库 instance.status 原值。"""
    return str(raw or "").strip()


def _legacy_process_id(inst: dict[str, Any], tasks: list[dict[str, Any]]) -> str:
    """流程 ID：优先 instance.process_id，否则取 task.instance_process_id。"""
    pid = str(inst.get("process_id") or "").strip()
    if pid:
        return pid
    for task in tasks:
        ipid = str(task.get("instance_process_id") or "").strip()
        if ipid:
            return ipid
    return ""


def _person(account: Any, name: Any) -> str:
    return _canonical_person_display(f"{str(account or '').strip()} {str(name or '').strip()}")


def _normalize_person_value(field_key: str, raw: str) -> str:
    if field_key in MULTI_PERSON_FIELD_KEYS:
        return _canonical_multi_person_display(raw)
    return _canonical_person_display(raw)


def _load_node_meta(conn: psycopg.Connection, template_code: str) -> dict[str, dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT wn.node_key, wn.id, wn.node_order
        FROM workflow_node wn
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wt.template_code = %s
        ORDER BY wn.node_order
        """,
        (template_code,),
    ).fetchall()
    return {
        str(r["node_key"]): {"id": int(r["id"]), "order": int(r["node_order"])}
        for r in rows
    }


def _load_node_field_keys(conn: psycopg.Connection, template_code: str) -> dict[str, set[str]]:
    rows = conn.execute(
        """
        SELECT wn.node_key, nfd.field_key
        FROM node_field_def nfd
        JOIN workflow_node wn ON wn.id = nfd.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        WHERE wt.template_code = %s AND nfd.is_active = TRUE
        """,
        (template_code,),
    ).fetchall()
    out: dict[str, set[str]] = {}
    for r in rows:
        out.setdefault(str(r["node_key"]), set()).add(str(r["field_key"]))
    return out


def _template_id(conn: psycopg.Connection, template_code: str) -> int:
    row = conn.execute(
        "SELECT id FROM workflow_template WHERE template_code = %s", (template_code,)
    ).fetchone()
    if not row:
        raise RuntimeError(f"workflow template missing: {template_code}")
    return int(row["id"])


def _normalize_legacy_field_value(field_key: str, val: str) -> str:
    if field_key in MODULE_CASCADE_FIELD_KEYS:
        return normalize_module_cascade_path(val)
    if field_key in PERSON_VALUE_FIELD_KEYS:
        return _normalize_person_value(field_key, val)
    if field_key in LEGACY_PLAIN_TEXT_FIELD_KEYS:
        return normalize_legacy_plain_text(val)
    return val


def _full_values_from_parse(parse_row: dict[str, Any] | None) -> dict[str, str]:
    if not parse_row:
        return {}
    out: dict[str, str] = {}
    for col, field_key in PARSE_COLUMN_TO_FIELD.items():
        raw = parse_row.get(col)
        if raw is None:
            continue
        val = str(raw).strip()
        if not val:
            continue
        val = _normalize_legacy_field_value(field_key, val)
        if not val:
            continue
        out[field_key] = val
    return out


def _form_values_from_task(
    task: dict[str, Any],
    cn_label_to_field_key: dict[str, str] | None,
) -> dict[str, str]:
    if not cn_label_to_field_key:
        return {}
    return parse_legacy_form_data(
        task.get("form_data"),
        cn_label_to_field_key,
        normalize_person=_normalize_person_value,
        person_field_keys=PERSON_VALUE_FIELD_KEYS,
    )


def _legacy_full_values(
    parse_row: dict[str, Any] | None,
    inst: dict[str, Any] | None,
    *,
    tasks: list[dict[str, Any]] | None = None,
    cn_label_to_field_key: dict[str, str] | None = None,
) -> dict[str, str]:
    """老库 parse 列 + task.form_data + instance 描述/严重性，供迁入与字段补全共用。"""
    full_values = _full_values_from_parse(parse_row)
    if tasks and cn_label_to_field_key:
        for task in tasks:
            form_vals = _form_values_from_task(task, cn_label_to_field_key)
            full_values = merge_parse_with_form_values(full_values, form_vals)
    if not inst:
        return full_values
    desc = str(inst.get("description") or "").strip()
    if desc and not str(full_values.get("issue_desc") or "").strip():
        full_values["issue_desc"] = desc
    if "severity" not in full_values:
        sev = str(inst.get("issue_severity") or "").strip()
        if sev:
            full_values["severity"] = sev
    return full_values


def _is_placeholder_ticket_title(title: str, ticket_no: str) -> bool:
    t = str(title or "").strip()
    no = str(ticket_no or "").strip()
    if not t:
        return False
    if no and t == f"Order {no}":
        return True
    return t.startswith("Order YW") and len(t) > len("Order YW")


def _title_from_legacy(
    inst: dict[str, Any] | None,
    ticket_no: str,
    full_values: dict[str, str],
) -> str:
    desc = str((inst or {}).get("description") or "").strip()
    if desc:
        return desc[:60]
    issue = str(full_values.get("issue_desc") or "").strip()
    if issue:
        return issue[:60]
    return f"Order {ticket_no}"


def _refresh_ticket_title_if_placeholder(
    conn: psycopg.Connection,
    *,
    ticket_id: int,
    ticket_no: str,
    inst: dict[str, Any] | None,
    full_values: dict[str, str],
) -> bool:
    row = conn.execute("SELECT title FROM ticket WHERE id = %s", (ticket_id,)).fetchone()
    if not row:
        return False
    old_title = str(row.get("title") or "").strip()
    if not _is_placeholder_ticket_title(old_title, ticket_no):
        return False
    new_title = _title_from_legacy(inst, ticket_no, full_values)
    if _is_placeholder_ticket_title(new_title, ticket_no):
        return False
    conn.execute(
        "UPDATE ticket SET title = %s, updated_at = NOW() WHERE id = %s",
        (new_title, ticket_id),
    )
    return True


def _merge_empty_fields_from_legacy(
    existing: dict[str, Any],
    legacy_slice: dict[str, str],
) -> tuple[dict[str, Any], bool]:
    out = dict(existing)
    changed = False
    for key, val in legacy_slice.items():
        sv = str(val or "").strip()
        if not sv:
            continue
        if not str(out.get(key) or "").strip():
            out[key] = sv
            changed = True
    return out, changed


def _backfill_ticket_node_fields_from_legacy(
    conn: psycopg.Connection,
    *,
    ticket_id: int,
    full_values: dict[str, str],
    node_fields: dict[str, set[str]],
) -> bool:
    """将老库字段写入各节点 values_json 中的空键，不删除流转历史。"""
    if not full_values:
        return False
    rows = conn.execute(
        """
        SELECT DISTINCT ON (wn.node_key)
          tnd.id, wn.node_key, tnd.values_json
        FROM ticket_node_data tnd
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        WHERE tnd.ticket_id = %s
        ORDER BY wn.node_key, tnd.created_at DESC, tnd.id DESC
        """,
        (ticket_id,),
    ).fetchall()
    changed = False
    for row in rows:
        nk = str(row.get("node_key") or "").strip()
        if not nk:
            continue
        existing = values_json_as_dict(row.get("values_json"))
        legacy_slice = _values_for_node(nk, full_values, node_fields)
        merged, row_changed = _merge_empty_fields_from_legacy(existing, legacy_slice)
        if not row_changed:
            continue
        conn.execute(
            """
            UPDATE ticket_node_data
            SET values_json = %s::jsonb
            WHERE id = %s
            """,
            (psycopg.types.json.Jsonb(merged), int(row["id"])),
        )
        changed = True
    return changed


def _ticket_needs_legacy_field_backfill(
    conn: psycopg.Connection,
    *,
    ticket_id: int,
    ticket_no: str,
    placeholder_only: bool,
) -> bool:
    if placeholder_only:
        row = conn.execute("SELECT title FROM ticket WHERE id = %s", (ticket_id,)).fetchone()
        return _is_placeholder_ticket_title(str((row or {}).get("title") or ""), ticket_no)
    row = conn.execute(
        """
        SELECT 1
        FROM ticket_node_data tnd
        WHERE tnd.ticket_id = %s
          AND COALESCE(NULLIF(TRIM(tnd.values_json ->> 'issue_desc'), ''), '') <> ''
        LIMIT 1
        """,
        (ticket_id,),
    ).fetchone()
    return row is None


def _values_for_node(node_key: str, full_values: dict[str, str], node_fields: dict[str, set[str]]) -> dict[str, str]:
    allowed = node_fields.get(node_key, set())
    return {k: v for k, v in full_values.items() if k in allowed}


def _snapshot_node_values_by_key(
    conn: psycopg.Connection, ticket_id: int
) -> dict[str, dict[str, str]]:
    """重建流转前按 node_key 保留各节点最新 values_json，避免仅依赖老库 parse 时字段被清空。"""
    rows = conn.execute(
        """
        SELECT wn.node_key, tnd.values_json
        FROM ticket_node_data tnd
        JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
        JOIN workflow_node wn ON wn.id = tni.node_id
        WHERE tnd.ticket_id = %s
        ORDER BY wn.node_key, tnd.created_at DESC, tnd.id DESC
        """,
        (ticket_id,),
    ).fetchall()
    out: dict[str, dict[str, str]] = {}
    for row in rows:
        nk = str(row.get("node_key") or "").strip()
        if not nk or nk in out:
            continue
        raw_vals = values_json_as_dict(row.get("values_json"))
        if not raw_vals:
            continue
        cleaned: dict[str, str] = {}
        for key, val in raw_vals.items():
            sk = str(key or "").strip()
            if not sk:
                continue
            sv = str(val or "").strip()
            if sv:
                cleaned[sk] = sv
        if cleaned:
            out[nk] = cleaned
    return out


def _merge_preserved_node_values(
    node_key: str,
    base_values: dict[str, str],
    preserved_by_node: dict[str, dict[str, str]] | None,
) -> dict[str, str]:
    """parse 映射为基础，已落库节点数据优先覆盖同键（保留新平台后续填报内容）。"""
    out = dict(base_values)
    preserved = (preserved_by_node or {}).get(node_key) or {}
    for key, val in preserved.items():
        sv = str(val or "").strip()
        if sv:
            out[key] = sv
    return out


def _normalize_legacy_node_name(raw: Any) -> str:
    s = str(raw or "").strip()
    for ch in ("\u200b", "\ufeff", "\u00a0"):
        s = s.replace(ch, "")
    return s


def _legacy_node_key_from_name_text(
    name: str,
    node_meta: dict[str, dict[str, Any]],
) -> str | None:
    """节点名字符串 → node_key；精确表 + 「含审核关闭」兜底。"""
    if not name:
        return None
    cand = LEGACY_NODE_NAME_TO_KEY.get(name)
    if cand and cand in node_meta:
        return cand
    if "审核关闭" in name and "audit_close" in node_meta:
        return "audit_close"
    return None


def _legacy_node_order(node_key: str | None) -> int | None:
    if not node_key:
        return None
    return LEGACY_NODE_ORDER.get(str(node_key).strip())


def _legacy_node_key_parts_from_fields(
    *,
    node_name: Any,
    node_id: Any,
    node_meta: dict[str, dict[str, Any]],
    legacy_node_names: dict[int, str] | None = None,
) -> tuple[str | None, str | None]:
    """分别解析节点名 / node_id → node_key，供 current/next 合并策略使用。"""
    name_key: str | None = None
    name = _normalize_legacy_node_name(node_name)
    if name:
        name_key = _legacy_node_key_from_name_text(name, node_meta)

    id_key: str | None = None
    if node_id is not None:
        try:
            nid = int(node_id)
        except (TypeError, ValueError):
            nid = None
        if nid is not None:
            cand = LEGACY_NODE_ID_TO_KEY.get(nid)
            if cand and cand in node_meta:
                id_key = cand
            elif legacy_node_names:
                legacy_name = _normalize_legacy_node_name(legacy_node_names.get(nid))
                if legacy_name:
                    cand = _legacy_node_key_from_name_text(legacy_name, node_meta)
                    if cand:
                        id_key = cand
    return name_key, id_key


def _legacy_node_key_from_fields(
    *,
    node_name: Any,
    node_id: Any,
    node_meta: dict[str, dict[str, Any]],
    legacy_node_names: dict[int, str] | None = None,
) -> str | None:
    """节点名 / node_id → node_key；两者并存时优先 node_id（老库节点名常有「问题审核」误存）。"""
    name_key, id_key = _legacy_node_key_parts_from_fields(
        node_name=node_name,
        node_id=node_id,
        node_meta=node_meta,
        legacy_node_names=legacy_node_names,
    )
    if id_key:
        return id_key
    return name_key


def _legacy_correct_misnamed_problem_review_next(
    next_key: str | None,
    *,
    from_node_key: str | None,
    node_meta: dict[str, dict[str, Any]],
) -> str | None:
    """老库常把 next 误存为「问题审核」；按源节点推断主路径下一节点。"""
    if next_key != "problem_review" or not from_node_key or from_node_key == "problem_fill":
        return next_key
    from_ord = _legacy_node_order(from_node_key)
    review_ord = _legacy_node_order("problem_review")
    if from_ord is None or review_ord is None or from_ord <= review_ord:
        return next_key
    corrected = LEGACY_STANDARD_FORWARD_NEXT.get(from_node_key)
    if corrected and corrected in node_meta:
        return corrected
    return next_key


def _legacy_last_mapped_task_pair(
    tasks: list[dict[str, Any]],
    node_meta: dict[str, dict[str, Any]],
    legacy_node_names: dict[int, str] | None,
    status_raw: str,
) -> tuple[str | None, str | None]:
    """返回末条可映射 task 的 (current_key, next_key)。"""
    last_t: dict[str, Any] | None = None
    last_nk: str | None = None
    for t in tasks:
        nk = _legacy_task_current_node_key(
            t, node_meta, legacy_node_names=legacy_node_names
        )
        if nk:
            last_t = t
            last_nk = nk
    if not last_t or not last_nk:
        return None, None
    next_nk = _legacy_task_next_node_key(
        last_t,
        node_meta,
        legacy_node_names=legacy_node_names,
        status_raw=status_raw,
        from_node_key=last_nk,
    )
    return last_nk, next_nk


def _effective_current_key_from_seq(seq: list[dict[str, Any]]) -> str | None:
    """重建序列中真正的当前节点：优先 processing，否则末节点。"""
    if not seq:
        return None
    for entry in reversed(seq):
        if entry.get("action_status") == "processing":
            nk = str(entry.get("node_key") or "").strip()
            if nk:
                return nk
    nk = str(seq[-1].get("node_key") or "").strip()
    return nk or None


def _legacy_instance_current_node_key(
    inst: dict[str, Any],
    node_meta: dict[str, dict[str, Any]],
    *,
    tasks: list[dict[str, Any]] | None = None,
    legacy_node_names: dict[int, str] | None = None,
) -> str:
    """实例当前节点：status=问题审核关闭 时强制 audit_close（老库 current 节点名常误存「问题审核」）。"""
    status_raw = _legacy_status_raw(inst.get("status"))
    if ticket_status_is_audit_close_pending(status_raw) and "audit_close" in node_meta:
        return "audit_close"
    if (
        not ticket_status_is_closed(status_raw)
        and "审核关闭" in status_raw
        and "audit_close" in node_meta
    ):
        return "audit_close"

    name = _normalize_legacy_node_name(inst.get("current_work_flow_node_name"))
    if name and "审核关闭" in name and "audit_close" in node_meta:
        return "audit_close"

    name_key, id_key = _legacy_node_key_parts_from_fields(
        node_name=inst.get("current_work_flow_node_name"),
        node_id=inst.get("current_work_flow_node_id"),
        node_meta=node_meta,
        legacy_node_names=legacy_node_names,
    )
    current_key = id_key or name_key
    # id 误指向问题审核、节点名却是后续阶段时以节点名为准（与 next 侧 id 误存对称）
    if current_key == "problem_review" and name_key:
        name_ord = _legacy_node_order(name_key)
        review_ord = _legacy_node_order("problem_review")
        if name_ord is not None and review_ord is not None and name_ord > review_ord:
            current_key = name_key
    if not current_key or current_key not in node_meta:
        return "problem_fill"

    if tasks and "audit_close" in node_meta:
        last_nk, next_nk = _legacy_last_mapped_task_pair(
            tasks, node_meta, legacy_node_names, status_raw
        )
        if next_nk == "audit_close" or last_nk == "audit_close":
            return "audit_close"
        if current_key == "problem_review" and last_nk == "ops_closure":
            return "audit_close"
        # 实例 current 误存「问题审核」，末条 task 已在后续阶段 → 取纠正后的 next 或主路径下一节点
        if current_key == "problem_review" and last_nk:
            last_ord = _legacy_node_order(last_nk)
            review_ord = _legacy_node_order("problem_review")
            if last_ord is not None and review_ord is not None and last_ord > review_ord:
                if next_nk and next_nk != "problem_review" and next_nk in node_meta:
                    return next_nk
                fwd = LEGACY_STANDARD_FORWARD_NEXT.get(last_nk)
                if fwd and fwd in node_meta:
                    return fwd

    return current_key


def _legacy_task_current_node_key(
    task: dict[str, Any],
    node_meta: dict[str, dict[str, Any]],
    *,
    legacy_node_names: dict[int, str] | None = None,
) -> str | None:
    nk = _legacy_node_key_from_fields(
        node_name=task.get("current_work_flow_node_name"),
        node_id=task.get("current_work_flow_node_id"),
        node_meta=node_meta,
        legacy_node_names=legacy_node_names,
    )
    if nk:
        return nk
    if str(task.get("status") or "").strip() == "关闭" and "audit_close" in node_meta:
        return "audit_close"
    return None


def _legacy_task_next_node_key(
    task: dict[str, Any],
    node_meta: dict[str, dict[str, Any]],
    *,
    legacy_node_names: dict[int, str] | None = None,
    status_raw: str = "",
    from_node_key: str | None = None,
) -> str | None:
    name_key, id_key = _legacy_node_key_parts_from_fields(
        node_name=task.get("next_work_flow_node_name"),
        node_id=task.get("next_work_flow_node_id"),
        node_meta=node_meta,
        legacy_node_names=legacy_node_names,
    )
    nk: str | None = None
    # next：id 误为问题审核、节点名是合法前进目标时优先节点名（迁入/重建流转共用）
    if id_key and name_key and id_key != name_key:
        from_ord = _legacy_node_order(from_node_key)
        id_ord = _legacy_node_order(id_key)
        name_ord = _legacy_node_order(name_key)
        review_ord = _legacy_node_order("problem_review")
        if (
            id_key == "problem_review"
            and from_ord is not None
            and review_ord is not None
            and from_ord > review_ord
            and name_ord is not None
            and name_ord > from_ord
            and name_key in node_meta
        ):
            nk = name_key
    if nk is None:
        nk = id_key or name_key
    return _legacy_correct_misnamed_problem_review_next(
        nk, from_node_key=from_node_key, node_meta=node_meta
    )


def _format_unmapped_legacy_tasks(tasks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for t in tasks[:5]:
        cur = _normalize_legacy_node_name(t.get("current_work_flow_node_name")) or "(空)"
        nid = t.get("current_work_flow_node_id")
        if nid is not None:
            parts.append(f"{cur}(node_id={nid})")
        else:
            parts.append(cur)
    return "；".join(parts)


def _load_legacy_node_names(conn_legacy: psycopg.Connection) -> dict[int, str]:
    global _LEGACY_NODE_NAMES_CACHE
    if _LEGACY_NODE_NAMES_CACHE is not None:
        return _LEGACY_NODE_NAMES_CACHE
    try:
        rows = conn_legacy.execute(
            """
            SELECT id, node_name
            FROM t_work_flow_node
            WHERE COALESCE(deleted, '0') = '0'
            """
        ).fetchall()
    except (UndefinedTable, UndefinedColumn):
        conn_legacy.rollback()
        _LEGACY_NODE_NAMES_CACHE = {}
        return _LEGACY_NODE_NAMES_CACHE
    out: dict[int, str] = {}
    for row in rows:
        try:
            out[int(row["id"])] = _normalize_legacy_node_name(row.get("node_name"))
        except (TypeError, ValueError):
            continue
    _LEGACY_NODE_NAMES_CACHE = out
    return out


def _build_node_sequence(
    inst: dict[str, Any],
    tasks: list[dict[str, Any]],
    current_key: str,
    status_raw: str,
    node_meta: dict[str, dict[str, Any]],
    *,
    legacy_node_names: dict[int, str] | None = None,
    cn_label_to_field_key: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """重建工单走过的节点序列（每个元素对应一次 node_instance）。"""
    seq: list[dict[str, Any]] = []
    is_closed = ticket_status_is_closed(status_raw)
    current_handler = _person(inst.get("current_assignee_id"), inst.get("current_assignee"))

    if tasks:
        # 老库 t_work_flow_task.creator_id 是任务记录创建人，真实数据里多恒为工单发起人，
        # 不能当作各节点的处理人。某节点的处理人 = 把工单指派进该节点的人，即上一条
        # 任务的 next_assignee；首个节点（问题填写）的处理人为工单创建人。
        prev_handler_id = str(inst.get("creator_id") or "")
        prev_handler_name = _person(inst.get("creator_id"), inst.get("creator_name"))
        for t in tasks:
            handler_id, handler_name = prev_handler_id, prev_handler_name
            # 推进到下一节点的处理人（即便当前任务节点无法映射也要推进，保证后续节点正确）
            prev_handler_id = str(t.get("next_assignee_id") or "")
            prev_handler_name = _person(t.get("next_assignee_id"), t.get("next_assignee"))
            nk = _legacy_task_current_node_key(
                t, node_meta, legacy_node_names=legacy_node_names
            )
            if not nk:
                continue
            seq.append(
                {
                    "node_key": nk,
                    "handler_name": handler_name,
                    "handler_id": handler_id,
                    "action_status": "completed",
                    "at": t.get("create_time") or inst.get("create_time"),
                    "next_handler": _person(t.get("next_assignee_id"), t.get("next_assignee")),
                    "next_node_key": _legacy_task_next_node_key(
                        t,
                        node_meta,
                        legacy_node_names=legacy_node_names,
                        status_raw=status_raw,
                        from_node_key=nk,
                    ),
                    "form_values": _form_values_from_task(t, cn_label_to_field_key),
                }
            )
        task_mapped_count = len(seq)
        if task_mapped_count == 0:
            logger.warning(
                "build_node_sequence: legacy_id=%s has %s tasks but none mapped to workflow nodes: %s",
                inst.get("id"),
                len(tasks),
                _format_unmapped_legacy_tasks(tasks),
            )
        last_key = seq[-1]["node_key"] if seq else None
        if last_key != current_key:
            # 未终态：当前节点进行中；已终态关闭：补当前节点为已完成（如仅有运维闭环 task 但实例停在审核关闭）
            seq.append(
                {
                    "node_key": current_key,
                    "handler_name": current_handler,
                    "handler_id": str(inst.get("current_assignee_id") or ""),
                    "action_status": "completed" if is_closed else "processing",
                    "at": inst.get("update_time") or inst.get("create_time"),
                    "next_handler": "",
                    "next_node_key": None,
                }
            )
        return seq, task_mapped_count

    # 无流转任务：源库没有逐阶段处理人记录，不臆造中间阶段（否则会把每个阶段塌缩成
    # 提单人、污染运维效率归属/SLA/独立闭环）。只还原确知的两段：
    #   - 问题填写：提单人（creator）
    #   - 当前/末节点（闭单即审核关闭）：当前处理人（current_assignee）
    # 中间阶段一律不生成节点实例/流转日志，故这类工单不计入任何人的运维效率。
    creator_handler = _person(inst.get("creator_id"), inst.get("creator_name"))
    pf_is_current = current_key == "problem_fill"
    seq.append(
        {
            "node_key": "problem_fill",
            "handler_name": creator_handler,
            "handler_id": str(inst.get("creator_id") or ""),
            "action_status": "processing" if (pf_is_current and not is_closed) else "completed",
            "at": inst.get("create_time"),
            "next_handler": "",
        }
    )
    if not pf_is_current:
        seq.append(
            {
                "node_key": current_key,
                "handler_name": current_handler,
                "handler_id": str(inst.get("current_assignee_id") or ""),
                "action_status": "processing" if not is_closed else "completed",
                "at": inst.get("update_time") or inst.get("create_time"),
                "next_handler": "",
            }
        )
    return seq, 0


def _fallback_problem_fill_sequence(inst: dict[str, Any], created_dt: Any) -> list[dict[str, Any]]:
    return [
        {
            "node_key": "problem_fill",
            "handler_name": _person(inst.get("creator_id"), inst.get("creator_name")),
            "handler_id": str(inst.get("creator_id") or ""),
            "action_status": "completed",
            "at": created_dt,
            "next_handler": "",
            "next_node_key": None,
        }
    ]


def _delete_ticket_workflow(conn: psycopg.Connection, ticket_id: int) -> None:
    conn.execute("DELETE FROM ticket_flow_log WHERE ticket_id = %s", (ticket_id,))
    conn.execute("DELETE FROM ticket_node_data WHERE ticket_id = %s", (ticket_id,))
    conn.execute("DELETE FROM ticket_node_instance WHERE ticket_id = %s", (ticket_id,))


def _insert_ticket_workflow(
    conn: psycopg.Connection,
    *,
    ticket_id: int,
    created_dt: Any,
    seq: list[dict[str, Any]],
    full_values: dict[str, str],
    node_fields: dict[str, set[str]],
    node_meta: dict[str, dict[str, Any]],
    status_raw: str,
    preserved_by_node: dict[str, dict[str, str]] | None = None,
) -> None:
    accumulated = dict(full_values)
    for idx, entry in enumerate(seq):
        nk = entry["node_key"]
        node_id = node_meta[nk]["id"]
        node_at = entry.get("at") or created_dt
        next_at = seq[idx + 1].get("at") if idx + 1 < len(seq) else None
        ended_at = None if entry["action_status"] == "processing" else next_at
        form_vals = entry.get("form_values") or {}
        if form_vals:
            accumulated = merge_form_values_into(accumulated, form_vals)

        instance = conn.execute(
            """
            INSERT INTO ticket_node_instance
              (ticket_id, node_id, handler_id, handler_name, action_status, started_at, ended_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                ticket_id,
                node_id,
                entry.get("handler_id") or "",
                entry.get("handler_name") or "",
                entry["action_status"],
                node_at,
                ended_at,
            ),
        ).fetchone()

        values = _merge_preserved_node_values(
            nk,
            _values_for_node(nk, accumulated, node_fields),
            preserved_by_node,
        )
        nh = str(entry.get("next_handler") or "").strip()
        if nh:
            values["next_handler"] = nh
        schema_snapshot = {"node_key": nk, "migrated": True}
        conn.execute(
            """
            INSERT INTO ticket_node_data
              (ticket_id, ticket_node_instance_id, values_json, schema_snapshot, created_by, created_at)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s, %s)
            """,
            (
                ticket_id,
                int(instance["id"]),
                psycopg.types.json.Jsonb(values),
                psycopg.types.json.Jsonb(schema_snapshot),
                entry.get("handler_id") or "",
                node_at,
            ),
        )

        # 流转日志：有下一节点则 submit；末段若 task 指向下一节点也 submit（不因终态 status 误记 close）
        if idx + 1 < len(seq):
            to_node_id = node_meta[seq[idx + 1]["node_key"]]["id"]
            action_type = "submit"
        else:
            next_nk = entry.get("next_node_key")
            if next_nk and next_nk in node_meta and next_nk != nk:
                to_node_id = node_meta[next_nk]["id"]
                action_type = "submit"
            elif (
                ticket_status_writes_close_flow_log(status_raw)
                and nk == "audit_close"
            ):
                to_node_id = node_id
                action_type = "close"
            else:
                to_node_id = None
                action_type = None
        if action_type:
            conn.execute(
                """
                INSERT INTO ticket_flow_log
                  (ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    ticket_id,
                    node_id,
                    to_node_id,
                    action_type,
                    entry.get("handler_id") or "",
                    entry.get("handler_name") or "",
                    "历史数据迁入",
                    node_at,
                ),
            )


def _rebuild_ticket_workflow_from_legacy(
    conn: psycopg.Connection,
    *,
    ticket_id: int,
    inst: dict[str, Any],
    parse_row: dict[str, Any] | None,
    tasks: list[dict[str, Any]],
    node_meta: dict[str, dict[str, Any]],
    node_fields: dict[str, set[str]],
    legacy_node_names: dict[int, str] | None = None,
    cn_label_to_field_key: dict[str, str] | None = None,
) -> None:
    status_raw = _legacy_status_raw(inst.get("status"))
    current_key = _legacy_instance_current_node_key(
        inst, node_meta, tasks=tasks, legacy_node_names=legacy_node_names
    )
    created_dt = inst.get("create_time") or datetime.now()
    full_values = _legacy_full_values(
        parse_row,
        inst,
        tasks=tasks,
        cn_label_to_field_key=cn_label_to_field_key,
    )

    seq, task_mapped_count = _build_node_sequence(
        inst,
        tasks,
        current_key,
        status_raw,
        node_meta,
        legacy_node_names=legacy_node_names,
        cn_label_to_field_key=cn_label_to_field_key,
    )
    if not seq:
        seq = _fallback_problem_fill_sequence(inst, created_dt)

    if tasks and task_mapped_count == 0:
        raise ValueError(
            f"老库有 {len(tasks)} 条流转 task 但无法映射到流程节点"
            f"（{_format_unmapped_legacy_tasks(tasks)}），已中止重建以免清空工单历史"
        )

    preserved_by_node = _snapshot_node_values_by_key(conn, ticket_id)
    _delete_ticket_workflow(conn, ticket_id)
    _insert_ticket_workflow(
        conn,
        ticket_id=ticket_id,
        created_dt=created_dt,
        seq=seq,
        full_values=full_values,
        node_fields=node_fields,
        node_meta=node_meta,
        status_raw=status_raw,
        preserved_by_node=preserved_by_node,
    )
    effective_key = _effective_current_key_from_seq(seq) or current_key
    if effective_key in node_meta:
        conn.execute(
            """
            UPDATE ticket SET current_node_id = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (node_meta[effective_key]["id"], ticket_id),
        )
        current_key = effective_key
    ticket_no = _legacy_process_id(inst, tasks) or ""
    _refresh_ticket_title_if_placeholder(
        conn,
        ticket_id=ticket_id,
        ticket_no=ticket_no,
        inst=inst,
        full_values=full_values,
    )
    logger.info(
        "repair_legacy workflow rebuilt ticket_id=%s legacy_instance_id=%s status=%s "
        "current_key=%s node_seq=%s task_count=%s closed=%s",
        ticket_id,
        int(inst.get("id") or 0),
        status_raw,
        current_key,
        "->".join(str(e.get("node_key") or "") for e in seq),
        len(tasks),
        ticket_status_is_closed(status_raw),
    )


def _migrate_one_instance(
    conn: psycopg.Connection,
    inst: dict[str, Any],
    parse_row: dict[str, Any] | None,
    tasks: list[dict[str, Any]],
    template_id: int,
    node_meta: dict[str, dict[str, Any]],
    node_fields: dict[str, set[str]],
    legacy_node_names: dict[int, str] | None = None,
    cn_label_to_field_key: dict[str, str] | None = None,
) -> str:
    """迁移单个老实例为新工单，返回老库 process_id（即 ticket_no）。"""
    status_raw = _legacy_status_raw(inst.get("status"))
    current_key = _legacy_instance_current_node_key(
        inst, node_meta, tasks=tasks, legacy_node_names=legacy_node_names
    )

    full_values = _legacy_full_values(
        parse_row,
        inst,
        tasks=tasks,
        cn_label_to_field_key=cn_label_to_field_key,
    )

    created_dt = inst.get("create_time") or datetime.now()
    ticket_no = _legacy_process_id(inst, tasks)
    if not ticket_no:
        raise ValueError("缺少 process_id / instance_process_id，无法作为流程 ID 迁入")

    title = _title_from_legacy(inst, ticket_no, full_values)
    current_node_id = node_meta[current_key]["id"]

    ticket = conn.execute(
        """
        INSERT INTO ticket
          (ticket_no, template_id, title, current_node_id, status,
           creator_id, creator_name, legacy_instance_id, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            ticket_no,
            template_id,
            title,
            current_node_id,
            status_raw,
            str(inst.get("creator_id") or ""),
            _canonical_person_display(str(inst.get("creator_name") or "")) or str(inst.get("creator_name") or ""),
            int(inst["id"]),
            created_dt,
            inst.get("update_time") or created_dt,
        ),
    ).fetchone()
    ticket_id = int(ticket["id"])

    seq, _task_mapped_count = _build_node_sequence(
        inst,
        tasks,
        current_key,
        status_raw,
        node_meta,
        legacy_node_names=legacy_node_names,
        cn_label_to_field_key=cn_label_to_field_key,
    )
    if not seq:
        seq = _fallback_problem_fill_sequence(inst, created_dt)

    _insert_ticket_workflow(
        conn,
        ticket_id=ticket_id,
        created_dt=created_dt,
        seq=seq,
        full_values=full_values,
        node_fields=node_fields,
        node_meta=node_meta,
        status_raw=status_raw,
    )
    effective_key = _effective_current_key_from_seq(seq) or current_key
    if effective_key in node_meta and effective_key != current_key:
        conn.execute(
            """
            UPDATE ticket SET current_node_id = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (node_meta[effective_key]["id"], ticket_id),
        )

    return ticket_no


def _normalize_process_ids(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = [raw]
    elif isinstance(raw, (list, tuple, set)):
        parts = list(raw)
    else:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in parts:
        pid = str(item or "").strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        out.append(pid)
    return out


def _legacy_instance_ids_for_process_ids(
    conn_legacy: psycopg.Connection, process_ids: list[str]
) -> list[int]:
    if not process_ids:
        return []
    rows = conn_legacy.execute(
        """
        SELECT DISTINCT i.id
        FROM t_work_flow_instance i
        LEFT JOIN t_work_flow_task t
          ON t.work_flow_instance_id = i.id AND COALESCE(t.deleted, '0') = '0'
        WHERE TRIM(COALESCE(i.process_id, '')) = ANY(%s)
           OR TRIM(COALESCE(t.instance_process_id, '')) = ANY(%s)
        ORDER BY i.id
        """,
        (process_ids, process_ids),
    ).fetchall()
    return [int(r["id"]) for r in rows]


def _fetch_legacy_instances_by_ids(
    conn_legacy: psycopg.Connection, instance_ids: list[int]
) -> list[dict[str, Any]]:
    if not instance_ids:
        return []
    return conn_legacy.execute(
        f"""
        SELECT {_INSTANCE_COLUMNS}
        FROM t_work_flow_instance
        WHERE id = ANY(%s)
        ORDER BY id
        """,
        (instance_ids,),
    ).fetchall()


_LEGACY_TASK_COLUMNS = """
    work_flow_instance_id, current_work_flow_node_id, current_work_flow_node_name,
    next_work_flow_node_id, next_work_flow_node_name,
    next_assignee, next_assignee_id, form_data, creator_name, creator_id,
    create_time, status, instance_process_id, id
"""
_LEGACY_TASK_COLUMNS_MINIMAL = """
    work_flow_instance_id, current_work_flow_node_name, next_work_flow_node_name,
    next_assignee, next_assignee_id, creator_name, creator_id,
    create_time, status, instance_process_id, id
"""


def _group_legacy_task_rows(rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        iid = int(row["work_flow_instance_id"])
        grouped.setdefault(iid, []).append(dict(row))
    return grouped


def _fetch_legacy_tasks_by_instance_ids(
    conn_legacy: psycopg.Connection, instance_ids: list[int]
) -> dict[int, list[dict[str, Any]]]:
    """按 instance_id 分组返回 task 列表（已过滤 deleted），含重建流转所需字段。"""
    if not instance_ids:
        return {}
    sql = f"""
        SELECT {{columns}}
        FROM t_work_flow_task
        WHERE work_flow_instance_id = ANY(%s) AND COALESCE(deleted, '0') = '0'
        ORDER BY work_flow_instance_id, create_time, id
    """
    try:
        rows = conn_legacy.execute(
            sql.format(columns=_LEGACY_TASK_COLUMNS.strip()),
            (instance_ids,),
        ).fetchall()
    except UndefinedColumn:
        conn_legacy.rollback()
        try:
            rows = conn_legacy.execute(
                sql.format(
                    columns=_LEGACY_TASK_COLUMNS.strip().replace(", form_data", "")
                ),
                (instance_ids,),
            ).fetchall()
        except UndefinedColumn:
            conn_legacy.rollback()
            rows = conn_legacy.execute(
                sql.format(columns=_LEGACY_TASK_COLUMNS_MINIMAL.strip()),
                (instance_ids,),
            ).fetchall()
    return _group_legacy_task_rows(rows)


def _fetch_legacy_parse_by_instance_ids(
    conn_legacy: psycopg.Connection, instance_ids: list[int]
) -> dict[int, dict[str, Any]]:
    """按 instance_id 返回最新 parse 行（重建流转用）。"""
    if not instance_ids:
        return {}
    try:
        rows = conn_legacy.execute(
            """
            SELECT DISTINCT ON (instance_id) *
            FROM t_work_flow_task_parse
            WHERE instance_id = ANY(%s)
            ORDER BY instance_id, id DESC
            """,
            (instance_ids,),
        ).fetchall()
    except UndefinedTable:
        conn_legacy.rollback()
        return {}
    return {int(r["instance_id"]): dict(r) for r in rows}


def _next_free_ticket_no(
    conn_new: psycopg.Connection, candidate: str, *, except_ticket_id: int
) -> str:
    """在 candidate 已被占用时追加 _displaced_{id} 后缀直至唯一。"""
    if not conn_new.execute(
        "SELECT 1 FROM ticket WHERE ticket_no = %s AND id <> %s LIMIT 1",
        (candidate, except_ticket_id),
    ).fetchone():
        return candidate
    base = f"{candidate}_displaced_{except_ticket_id}"
    if not conn_new.execute(
        "SELECT 1 FROM ticket WHERE ticket_no = %s AND id <> %s LIMIT 1",
        (base, except_ticket_id),
    ).fetchone():
        return base
    for seq in range(2, 1000):
        alt = f"{base}_{seq}"
        if not conn_new.execute(
            "SELECT 1 FROM ticket WHERE ticket_no = %s AND id <> %s LIMIT 1",
            (alt, except_ticket_id),
        ).fetchone():
            return alt
    raise ValueError(f"无法为 {candidate} 找到可用占位流程 ID")


def _displace_ticket_no_holder(
    conn_new: psycopg.Connection,
    conn_legacy: psycopg.Connection,
    *,
    target_no: str,
    except_ticket_id: int,
    refresh_snapshot: bool,
) -> None:
    """移走占用 target_no 的其它工单，以便 except_ticket_id 可改用该流程 ID。"""
    from ticket_list_snapshot import refresh_ticket_list_snapshot

    blocker = conn_new.execute(
        """
        SELECT id, ticket_no, legacy_instance_id
        FROM ticket
        WHERE ticket_no = %s AND id <> %s
        LIMIT 1
        """,
        (target_no, except_ticket_id),
    ).fetchone()
    if not blocker:
        return

    blocker_id = int(blocker["id"])
    legacy_id = blocker.get("legacy_instance_id")
    correct_no = ""

    if legacy_id is not None:
        inst_rows = _fetch_legacy_instances_by_ids(conn_legacy, [int(legacy_id)])
        if inst_rows:
            tasks = _fetch_legacy_tasks_by_instance_ids(conn_legacy, [int(legacy_id)])
            correct_no = _legacy_process_id(inst_rows[0], tasks.get(int(legacy_id), []))

    if correct_no and correct_no != target_no:
        holder = conn_new.execute(
            "SELECT id FROM ticket WHERE ticket_no = %s AND id <> %s LIMIT 1",
            (correct_no, blocker_id),
        ).fetchone()
        if holder:
            _displace_ticket_no_holder(
                conn_new,
                conn_legacy,
                target_no=correct_no,
                except_ticket_id=blocker_id,
                refresh_snapshot=refresh_snapshot,
            )
        new_no_for_blocker = _next_free_ticket_no(
            conn_new, correct_no, except_ticket_id=blocker_id
        )
    else:
        new_no_for_blocker = _next_free_ticket_no(
            conn_new,
            f"{target_no}_displaced_{blocker_id}",
            except_ticket_id=blocker_id,
        )

    conn_new.execute(
        "UPDATE ticket SET ticket_no = %s, updated_at = NOW() WHERE id = %s",
        (new_no_for_blocker, blocker_id),
    )
    if refresh_snapshot:
        refresh_ticket_list_snapshot(conn_new, blocker_id)
    logger.info(
        "repair_legacy displaced blocker ticket_id=%s %s -> %s for target=%s",
        blocker_id,
        blocker.get("ticket_no"),
        new_no_for_blocker,
        target_no,
    )


def _migrate_legacy_instance_row(
    conn_new: psycopg.Connection,
    conn_legacy: psycopg.Connection,
    inst: dict[str, Any],
    *,
    template_id: int,
    node_meta: dict[str, dict[str, Any]],
    node_fields: dict[str, set[str]],
    summary: dict[str, Any],
    legacy_node_names: dict[int, str] | None = None,
    cn_label_to_field_key: dict[str, str] | None = None,
) -> None:
    if _is_deleted(inst.get("deleted")):
        summary["skipped_deleted"] += 1
        return

    already = conn_new.execute(
        "SELECT 1 FROM ticket WHERE legacy_instance_id = %s", (int(inst["id"]),)
    ).fetchone()
    if already:
        summary["skipped_existing"] += 1
        return

    parse_row = conn_legacy.execute(
        "SELECT * FROM t_work_flow_task_parse WHERE instance_id = %s ORDER BY id DESC LIMIT 1",
        (int(inst["id"]),),
    ).fetchone()
    tasks = _fetch_legacy_tasks_by_instance_ids(conn_legacy, [int(inst["id"])]).get(
        int(inst["id"]), []
    )

    try:
        conn_new.execute("SAVEPOINT mig_one")
        ticket_no = _migrate_one_instance(
            conn_new,
            inst,
            parse_row,
            tasks,
            template_id,
            node_meta,
            node_fields,
            legacy_node_names=legacy_node_names,
            cn_label_to_field_key=cn_label_to_field_key,
        )
        conn_new.execute("RELEASE SAVEPOINT mig_one")
        summary["migrated"] += 1
        summary["ticket_nos"].append(ticket_no)
        logger.info(
            "migrate_legacy instance ok legacy_id=%s ticket_no=%s",
            inst.get("id"),
            ticket_no,
        )
    except Exception as exc:  # noqa: BLE001 - 单条失败不阻断整体迁移
        conn_new.execute("ROLLBACK TO SAVEPOINT mig_one")
        summary["failed"] += 1
        if len(summary["errors"]) < 50:
            summary["errors"].append({"legacy_id": int(inst["id"]), "error": str(exc)})
        logger.error(
            "migrate_legacy instance failed legacy_id=%s error=%s",
            inst.get("id"),
            exc,
        )


def _legacy_summary_for_audit(summary: dict[str, Any]) -> dict[str, Any]:
    """审计日志用：去掉逐单号列表，避免迁入/修复刷屏。"""
    out = {k: v for k, v in summary.items() if k != "ticket_nos"}
    nos = summary.get("ticket_nos")
    if isinstance(nos, list):
        out["ticket_nos_count"] = len(nos)
    errors = out.get("errors")
    if isinstance(errors, list) and len(errors) > 5:
        out["errors"] = errors[:5]
        out["errors_truncated"] = len(errors) - 5
    return out


def _legacy_summary_for_response(summary: dict[str, Any]) -> dict[str, Any]:
    """HTTP 响应：省略 ticket_nos 大数组，降低序列化内存。"""
    return _legacy_summary_for_audit(summary)


def list_legacy_migration_candidates(
    conn_legacy: psycopg.Connection,
    conn_new: psycopg.Connection,
    *,
    limit: int = 500,
    search: str = "",
) -> dict[str, Any]:
    """列出老库可迁入工单（按 process_id 展示），供前端选择。"""
    limit = max(1, min(int(limit), 2000))
    params: list[Any] = []
    where = "WHERE 1=1"
    q = str(search or "").strip()
    if q:
        where += (
            " AND (TRIM(COALESCE(i.process_id, '')) ILIKE %s"
            " OR TRIM(COALESCE(i.description, '')) ILIKE %s"
            " OR CAST(i.id AS TEXT) = %s)"
        )
        like = f"%{q}%"
        params.extend([like, like, q])

    rows = conn_legacy.execute(
        f"""
        SELECT
          i.id AS legacy_id,
          COALESCE(
            NULLIF(TRIM(i.process_id), ''),
            (
              SELECT NULLIF(TRIM(t.instance_process_id), '')
              FROM t_work_flow_task t
              WHERE t.work_flow_instance_id = i.id AND COALESCE(t.deleted, '0') = '0'
              ORDER BY t.id
              LIMIT 1
            ),
            ''
          ) AS process_id,
          TRIM(COALESCE(i.status, '')) AS status,
          TRIM(COALESCE(i.current_work_flow_node_name, '')) AS current_node,
          TRIM(COALESCE(i.description, '')) AS description,
          i.create_time
        FROM t_work_flow_instance i
        {where}
        ORDER BY i.id DESC
        LIMIT %s
        """,
        (*params, limit),
    ).fetchall()

    legacy_ids = [int(r["legacy_id"]) for r in rows]
    migrated_ids: set[int] = set()
    if legacy_ids:
        migrated_rows = conn_new.execute(
            "SELECT legacy_instance_id FROM ticket WHERE legacy_instance_id = ANY(%s)",
            (legacy_ids,),
        ).fetchall()
        migrated_ids = {int(r["legacy_instance_id"]) for r in migrated_rows if r["legacy_instance_id"]}

    deleted_rows = conn_legacy.execute(
        "SELECT id, deleted FROM t_work_flow_instance WHERE id = ANY(%s)",
        (legacy_ids or [-1],),
    ).fetchall()
    deleted_ids = {int(r["id"]) for r in deleted_rows if _is_deleted(r.get("deleted"))}

    items: list[dict[str, Any]] = []
    for r in rows:
        lid = int(r["legacy_id"])
        desc = str(r.get("description") or "").strip()
        if len(desc) > 80:
            desc = desc[:80] + "…"
        ct = r.get("create_time")
        items.append(
            {
                "legacy_id": lid,
                "process_id": str(r.get("process_id") or "").strip(),
                "status": str(r.get("status") or "").strip(),
                "current_node": str(r.get("current_node") or "").strip(),
                "description": desc,
                "create_time": ct.isoformat() if hasattr(ct, "isoformat") else str(ct or ""),
                "is_deleted": lid in deleted_ids,
                "migrated": lid in migrated_ids,
                "selectable": lid not in deleted_ids and bool(str(r.get("process_id") or "").strip()),
            }
        )

    return {"items": items, "total": len(items), "truncated": len(items) >= limit}


def migrate_legacy_tickets(
    conn_new: psycopg.Connection,
    conn_legacy: psycopg.Connection,
    *,
    batch_size: int = 200,
    max_total: int | None = None,
    after_legacy_instance_id: int = 0,
    process_ids: list[str] | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> dict[str, Any]:
    """分批迁移老库工单到新平台，返回汇总。conn_new 由调用方负责提交/关闭。

    「迁入全部」时须配合 max_total + after_legacy_instance_id 拆成多批 HTTP 请求；
    未传 max_total 时由路由层默认 cap 为 batch_size，避免单次请求扫完整库 OOM。
    """
    template_id = _template_id(conn_new, template_code)
    node_meta = _load_node_meta(conn_new, template_code)
    node_fields = _load_node_field_keys(conn_new, template_code)
    legacy_node_names = _load_legacy_node_names(conn_legacy)
    cn_label_to_field_key = load_cn_label_to_field_key(conn_new, template_code)

    summary: dict[str, Any] = {
        "migrated": 0,
        "skipped_existing": 0,
        "skipped_deleted": 0,
        "skipped_not_found": 0,
        "failed": 0,
        "errors": [],
        "ticket_nos": [],
        "processed": 0,
        "has_more": False,
        "next_after_legacy_instance_id": None,
    }

    _log_migrate_memory("batch_init")

    selected_ids = _normalize_process_ids(process_ids)
    if selected_ids:
        logger.info(
            "migrate_legacy batch start mode=process_ids count=%s",
            len(selected_ids),
        )
        instance_ids = _legacy_instance_ids_for_process_ids(conn_legacy, selected_ids)
        found_pids: set[str] = set()
        rows = _fetch_legacy_instances_by_ids(conn_legacy, instance_ids)
        for inst in rows:
            summary["processed"] += 1
            tasks = conn_legacy.execute(
                """
                SELECT instance_process_id
                FROM t_work_flow_task
                WHERE work_flow_instance_id = %s AND COALESCE(deleted, '0') = '0'
                ORDER BY create_time, id
                LIMIT 1
                """,
                (int(inst["id"]),),
            ).fetchall()
            pid = _legacy_process_id(inst, tasks)
            if pid:
                found_pids.add(pid)
            _migrate_legacy_instance_row(
                conn_new,
                conn_legacy,
                inst,
                template_id=template_id,
                node_meta=node_meta,
                node_fields=node_fields,
                summary=summary,
                legacy_node_names=legacy_node_names,
                cn_label_to_field_key=cn_label_to_field_key,
            )
        summary["skipped_not_found"] = len(set(selected_ids) - found_pids)
        conn_new.commit()
        gc.collect()
        _log_migrate_memory("batch_done_process_ids")
        logger.info(
            "migrate_legacy batch done mode=process_ids processed=%s migrated=%s "
            "skipped_existing=%s skipped_deleted=%s skipped_not_found=%s failed=%s",
            summary["processed"],
            summary["migrated"],
            summary["skipped_existing"],
            summary["skipped_deleted"],
            summary["skipped_not_found"],
            summary["failed"],
        )
        if summary["errors"]:
            logger.warning(
                "migrate_legacy batch errors sample=%s",
                summary["errors"][:5],
            )
        return summary

    last_id = max(0, int(after_legacy_instance_id or 0))
    processed = 0
    logger.info(
        "migrate_legacy batch start after_legacy_instance_id=%s batch_size=%s max_total=%s rss_mb=%s",
        last_id,
        batch_size,
        max_total if max_total is not None else "all",
        _process_rss_mb(),
    )
    while True:
        fetch_limit = batch_size
        if max_total is not None:
            remaining = max_total - processed
            if remaining <= 0:
                break
            fetch_limit = min(batch_size, remaining)

        rows = conn_legacy.execute(
            f"""
            SELECT {_INSTANCE_COLUMNS}
            FROM t_work_flow_instance
            WHERE id > %s
            ORDER BY id
            LIMIT %s
            """,
            (last_id, fetch_limit),
        ).fetchall()
        if not rows:
            break

        for inst in rows:
            last_id = int(inst["id"])
            processed += 1
            _migrate_legacy_instance_row(
                conn_new,
                conn_legacy,
                inst,
                template_id=template_id,
                node_meta=node_meta,
                node_fields=node_fields,
                summary=summary,
                legacy_node_names=legacy_node_names,
                cn_label_to_field_key=cn_label_to_field_key,
            )

        conn_new.commit()
        gc.collect()
        if max_total is not None and processed >= max_total:
            more = conn_legacy.execute(
                "SELECT 1 FROM t_work_flow_instance WHERE id > %s LIMIT 1",
                (last_id,),
            ).fetchone()
            if more:
                summary["has_more"] = True
                summary["next_after_legacy_instance_id"] = last_id
            break
        if len(rows) < fetch_limit:
            break

    summary["processed"] = processed
    _log_migrate_memory("batch_done")
    logger.info(
        "migrate_legacy batch done processed=%s migrated=%s skipped_existing=%s "
        "skipped_deleted=%s failed=%s has_more=%s next_after=%s",
        summary["processed"],
        summary["migrated"],
        summary["skipped_existing"],
        summary["skipped_deleted"],
        summary["failed"],
        summary["has_more"],
        summary.get("next_after_legacy_instance_id"),
    )
    if summary["errors"]:
        logger.warning(
            "migrate_legacy batch errors sample=%s",
            summary["errors"][:5],
        )
    return summary


def repair_legacy_migrated_tickets(
    conn_new: psycopg.Connection,
    conn_legacy: psycopg.Connection,
    *,
    process_ids: list[str] | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
    limit: int | None = None,
    after_legacy_instance_id: int = 0,
    rebuild_workflow: bool = False,
    backfill_fields_from_legacy: bool = False,
    backfill_placeholder_only: bool = True,
) -> dict[str, Any]:
    """按老库修复已迁工单。

    默认（rebuild_workflow=False）：仅校正 ticket_no / status / current_node_id 并刷新列表快照。
    rebuild_workflow=True：额外按老库 task 重建 node_instance / node_data / flow_log（纠流转日志等）。
    backfill_fields_from_legacy=True：从老库 parse / instance 补全节点空字段与占位 title（不删流转）。

    limit / after_legacy_instance_id：分批修复，避免 HTTP 网关超时；返回 has_more 供前端续跑。
    """
    from config import TICKET_LIST_SNAPSHOT_ENABLED

    node_meta = _load_node_meta(conn_new, template_code)
    node_fields = _load_node_field_keys(conn_new, template_code)
    legacy_node_names = _load_legacy_node_names(conn_legacy)
    cn_label_to_field_key = load_cn_label_to_field_key(conn_new, template_code)
    summary: dict[str, Any] = {
        "repaired": 0,
        "skipped_unchanged": 0,
        "skipped_not_found": 0,
        "failed": 0,
        "errors": [],
        "ticket_nos": [],
        "processed": 0,
        "has_more": False,
        "next_after_legacy_instance_id": None,
        "ticket_no_displaced": 0,
    }

    selected_ids = _normalize_process_ids(process_ids)
    legacy_filter_ids: list[int] | None = None
    if selected_ids:
        legacy_filter_ids = _legacy_instance_ids_for_process_ids(conn_legacy, selected_ids)
        inst_rows = _fetch_legacy_instances_by_ids(conn_legacy, legacy_filter_ids)
        tasks_by_inst = _fetch_legacy_tasks_by_instance_ids(
            conn_legacy, [int(r["id"]) for r in inst_rows]
        )
        found_pids: set[str] = set()
        for inst in inst_rows:
            pid = _legacy_process_id(inst, tasks_by_inst.get(int(inst["id"]), []))
            if pid:
                found_pids.add(pid)
        summary["skipped_not_found"] = len(set(selected_ids) - found_pids)
        if summary["skipped_not_found"]:
            logger.warning(
                "repair_legacy process_ids not found in legacy db: %s",
                sorted(set(selected_ids) - found_pids),
            )
        if not legacy_filter_ids:
            logger.info("repair_legacy no matching legacy instances for process_ids=%s", selected_ids)
            return summary

    batch_limit: int | None = None
    if limit is not None:
        batch_limit = max(1, min(int(limit), 500))
    cursor_after = max(0, int(after_legacy_instance_id or 0))

    logger.info(
        "repair_legacy batch start limit=%s after_legacy_instance_id=%s process_ids=%s "
        "rebuild_workflow=%s backfill_fields=%s backfill_placeholder_only=%s",
        batch_limit if batch_limit is not None else "all",
        cursor_after,
        selected_ids if selected_ids else "all",
        rebuild_workflow,
        backfill_fields_from_legacy,
        backfill_placeholder_only,
    )

    params: list[Any] = [template_code, cursor_after]
    ticket_sql = """
        SELECT t.id, t.ticket_no, t.status, t.current_node_id, t.legacy_instance_id, t.title
        FROM ticket t
        JOIN workflow_template wt ON wt.id = t.template_id
        WHERE t.legacy_instance_id IS NOT NULL AND wt.template_code = %s
          AND t.legacy_instance_id > %s
    """
    if backfill_fields_from_legacy and backfill_placeholder_only and not process_ids:
        ticket_sql += " AND t.title LIKE 'Order YW%'"
    if legacy_filter_ids is not None:
        ticket_sql += " AND t.legacy_instance_id = ANY(%s)"
        params.append(legacy_filter_ids)
    ticket_sql += " ORDER BY t.legacy_instance_id"
    if batch_limit is not None:
        ticket_sql += " LIMIT %s"
        params.append(batch_limit + 1)
    tickets = conn_new.execute(ticket_sql, params).fetchall()

    has_more = False
    if batch_limit is not None and len(tickets) > batch_limit:
        has_more = True
        tickets = tickets[:batch_limit]

    refresh_snapshot = TICKET_LIST_SNAPSHOT_ENABLED
    if refresh_snapshot:
        from ticket_list_snapshot import refresh_ticket_list_snapshot

    legacy_ids = [int(r["legacy_instance_id"]) for r in tickets]
    inst_by_id = {
        int(r["id"]): r for r in _fetch_legacy_instances_by_ids(conn_legacy, legacy_ids)
    }
    tasks_by_inst = _fetch_legacy_tasks_by_instance_ids(conn_legacy, legacy_ids)
    parse_by_inst = (
        _fetch_legacy_parse_by_instance_ids(conn_legacy, legacy_ids)
        if rebuild_workflow or backfill_fields_from_legacy
        else {}
    )

    logger.info(
        "repair_legacy batch loaded tickets=%s legacy_instances=%s",
        len(tickets),
        len(inst_by_id),
    )

    last_legacy_id = cursor_after
    for row in tickets:
        summary["processed"] += 1
        legacy_id = int(row["legacy_instance_id"])
        ticket_id = int(row["id"])
        last_legacy_id = legacy_id
        inst = inst_by_id.get(legacy_id)
        if not inst:
            summary["failed"] += 1
            reason = "老库实例不存在"
            if len(summary["errors"]) < 50:
                summary["errors"].append(
                    {
                        "legacy_id": legacy_id,
                        "ticket_no": str(row["ticket_no"]),
                        "error": reason,
                    }
                )
            _log_repair_failed(
                ticket_id=ticket_id,
                legacy_id=legacy_id,
                ticket_no=str(row["ticket_no"]),
                reason=reason,
            )
            continue
        tasks = tasks_by_inst.get(legacy_id, [])
        new_no = _legacy_process_id(inst, tasks)
        if not new_no:
            summary["failed"] += 1
            reason = "老库缺少 process_id / instance_process_id"
            if len(summary["errors"]) < 50:
                summary["errors"].append(
                    {
                        "legacy_id": legacy_id,
                        "ticket_no": str(row["ticket_no"]),
                        "error": reason,
                    }
                )
            _log_repair_failed(
                ticket_id=ticket_id,
                legacy_id=legacy_id,
                ticket_no=str(row["ticket_no"]),
                reason=reason,
            )
            continue

        new_status = _legacy_status_raw(inst.get("status"))
        current_key = _legacy_instance_current_node_key(
            inst, node_meta, tasks=tasks, legacy_node_names=legacy_node_names
        )
        new_node_id = node_meta[current_key]["id"]

        old_no = str(row["ticket_no"])
        old_status = str(row["status"] or "")
        old_node_id = int(row["current_node_id"]) if row["current_node_id"] is not None else None

        fields_changed = not (
            old_no == new_no and old_status == new_status and old_node_id == new_node_id
        )
        needs_backfill = False
        if backfill_fields_from_legacy:
            needs_backfill = _ticket_needs_legacy_field_backfill(
                conn_new,
                ticket_id=ticket_id,
                ticket_no=old_no,
                placeholder_only=backfill_placeholder_only,
            )

        if not rebuild_workflow and not fields_changed and not needs_backfill:
            summary["skipped_unchanged"] += 1
            continue

        conn_new.execute("SAVEPOINT repair_one")
        try:
            if old_no != new_no:
                before = conn_new.execute(
                    """
                    SELECT id FROM ticket
                    WHERE ticket_no = %s AND id <> %s
                    LIMIT 1
                    """,
                    (new_no, ticket_id),
                ).fetchone()
                if before:
                    _displace_ticket_no_holder(
                        conn_new,
                        conn_legacy,
                        target_no=new_no,
                        except_ticket_id=ticket_id,
                        refresh_snapshot=refresh_snapshot,
                    )
                    summary["ticket_no_displaced"] = int(summary.get("ticket_no_displaced") or 0) + 1

            if rebuild_workflow:
                _rebuild_ticket_workflow_from_legacy(
                    conn_new,
                    ticket_id=ticket_id,
                    inst=inst,
                    parse_row=parse_by_inst.get(legacy_id),
                    tasks=tasks,
                    node_meta=node_meta,
                    node_fields=node_fields,
                    legacy_node_names=legacy_node_names,
                    cn_label_to_field_key=cn_label_to_field_key,
                )
                row_after = conn_new.execute(
                    "SELECT current_node_id FROM ticket WHERE id = %s",
                    (ticket_id,),
                ).fetchone()
                if row_after and row_after.get("current_node_id") is not None:
                    new_node_id = int(row_after["current_node_id"])
            backfill_changed = False
            if backfill_fields_from_legacy or rebuild_workflow:
                full_values = _legacy_full_values(
                    parse_by_inst.get(legacy_id),
                    inst,
                    tasks=tasks,
                    cn_label_to_field_key=cn_label_to_field_key,
                )
                if backfill_fields_from_legacy and not rebuild_workflow:
                    backfill_changed = _backfill_ticket_node_fields_from_legacy(
                        conn_new,
                        ticket_id=ticket_id,
                        full_values=full_values,
                        node_fields=node_fields,
                    )
                title_changed = _refresh_ticket_title_if_placeholder(
                    conn_new,
                    ticket_id=ticket_id,
                    ticket_no=new_no,
                    inst=inst,
                    full_values=full_values,
                )
                backfill_changed = backfill_changed or title_changed
                if backfill_changed:
                    summary["fields_backfilled"] = int(summary.get("fields_backfilled") or 0) + 1
            if fields_changed:
                conn_new.execute(
                    """
                    UPDATE ticket
                    SET ticket_no = %s, status = %s, current_node_id = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (new_no, new_status, new_node_id, ticket_id),
                )
            if refresh_snapshot and (fields_changed or rebuild_workflow or backfill_changed):
                refresh_ticket_list_snapshot(conn_new, ticket_id)
            conn_new.execute("RELEASE SAVEPOINT repair_one")
            if fields_changed or rebuild_workflow or backfill_changed:
                summary["repaired"] += 1
                summary["ticket_nos"].append(new_no)
            else:
                summary["skipped_unchanged"] += 1
        except Exception as exc:  # noqa: BLE001
            try:
                conn_new.execute("ROLLBACK TO SAVEPOINT repair_one")
            except Exception as sp_exc:  # noqa: BLE001
                logger.warning(
                    "repair_legacy savepoint rollback failed ticket_id=%s legacy_id=%s detail=%s",
                    ticket_id,
                    legacy_id,
                    sp_exc,
                )
                conn_new.rollback()
            summary["failed"] += 1
            if len(summary["errors"]) < 50:
                summary["errors"].append(
                    {
                        "legacy_id": legacy_id,
                        "ticket_no": old_no,
                        "process_id": new_no,
                        "error": str(exc),
                        "action": "repair",
                    }
                )
            _log_repair_failed(
                ticket_id=ticket_id,
                legacy_id=legacy_id,
                ticket_no=old_no,
                reason=str(exc),
                exc=exc,
            )
        else:
            logger.info(
                "repair_legacy ticket ok ticket_id=%s ticket_no=%s legacy_id=%s "
                "rebuild_workflow=%s fields_changed=%s status=%s->%s current_key=%s",
                ticket_id,
                new_no,
                legacy_id,
                rebuild_workflow,
                fields_changed,
                old_status,
                new_status,
                current_key,
            )

    conn_new.commit()
    summary["has_more"] = has_more
    if has_more and tickets:
        summary["next_after_legacy_instance_id"] = last_legacy_id
    logger.info(
        "repair_legacy batch done processed=%s repaired=%s skipped_unchanged=%s failed=%s "
        "has_more=%s next_after=%s",
        summary["processed"],
        summary["repaired"],
        summary["skipped_unchanged"],
        summary["failed"],
        summary["has_more"],
        summary.get("next_after_legacy_instance_id"),
    )
    if summary["errors"]:
        logger.warning("repair_legacy batch errors sample=%s", summary["errors"][:5])
    return summary


def count_legacy_migrated_tickets(
    conn: psycopg.Connection,
    *,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> int:
    row = conn.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM ticket t
        JOIN workflow_template wt ON wt.id = t.template_id
        WHERE t.legacy_instance_id IS NOT NULL AND wt.template_code = %s
        """,
        (template_code,),
    ).fetchone()
    return int((row or {}).get("cnt") or 0)


def delete_legacy_migrated_tickets(
    conn: psycopg.Connection,
    *,
    process_ids: list[str] | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
    limit: int | None = None,
    after_legacy_instance_id: int = 0,
    dry_run: bool = False,
) -> dict[str, Any]:
    """删除历史迁入工单（legacy_instance_id IS NOT NULL）。

    子表 ticket_node_* / ticket_flow_log / ticket_list_snapshot / ticket_stats_ticket
    等随 ticket ON DELETE CASCADE 一并清理；ticket_reminder_log 按 ticket_no 额外删除。
    limit / after_legacy_instance_id 支持分批删除，避免大批量 HTTP 超时。
    """
    summary: dict[str, Any] = {
        "deleted": 0,
        "skipped_not_found": 0,
        "processed": 0,
        "ticket_nos": [],
        "has_more": False,
        "next_after_legacy_instance_id": None,
        "dry_run": dry_run,
    }

    selected_ids = _normalize_process_ids(process_ids)
    batch_limit: int | None = None
    if limit is not None:
        batch_limit = max(1, min(int(limit), 500))
    cursor_after = max(0, int(after_legacy_instance_id or 0))

    if selected_ids and not batch_limit:
        params: list[Any] = [template_code, selected_ids]
        ticket_sql = """
            SELECT t.id, t.ticket_no, t.legacy_instance_id
            FROM ticket t
            JOIN workflow_template wt ON wt.id = t.template_id
            WHERE t.legacy_instance_id IS NOT NULL AND wt.template_code = %s
              AND t.ticket_no = ANY(%s)
            ORDER BY t.legacy_instance_id
        """
        tickets = conn.execute(ticket_sql, params).fetchall()
        found = {str(r["ticket_no"]) for r in tickets}
        summary["skipped_not_found"] = len(set(selected_ids) - found)
        summary["has_more"] = False
    else:
        params = [template_code, cursor_after]
        ticket_sql = """
            SELECT t.id, t.ticket_no, t.legacy_instance_id
            FROM ticket t
            JOIN workflow_template wt ON wt.id = t.template_id
            WHERE t.legacy_instance_id IS NOT NULL AND wt.template_code = %s
              AND t.legacy_instance_id > %s
            ORDER BY t.legacy_instance_id
        """
        if batch_limit is not None:
            ticket_sql += " LIMIT %s"
            params.append(batch_limit + 1)
        tickets = conn.execute(ticket_sql, params).fetchall()
        has_more = False
        if batch_limit is not None and len(tickets) > batch_limit:
            has_more = True
            tickets = tickets[:batch_limit]
        summary["has_more"] = has_more

    if not tickets:
        logger.info(
            "delete_legacy_migrated none cursor_after=%s process_ids=%s dry_run=%s",
            cursor_after,
            selected_ids if selected_ids else "all",
            dry_run,
        )
        return summary

    ticket_ids = [int(r["id"]) for r in tickets]
    ticket_nos = [str(r["ticket_no"]) for r in tickets]
    last_legacy_id = int(tickets[-1]["legacy_instance_id"])
    summary["processed"] = len(tickets)

    if dry_run:
        summary["deleted"] = len(tickets)
        summary["ticket_nos"] = ticket_nos
        if summary.get("has_more"):
            summary["next_after_legacy_instance_id"] = last_legacy_id
        logger.info(
            "delete_legacy_migrated dry_run count=%s has_more=%s next_after=%s",
            len(tickets),
            summary.get("has_more"),
            summary.get("next_after_legacy_instance_id"),
        )
        return summary

    conn.execute(
        """
        DELETE FROM ticket_reminder_log
        WHERE ticket_no = ANY(%s)
        """,
        (ticket_nos,),
    )
    conn.execute("DELETE FROM ticket WHERE id = ANY(%s)", (ticket_ids,))
    conn.commit()

    summary["deleted"] = len(tickets)
    summary["ticket_nos"] = ticket_nos
    if summary.get("has_more"):
        summary["next_after_legacy_instance_id"] = last_legacy_id

    logger.info(
        "delete_legacy_migrated done deleted=%s has_more=%s next_after=%s process_ids=%s",
        summary["deleted"],
        summary.get("has_more"),
        summary.get("next_after_legacy_instance_id"),
        selected_ids if selected_ids else "all",
    )
    return summary
