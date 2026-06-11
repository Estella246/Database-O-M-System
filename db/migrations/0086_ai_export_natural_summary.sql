-- AI Export natural_summary: LLM 生成的 WHERE 子句人类可读中文摘要

ALTER TABLE ai_export_task
  ADD COLUMN IF NOT EXISTS natural_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_export_template
  ADD COLUMN IF NOT EXISTS natural_summary TEXT NOT NULL DEFAULT '';