"""老平台（GaussDB）历史工单 → 新平台工单 的迁移逻辑。

老库三张核心表（见 origin_orders 设计）：
  - t_work_flow_instance     工单基本信息（当前节点/处理人/状态/创建人…）
  - t_work_flow_task         节点流转任务（每次提交一条，含目标节点与下一处理人）
  - t_work_flow_task_parse   字段解析表（column1..column64 固定列，语义见下方映射）

迁移策略：后端直连老库，按 instance.id 游标分批读取、分批提交；以 ticket.legacy_instance_id
做幂等（重复迁入跳过已迁实例，支持中断续跑）。流程 ID 取 instance.process_id（或 task
.instance_process_id）；status 保留 instance.status 原值。按 task 逐节点重建 node_instance /
node_data / flow_log，字段值取自 parse 列（按新平台 node_field_def 的归属节点落位）。
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
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
from utils.ticket_status import ticket_status_is_closed

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
    status_raw: str,
    node_meta: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
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
        if not is_closed:
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
    """迁移单个老实例为新工单，返回老库 process_id（即 ticket_no）。"""
    status_raw = _legacy_status_raw(inst.get("status"))
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
    ticket_no = _legacy_process_id(inst, tasks)
    if not ticket_no:
        raise ValueError("缺少 process_id / instance_process_id，无法作为流程 ID 迁入")

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
            status_raw,
            str(inst.get("creator_id") or ""),
            _canonical_person_display(str(inst.get("creator_name") or "")) or str(inst.get("creator_name") or ""),
            int(inst["id"]),
            created_dt,
            inst.get("update_time") or created_dt,
        ),
    ).fetchone()
    ticket_id = int(ticket["id"])

    seq = _build_node_sequence(inst, tasks, current_key, status_raw, node_meta)
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
        elif ticket_status_is_closed(status_raw):
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


def _migrate_legacy_instance_row(
    conn_new: psycopg.Connection,
    conn_legacy: psycopg.Connection,
    inst: dict[str, Any],
    *,
    template_id: int,
    node_meta: dict[str, dict[str, Any]],
    node_fields: dict[str, set[str]],
    summary: dict[str, Any],
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
    tasks = conn_legacy.execute(
        """
        SELECT current_work_flow_node_name, next_work_flow_node_name,
               next_assignee, next_assignee_id, creator_name, creator_id,
               create_time, status, instance_process_id
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
    process_ids: list[str] | None = None,
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
        "skipped_not_found": 0,
        "failed": 0,
        "errors": [],
        "ticket_nos": [],
    }

    selected_ids = _normalize_process_ids(process_ids)
    if selected_ids:
        instance_ids = _legacy_instance_ids_for_process_ids(conn_legacy, selected_ids)
        found_pids: set[str] = set()
        rows = _fetch_legacy_instances_by_ids(conn_legacy, instance_ids)
        for inst in rows:
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
            )
        summary["skipped_not_found"] = len(set(selected_ids) - found_pids)
        conn_new.commit()
        return summary

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
            _migrate_legacy_instance_row(
                conn_new,
                conn_legacy,
                inst,
                template_id=template_id,
                node_meta=node_meta,
                node_fields=node_fields,
                summary=summary,
            )

        conn_new.commit()
        if max_total is not None and processed >= max_total:
            break

    return summary


def repair_legacy_migrated_tickets(
    conn_new: psycopg.Connection,
    conn_legacy: psycopg.Connection,
    *,
    process_ids: list[str] | None = None,
    template_code: str = SCHEMA_TEMPLATE_CODE,
) -> dict[str, Any]:
    """按老库最新数据修复已迁工单的 ticket_no / status / current_node_id（及列表快照）。"""
    from config import TICKET_LIST_SNAPSHOT_ENABLED

    node_meta = _load_node_meta(conn_new, template_code)
    summary: dict[str, Any] = {
        "repaired": 0,
        "skipped_unchanged": 0,
        "skipped_not_found": 0,
        "failed": 0,
        "errors": [],
        "ticket_nos": [],
    }

    selected_ids = _normalize_process_ids(process_ids)
    legacy_filter_ids: list[int] | None = None
    if selected_ids:
        legacy_filter_ids = _legacy_instance_ids_for_process_ids(conn_legacy, selected_ids)
        found_pids: set[str] = set()
        for inst in _fetch_legacy_instances_by_ids(conn_legacy, legacy_filter_ids):
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
        summary["skipped_not_found"] = len(set(selected_ids) - found_pids)
        if not legacy_filter_ids:
            return summary

    params: list[Any] = [template_code]
    ticket_sql = """
        SELECT t.id, t.ticket_no, t.status, t.current_node_id, t.legacy_instance_id
        FROM ticket t
        JOIN workflow_template wt ON wt.id = t.template_id
        WHERE t.legacy_instance_id IS NOT NULL AND wt.template_code = %s
    """
    if legacy_filter_ids is not None:
        ticket_sql += " AND t.legacy_instance_id = ANY(%s)"
        params.append(legacy_filter_ids)
    ticket_sql += " ORDER BY t.legacy_instance_id"
    tickets = conn_new.execute(ticket_sql, params).fetchall()

    refresh_snapshot = TICKET_LIST_SNAPSHOT_ENABLED
    if refresh_snapshot:
        from ticket_list_snapshot import refresh_ticket_list_snapshot

    for row in tickets:
        legacy_id = int(row["legacy_instance_id"])
        inst_rows = _fetch_legacy_instances_by_ids(conn_legacy, [legacy_id])
        if not inst_rows:
            summary["failed"] += 1
            if len(summary["errors"]) < 50:
                summary["errors"].append(
                    {
                        "legacy_id": legacy_id,
                        "ticket_no": str(row["ticket_no"]),
                        "error": "老库实例不存在",
                    }
                )
            continue
        inst = inst_rows[0]
        tasks = conn_legacy.execute(
            """
            SELECT instance_process_id
            FROM t_work_flow_task
            WHERE work_flow_instance_id = %s AND COALESCE(deleted, '0') = '0'
            ORDER BY create_time, id
            """,
            (legacy_id,),
        ).fetchall()
        new_no = _legacy_process_id(inst, tasks)
        if not new_no:
            summary["failed"] += 1
            if len(summary["errors"]) < 50:
                summary["errors"].append(
                    {
                        "legacy_id": legacy_id,
                        "ticket_no": str(row["ticket_no"]),
                        "error": "老库缺少 process_id / instance_process_id",
                    }
                )
            continue

        new_status = _legacy_status_raw(inst.get("status"))
        current_key = LEGACY_NODE_NAME_TO_KEY.get(
            str(inst.get("current_work_flow_node_name") or "").strip(), "problem_fill"
        )
        if current_key not in node_meta:
            current_key = "problem_fill"
        new_node_id = node_meta[current_key]["id"]

        old_no = str(row["ticket_no"])
        old_status = str(row["status"] or "")
        old_node_id = int(row["current_node_id"]) if row["current_node_id"] is not None else None

        if old_no != new_no:
            conflict = conn_new.execute(
                """
                SELECT id FROM ticket
                WHERE ticket_no = %s AND id <> %s
                LIMIT 1
                """,
                (new_no, int(row["id"])),
            ).fetchone()
            if conflict:
                summary["failed"] += 1
                if len(summary["errors"]) < 50:
                    summary["errors"].append(
                        {
                            "legacy_id": legacy_id,
                            "ticket_no": old_no,
                            "error": f"流程 ID {new_no} 已被其他工单占用",
                        }
                    )
                continue

        if old_no == new_no and old_status == new_status and old_node_id == new_node_id:
            summary["skipped_unchanged"] += 1
            continue

        try:
            conn_new.execute(
                """
                UPDATE ticket
                SET ticket_no = %s, status = %s, current_node_id = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (new_no, new_status, new_node_id, int(row["id"])),
            )
            if refresh_snapshot:
                refresh_ticket_list_snapshot(conn_new, int(row["id"]))
            summary["repaired"] += 1
            summary["ticket_nos"].append(new_no)
        except Exception as exc:  # noqa: BLE001
            summary["failed"] += 1
            if len(summary["errors"]) < 50:
                summary["errors"].append(
                    {
                        "legacy_id": legacy_id,
                        "ticket_no": old_no,
                        "error": str(exc),
                    }
                )
            logger.error("repair legacy ticket %s failed: %s", row.get("id"), exc)

    conn_new.commit()
    return summary
