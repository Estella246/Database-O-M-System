BEGIN;

ALTER TABLE requirement ADD COLUMN IF NOT EXISTS value VARCHAR(32) NOT NULL DEFAULT '质量加固';

ALTER TABLE requirement ADD CONSTRAINT chk_requirement_value
  CHECK (value IN ('质量加固', '性能提升', '竞争力提升', '定位能力提升', '恢复能力提升', '感知能力提升'));

CREATE INDEX IF NOT EXISTS idx_requirement_value ON requirement (value);

COMMIT;
