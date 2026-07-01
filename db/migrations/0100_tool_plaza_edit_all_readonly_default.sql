BEGIN;

-- 纠正 0099 初版将 admin/管理员 种为 editable 的情况：统一回落为 readonly（仅本人）
UPDATE role_permission_policy
SET permission_level = 'readonly',
    updated_by = 'migration',
    updated_at = NOW()
WHERE node_key = '__whitelist__'
  AND field_key = 'tool_plaza_edit'
  AND permission_level = 'editable'
  AND updated_by = 'migration';

COMMIT;
