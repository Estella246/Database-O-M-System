-- 重大问题（工单驱动）导出按钮白名单：为 admin(PL) 与 管理员(非PL) 默认授予
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
VALUES
  ('admin',   TRUE,  '__whitelist__', 'major_problem_export', 'readonly', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'major_problem_export', 'readonly', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;
