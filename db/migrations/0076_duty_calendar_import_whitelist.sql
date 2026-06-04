-- 月历值班表 Excel 批量导入权限（白名单控制）
-- 为 admin(PL) 和 管理员(非PL) 角色配置 duty_calendar_import 权限

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by) VALUES
  ('admin',   TRUE,  '__whitelist__', 'duty_calendar_import', 'readonly', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'duty_calendar_import', 'readonly', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();
