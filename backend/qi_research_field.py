"""在研责任田统计共享原语。

供 routers/qi.py（分析看板）与 routers/improvement_report.py（改进报告）共用：
- 桶构建/槽位匹配/范围展示文本：责任田「田目录 + 节点关联」两层模型的统计口径唯一事实源
- module_window_counts：窗口内按 (domain, module_feature) 的一条 GROUP BY 聚合
  （总数/已确认/已接纳/已闭环），两处的唯一查询实现
"""
from __future__ import annotations

from datetime import datetime


def research_field_buckets(conn) -> list[dict]:
    """在研责任田统计桶：目录表 research_duty_field + 关联表 research_duty_field_binding（与工单责任田树不是一个概念）。

    每田一桶（田可关联多个「领域/模块」槽位，多模块共田）。匹配口径：qi_request.domain=槽位领域；
    module 非空要求 module_feature（不含领域前缀的模块路径，如「模块」或「模块/特性」）以 module 为前缀，
    module 为空=整领域。
    """
    fields = conn.execute(
        """SELECT id, name, owner
           FROM research_duty_field
           ORDER BY sort_order, id"""
    ).fetchall()
    bindings = conn.execute(
        """SELECT field_id, domain, module
           FROM research_duty_field_binding
           ORDER BY id"""
    ).fetchall()
    scopes_by_field: dict[int, list[dict]] = {}
    for b in bindings:
        scopes_by_field.setdefault(int(b["field_id"]), []).append(
            {"domain": str(b["domain"] or ""), "module": str(b["module"] or "")}
        )
    # 每田一桶：一个田可关联多个「领域/模块」槽位（多模块共田），统计按田合并
    return [
        {
            "name": str(f["name"] or ""),
            "owner": str(f["owner"] or ""),
            "scopes": scopes_by_field.get(int(f["id"]), []),
        }
        for f in fields
    ]


def research_scope_text(bucket: dict) -> str:
    """桶的关联范围展示文本：多个槽位用「、」拼接；模块空=整领域。"""
    parts = []
    for sc in bucket.get("scopes") or []:
        d = str(sc.get("domain") or "")
        m = str(sc.get("module") or "")
        parts.append(f"{d}（整领域）" if not m else f"{d}/{m}")
    return "、".join(parts)


def match_research_bucket(buckets: list[dict], domain: str, module_feature: str) -> int:
    """按 domain + module_feature 匹配统计桶，返回桶下标；不匹配返回 -1。module 空=整领域。

    桶 = 在研责任田目录田，带若干关联槽位 scopes（多模块可共田，命中任一槽位即归该田）。
    module_feature 存的是不含领域前缀的模块路径（前端级联「领域不重复进路径」，如「模块」或「模块/特性」），
    因此模块槽位匹配 mf == module 或以 module + '/' 开头的更深路径。
    口径「模块槽位吃掉本模块单，整领域槽位兜底其余」由本函数保证，与田的 sort_order 无关：
    模块槽位命中即优先返回；整领域槽位只兜底未命中模块槽位的单（首个整领域槽位所在的田）。
    """
    dom = str(domain or "").strip()
    mf = str(module_feature or "").strip()
    fallback = -1
    for i, b in enumerate(buckets):
        for sc in b.get("scopes") or []:
            if str(sc.get("domain") or "") != dom:
                continue
            mod = str(sc.get("module") or "")
            if not mod:
                if fallback < 0:
                    fallback = i
                continue
            if mf == mod or mf.startswith(mod + "/"):
                return i
    return fallback


def module_window_counts(
    conn, start: datetime, end: datetime, extra_preds: list[str] | None = None
) -> list[dict]:
    """窗口内按 (domain, module_feature) 一条 GROUP BY 聚合：总数/已确认/已接纳/已闭环。

    extra_preds 为调用方附加谓词（如看板的状态/阶段筛选，已带 r. 前缀与自身参数占位符）；
    改进报告与看板 research_field_stats 共用本实现，口径唯一。
    """
    preds_sql = ""
    params: list = [start, end]
    if extra_preds:
        preds_sql = " AND " + " AND ".join(extra_preds)
    rows = conn.execute(
        f"""SELECT r.domain, r.module_feature, COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE EXISTS (
                     SELECT 1 FROM qi_stage_data sd JOIN qi_stage s2 ON s2.id = sd.stage_id
                     WHERE sd.request_id = r.id AND sd.stage_key = 'analysis'
                       AND sd.draft = FALSE AND sd.values_json->>'accept' IN ('是','否'))) AS analyzed,
                   COUNT(*) FILTER (WHERE EXISTS (
                     SELECT 1 FROM qi_stage_data sd JOIN qi_stage s2 ON s2.id = sd.stage_id
                     WHERE sd.request_id = r.id AND sd.stage_key = 'analysis'
                       AND sd.draft = FALSE AND sd.values_json->>'accept' = '是')) AS accepted,
                   COUNT(*) FILTER (WHERE r.current_status = 'closed' AND r.current_stage = 'acceptance') AS closed_done
            FROM qi_request r
            WHERE r.current_status != 'draft' AND r.created_at >= %s AND r.created_at < %s{preds_sql}
            GROUP BY r.domain, r.module_feature""",
        tuple(params),
    ).fetchall()
    return [dict(r) for r in rows]
