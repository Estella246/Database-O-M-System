# Database migrations (PostgreSQL)

**本目录是数据库 schema、种子数据、选项集的唯一来源。** 勿再使用已移除的 `db/postgres/`、`db/gaussdb/` 并行脚本。

This directory stores all schema changes in append-only SQL files.

## Naming convention

- `0001_init_workflow_schema.sql`
- `0002_*.sql`
- `0003_*.sql`

Always create a new file for schema/data updates. Do not rewrite an already-applied migration in shared environments.

## Apply to a new environment

**推荐**：在空库上一次性按序执行全部迁移：

```bash
export DATABASE_URL='postgresql://USER:PASS@HOST:PORT/DBNAME'
./scripts/ci/migrate-smoke.sh
```

或使用项目启动脚本（空库时自动跑迁移）：`python scripts/start.py`。

已部署环境仅执行尚未应用的新文件，例如：

```bash
psql "$DATABASE_URL" -f db/migrations/0048_biz_env_rename_problem_stage.sql
```

## CI / 本地迁移冒烟（语法与顺序）

在 **可丢弃的空库** 上按序执行全部迁移，用于尽早发现非法类型名、语法错误与顺序依赖问题：

```bash
export DATABASE_URL='postgresql://USER:PASS@HOST:PORT/DBNAME'
./scripts/ci/migrate-smoke.sh
```

脚本使用 `psql -v ON_ERROR_STOP=1`，任一语句失败即退出非零。文件名按 `LC_ALL=C sort` 排序（与 `ls *.sql | sort` 一致）。

## Rules for this repo

- Keep every migration idempotent where practical (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Put destructive operations in dedicated migrations with clear comments.
- If a field dictionary changes (like whitelist options), record it with `INSERT/UPDATE` SQL in a new migration.
- Keep source-of-truth for `问题填写` node fields in SQL seed statements so bootstrap environments are consistent.
