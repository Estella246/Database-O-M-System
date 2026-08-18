-- 改进报告（数据报表组）由权限策略白名单 `improvement_report` 控制，默认 hidden；
-- 管理员角色种入 editable，确保现有 admin 用户可见（仿 0041 monthly_report）。
BEGIN;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by) VALUES
  ('admin',   TRUE,  '__whitelist__', 'improvement_report', 'editable', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'improvement_report', 'editable', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
