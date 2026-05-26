BEGIN;

-- 请假申请列表删除：独立白名单项 leave_delete（与 leave_apply 解耦）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', 'leave_delete', 'readonly', 'migration'
FROM role_permission_policy r
WHERE r.node_key = '__whitelist__' AND r.field_key = 'leave_application'
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

-- user_account 已无 is_pl（0069）；权限策略基线写入 is_pl=false
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT ua.role_code, FALSE, '__whitelist__', 'leave_delete', 'readonly', 'migration'
FROM user_account ua
WHERE btrim(coalesce(ua.role_code, '')) <> ''
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
