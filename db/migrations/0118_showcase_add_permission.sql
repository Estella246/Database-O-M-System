BEGIN;

-- GaussDB大事件 Add 按钮：所有现有权限组默认不展示。
WITH permission_groups AS (
  SELECT DISTINCT role_code, is_pl
  FROM role_permission_policy
  WHERE COALESCE(role_code, '') <> ''
  UNION
  SELECT DISTINCT role_code, FALSE AS is_pl
  FROM user_account
  WHERE COALESCE(role_code, '') <> ''
)
INSERT INTO role_permission_policy (
  role_code, is_pl, node_key, field_key, permission_level, updated_by
)
SELECT
  role_code,
  is_pl,
  '__whitelist__',
  'showcase_add',
  'hidden',
  'migration'
FROM permission_groups
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
