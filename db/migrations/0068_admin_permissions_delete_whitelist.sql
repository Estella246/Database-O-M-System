-- 权限策略页：删除权限组按钮白名单项
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
VALUES
  ('admin',   TRUE,  '__whitelist__', 'admin_permissions_delete', 'readonly', 'migration'),
  ('管理员',  FALSE, '__whitelist__', 'admin_permissions_delete', 'editable', 'migration')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();
