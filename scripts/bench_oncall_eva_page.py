#!/usr/bin/env python3
"""运维效率整页压测：config/groups/depts/scores/extras/events + 内存采样。"""
from __future__ import annotations

import argparse
import statistics
import subprocess
import sys
import time

import httpx


def rss_mb(pid: int) -> float | None:
    try:
        import psutil

        return psutil.Process(pid).memory_info().rss / (1024 * 1024)
    except ImportError:
        pass
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", f"(Get-Process -Id {pid}).WorkingSet64"],
            text=True,
        ).strip()
        return int(out) / (1024 * 1024)
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--rounds", type=int, default=10)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--month", type=int, default=5)
    parser.add_argument("--label", default="")
    args = parser.parse_args()

    y, m = args.year, args.month
    base = args.base_url
    urls = [
        f"{base}/api/oncall-eva/config",
        f"{base}/api/oncall-eva/groups",
        f"{base}/api/oncall-eva/departments",
        f"{base}/api/oncall-eva/scores?year={y}&month={m}&operator_id=admin",
        f"{base}/api/oncall-eva/extras?year={y}&month={m}",
        f"{base}/api/oncall-eva/events?year={y}&month={m}",
    ]

    mem_samples: list[float] = []
    totals: list[float] = []
    scores_lat: list[float] = []

    tag = f" [{args.label}]" if args.label else ""
    print(f"=== 运维效率整页压测{tag} ===")
    print(f"period={y}-{m:02d}, rounds={args.rounds}, pid={args.pid}")
    print()

    with httpx.Client(timeout=600.0) as client:
        for i in range(1, args.rounds + 1):
            t0 = time.perf_counter()
            scores_ms = 0.0
            team_tickets = None
            people = None
            for u in urls:
                tu = time.perf_counter()
                r = client.get(u)
                elapsed_u = (time.perf_counter() - tu) * 1000
                if "/scores" in u:
                    scores_ms = elapsed_u
                    if r.status_code == 200:
                        body = r.json()
                        team_tickets = (body.get("team") or {}).get("total_tickets")
                        people = len(body.get("items") or [])
            total_ms = (time.perf_counter() - t0) * 1000
            totals.append(total_ms / 1000)
            scores_lat.append(scores_ms / 1000)
            rss = rss_mb(args.pid)
            if rss is not None:
                mem_samples.append(rss)
            rss_s = f"{rss:.1f} MB" if rss is not None else "N/A"
            print(
                f"  [{i:2d}/{args.rounds}] page={total_ms:.0f}ms scores={scores_ms:.0f}ms "
                f"people={people} team_tickets={team_tickets} rss={rss_s}"
            )

    print()
    print(
        f"整页 s: min={min(totals):.2f} p50={statistics.median(totals):.2f} "
        f"max={max(totals):.2f} avg={statistics.mean(totals):.2f}"
    )
    print(
        f"/scores s: min={min(scores_lat):.2f} p50={statistics.median(scores_lat):.2f} "
        f"max={max(scores_lat):.2f} avg={statistics.mean(scores_lat):.2f}"
    )
    if mem_samples:
        print(
            f"RSS MB: start={mem_samples[0]:.1f} end={mem_samples[-1]:.1f} "
            f"peak={max(mem_samples):.1f} delta={mem_samples[-1]-mem_samples[0]:+.1f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
