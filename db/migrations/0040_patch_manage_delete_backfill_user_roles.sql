BEGIN;

-- 0039 仅从「已有 patch_manage 行」的角色补全，易遗漏仅有用户、白名单未写 patch_manage 库表行的角色。
-- 为 user_account 中出现的每个 (role_code, is_pl) 补齐 patch_manage_delete（默认展示删除）。
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT ua.role_code, ua.is_pl, '__whitelist__', 'patch_manage_delete', 'readonly', 'migration'
FROM user_account ua
WHERE btrim(coalesce(ua.role_code, '')) <> ''
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
