-- 为“管理员”权限组补齐权限策略页编辑能力（页面可见 + 新增权限组 + 配置白名单）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
VALUES
  ('管理员', FALSE, '__whitelist__', 'admin_permissions', 'editable', 'admin'),
  ('管理员', FALSE, '__whitelist__', 'admin_permissions_add', 'editable', 'admin'),
  ('管理员', FALSE, '__whitelist__', 'admin_permissions_whitelist', 'editable', 'admin')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();
