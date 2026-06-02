"""老平台（GaussDB）历史工单 → 新平台工单 的迁移逻辑。

老库三张核心表（见 origin_orders 设计）：
  - t_work_flow_instance     工单基本信息（当前节点/处理人/状态/创建人…）
  - t_work_flow_task         节点流转任务（每次提交一条，含目标节点与下一处理人）
  - t_work_flow_task_parse   字段解析表（column1..column64 固定列，语义见下方映射）

迁移策略：后端直连老库，按 instance.id 游标分批读取、分批提交；以 ticket.legacy_instance_id
做幂等（重复迁入跳过已迁实例，支持中断续跑）。按 task 逐节点重建 node_instance /
node_data / flow_log，字段值取自 parse 列（按新平台 node_field_def 的归属节点落位）。
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable
from psycopg.rows import dict_row

from config import (
    SCHEMA_TEMPLATE_CODE,
    PERSON_VALUE_FIELD_KEYS,
    MULTI_PERSON_FIELD_KEYS,
)
from utils import (
    canonical_person_display as _canonical_person_display,
    canonical_multi_person_display as _canonical_multi_person_display,
)

logger = logging.getLogger(__name__)

# 老库节点名 → 新平台 node_key（兼容「运维分析/运维人员分析」等别名）
LEGACY_NODE_NAME_TO_KEY: dict[str, str] = {
    "问题填写": "problem_fill",
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
}

# 老库工单状态 → 新平台 ticket.status（仅 open/suspended/closed 三态）
# 「问题审核关闭」是走完运维分析/开发分析等阶段后、在末尾审核关闭节点关单的正常终态。
_LEGACY_STATUS_CLOSED = {"关闭", "完成", "非问题关闭", "已关闭", "问题审核关闭"}
_LEGACY_STATUS_SUSPENDED = {"暂停", "挂起", "暂时挂起"}

# t_work_flow_task_parse.columnN → 新平台 field_key（仅保留新平台有对应字段的列）。
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
    "column47": "issue_type_judge",   # 问题类型初判断
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

_INSTANCE_COLUMNS = (
    "id, work_flow_info_name, current_work_flow_node_name, current_assignee, "
    "current_assignee_id, status, description, issue_severity, creator_name, "
    "creator_id, create_time, update_time, deleted"
)


def get_legacy_dsn() -> str:
    """老库连接串：优先 LEGACY_DATABASE_URL；本地验证默认回退当前库（读模拟老表）。"""
    return (
        os.getenv("LEGACY_DATABASE_URL")
        or os.getenv("DATABASE_URL", "postgresql://estella@localhost:5432/yunwei_ticket")
    )


def legacy_conn() -> psycopg.Connection:
    return psycopg.connect(get_legacy_dsn(), row_factory=dict_row)


def _map_status(raw: Any) -> str:
    s = str(raw or "").strip()
    if s in _LEGACY_STATUS_CLOSED:
        return "closed"
    if s in _LEGACY_STATUS_SUSPENDED:
        return "suspended"
    return "open"


def _is_deleted(raw: Any) -> bool:
    return str(raw or "0").strip() not in ("", "0")


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


def _allocate_yw_ticket_no_for_date(conn: psycopg.Connection, d: date) -> str:
    """按指定自然日分配 YW+YYYYMMDD+nnn，取当日最小未占用序号（与现有规则一致）。"""
    prefix = f"YW{d.strftime('%Y%m%d')}"
    rows = conn.execute(
        """
        SELECT SUBSTRING(ticket_no FROM 11 FOR 3) AS suf
        FROM ticket
        WHERE ticket_no LIKE %s AND CHAR_LENGTH(ticket_no) = 13
        """,
        (prefix + "%",),
    ).fetchall()
    used: set[int] = set()
    for r in rows:
        try:
            used.add(int(str(r["suf"] or "")))
        except ValueError:
            pass
    for n in range(1000):
        if n not in used:
            return prefix + f"{n:03d}"
    raise RuntimeError(f"ticket_no space exhausted for {prefix}")


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
        if field_key in PERSON_VALUE_FIELD_KEYS:
            val = _normalize_person_value(field_key, val)
        out[field_key] = val
    return out


def _values_for_node(node_key: str, full_values: dict[str, str], node_fields: dict[str, set[str]]) -> dict[str, str]:
    allowed = node_fields.get(node_key, set())
    return {k: v for k, v in full_values.items() if k in allowed}


def _build_node_sequence(
    inst: dict[str, Any],
    tasks: list[dict[str, Any]],
    current_key: str,
    status_new: str,
    node_meta: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """重建工单走过的节点序列（每个元素对应一次 node_instance）。"""
    seq: list[dict[str, Any]] = []
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
            nk = LEGACY_NODE_NAME_TO_KEY.get(str(t.get("current_work_flow_node_name") or "").strip())
            if not nk or nk not in node_meta:
                continue
            seq.append(
                {
                    "node_key": nk,
                    "handler_name": handler_name,
                    "handler_id": handler_id,
                    "action_status": "completed",
                    "at": t.get("create_time") or inst.get("create_time"),
                    "next_handler": _person(t.get("next_assignee_id"), t.get("next_assignee")),
                }
            )
        # 未关闭工单：当前节点还停在某人手里，补一个进行中的 node_instance
        if status_new != "closed":
            seq.append(
                {
                    "node_key": current_key,
                    "handler_name": current_handler,
                    "handler_id": str(inst.get("current_assignee_id") or ""),
                    "action_status": "processing",
                    "at": inst.get("update_time") or inst.get("create_time"),
                    "next_handler": "",
                }
            )
        return seq

    # 无流转任务（仅 parse）：按节点顺序还原 problem_fill..当前节点
    current_order = node_meta.get(current_key, {}).get("order", 1)
    creator_handler = _person(inst.get("creator_id"), inst.get("creator_name"))
    ordered = sorted(node_meta.items(), key=lambda kv: kv[1]["order"])
    for nk, meta in ordered:
        if meta["order"] > current_order:
            break
        is_current = nk == current_key and status_new != "closed"
        seq.append(
            {
                "node_key": nk,
                "handler_name": current_handler if is_current else creator_handler,
                "handler_id": str(
                    (inst.get("current_assignee_id") if is_current else inst.get("creator_id")) or ""
                ),
                "action_status": "processing" if is_current else "completed",
                "at": inst.get("create_time"),
                "next_handler": current_handler if (not is_current and meta["order"] == current_order - 1) else "",
            }
        )
    return seq


def _migrate_one_instance(
    conn: psycopg.Connection,
    inst: dict[str, Any],
    parse_row: dict[str, Any] | None,
    tasks: list[dict[str, Any]],
    template_id: int,
    node_meta: dict[str, dict[str, Any]],
    node_fields: dict[str, set[str]],
) -> str:
    """迁移单个老实例为新工单，返回分配的 ticket_no。"""
    status_new = _map_status(inst.get("status"))
    current_key = LEGACY_NODE_NAME_TO_KEY.get(
        str(inst.get("current_work_flow_node_name") or "").strip(), "problem_fill"
    )
    if current_key not in node_meta:
        current_key = "problem_fill"

    full_values = _full_values_from_parse(parse_row)
    # 老库实例上的严重性兜底（parse 未给出时）
    if "severity" not in full_values:
        sev = str(inst.get("issue_severity") or "").strip()
        if sev:
            full_values["severity"] = sev

    created_dt = inst.get("create_time") or datetime.now()
    created_date = created_dt.date() if isinstance(created_dt, datetime) else date.today()
    ticket_no = _allocate_yw_ticket_no_for_date(conn, created_date)

    desc = str(inst.get("description") or "").strip()
    title = (desc[:60] if desc else f"Order {ticket_no}")
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
            status_new,
            str(inst.get("creator_id") or ""),
            _canonical_person_display(str(inst.get("creator_name") or "")) or str(inst.get("creator_name") or ""),
            int(inst["id"]),
            created_dt,
            inst.get("update_time") or created_dt,
        ),
    ).fetchone()
    ticket_id = int(ticket["id"])

    seq = _build_node_sequence(inst, tasks, current_key, status_new, node_meta)
    if not seq:
        # 至少落一个 problem_fill 实例，保证列表/详情可见
        seq = [
            {
                "node_key": "problem_fill",
                "handler_name": _person(inst.get("creator_id"), inst.get("creator_name")),
                "handler_id": str(inst.get("creator_id") or ""),
                "action_status": "completed",
                "at": created_dt,
                "next_handler": "",
            }
        ]

    for idx, entry in enumerate(seq):
        nk = entry["node_key"]
        node_id = node_meta[nk]["id"]
        node_at = entry.get("at") or created_dt
        next_at = seq[idx + 1].get("at") if idx + 1 < len(seq) else None
        ended_at = None if entry["action_status"] == "processing" else next_at

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

        values = _values_for_node(nk, full_values, node_fields)
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

        # 流转日志：指向下一节点；末节点若已关闭记 close
        if idx + 1 < len(seq):
            to_node_id = node_meta[seq[idx + 1]["node_key"]]["id"]
            action_type = "submit"
        elif status_new == "closed":
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

    return ticket_no


def migrate_legacy_tickets(
    conn_new: psycopg.Connection,
    conn_legacy: psycopg.Connection,
    *,
    batch_size: int = 200,
    max_total: int | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> dict[str, Any]:
    """分批迁移老库工单到新平台，返回汇总。conn_new 由调用方负责提交/关闭。"""
    template_id = _template_id(conn_new, template_code)
    node_meta = _load_node_meta(conn_new, template_code)
    node_fields = _load_node_field_keys(conn_new, template_code)

    summary: dict[str, Any] = {
        "migrated": 0,
        "skipped_existing": 0,
        "skipped_deleted": 0,
        "failed": 0,
        "errors": [],
        "ticket_nos": [],
    }

    last_id = 0
    processed = 0
    while True:
        rows = conn_legacy.execute(
            f"""
            SELECT {_INSTANCE_COLUMNS}
            FROM t_work_flow_instance
            WHERE id > %s
            ORDER BY id
            LIMIT %s
            """,
            (last_id, batch_size),
        ).fetchall()
        if not rows:
            break

        for inst in rows:
            last_id = int(inst["id"])
            processed += 1

            if _is_deleted(inst.get("deleted")):
                summary["skipped_deleted"] += 1
                continue

            already = conn_new.execute(
                "SELECT 1 FROM ticket WHERE legacy_instance_id = %s", (int(inst["id"]),)
            ).fetchone()
            if already:
                summary["skipped_existing"] += 1
                continue

            parse_row = conn_legacy.execute(
                "SELECT * FROM t_work_flow_task_parse WHERE instance_id = %s ORDER BY id DESC LIMIT 1",
                (int(inst["id"]),),
            ).fetchone()
            tasks = conn_legacy.execute(
                """
                SELECT current_work_flow_node_name, next_work_flow_node_name,
                       next_assignee, next_assignee_id, creator_name, creator_id,
                       create_time, status
                FROM t_work_flow_task
                WHERE work_flow_instance_id = %s
                  AND COALESCE(deleted, '0') = '0'
                ORDER BY create_time, id
                """,
                (int(inst["id"]),),
            ).fetchall()

            try:
                conn_new.execute("SAVEPOINT mig_one")
                ticket_no = _migrate_one_instance(
                    conn_new, inst, parse_row, tasks, template_id, node_meta, node_fields
                )
                conn_new.execute("RELEASE SAVEPOINT mig_one")
                summary["migrated"] += 1
                summary["ticket_nos"].append(ticket_no)
            except Exception as exc:  # noqa: BLE001 - 单条失败不阻断整体迁移
                conn_new.execute("ROLLBACK TO SAVEPOINT mig_one")
                summary["failed"] += 1
                if len(summary["errors"]) < 50:
                    summary["errors"].append({"legacy_id": int(inst["id"]), "error": str(exc)})
                logger.error("migrate legacy instance %s failed: %s", inst.get("id"), exc)

        conn_new.commit()
        if max_total is not None and processed >= max_total:
            break

    return summary
