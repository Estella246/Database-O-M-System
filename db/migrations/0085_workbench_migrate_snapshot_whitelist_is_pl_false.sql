BEGIN;

-- 0081 第二段沿用 ua.is_pl，0069 已删除 user_account.is_pl；在 0081 已执行环境上按 is_pl=false 补齐缺失角色。
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT ua.role_code, FALSE, '__whitelist__', 'workbench_migrate', 'readonly', 'migration'
FROM user_account ua
WHERE btrim(coalesce(ua.role_code, '')) <> ''
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT ua.role_code, FALSE, '__whitelist__', 'workbench_snapshot_rebuild', 'readonly', 'migration'
FROM user_account ua
WHERE btrim(coalesce(ua.role_code, '')) <> ''
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
