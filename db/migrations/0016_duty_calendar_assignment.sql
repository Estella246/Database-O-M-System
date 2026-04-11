BEGIN;

CREATE TABLE IF NOT EXISTS duty_calendar_assignment (
  id BIGSERIAL PRIMARY KEY,
  table_kind VARCHAR(16) NOT NULL,
  duty_date DATE NOT NULL,
  account VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  shift VARCHAR(16) NOT NULL,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_duty_calendar_kind CHECK (table_kind IN ('kernel', 'control')),
  CONSTRAINT chk_duty_calendar_shift CHECK (shift IN ('full', 'night'))
);

CREATE INDEX IF NOT EXISTS idx_duty_calendar_kind_date
  ON duty_calendar_assignment (table_kind, duty_date);

COMMIT;
