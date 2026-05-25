-- 新增需求导出权限项（白名单控制）
-- 为 admin(PL) 和 管理员(非PL) 角色配置 requirement_export 权限

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by) VALUES
  ('admin',   TRUE,  '__whitelist__', 'requirement_export', 'readonly', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'requirement_export', 'readonly', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();