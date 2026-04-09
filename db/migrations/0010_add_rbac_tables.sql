BEGIN;

CREATE TABLE IF NOT EXISTS role_permission_policy (
  id BIGSERIAL PRIMARY KEY,
  role_code VARCHAR(64) NOT NULL,
  is_pl BOOLEAN NOT NULL DEFAULT FALSE,
  node_key VARCHAR(64) NOT NULL,
  field_key VARCHAR(64) NOT NULL,
  permission_level VARCHAR(16) NOT NULL,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_permission_level CHECK (permission_level IN ('hidden', 'readonly', 'editable')),
  UNIQUE (role_code, is_pl, node_key, field_key)
);

CREATE INDEX IF NOT EXISTS idx_role_permission_lookup
ON role_permission_policy (role_code, is_pl, node_key);

CREATE TABLE IF NOT EXISTS user_account (
  id BIGSERIAL PRIMARY KEY,
  account VARCHAR(64) NOT NULL UNIQUE,
  user_name VARCHAR(128) NOT NULL,
  role_code VARCHAR(64) NOT NULL,
  group_name VARCHAR(128) NOT NULL,
  is_pl BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_account_role_group
ON user_account (role_code, group_name, is_pl);

-- Seed a basic admin user.
INSERT INTO user_account (account, user_name, role_code, group_name, is_pl, updated_by)
VALUES ('admin', '管理员', 'admin', 'platform', TRUE, 'system')
ON CONFLICT (account) DO NOTHING;

COMMIT;
