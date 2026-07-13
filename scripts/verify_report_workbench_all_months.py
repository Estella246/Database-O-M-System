"""扫描本地库各月：工作台 vs 报告 内核质量问题数量。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.dirname(__file__))

import psycopg
from psycopg.rows import dict_row

from verify_report_workbench_count import report_count, workbench_count

dsn = os.environ.get("DATABASE_URL")
if not dsn:
    print("DATABASE_URL missing")
    raise SystemExit(1)

with psycopg.connect(dsn, row_factory=dict_row) as conn:
    rows = conn.execute(
        """
        SELECT to_char(tls.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYYMM') AS ym,
               COUNT(*) AS cnt
        FROM ticket_list_snapshot tls
        WHERE tls.template_code = 'HCS_INCIDENT'
          AND tls.extra_fields->>'component' = '内核问题'
          AND tls.extra_fields->>'is_quality_issue' = ANY(ARRAY[
            '是（已知质量问题）', '是（新发现质量问题）'
          ])
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT 24
        """
    ).fetchall()

    print("month scan (workbench vs report import):")
    mismatch = 0
    if not rows:
        print("  (no kernel+quality snapshot rows in DB)")
    for r in rows:
        ym = str(r["ym"])
        wb = workbench_count(conn, ym=ym)
        rp = report_count(conn, ym=ym)
        ok = wb == rp
        if not ok:
            mismatch += 1
        print(f"  [{'OK' if ok else 'DIFF'}] {ym}: workbench={wb} report={rp}")

    print(f"summary: {len(rows)} months checked, {mismatch} mismatches")
    raise SystemExit(1 if mismatch else 0)
