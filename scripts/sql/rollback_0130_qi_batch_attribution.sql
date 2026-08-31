-- 回滚迁移 0130（QI 工单闭环批量提交归属修复）：按备份表 qi_batch_attrib_fix_0130
-- 把 qi_flow_log.operator_id/operator_name 与 propose 非草稿 qi_stage_data.created_by
-- 还原为原值（闭环操作人）。comment 中的「归属修复，原操作人：…」备注保留（纯审计备注，不影响功能）。
-- 幂等：仅在当前值 <> 备份原值时更新，重跑 0 行命中。
-- 用法：psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sql/rollback_0130_qi_batch_attribution.sql
BEGIN;

UPDATE qi_flow_log fl
SET operator_id   = b.old_value,
    operator_name = b.old_name
FROM qi_batch_attrib_fix_0130 b
WHERE b.kind = 'log' AND b.row_id = fl.id
  AND (fl.operator_id <> b.old_value OR fl.operator_name <> b.old_name);

UPDATE qi_stage_data sd
SET created_by = b.old_value
FROM qi_batch_attrib_fix_0130 b
WHERE b.kind = 'stage' AND b.row_id = sd.id
  AND sd.created_by <> b.old_value;

-- 回滚结果预览（各 kind 行数应与备份表一致）
SELECT kind, count(*) AS restored_rows FROM qi_batch_attrib_fix_0130 GROUP BY kind ORDER BY kind;

COMMIT;
