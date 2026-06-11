BEGIN;

-- 导出任务主表
CREATE TABLE IF NOT EXISTS ai_export_task (
  id SERIAL PRIMARY KEY,
  creator_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  -- draft → preview → processing → ready → expired
  source_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  original_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  transform_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  rule_description TEXT NOT NULL DEFAULT '',
  total_rows INT NOT NULL DEFAULT 0,
  processed_rows INT NOT NULL DEFAULT 0,
  preview_done BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT NOT NULL DEFAULT '',
  excel_downloaded_at TIMESTAMPTZ,
  report_status VARCHAR(16) NOT NULL DEFAULT 'none',
  -- none → generating → done
  report_prompt TEXT NOT NULL DEFAULT '',
  report_html TEXT NOT NULL DEFAULT '',
  natural_description TEXT NOT NULL DEFAULT '',
  where_sql TEXT NOT NULL DEFAULT '',
  natural_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_export_task_creator
  ON ai_export_task (creator_id, status, created_at DESC);

-- 导出数据行表
CREATE TABLE IF NOT EXISTS ai_export_row (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES ai_export_task(id) ON DELETE CASCADE,
  row_index INT NOT NULL,
  original_data JSONB NOT NULL,
  derived_data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_export_row_task_row_index
  ON ai_export_row (task_id, row_index);

CREATE INDEX IF NOT EXISTS idx_ai_export_row_task
  ON ai_export_row (task_id, row_index);

-- 规则模板表
CREATE TABLE IF NOT EXISTS ai_export_template (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  creator_id VARCHAR(64) NOT NULL,
  source_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  original_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  transform_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  natural_description TEXT NOT NULL DEFAULT '',
  where_sql TEXT NOT NULL DEFAULT '',
  natural_summary TEXT NOT NULL DEFAULT '',
  is_preset BOOLEAN NOT NULL DEFAULT FALSE,
  usage_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_export_template_creator
  ON ai_export_template (creator_id, is_preset, usage_count DESC);

-- 种入权限策略（管理员 + admin 角色）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
VALUES
  ('管理员', FALSE, '__whitelist__', 'ai_export', 'editable', 'system'),
  ('admin',   TRUE,  '__whitelist__', 'ai_export', 'editable', 'system'),
  ('管理员', FALSE, '__whitelist__', 'ai_export_template', 'editable', 'system'),
  ('admin',   TRUE,  '__whitelist__', 'ai_export_template', 'editable', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();

-- 预设模板
INSERT INTO ai_export_template (name, creator_id, source_config, original_columns, transform_rules, is_preset) VALUES
  ('工单风险等级导出', 'system',
   '{"time_range":{}, "template_code":"HCS_INCIDENT"}'::jsonb,
   '["ticket_no","severity","问题描述","局点","created_at"]'::jsonb,
   '[{"type":"mapping","target_column":"风险等级","value_range":["高风险","低风险"],"source_column":"severity","mapping":{"致命":"高风险","严重":"高风险","一般":"低风险"}}]'::jsonb,
   TRUE),
  ('工单根因分类导出', 'system',
   '{"time_range":{}, "template_code":"HCS_INCIDENT"}'::jsonb,
   '["ticket_no","问题描述","问题组件","severity","局点"]'::jsonb,
   '[{"type":"llm_reasoning","target_column":"根因分类","value_range":["内核","管控","配置","其他"],"source_columns":["问题描述","问题组件"],"reasoning_instruction":"根据问题描述和问题组件推理判断根因分类"}]'::jsonb,
   TRUE);

COMMIT;