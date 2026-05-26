BEGIN;

-- 用户管理：扩展档案字段，移除是否 PL（权限策略表 role_permission_policy.is_pl 保留）
ALTER TABLE user_account
  ADD COLUMN IF NOT EXISTS email VARCHAR(256) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS product_line VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS min_dept VARCHAR(256) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS remark TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_user_account_role_group;

ALTER TABLE user_account DROP COLUMN IF EXISTS is_pl;

CREATE INDEX IF NOT EXISTS idx_user_account_role_group
ON user_account (role_code, group_name);

COMMIT;
