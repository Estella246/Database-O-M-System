#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for py in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$py" >/dev/null 2>&1 && "$py" -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3, 10) else 1)" 2>/dev/null; then
    exec "$py" scripts/start.py "$@"
  fi
done
echo "[!] 未找到 Python 3.10+，请先安装（如: brew install python@3.11）后再运行 ./scripts/start.sh" >&2
exit 1
