BEGIN;

-- 用户管理：新增「领域」档案字段
ALTER TABLE user_account
  ADD COLUMN IF NOT EXISTS expert_domain VARCHAR(128) NOT NULL DEFAULT '';

COMMIT;
