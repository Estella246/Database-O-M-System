-- 参数配置 / 问题根因：独立白名单项（页面可见 + 编辑按钮）
-- 为内置 admin / 管理员角色种入可见态；已有 params_config 的角色回填页面可见（readonly）
BEGIN;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by) VALUES
  ('admin',   TRUE,  '__whitelist__', 'params_issue_root_cause',      'editable', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'params_issue_root_cause',      'editable', 'system'),
  ('admin',   TRUE,  '__whitelist__', 'params_issue_root_cause_edit', 'editable', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'params_issue_root_cause_edit', 'editable', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

-- 已有「参数配置」可见的角色：默认开放问题根因页（只读入口，编辑仍须单独配置 edit 项）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', 'params_issue_root_cause', 'readonly', 'migration'
FROM role_permission_policy r
WHERE r.node_key = '__whitelist__' AND r.field_key = 'params_config'
  AND r.permission_level IN ('readonly', 'editable')
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

-- 已有拉群模板编辑权限的角色：同步开放问题根因编辑（与历史管理员参数编辑口径一致）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', 'params_issue_root_cause_edit', 'readonly', 'migration'
FROM role_permission_policy r
WHERE r.node_key = '__whitelist__' AND r.field_key = 'params_group_template_edit'
  AND r.permission_level IN ('readonly', 'editable')
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
