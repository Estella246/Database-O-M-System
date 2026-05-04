#!/usr/bin/env bash
# 在全新临时 PostgreSQL 上按文件名排序执行 db/migrations/*.sql，用于发现语法错误、非法类型名、顺序依赖等问题。
# 用法：
#   export DATABASE_URL='postgresql://USER:PASS@HOST:PORT/DBNAME'
#   ./scripts/ci/migrate-smoke.sh
#
# 示例（本地 Docker，库须为空或可丢弃）：
#   docker run -d --rm --name pg-migrate-smoke -e POSTGRES_PASSWORD=test -p 55434:5432 postgres:16-alpine
#   sleep 3
#   DATABASE_URL='postgresql://postgres:test@127.0.0.1:55434/postgres' ./scripts/ci/migrate-smoke.sh
#   docker stop pg-migrate-smoke
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/db/migrations"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: 请设置 DATABASE_URL（指向可丢弃的空库或专用 smoke 库）" >&2
  exit 1
fi

shopt -s nullglob
paths=("$MIG_DIR"/*.sql)
if [[ ${#paths[@]} -eq 0 ]]; then
  echo "error: 未找到 $MIG_DIR/*.sql" >&2
  exit 1
fi

echo "Applying migrations with ON_ERROR_STOP=1 ..."

count=0
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  echo "=== $(basename "$f") ==="
  psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$f"
  count=$((count + 1))
done < <(printf '%s\n' "${paths[@]}" | LC_ALL=C sort)

echo "OK: applied ${count} migration file(s)."
