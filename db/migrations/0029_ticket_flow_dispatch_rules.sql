BEGIN;

CREATE TABLE IF NOT EXISTS holiday_day_config (
  holiday_date DATE PRIMARY KEY,
  day_type VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_holiday_day_type CHECK (day_type IN ('workday', 'weekend_holiday'))
);

ALTER TABLE duty_calendar_assignment
  ADD COLUMN IF NOT EXISTS last_accept_at VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_dispatch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_dispatch_ticket_no VARCHAR(32) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_dispatch_node_key VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_dispatch_rule JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE duty_rotation_entry
  ADD COLUMN IF NOT EXISTS last_dispatch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_dispatch_ticket_no VARCHAR(32) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_dispatch_node_key VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_dispatch_rule JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE duty_site_oncall_row
  ADD COLUMN IF NOT EXISTS last_dispatch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_dispatch_ticket_no VARCHAR(32) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_dispatch_node_key VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_dispatch_rule JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
