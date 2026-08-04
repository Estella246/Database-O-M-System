BEGIN;

CREATE TABLE IF NOT EXISTS ticket_assistant_session (
  id BIGSERIAL PRIMARY KEY,
  creator_id VARCHAR(64) NOT NULL,
  creator_name VARCHAR(128) NOT NULL DEFAULT '',
  form_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  title VARCHAR(256) NOT NULL DEFAULT '未命名会话',
  jiuwen_session_id VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'chatting',
  ticket_no VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ticket_assistant_session_status_chk
    CHECK (status IN ('chatting', 'transferred', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_assistant_session_creator
  ON ticket_assistant_session (creator_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_assistant_session_jiuwen
  ON ticket_assistant_session (jiuwen_session_id)
  WHERE jiuwen_session_id <> '';

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
VALUES
  ('管理员', FALSE, '__whitelist__', 'ticket_assistant', 'editable', 'admin')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();

COMMIT;
