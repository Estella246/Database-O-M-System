BEGIN;

CREATE TABLE IF NOT EXISTS duty_rotation_entry (
  roster_kind VARCHAR(40) NOT NULL,
  position INT NOT NULL CHECK (position >= 0 AND position < 10000),
  account VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  last_accept_at VARCHAR(64) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (roster_kind, position),
  CONSTRAINT chk_duty_rotation_status CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_duty_rotation_kind
  ON duty_rotation_entry (roster_kind);

CREATE TABLE IF NOT EXISTS duty_site_oncall_row (
  position INT NOT NULL CHECK (position >= 0 AND position < 10000),
  site_name VARCHAR(256) NOT NULL,
  account VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  last_accept_at VARCHAR(64) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (position),
  CONSTRAINT chk_duty_site_oncall_status CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS duty_rl_oncall_row (
  duty_date DATE NOT NULL PRIMARY KEY,
  primary_account VARCHAR(64) NOT NULL,
  primary_user_name VARCHAR(128) NOT NULL DEFAULT '',
  primary_phone VARCHAR(32) NOT NULL DEFAULT '',
  backup_account VARCHAR(64) NOT NULL DEFAULT '',
  backup_user_name VARCHAR(128) NOT NULL DEFAULT '',
  backup_phone VARCHAR(32) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
