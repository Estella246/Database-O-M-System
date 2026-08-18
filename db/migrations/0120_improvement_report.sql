-- 改进报告（质量改进月度总结报告）主表
-- 仿 monthly_report（0036）：4 段内容以 JSONB 存储，支持分段独立保存与归档。
-- report_month 形如 '202608'，唯一标识一个月份的报告。
BEGIN;

CREATE TABLE IF NOT EXISTS improvement_report (
  id BIGSERIAL PRIMARY KEY,
  report_month VARCHAR(8) NOT NULL UNIQUE,
  title VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  section_overview JSONB NOT NULL DEFAULT '{}'::jsonb,
  section_overall JSONB NOT NULL DEFAULT '{}'::jsonb,
  section_domain JSONB NOT NULL DEFAULT '{}'::jsonb,
  section_monthly_new JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_improvement_report_status CHECK (status IN ('draft','archived')),
  CONSTRAINT chk_improvement_report_month_format CHECK (report_month ~ '^[0-9]{6}$')
);

CREATE INDEX IF NOT EXISTS idx_improvement_report_month
ON improvement_report (report_month DESC);

CREATE INDEX IF NOT EXISTS idx_improvement_report_status
ON improvement_report (status, report_month DESC);

CREATE TRIGGER trg_improvement_report_updated_at
BEFORE UPDATE ON improvement_report
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
