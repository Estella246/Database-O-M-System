BEGIN;

-- 「需求管理」重构为「质量改进」：删除原 requirement 表的全部旧列，按新列结构重建该表。
-- 直接 DROP 重建（含依赖的 requirement_log 与触发器），保证存量库最终结构与新设计完全一致。
-- 旧表存在大量与新设计无关的列（title/assignee/related_issues/external_req_no/planned_date/remark/value 等），
-- 重建可彻底避免「老列残留 / 约束冲突 / proposed_at 缺失」等问题。

DROP TABLE IF EXISTS requirement_log CASCADE;
DROP TABLE IF EXISTS requirement CASCADE;

CREATE TABLE requirement (
  id BIGSERIAL PRIMARY KEY,
  requirement_no VARCHAR(32) NOT NULL UNIQUE,
  category VARCHAR(32) NOT NULL DEFAULT '质量加固和改进',
  represent_issue TEXT NOT NULL DEFAULT '',
  domain VARCHAR(128) NOT NULL DEFAULT '',
  module_feature VARCHAR(256) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  improvement TEXT NOT NULL DEFAULT '',
  priority VARCHAR(8) NOT NULL DEFAULT '中',
  proposer VARCHAR(256) NOT NULL,
  proposed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(32) NOT NULL DEFAULT '已接纳',
  planned_version VARCHAR(128) NOT NULL DEFAULT '',
  creator_id VARCHAR(64) NOT NULL,
  creator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_requirement_priority CHECK (priority IN ('高', '中', '低')),
  CONSTRAINT chk_requirement_category CHECK (category IN ('定位定界', '测试加固', '快速恢复', '需求', '质量加固和改进')),
  CONSTRAINT chk_requirement_status CHECK (status IN ('已实现', '已接纳', '部分接纳', '拒绝'))
);

CREATE INDEX IF NOT EXISTS idx_requirement_proposer ON requirement (proposer);
CREATE INDEX IF NOT EXISTS idx_requirement_creator ON requirement (creator_id);
CREATE INDEX IF NOT EXISTS idx_requirement_priority ON requirement (priority);
CREATE INDEX IF NOT EXISTS idx_requirement_proposed_at ON requirement (proposed_at);

CREATE TRIGGER trg_requirement_updated_at
BEFORE UPDATE ON requirement
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE requirement_log (
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
