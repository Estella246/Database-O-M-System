-- 催办通知记录表
CREATE TABLE IF NOT EXISTS ticket_reminder_log (
  id SERIAL PRIMARY KEY,
  ticket_no VARCHAR(32) NOT NULL,
  severity VARCHAR(32) NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  last_reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ticket_reminder_ticket_no UNIQUE (ticket_no)
);