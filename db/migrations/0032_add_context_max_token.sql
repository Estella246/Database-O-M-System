-- 0032: 添加 context_max_token 配置项（上下文最大token长度）

-- 系统级配置：添加 llm_context_max_token
INSERT INTO param_llm_config (key, value, value_type, description)
VALUES ('llm_context_max_token', '128000', 'int', '上下文最大Token长度')
ON CONFLICT (key) DO NOTHING;

-- 用户级配置：添加 context_max_token 列
ALTER TABLE ai_user_llm_config ADD COLUMN IF NOT EXISTS context_max_token INT;
