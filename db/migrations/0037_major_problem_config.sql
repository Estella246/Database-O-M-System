BEGIN;

CREATE TABLE IF NOT EXISTS major_problem_config (
  id BIGSERIAL PRIMARY KEY,
  field_key VARCHAR(64) NOT NULL UNIQUE,
  field_label VARCHAR(128) NOT NULL,
  field_type VARCHAR(32) NOT NULL DEFAULT 'text',
  field_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_field_type CHECK (field_type IN ('text', 'select', 'multiselect', 'checkbox', 'date', 'number'))
);

CREATE INDEX IF NOT EXISTS idx_major_problem_config_field_key ON major_problem_config (field_key);
CREATE INDEX IF NOT EXISTS idx_major_problem_config_is_active ON major_problem_config (is_active);

CREATE TRIGGER trg_major_problem_config_updated_at
BEFORE UPDATE ON major_problem_config
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE major_problem ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO major_problem_config (field_key, field_label, field_type, field_options, is_required, is_active, sort_order) VALUES
('is_risk_issue', '是否风险问题', 'checkbox', '[]', FALSE, TRUE, 1),
('is_quality_issue', '是否质量问题', 'checkbox', '[]', FALSE, TRUE, 2),
('is_customer_complaint', '是否客户投诉', 'checkbox', '[]', FALSE, TRUE, 3),
('is_production_incident', '是否生产事故', 'checkbox', '[]', FALSE, TRUE, 4),
('priority_level', '优先级等级', 'select', '[{"value": "P0", "label": "P0-紧急"}, {"value": "P1", "label": "P1-高"}, {"value": "P2", "label": "P2-中"}, {"value": "P3", "label": "P3-低"}]', FALSE, TRUE, 5),
('responsibility_team', '责任团队', 'select', '[{"value": "内核组", "label": "内核组"}, {"value": "管控组", "label": "管控组"}, {"value": "运维组", "label": "运维组"}, {"value": "测试组", "label": "测试组"}, {"value": "其他", "label": "其他"}]', FALSE, TRUE, 6);

COMMIT;