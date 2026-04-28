BEGIN;

CREATE TABLE IF NOT EXISTS requirement (
  id BIGSERIAL PRIMARY KEY,
  requirement_no VARCHAR(32) NOT NULL UNIQUE,
  title VARCHAR(256) NOT NULL,
  description TEXT NOT NULL,
  proposer VARCHAR(256) NOT NULL,
  assignee VARCHAR(256) NOT NULL,
  related_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_req_no VARCHAR(64) NOT NULL DEFAULT '',
  planned_version VARCHAR(128) NOT NULL DEFAULT '',
  planned_date DATE,
  priority SMALLINT NOT NULL DEFAULT 5,
  remark TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '待分析',
  creator_id VARCHAR(64) NOT NULL,
  creator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_requirement_status CHECK (status IN ('待分析', '待RAT决策', '开发中', '已经落地')),
  CONSTRAINT chk_requirement_priority CHECK (priority >= 1 AND priority <= 10)
);

CREATE INDEX IF NOT EXISTS idx_requirement_status ON requirement (status);
CREATE INDEX IF NOT EXISTS idx_requirement_assignee ON requirement (assignee);
CREATE INDEX IF NOT EXISTS idx_requirement_proposer ON requirement (proposer);
CREATE INDEX IF NOT EXISTS idx_requirement_creator ON requirement (creator_id);
CREATE INDEX IF NOT EXISTS idx_requirement_planned_date ON requirement (planned_date);

CREATE TRIGGER trg_requirement_updated_at
BEFORE UPDATE ON requirement
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS requirement_log (
  id BIGSERIAL PRIMARY KEY,
  requirement_id BIGINT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32),
  changed_fields JSONB,
  comment TEXT NOT NULL DEFAULT '',
  operator_id VARCHAR(64) NOT NULL,
  operator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requirement_log_req ON requirement_log (requirement_id);

COMMIT;
