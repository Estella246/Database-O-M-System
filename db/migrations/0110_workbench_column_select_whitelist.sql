BEGIN;

-- 工作台「选择列」：展示全部列 / 仅系统字段+问题填写+问题审核（默认 readonly = 全部）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', 'workbench_column_select', 'readonly', 'migration'
FROM role_permission_policy r
WHERE r.node_key = '__whitelist__' AND r.field_key = 'ticket_list'
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT ua.role_code, FALSE, '__whitelist__', 'workbench_column_select', 'readonly', 'migration'
FROM user_account ua
WHERE btrim(coalesce(ua.role_code, '')) <> ''
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
