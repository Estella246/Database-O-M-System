BEGIN;

-- 工作台迁入 / 重建列表快照：独立白名单项（与 workbench_delete 解耦，初始值继承 workbench_delete）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', 'workbench_migrate', r.permission_level, 'migration'
FROM role_permission_policy r
WHERE r.node_key = '__whitelist__' AND r.field_key = 'workbench_delete'
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', 'workbench_snapshot_rebuild', r.permission_level, 'migration'
FROM role_permission_policy r
WHERE r.node_key = '__whitelist__' AND r.field_key = 'workbench_delete'
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

-- 为 user_account 中出现的每个 (role_code, is_pl) 补齐（默认展示，与 patch_manage_delete 0040 一致）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT ua.role_code, ua.is_pl, '__whitelist__', 'workbench_migrate', 'readonly', 'migration'
FROM user_account ua
WHERE btrim(coalesce(ua.role_code, '')) <> ''
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT ua.role_code, ua.is_pl, '__whitelist__', 'workbench_snapshot_rebuild', 'readonly', 'migration'
FROM user_account ua
WHERE btrim(coalesce(ua.role_code, '')) <> ''
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
