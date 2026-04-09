# Database migrations (PostgreSQL)

This directory stores all schema changes in append-only SQL files.

## Naming convention

- `0001_init_workflow_schema.sql`
- `0002_*.sql`
- `0003_*.sql`

Always create a new file for schema/data updates. Do not rewrite an already-applied migration in shared environments.

## Apply to a new environment

Run in order:

```bash
psql "$DATABASE_URL" -f db/migrations/0001_init_workflow_schema.sql
psql "$DATABASE_URL" -f db/migrations/0002_seed_all_node_fields_from_xlsx.sql
psql "$DATABASE_URL" -f db/migrations/0003_add_ops_closure_recovery_fields.sql
psql "$DATABASE_URL" -f db/migrations/0004_fix_ops_closure_field_order.sql
psql "$DATABASE_URL" -f db/migrations/0005_sync_problem_fill_with_latest_xlsx.sql
psql "$DATABASE_URL" -f db/migrations/0006_problem_review_xlsx_and_visibility_rules.sql
psql "$DATABASE_URL" -f db/migrations/0007_ops_analysis_relax_required_when_other_ops.sql
psql "$DATABASE_URL" -f db/migrations/0008_optional_when_handle_mode_dev_ops_audit.sql
psql "$DATABASE_URL" -f db/migrations/0009_dev_analysis_workaround_optional_when_consult.sql
psql "$DATABASE_URL" -f db/migrations/0010_add_rbac_tables.sql
psql "$DATABASE_URL" -f db/migrations/0011_add_l30030745_to_next_handler_whitelists.sql
psql "$DATABASE_URL" -f db/migrations/0012_add_handle_mode_next_handler_whitelist_map.sql
psql "$DATABASE_URL" -f db/migrations/0013_disable_no_next_handler_modes.sql
psql "$DATABASE_URL" -f db/migrations/0014_disable_ops_analysis_direct_ops_closure.sql
psql "$DATABASE_URL" -f db/migrations/0015_reenable_ops_analysis_direct_ops_closure.sql
```

Then each new migration:

```bash
psql "$DATABASE_URL" -f db/migrations/0002_your_change.sql
```

## Rules for this repo

- Keep every migration idempotent where practical (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Put destructive operations in dedicated migrations with clear comments.
- If a field dictionary changes (like whitelist options), record it with `INSERT/UPDATE` SQL in a new migration.
- Keep source-of-truth for `问题填写` node fields in SQL seed statements so bootstrap environments are consistent.
