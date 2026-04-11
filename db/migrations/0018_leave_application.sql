BEGIN;

CREATE TABLE IF NOT EXISTS leave_approver_whitelist (
  account VARCHAR(64) PRIMARY KEY,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_application (
  id SERIAL PRIMARY KEY,
  application_no VARCHAR(32) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL,
  application_type VARCHAR(64) NOT NULL,
  applicant_account VARCHAR(64) NOT NULL,
  applicant_display VARCHAR(256) NOT NULL,
  approver_account VARCHAR(64) NOT NULL,
  approver_display VARCHAR(256) NOT NULL,
  cc_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_handler_account VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  CONSTRAINT chk_leave_app_status CHECK (
    status IN ('待提交', '审批中', '同意申请', '拒绝申请', '已取消')
  )
);

CREATE INDEX IF NOT EXISTS idx_leave_application_status ON leave_application (status);
CREATE INDEX IF NOT EXISTS idx_leave_application_handler ON leave_application (current_handler_account);
CREATE INDEX IF NOT EXISTS idx_leave_application_applicant ON leave_application (applicant_account);

CREATE TABLE IF NOT EXISTS leave_time_segment (
  id SERIAL PRIMARY KEY,
  leave_application_id INT NOT NULL REFERENCES leave_application(id) ON DELETE CASCADE,
  seq INT NOT NULL CHECK (seq >= 0 AND seq < 1000),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  duration_hours NUMERIC(14, 4) NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  UNIQUE (leave_application_id, seq),
  CONSTRAINT chk_leave_seg_time CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS leave_application_log (
  id SERIAL PRIMARY KEY,
  leave_application_id INT NOT NULL REFERENCES leave_application(id) ON DELETE CASCADE,
  step_label VARCHAR(64) NOT NULL,
  operator_account VARCHAR(64) NOT NULL,
  operator_display VARCHAR(256) NOT NULL,
  action VARCHAR(32) NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_app_log_app ON leave_application_log (leave_application_id);

COMMIT;
