BEGIN;

-- 提单助手：所有权限策略默认不展示（含管理员）；需展示时在权限策略中手动打开
UPDATE role_permission_policy
SET permission_level = 'hidden',
    updated_by = 'admin',
    updated_at = NOW()
WHERE node_key = '__whitelist__'
  AND field_key = 'ticket_assistant'
  AND permission_level IS DISTINCT FROM 'hidden';

COMMIT;
