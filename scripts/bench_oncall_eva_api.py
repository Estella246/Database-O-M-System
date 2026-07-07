#!/usr/bin/env python3
"""运维效率 API 压测：连续请求 /scores 并采样后端进程内存。"""
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
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"(Get-Process -Id {pid} -ErrorAction Stop).WorkingSet64",
            ],
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
    args = parser.parse_args()

    url = (
        f"{args.base_url}/api/oncall-eva/scores"
        f"?year={args.year}&month={args.month}&operator_id=admin"
    )

    mem_samples: list[float] = []
    latencies: list[float] = []

    print("=== 运维效率 /scores API 压测 ===")
    print(f"URL: {url}")
    print(f"PID: {args.pid}, rounds: {args.rounds}")
    print()

    with httpx.Client(timeout=600.0) as client:
        for i in range(1, args.rounds + 1):
            t0 = time.perf_counter()
            r = client.get(url)
            elapsed = time.perf_counter() - t0
            latencies.append(elapsed)
            rss = rss_mb(args.pid)
            if rss is not None:
                mem_samples.append(rss)

            ok = r.status_code == 200
            body = r.json() if ok else {}
            items = len(body.get("items") or []) if ok else 0
            tickets = (body.get("team") or {}).get("total_tickets") if ok else None
            rss_s = f"{rss:.1f} MB" if rss is not None else "N/A"
            print(
                f"  [{i:2d}/{args.rounds}] status={r.status_code} "
                f"people={items} team_tickets={tickets} "
                f"latency={elapsed*1000:.0f}ms rss={rss_s}"
            )
            if not ok:
                print(f"       body: {r.text[:300]}")
                return 1

    print()
    if latencies:
        print(
            f"延迟 ms: min={min(latencies)*1000:.0f} "
            f"p50={statistics.median(latencies)*1000:.0f} "
            f"max={max(latencies)*1000:.0f} "
            f"avg={statistics.mean(latencies)*1000:.0f}"
        )
    if mem_samples:
        delta = mem_samples[-1] - mem_samples[0]
        print(
            f"内存 RSS: start={mem_samples[0]:.1f} MB "
            f"end={mem_samples[-1]:.1f} MB "
            f"peak={max(mem_samples):.1f} MB "
            f"delta={delta:+.1f} MB"
        )
        if delta > 200:
            print("[WARN] 内存增长超过 200MB")
        else:
            print("[OK] 内存增长在可接受范围内")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
