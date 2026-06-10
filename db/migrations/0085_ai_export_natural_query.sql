-- ai_export natural query: add natural_description + where_sql columns

-- ai_export_task: 新增自然语言查询字段
ALTER TABLE ai_export_task
  ADD COLUMN IF NOT EXISTS natural_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS where_sql TEXT NOT NULL DEFAULT '';

-- ai_export_template: 新增自然语言描述字段
ALTER TABLE ai_export_template
  ADD COLUMN IF NOT EXISTS natural_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS where_sql TEXT NOT NULL DEFAULT '';