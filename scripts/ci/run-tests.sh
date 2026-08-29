#!/usr/bin/env bash
# 一键跑全量测试：先 API/M13 等非 e2e，再 e2e。
# 原因：同一 pytest 进程内先跑 test/e2e（Playwright）再跑 test_m13_frontend 可能触发
# 「Sync API inside the asyncio loop」。分两进程可避免。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/test"
rc=0
echo "== pytest: test/* (excluding e2e) =="
python -m pytest . --ignore=e2e -v --tb=short "$@" || rc=1
echo "== pytest: e2e =="
python -m pytest e2e -v --tb=short "$@" || rc=1
echo "== node --test: frontend regression (*.regression.mjs) =="
# jest 无 ESM 配置不收集 .mjs，node:test 真 import ES Module 跑行为断言
node --test frontend_tests/__tests__/*.regression.mjs || rc=1
exit "$rc"
