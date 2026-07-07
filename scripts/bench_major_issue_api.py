#!/usr/bin/bin/python3
"""重大问题列表 API 压测：连续请求并采样后端进程内存。"""
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
    # Windows fallback via PowerShell
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
    parser.add_argument("--pid", type=int, default=0, help="uvicorn 进程 PID")
    parser.add_argument("--rounds", type=int, default=20)
    parser.add_argument("--force-sync", action="store_true", help="每次强制全量同步（压力更大）")
    args = parser.parse_args()

    pid = args.pid
    if not pid:
        print("请指定 --pid（uvicorn 进程 ID）", file=sys.stderr)
        return 2

    url = (
        f"{args.base_url}/api/major-issues"
        f"?operator_id=admin&page=1&page_size=20"
        f"{'&force_sync=true' if args.force_sync else ''}"
    )

    mem_samples: list[float] = []
    latencies: list[float] = []

    print(f"=== 重大问题 API 压测 ===")
    print(f"URL: {url}")
    print(f"PID: {pid}, rounds: {args.rounds}")
    print()

    with httpx.Client(timeout=300.0) as client:
        for i in range(1, args.rounds + 1):
            t0 = time.perf_counter()
            r = client.get(url)
            elapsed = time.perf_counter() - t0
            latencies.append(elapsed)
            rss = rss_mb(pid)
            if rss is not None:
                mem_samples.append(rss)

            ok = r.status_code == 200
            total = r.json().get("total") if ok else None
            items = len(r.json().get("items") or []) if ok else 0
            rss_s = f"{rss:.1f} MB" if rss is not None else "N/A"
            print(
                f"  [{i:2d}/{args.rounds}] status={r.status_code} "
                f"total={total} items={items} "
                f"latency={elapsed*1000:.0f}ms rss={rss_s}"
            )
            if not ok:
                print(f"       body: {r.text[:200]}")
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
        print(
            f"内存 RSS: start={mem_samples[0]:.1f} MB "
            f"end={mem_samples[-1]:.1f} MB "
            f"peak={max(mem_samples):.1f} MB "
            f"delta={mem_samples[-1]-mem_samples[0]:+.1f} MB"
        )
        if mem_samples[-1] - mem_samples[0] > 200:
            print("[WARN] 内存增长超过 200MB，建议继续排查")
        else:
            print("[OK] 内存增长在可接受范围内（节流生效时后续请求应更快、内存更稳）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
