-- 参数配置子页白名单：与 params_config 可见角色对齐，显式写入各子页「展示」策略
-- （未配置时前端默认 readonly，本迁移便于权限策略 UI 展示一致）
BEGIN;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', sub.field_key, 'readonly', 'migration'
FROM role_permission_policy r
CROSS JOIN (
  VALUES
    ('params_duty_field_edit'),
    ('params_version_edit'),
    ('params_group_template_edit'),
    ('params_issue_root_cause'),
    ('params_llm_config')
) AS sub(field_key)
WHERE r.node_key = '__whitelist__'
  AND r.field_key = 'params_config'
  AND r.permission_level IN ('readonly', 'editable')
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
