"""对比月度报告导入 KPI 与工作台列筛选数量是否一致。"""
from __future__ import annotations

import calendar
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import psycopg
from psycopg.rows import dict_row

from config import SCHEMA_TEMPLATE_CODE
from routers.monthly_report import _compute_insight, _is_kernel_quality, _effective_fields_from_snapshot

_KERNEL = "内核问题"
_QUALITY_VALUES = ("是（已知质量问题）", "是（新发现质量问题）")


def _month_date_range(ym: str) -> tuple[str, str]:
    year, month = int(ym[:4]), int(ym[4:])
    last_day = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"


def workbench_count(conn, *, ym: str) -> int:
    """工作台口径：快照表 + created_at 日期闭区间 + component + is_quality_issue。"""
    created_from, created_to = _month_date_range(ym)

    row = conn.execute(
        """
        SELECT COUNT(*) AS cnt
        FROM ticket_list_snapshot tls
        WHERE tls.template_code = %(template_code)s
          AND DATE(timezone('Asia/Shanghai', tls.created_at)) >= %(created_from)s::date
          AND DATE(timezone('Asia/Shanghai', tls.created_at)) <= %(created_to)s::date
          AND tls.extra_fields->>'component' = %(component)s
          AND tls.extra_fields->>'is_quality_issue' = ANY(%(quality)s)
        """,
        {
            "template_code": SCHEMA_TEMPLATE_CODE,
            "created_from": created_from,
            "created_to": created_to,
            "component": _KERNEL,
            "quality": list(_QUALITY_VALUES),
        },
    ).fetchone()
    return int(row["cnt"] or 0)


def report_count(conn, *, ym: str) -> int:
    """报告口径：_compute_insight KPI total_count。"""
    return int(_compute_insight(conn, ym)["kpi"]["total_count"])


def report_kernel_quality_ids(conn, *, ym: str) -> set[int]:
    fields = _effective_fields_from_snapshot(conn, ym)
    return {tid for tid, f in fields.items() if _is_kernel_quality(f)}


def workbench_ids(conn, *, ym: str) -> set[int]:
    created_from, created_to = _month_date_range(ym)
    rows = conn.execute(
        """
        SELECT tls.ticket_id, tls.ticket_no
        FROM ticket_list_snapshot tls
        WHERE tls.template_code = %(template_code)s
          AND DATE(timezone('Asia/Shanghai', tls.created_at)) >= %(created_from)s::date
          AND DATE(timezone('Asia/Shanghai', tls.created_at)) <= %(created_to)s::date
          AND tls.extra_fields->>'component' = %(component)s
          AND tls.extra_fields->>'is_quality_issue' = ANY(%(quality)s)
        ORDER BY tls.ticket_no
        """,
        {
            "template_code": SCHEMA_TEMPLATE_CODE,
            "created_from": created_from,
            "created_to": created_to,
            "component": _KERNEL,
            "quality": list(_QUALITY_VALUES),
        },
    ).fetchall()
    return {int(r["ticket_id"]) for r in rows}


def main() -> int:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: DATABASE_URL 未设置")
        return 1

    months = os.environ.get("VERIFY_YM", "202606,209907").split(",")
    exit_code = 0

    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        for raw in months:
            ym = raw.strip()
            if not ym:
                continue
            wb = workbench_count(conn, ym=ym)
            rp = report_count(conn, ym=ym)
            ok = wb == rp
            status = "OK" if ok else "MISMATCH"
            print(f"[{status}] ym={ym}  workbench={wb}  report={rp}")
            if not ok:
                exit_code = 1
                wb_ids = workbench_ids(conn, ym=ym)
                rp_ids = report_kernel_quality_ids(conn, ym=ym)
                only_report = rp_ids - wb_ids
                only_workbench = wb_ids - rp_ids
                if only_report:
                    rows = conn.execute(
                        """
                        SELECT ticket_id, ticket_no,
                               extra_fields->>'component' AS component,
                               extra_fields->>'is_quality_issue' AS quality
                        FROM ticket_list_snapshot
                        WHERE ticket_id = ANY(%s)
                        ORDER BY ticket_no
                        LIMIT 20
                        """,
                        (list(only_report),),
                    ).fetchall()
                    print(f"  only in report ({len(only_report)}):", [r["ticket_no"] for r in rows[:10]])
                    if not rows:
                        print("  (report-only tickets have no snapshot row)")
                if only_workbench:
                    rows = conn.execute(
                        """
                        SELECT ticket_id, ticket_no FROM ticket_list_snapshot
                        WHERE ticket_id = ANY(%s) ORDER BY ticket_no LIMIT 10
                        """,
                        (list(only_workbench),),
                    ).fetchall()
                    print(f"  only in workbench ({len(only_workbench)}):", [r["ticket_no"] for r in rows])

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
