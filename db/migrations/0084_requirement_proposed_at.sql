BEGIN;

-- 质量改进新增「提出时间」字段（可编辑日期，导入/导出/新建均带）。
-- 存量行回填为创建日期；新行默认当天。
ALTER TABLE requirement ADD COLUMN IF NOT EXISTS proposed_at DATE NOT NULL DEFAULT CURRENT_DATE;
UPDATE requirement SET proposed_at = created_at::date;

CREATE INDEX IF NOT EXISTS idx_requirement_proposed_at ON requirement (proposed_at);

COMMIT;
