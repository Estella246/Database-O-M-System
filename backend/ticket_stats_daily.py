"""统计图表日汇总预聚合：工单 submit / 快照 refresh 时增量维护。"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import psycopg
from psycopg.errors import UndefinedTable
from psycopg.types.json import Jsonb

from config import SCHEMA_TEMPLATE_CODE, TICKET_STATS_DAILY_ENABLED
from database import db_conn

logger = logging.getLogger(__name__)


def stats_daily_enabled() -> bool:
    return bool(TICKET_STATS_DAILY_ENABLED)


def _table_ready(conn: psycopg.Connection) -> bool:
    if not stats_daily_enabled():
        return False
    try:
        r = conn.execute("SELECT to_regclass('public.ticket_stats_daily') AS name").fetchone()
        return bool(r and r.get("name"))
    except Exception:
        return False


def _deep_merge_sum(base: dict[str, Any], add: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in add.items():
        if isinstance(v, dict):
            cur = out.get(k)
            if isinstance(cur, dict):
                out[k] = _deep_merge_sum(cur, v)
            else:
                out[k] = _deep_merge_sum({}, v)
        elif isinstance(v, (int, float)):
            cur = out.get(k, 0)
            if isinstance(cur, (int, float)):
                out[k] = cur + v
            else:
                out[k] = v
        else:
            out[k] = v
    return out


def _deep_merge_sub(base: dict[str, Any], sub: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in sub.items():
        if isinstance(v, dict):
            cur = out.get(k)
            if isinstance(cur, dict):
                out[k] = _deep_merge_sub(cur, v)
            elif cur is None:
                out[k] = _deep_merge_sub({}, v)
            else:
                out[k] = cur
        elif isinstance(v, (int, float)):
            cur = out.get(k, 0)
            if isinstance(cur, (int, float)):
                nv = cur - v
                if nv:
                    out[k] = nv
                elif k in out:
                    del out[k]
            else:
                out[k] = -v
        elif k in out:
            del out[k]
    return out



def _ownership_segment_keys(ticket: dict[str, Any]) -> set[str]:
    from stats_charts import _quality_value, _ticket_component

    q = _quality_value(ticket)
    comp = _ticket_component(ticket)
    q_tags = ["all"]
    if q == "known":
        q_tags.extend(["known", "yes"])
    elif q == "new":
        q_tags.extend(["new", "yes"])
    elif q == "no":
        q_tags.append("no")
    c_tags = ["all"]
    if comp in ("kernel", "control"):
        c_tags.append(comp)
    return {f"{qt}_{ct}" for qt in q_tags for ct in c_tags}


def _ownership_segment_metrics(ticket: dict[str, Any]) -> dict[str, Any]:
    from stats_charts import (
        OWNERSHIP_R_LINES,
        _is_core_c_version,
        _is_open,
        _is_spc_version,
        _module_path,
        _parse_module_levels,
        _quality_value,
        _r_of_version,
        _ticket_version,
        metrics_compound_key,
    )

    ver = _ticket_version(ticket)
    env = str(ticket.get("bizEnv") or "").strip() or "未知环境"
    site = str(ticket.get("location") or "").strip() or "未知局点"
    proc = str(ticket.get("processId") or ticket.get("orderId") or "").strip()
    qv = _quality_value(ticket)
    intro_l1, intro_l2, intro_l3 = _parse_module_levels(_module_path(ticket, "intro"))
    owner_l1, owner_l2, owner_l3 = _parse_module_levels(_module_path(ticket, "owner"))
    r_ver = _r_of_version(ver)
    seg: dict[str, Any] = {
        "total": 1,
        "trend_quality_yes": 1 if qv in ("known", "new") else 0,
        "trend_known": 1 if qv == "known" else 0,
        "trend_new": 1 if qv == "new" else 0,
        "by_version": {ver: 1},
        "by_biz_env": {env: 1},
        "by_site": {site: 1},
        "by_r_version": {r_ver: 1} if r_ver in OWNERSHIP_R_LINES else {},
        "module_intro_l1": {intro_l1: 1},
        "module_intro_l2": {f"{intro_l1}/{intro_l2}": 1},
        "module_intro_l3": {f"{intro_l1}/{intro_l2}/{intro_l3}": 1},
        "module_owner_l1": {owner_l1: 1},
        "module_owner_l2": {f"{owner_l1}/{owner_l2}": 1},
        "module_owner_l3": {f"{owner_l1}/{owner_l2}/{owner_l3}": 1},
        "version_env": {metrics_compound_key(env, ver): 1},
        "hotspot_intro": {metrics_compound_key(intro_l1, ver): 1},
        "hotspot_owner": {metrics_compound_key(owner_l1, ver): 1},
    }
    if proc:
        seg["by_site_proc"] = {site: 1}
    if _is_spc_version(ver):
        seg["spc_by_version"] = {ver: 1}
        if _is_open(ticket):
            seg["spc_open_by_version"] = {ver: 1}
    if _is_core_c_version(ver):
        seg["core_by_version"] = {ver: 1}
    if _is_open(ticket):
        seg["open_by_version"] = {ver: 1}
    dts = str(ticket.get("dts_no") or "").strip()
    if dts:
        seg["dts_intro_path"] = {dts: f"{intro_l1}/{intro_l2}"}
        seg["dts_owner_path"] = {dts: f"{owner_l1}/{owner_l2}"}
    else:
        seg["dts_dedup_intro_l2"] = {f"{intro_l1}/{intro_l2}": 1}
        seg["dts_dedup_owner_l2"] = {f"{owner_l1}/{owner_l2}": 1}
    return seg


def _labor_metrics(
    ticket: dict[str, Any],
    *,
    submitters: list[str] | None = None,
    person_stages: dict[str, dict[str, int]] | None = None,
    dwell_acc: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from stats_charts import (
        LABOR_FLOW_COMMANDO,
        LABOR_FLOW_INDEPENDENT,
        LABOR_STACK_STAGES,
        _is_open,
        _labor_person_stack_stage,
        _normalize_person_name,
        _ticket_collaborator_names,
        _ticket_stage,
    )

    raw_person = str(ticket.get("currentHandler") or ticket.get("assignee") or ticket.get("creatorName") or "").strip()
    person = _normalize_person_name(raw_person) or "未分配"
    stage = _ticket_stage(ticket)
    person_stack_stage = _labor_person_stack_stage(ticket)
    is_open = _is_open(ticket)
    created = ticket.get("createdAt") or ticket.get("created_at") or ""
    created_ms = 0.0
    if isinstance(created, datetime):
        created_ms = created.timestamp() * 1000
    elif isinstance(created, str) and created.strip():
        try:
            created_ms = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp() * 1000
        except ValueError:
            created_ms = 0.0

    flow_key = str(ticket.get("_laborFlowKey") or "").strip()

    submit_names: list[str] = []
    seen_submit: set[str] = set()
    for raw in submitters or []:
        name = _normalize_person_name(str(raw).strip()) if str(raw).strip() else ""
        if not name:
            name = str(raw).strip()
        if not name or name in seen_submit:
            continue
        seen_submit.add(name)
        submit_names.append(name)
    if not submit_names:
        # 无流转提交记录时回退当前归属人，避免空柱
        submit_names = [person]
    submit_set = set(submit_names)
    collab_only = [c for c in _ticket_collaborator_names(ticket) if c not in submit_set]

    # 各阶段人员滞留：优先节点实例历史（一单可多阶段）；否则回退当前阶段
    if person_stages:
        by_person_stage = {
            str(p): {str(st): int(c) for st, c in (stages or {}).items() if int(c or 0) > 0}
            for p, stages in person_stages.items()
        }
        by_person_stage = {p: st for p, st in by_person_stage.items() if st}
    else:
        by_person_stage = {person: {person_stack_stage: 1}}

    labor: dict[str, Any] = {
        # by_person 保留旧字段兼容；人力投入图优先读 by_person_submit (+ collab)
        "by_person": {p: 1 for p in submit_names},
        "by_person_submit": {p: 1 for p in submit_names},
        "by_stage_all": {stage: 1},
        "by_person_stage": by_person_stage,
    }
    if collab_only:
        labor["by_person_collab"] = {p: 1 for p in collab_only}
    if is_open:
        labor["by_person_open"] = {person: 1}
        labor["by_stage_open"] = {stage: 1}
        labor["by_person_stage_open"] = {person: {stage: 1}}
        labor["open_dwell"] = {stage: {"count": 1, "sum_created_ms": created_ms}}
        if stage in LABOR_STACK_STAGES:
            labor["open_dwell_stack"] = {stage: {"count": 1, "sum_created_ms": created_ms}}
    if flow_key in (LABOR_FLOW_COMMANDO, LABOR_FLOW_INDEPENDENT):
        flow_person_raw = str(ticket.get("_laborFlowPerson") or "").strip()
        flow_person = _normalize_person_name(flow_person_raw) if flow_person_raw else ""
        if flow_person:
            labor["by_person_flow"] = {flow_person: {flow_key: 1}}
    # 实例滞留累加器：读侧按 sum/count 合并后再求平均，避免人力投入页全扫实例
    if isinstance(dwell_acc, dict):
        dps = dwell_acc.get("by_person_stage")
        ds = dwell_acc.get("by_stage")
        if dps:
            labor["dwell_by_person_stage"] = dps
        if ds:
            labor["dwell_by_stage"] = ds
    return labor


def _doer_metrics(conn: psycopg.Connection, ticket_id: int, ticket: dict[str, Any]) -> dict[str, Any]:
    from stats_charts import (
        DOER_CATEGORY_PRIORITY,
        DOER_STAGE_KEYS,
        _classify_doer_multi,
        _classify_single_phase_doer,
        _fetch_doer_items,
        _is_consult_ticket,
    )

    items = _fetch_doer_items(conn, [ticket_id])
    if not items:
        return {}
    it = items[0]
    cat = _classify_doer_multi(it.get("nodes") or {}, True, True)
    ops_cat = _classify_single_phase_doer((it.get("nodes") or {}).get("ops_analysis"))
    dev_cat = _classify_single_phase_doer((it.get("nodes") or {}).get("dev_analysis"))
    is_consult = _is_consult_ticket(it.get("nodes") or {})

    created_day = ""
    closed_day = ""
    closed_hours = 0.0
    if it.get("created_at"):
        try:
            created_day = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            pass
    if it.get("closed_at") and it.get("created_at"):
        try:
            c0 = datetime.fromisoformat(str(it["created_at"]).replace("Z", "+00:00"))
            c1 = datetime.fromisoformat(str(it["closed_at"]).replace("Z", "+00:00"))
            closed_hours = max(0.0, (c1 - c0).total_seconds() / 3600.0)
            closed_day = c1.astimezone(timezone.utc).strftime("%Y-%m-%d")
        except ValueError:
            pass

    inst_hours: dict[str, float] = {}
    for nk in DOER_STAGE_KEYS:
        h = float((it.get("instances") or {}).get(nk, {}).get("hours") or 0)
        if h > 0:
            inst_hours[nk] = h

    doer: dict[str, Any] = {
        "by_category": {cat: 1},
        "by_ops_category": {ops_cat: 1},
        "by_dev_category": {dev_cat: 1},
        "include_ops_dev": {
            f"{ops_cat}_{dev_cat}": 1,
        },
    }
    if created_day:
        day_bucket = {
            "total": 1,
            "used_doer": 1 if cat in ("doer_resolved", "doer_helped", "doer_no_help") else 0,
            "consult": 1 if is_consult else 0,
            "effective": 1 if cat in ("doer_resolved", "doer_helped") else 0,
            "used_for_eff": 1 if cat in ("doer_resolved", "doer_helped", "doer_no_help") else 0,
        }
        ym = created_day[:7]
        doer["by_created_day"] = {created_day: day_bucket}
        doer["by_created_month"] = {
            ym: {"total": 1, "consult": 1 if is_consult else 0},
        }
        if cat in ("doer_resolved", "doer_helped", "doer_no_help"):
            doer["by_created_day"][created_day]["category_" + cat] = 1
    if closed_day and closed_hours > 0:
        doer["by_closed_day"] = {closed_day: {"count": 1, "sum_hours": closed_hours}}

    if is_consult:
        consult_block: dict[str, Any] = {"consult_total": 1}
        non_consult_block: dict[str, Any] = {}
    else:
        consult_block = {}
        non_consult_block = {"non_consult_total": 1}

    for nk in DOER_STAGE_KEYS:
        h = inst_hours.get(nk, 0.0)
        if h <= 0:
            continue
        used_key = f"hours_used_{nk}"
        no_key = f"hours_no_{nk}"
        if cat in ("doer_resolved", "doer_helped", "doer_no_help"):
            consult_block[used_key] = consult_block.get(used_key, 0.0) + h
            non_consult_block[used_key] = non_consult_block.get(used_key, 0.0) + h
        elif cat == "no_doer":
            consult_block[no_key] = consult_block.get(no_key, 0.0) + h
            non_consult_block[no_key] = non_consult_block.get(no_key, 0.0) + h
        if is_consult:
            consult_block[f"count_used_{nk}"] = consult_block.get(f"count_used_{nk}", 0) + (
                1 if cat in ("doer_resolved", "doer_helped", "doer_no_help") else 0
            )
            consult_block[f"count_no_{nk}"] = consult_block.get(f"count_no_{nk}", 0) + (
                1 if cat == "no_doer" else 0
            )
        else:
            non_consult_block[f"count_used_{nk}"] = non_consult_block.get(f"count_used_{nk}", 0) + (
                1 if cat in ("doer_resolved", "doer_helped", "doer_no_help") else 0
            )
            non_consult_block[f"count_no_{nk}"] = non_consult_block.get(f"count_no_{nk}", 0) + (
                1 if cat == "no_doer" else 0
            )

    if consult_block:
        doer["consult_eff"] = consult_block
    if non_consult_block:
        doer["non_consult_eff"] = non_consult_block

    _ = DOER_CATEGORY_PRIORITY  # import side-effect guard for lint
    return doer


def compute_ticket_metrics(
    conn: psycopg.Connection,
    ticket_id: int,
    ticket: dict[str, Any],
    *,
    stats_day: date,
    creator_id: str,
) -> dict[str, Any]:
    from stats_charts import (
        _fetch_ticket_flow_passthrough_flags,
        _fetch_ticket_submit_operator_names,
        _normalize_person_name,
        fetch_labor_dwell_accumulators_by_ticket,
        resolve_labor_flow_key,
    )

    ownership: dict[str, dict[str, Any]] = {}
    for sk in _ownership_segment_keys(ticket):
        ownership[sk] = _ownership_segment_metrics(ticket)

    submit_map = _fetch_ticket_submit_operator_names(conn, [ticket_id])
    submitters = list(submit_map.get(int(ticket_id), []))

    flags = _fetch_ticket_flow_passthrough_flags(conn, [ticket_id])
    has_c, has_i, nk, ops_name = flags.get(int(ticket_id), (False, False, "", ""))
    ticket_with_flow = {
        **ticket,
        "_laborFlowKey": resolve_labor_flow_key(
            status=ticket.get("status"),
            current_stage=str(ticket.get("currentStage") or ticket.get("current_stage") or ""),
            node_key=nk,
            has_commando=has_c,
            has_independent=has_i,
        ),
        "_laborFlowPerson": _normalize_person_name(ops_name) if ops_name else "",
    }
    dwell_acc = fetch_labor_dwell_accumulators_by_ticket(conn, [ticket_id]).get(int(ticket_id)) or {}
    person_stages: dict[str, dict[str, int]] = {}
    for p, stages in (dwell_acc.get("by_person_stage") or {}).items():
        st_map = {
            str(st): int(b.get("cnt") or 0) + int(b.get("cnt_open") or 0)
            for st, b in (stages or {}).items()
        }
        st_map = {st: c for st, c in st_map.items() if c > 0}
        if st_map:
            person_stages[str(p)] = st_map

    metrics: dict[str, Any] = {
        "ticket_count": 1,
        "creator_id": creator_id,
        "stats_day": stats_day.isoformat(),
        "ownership": ownership,
        "labor": _labor_metrics(
            ticket_with_flow,
            submitters=submitters,
            person_stages=person_stages,
            dwell_acc=dwell_acc,
        ),
        "doer": _doer_metrics(conn, ticket_id, ticket),
    }
    return metrics


def _apply_daily_delta(
    conn: psycopg.Connection,
    stats_day: date,
    delta: dict[str, Any],
    *,
    ticket_delta: int,
) -> None:
    if not delta and ticket_delta == 0:
        return
    row = conn.execute(
        """
        SELECT ticket_count, metrics
        FROM ticket_stats_daily
        WHERE stats_day = %s AND template_code = %s
        FOR UPDATE
        """,
        (stats_day, SCHEMA_TEMPLATE_CODE),
    ).fetchone()
    if row:
        cur_count = int(row["ticket_count"] or 0) + ticket_delta
        cur_metrics = row["metrics"] if isinstance(row["metrics"], dict) else {}
        if ticket_delta >= 0:
            new_metrics = _deep_merge_sum(cur_metrics, delta)
        else:
            new_metrics = _deep_merge_sub(cur_metrics, delta)
        if cur_count <= 0 and not new_metrics:
            conn.execute(
                "DELETE FROM ticket_stats_daily WHERE stats_day = %s AND template_code = %s",
                (stats_day, SCHEMA_TEMPLATE_CODE),
            )
            return
        conn.execute(
            """
            UPDATE ticket_stats_daily
            SET ticket_count = %s, metrics = %s::jsonb, updated_at = NOW()
            WHERE stats_day = %s AND template_code = %s
            """,
            (max(0, cur_count), Jsonb(new_metrics), stats_day, SCHEMA_TEMPLATE_CODE),
        )
    elif ticket_delta > 0:
        conn.execute(
            """
            INSERT INTO ticket_stats_daily (stats_day, template_code, ticket_count, metrics, updated_at)
            VALUES (%s, %s, %s, %s::jsonb, NOW())
            """,
            (stats_day, SCHEMA_TEMPLATE_CODE, ticket_delta, Jsonb(delta)),
        )


def _row_from_snapshot_record(r: dict[str, Any]) -> dict[str, Any]:
    from stats_charts import _row_from_snapshot

    return _row_from_snapshot(r)


def _parse_stats_day(ticket: dict[str, Any], fallback_created: Any) -> date:
    from stats_charts import _stats_day

    ymd = _stats_day(ticket)
    if ymd:
        try:
            return date.fromisoformat(ymd)
        except ValueError:
            pass
    if hasattr(fallback_created, "date"):
        return fallback_created.date()
    if isinstance(fallback_created, str) and len(fallback_created) >= 10:
        try:
            return date.fromisoformat(fallback_created[:10])
        except ValueError:
            pass
    return datetime.now(timezone.utc).date()


def refresh_ticket_stats(conn: psycopg.Connection, ticket_id: int) -> None:
    """快照 refresh / submit 后增量更新日汇总。"""
    if not _table_ready(conn):
        return

    old = conn.execute(
        "SELECT stats_day, metrics FROM ticket_stats_ticket WHERE ticket_id = %s",
        (ticket_id,),
    ).fetchone()

    snap = conn.execute(
        """
        SELECT ticket_id, ticket_no, template_code, creator_id, created_at,
               status, creator_name, current_stage, current_handler, start_date,
               location, biz_env, severity, is_quality_issue, description_plain, extra_fields
        FROM ticket_list_snapshot
        WHERE ticket_id = %s
        """,
        (ticket_id,),
    ).fetchone()

    if old:
        old_day = old["stats_day"]
        old_metrics = old["metrics"] if isinstance(old["metrics"], dict) else {}
        _apply_daily_delta(conn, old_day, old_metrics, ticket_delta=-1)
        conn.execute("DELETE FROM ticket_stats_ticket WHERE ticket_id = %s", (ticket_id,))

    if not snap or str(snap.get("template_code") or "") != SCHEMA_TEMPLATE_CODE:
        return

    ticket = _row_from_snapshot_record(dict(snap))
    stats_day = _parse_stats_day(ticket, snap.get("created_at"))
    creator_id = str(snap.get("creator_id") or "")
    metrics = compute_ticket_metrics(conn, ticket_id, ticket, stats_day=stats_day, creator_id=creator_id)

    conn.execute(
        """
        INSERT INTO ticket_stats_ticket (ticket_id, ticket_no, stats_day, template_code, creator_id, metrics, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, NOW())
        """,
        (
            ticket_id,
            str(snap.get("ticket_no") or ""),
            stats_day,
            SCHEMA_TEMPLATE_CODE,
            creator_id,
            Jsonb(metrics),
        ),
    )
    _apply_daily_delta(conn, stats_day, metrics, ticket_delta=1)


def remove_ticket_stats(conn: psycopg.Connection, ticket_id: int) -> None:
    if not _table_ready(conn):
        return
    old = conn.execute(
        "SELECT stats_day, metrics FROM ticket_stats_ticket WHERE ticket_id = %s",
        (ticket_id,),
    ).fetchone()
    if not old:
        return
    old_metrics = old["metrics"] if isinstance(old["metrics"], dict) else {}
    _apply_daily_delta(conn, old["stats_day"], old_metrics, ticket_delta=-1)
    conn.execute("DELETE FROM ticket_stats_ticket WHERE ticket_id = %s", (ticket_id,))


def fetch_merged_daily_metrics(
    conn: psycopg.Connection,
    start_date: date,
    end_date: date,
    *,
    only_self: bool,
    operator_id: str,
) -> dict[str, Any] | None:
    """读取 [start_date, end_date] 日汇总；返回 daily_slices 供图表按日/月/年展开。"""
    if not _table_ready(conn):
        return None
    try:
        if only_self:
            cid = str(operator_id or "").strip()
            rows = conn.execute(
                """
                SELECT stats_day, metrics
                FROM ticket_stats_ticket
                WHERE template_code = %s
                  AND stats_day BETWEEN %s AND %s
                  AND creator_id = %s
                ORDER BY stats_day
                """,
                (SCHEMA_TEMPLATE_CODE, start_date, end_date, cid),
            ).fetchall()
            slices = []
            for r in rows:
                m = r["metrics"] if isinstance(r["metrics"], dict) else {}
                day = r["stats_day"].isoformat() if hasattr(r["stats_day"], "isoformat") else str(r["stats_day"])
                slices.append(
                    {
                        "stats_day": day,
                        "ownership": m.get("ownership") or {},
                        "labor": m.get("labor") or {},
                        "doer": m.get("doer") or {},
                    }
                )
            return {"ticket_count": len(slices), "daily_slices": slices}

        rows = conn.execute(
            """
            SELECT stats_day, ticket_count, metrics
            FROM ticket_stats_daily
            WHERE template_code = %s AND stats_day BETWEEN %s AND %s
            ORDER BY stats_day
            """,
            (SCHEMA_TEMPLATE_CODE, start_date, end_date),
        ).fetchall()
    except UndefinedTable:
        return None

    slices: list[dict[str, Any]] = []
    ticket_count = 0
    for r in rows:
        m = r["metrics"] if isinstance(r["metrics"], dict) else {}
        day = r["stats_day"].isoformat() if hasattr(r["stats_day"], "isoformat") else str(r["stats_day"])
        slices.append(
            {
                "stats_day": day,
                "ownership": m.get("ownership") or {},
                "labor": m.get("labor") or {},
                "doer": m.get("doer") or {},
            }
        )
        ticket_count += int(r["ticket_count"] or 0)
    return {"ticket_count": ticket_count, "daily_slices": slices}


def backfill_stats_daily_batch(
    conn: psycopg.Connection,
    *,
    reset: bool = False,
    after_ticket_id: int = 0,
    batch_size: int = 50,
) -> dict[str, Any]:
    """分批回填日汇总；reset 时清空后从 ticket_id=0 起算。"""
    if not _table_ready(conn):
        raise RuntimeError("ticket_stats_daily 表不存在，请先执行 migration 0082")

    logs: list[str] = []
    batch_size = max(1, min(int(batch_size or 50), 500))
    after_ticket_id = max(0, int(after_ticket_id or 0))

    if reset:
        conn.execute("DELETE FROM ticket_stats_daily WHERE template_code = %s", (SCHEMA_TEMPLATE_CODE,))
        conn.execute("DELETE FROM ticket_stats_ticket WHERE template_code = %s", (SCHEMA_TEMPLATE_CODE,))
        after_ticket_id = 0
        logs.append("已清空 ticket_stats_daily / ticket_stats_ticket，开始全量回填")

    total_row = conn.execute(
        "SELECT COUNT(*) AS cnt FROM ticket_list_snapshot WHERE template_code = %s",
        (SCHEMA_TEMPLATE_CODE,),
    ).fetchone()
    total = int(total_row["cnt"] or 0) if total_row else 0

    if total == 0:
        logs.append("ticket_list_snapshot 无 HCS 工单，请先重建列表快照")
        return {
            "ok": True,
            "processed": 0,
            "refreshed": 0,
            "total": 0,
            "has_more": False,
            "next_after_ticket_id": 0,
            "done_cumulative": 0,
            "logs": logs,
        }

    rows = conn.execute(
        """
        SELECT ticket_id FROM ticket_list_snapshot
        WHERE template_code = %s AND ticket_id > %s
        ORDER BY ticket_id
        LIMIT %s
        """,
        (SCHEMA_TEMPLATE_CODE, after_ticket_id, batch_size),
    ).fetchall()

    processed = 0
    last_id = after_ticket_id
    for r in rows:
        tid = int(r["ticket_id"])
        refresh_ticket_stats(conn, tid)
        processed += 1
        last_id = tid

    done_row = conn.execute(
        "SELECT COUNT(*) AS cnt FROM ticket_stats_ticket WHERE template_code = %s",
        (SCHEMA_TEMPLATE_CODE,),
    ).fetchone()
    done_cumulative = int(done_row["cnt"] or 0) if done_row else 0

    has_more = False
    if last_id > after_ticket_id:
        more = conn.execute(
            """
            SELECT 1 FROM ticket_list_snapshot
            WHERE template_code = %s AND ticket_id > %s
            LIMIT 1
            """,
            (SCHEMA_TEMPLATE_CODE, last_id),
        ).fetchone()
        has_more = bool(more)

    if reset and processed == 0 and after_ticket_id == 0 and total > 0:
        logs.append(f"待回填 HCS 工单共 {total} 条，batch_size={batch_size}")
    logs.append(
        f"本批处理 {processed} 条（after_ticket_id={after_ticket_id}），累计 {done_cumulative}/{total}"
    )
    if not has_more:
        logs.append(f"回填完成：共写入 {done_cumulative} 条工单日汇总贡献")

    logger.info(
        "stats daily backfill batch processed=%s cumulative=%s total=%s has_more=%s after=%s",
        processed,
        done_cumulative,
        total,
        has_more,
        last_id,
    )

    return {
        "ok": True,
        "processed": processed,
        "refreshed": processed,
        "total": total,
        "has_more": has_more,
        "next_after_ticket_id": last_id if has_more else 0,
        "done_cumulative": done_cumulative,
        "logs": logs,
    }


def refresh_all_hcs_stats(batch_size: int = 500) -> dict[str, int]:
    """全量回填日汇总（CLI；Web 请用 backfill_stats_daily_batch 分批）。"""
    done = 0
    total = 0
    after = 0
    reset = True
    while True:
        with db_conn() as conn:
            summary = backfill_stats_daily_batch(
                conn,
                reset=reset,
                after_ticket_id=after,
                batch_size=batch_size or 500,
            )
            conn.commit()
        total = int(summary.get("total") or total)
        done = int(summary.get("done_cumulative") or done)
        if not summary.get("has_more"):
            break
        after = int(summary.get("next_after_ticket_id") or 0)
        reset = False
        if not after:
            break
    logger.info("stats daily backfill done refreshed=%s total=%s", done, total)
    return {"refreshed": done, "total": total}
