-- oncall_eva_review / oncall_eva 基线写入 is_pl=false（用户侧按非 PL 解析白名单）。
-- 代他人申报加分项与审批、红黑事件录入共用 oncall_eva_review；未配置时默认 hidden。
BEGIN;

-- 从历史 is_pl=true 行回填到 is_pl=false
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT role_code, FALSE, node_key, field_key, permission_level, 'migration'
FROM role_permission_policy
WHERE node_key = '__whitelist__'
  AND field_key IN ('oncall_eva', 'oncall_eva_review')
  AND is_pl = TRUE
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
