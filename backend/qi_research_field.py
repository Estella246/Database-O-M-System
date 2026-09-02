"""在研责任田统计共享原语。

供 routers/qi.py（分析看板）与 routers/improvement_report.py（改进报告）共用：
- 桶构建/槽位匹配/范围展示文本：责任田「田目录 + 节点关联」两层模型的统计口径唯一事实源
- module_window_counts：窗口内按 (domain, module_feature) 的一条 GROUP BY 聚合
  （总数/已确认/已接纳/已闭环），两处的唯一查询实现
"""
from __future__ import annotations

from datetime import datetime

from utils.person_display import parse_person_parts_lenient, person_key

# 「生效责任人」子查询（人兜底归桶的数据源）：确认/实施阶段最新非空 responsible。
# 注意：与 qi.py handler_stage_rows / improvement_report._inflight_rows 的 resp（任意阶段最新非空
# responsible，用于「当前处理人」）刻意不同源——验收阶段转单写的 acceptance.responsible 不得参与
# 人兜底归桶。两处消费方只引用本常量，禁止各自再拼。
RF_RESPONSIBLE_LATERAL = """LEFT JOIN LATERAL (
    SELECT s.responsible FROM qi_stage s
    WHERE s.request_id = r.id AND s.stage_key IN ('analysis', 'closure') AND s.responsible <> ''
    ORDER BY s.id DESC LIMIT 1
) rfresp ON TRUE"""


def research_field_buckets(conn) -> list[dict]:
    """在研责任田统计桶：目录表 research_duty_field + 关联表 research_duty_field_binding（与工单责任田树不是一个概念）。

    每田一桶（田可关联多个「领域/模块」槽位，多模块共田）。匹配口径：qi_request.domain=槽位领域；
    module 非空要求 module_feature（不含领域前缀的模块路径，如「模块」或「模块/特性」）以 module 为前缀，
    module 为空=整领域。
    owner 支持多人（「；」分隔，读侧对历史遗留分隔符宽容解析）：owner_persons/owner_keys/
    owner_tokens 供人兜底归桶（match_owner_bucket），owner 原样保留供响应透出。
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
    out = []
    for f in fields:
        owner = str(f["owner"] or "")
        owner_persons = parse_person_parts_lenient(owner)
        out.append({
            "name": str(f["name"] or ""),
            "owner": owner,
            "owner_persons": owner_persons,
            "owner_keys": {person_key(p) for p in owner_persons if person_key(p)},
            # 全部词元并集（账号∪姓名）：供单词元责任人（裸账号/裸姓名）兜底比对
            "owner_tokens": {t for p in owner_persons for t in p.split()},
            "scopes": scopes_by_field.get(int(f["id"]), []),
        })
    return out


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


def match_owner_bucket(buckets: list[dict], responsible: str) -> int:
    """按「生效责任人」匹配统计桶（人兜底），返回桶下标；无命中返回 -1。

    责任人与桶 owner 段都转成 person_key（次序无关词元键）比对，段序/空白写法差异不干扰；
    责任人为单词元（QI 处理人是自由文本，提交校验允许只填账号，也有只填姓名的存量）
    时，命中该田任一 owner 段的任一词元（账号或姓名）即视为同人——否则裸账号与
    「姓名 账号」owner 词元数不等，结构上永远匹配不上，人兜底静默漏计。
    多词元且非同键（如「姓名+别人账号」的错位组合）不命中，避免过度匹配。
    桶序即 research_duty_field 的 (sort_order, id)——同一责任人属于多个田时取首个，
    与 match_research_bucket 的整领域兜底「首个槽位」约定一致。
    """
    key = person_key(responsible)
    if not key:
        return -1
    single = key[0] if len(key) == 1 else None
    for i, b in enumerate(buckets):
        if key in (b.get("owner_keys") or set()):
            return i
        if single is not None and single in (b.get("owner_tokens") or set()):
            return i
    return -1


def match_bucket_module_then_owner(
    buckets: list[dict], domain: str, module_feature: str, responsible: str
) -> int:
    """归桶总口径：模块槽位优先，人兜底。每单严格归 0/1 个田（无跨田重叠）。

    ① match_research_bucket（模块槽位精确/前缀 + 整领域兜底）命中即返回——与历史行为逐字节
    等价，已绑模块的统计数字零变化；
    ② 未命中任何田时，若该单生效责任人（确认/实施最新非空 qi_stage.responsible，见
    RF_RESPONSIBLE_LATERAL）属于某田责任人集合（词元键比对，裸账号/裸姓名亦命中），归该田
    （多田命中按桶序取首个）；
    ③ 否则不归任何田。
    """
    bi = match_research_bucket(buckets, domain, module_feature)
    if bi >= 0:
        return bi
    return match_owner_bucket(buckets, responsible)


def module_window_counts(
    conn, start: datetime, end: datetime, extra_preds: list[str] | None = None
) -> list[dict]:
    """窗口内按 (domain, module_feature, 生效责任人) 一条 GROUP BY 聚合：总数/已确认/已接纳/已闭环。

    extra_preds 为调用方附加谓词（如看板的状态/阶段筛选，已带 r. 前缀与自身参数占位符）；
    改进报告与看板 research_field_stats 共用本实现，口径唯一。

    返回行含 responsible（RF_RESPONSIBLE_LATERAL 的生效责任人）：同一 (domain,module) 组的
    多个责任人拆成多行、供调用方各自独立归桶（模块优先、人兜底）。模块命中的组行无论拆成
    几行都进同一桶，合计不变（零变化保证）。
    """
    preds_sql = ""
    params: list = [start, end]
    if extra_preds:
        preds_sql = " AND " + " AND ".join(extra_preds)
    rows = conn.execute(
        f"""SELECT r.domain, r.module_feature, rfresp.responsible AS responsible, COUNT(*) AS total,
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
            {RF_RESPONSIBLE_LATERAL}
            WHERE r.current_status != 'draft' AND r.created_at >= %s AND r.created_at < %s{preds_sql}
            GROUP BY r.domain, r.module_feature, rfresp.responsible""",
        tuple(params),
    ).fetchall()
    return [dict(r) for r in rows]
