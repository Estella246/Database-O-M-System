BEGIN;

-- 提单助手 / 是否支持转人工：editable=是（完整提单+转人工），readonly=否（纯对话）
-- 默认「是」，与开启提单助手后的既有行为一致
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', 'ticket_assistant_transfer', 'editable', 'migration'
FROM role_permission_policy r
WHERE r.node_key = '__whitelist__'
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT ua.role_code, FALSE, '__whitelist__', 'ticket_assistant_transfer', 'editable', 'migration'
FROM user_account ua
WHERE btrim(coalesce(ua.role_code, '')) <> ''
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
