BEGIN;

ALTER TABLE requirement ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT '其他';

ALTER TABLE requirement ADD CONSTRAINT chk_requirement_category
  CHECK (category IN ('管控需求', '内核需求', '管控和内核需求', '其他'));

CREATE INDEX IF NOT EXISTS idx_requirement_category ON requirement (category);

COMMIT;
