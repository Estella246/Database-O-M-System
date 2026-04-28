BEGIN;

CREATE TABLE IF NOT EXISTS ai_conversation (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(256) NOT NULL DEFAULT '新对话',
  creator_id VARCHAR(64) NOT NULL,
  creator_name VARCHAR(128) NOT NULL DEFAULT '',
  total_tokens INT NOT NULL DEFAULT 0,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_creator
  ON ai_conversation (creator_id, is_deleted, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_message (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  react_steps JSONB DEFAULT NULL,
  sql_query TEXT DEFAULT NULL,
  query_result JSONB DEFAULT NULL,
  chart_config JSONB DEFAULT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_message_conv
  ON ai_message (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_quick_template (
  id BIGSERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  is_preset BOOLEAN NOT NULL DEFAULT FALSE,
  creator_id VARCHAR(64) NOT NULL DEFAULT 'system',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ai_quick_template (question, is_preset, creator_id, sort_order) VALUES
  ('最近1周新增了多少个工单？', TRUE, 'system', 1),
  ('当前各节点待处理工单数量分布？', TRUE, 'system', 2),
  ('本月致命/严重/一般问题各有多少？', TRUE, 'system', 3),
  ('哪些处理人当前待处理工单最多（TOP5）？', TRUE, 'system', 4),
  ('最近1周工单的平均处理时长是多少？', TRUE, 'system', 5),
  ('当前挂起的工单有哪些？', TRUE, 'system', 6),
  ('最近1个月各区域的问题分布？', TRUE, 'system', 7),
  ('本周值班人员是谁？', TRUE, 'system', 8),
  ('最近1周需求状态变更情况？', TRUE, 'system', 9),
  ('哪些工单在某个节点停留超过3天？', TRUE, 'system', 10);

CREATE TABLE IF NOT EXISTS param_llm_config (
  key VARCHAR(128) PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  value_type VARCHAR(16) NOT NULL DEFAULT 'string',
  description VARCHAR(512) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO param_llm_config (key, value, value_type, description) VALUES
  ('llm_api_base_url', 'https://api.openai.com/v1', 'string', 'LLM API 地址'),
  ('llm_api_key', '', 'string', '系统 API Key'),
  ('llm_model', 'gpt-4o', 'string', '默认模型名称'),
  ('llm_max_tokens', '4096', 'int', '单次回复最大 token'),
  ('llm_temperature', '0.0', 'float', '生成温度'),
  ('llm_system_prompt', '', 'string', '系统提示词'),
  ('llm_query_timeout', '30', 'int', 'SQL 查询超时(秒)'),
  ('llm_max_react_rounds', '5', 'int', 'ReAct 最大推理轮次'),
  ('llm_max_result_rows', '200', 'int', '查询结果行数上限'),
  ('llm_enabled', 'false', 'bool', '全局开关');

CREATE TABLE IF NOT EXISTS ai_user_llm_config (
  account VARCHAR(64) PRIMARY KEY,
  api_base_url TEXT,
  api_key TEXT,
  model VARCHAR(256),
  max_tokens INT,
  temperature REAL,
  system_prompt TEXT,
  query_timeout INT,
  max_react_rounds INT,
  max_result_rows INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
VALUES
  ('管理员', FALSE, '__whitelist__', 'ai_assistant', 'editable', 'admin'),
  ('管理员', FALSE, '__whitelist__', 'ai_assistant_template_edit', 'editable', 'admin'),
  ('管理员', FALSE, '__whitelist__', 'ai_assistant_config', 'editable', 'admin')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();

COMMIT;
