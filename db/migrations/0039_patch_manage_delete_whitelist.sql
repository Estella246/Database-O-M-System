BEGIN;

-- 补丁管理列表删除：独立白名单项 patch_manage_delete（与 workbench_delete 解耦）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', 'patch_manage_delete', 'readonly', 'migration'
FROM role_permission_policy r
WHERE r.node_key = '__whitelist__' AND r.field_key = 'patch_manage'
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
