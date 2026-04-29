BEGIN;

-- 工单分析 Skill 配置表
CREATE TABLE IF NOT EXISTS ticket_analysis_skill (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  api_base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model VARCHAR(128) NOT NULL DEFAULT 'gpt-4o',
  max_tokens INT NOT NULL DEFAULT 4096,
  temperature REAL NOT NULL DEFAULT 0.3,
  system_prompt TEXT,
  analysis_prompt_template TEXT NOT NULL,
  input_fields JSONB DEFAULT NULL,
  output_format JSONB DEFAULT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  creator_id VARCHAR(64) NOT NULL DEFAULT '',
  creator_name VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_analysis_skill_creator
  ON ticket_analysis_skill (creator_id, created_at DESC);

-- 工单分析历史记录表
CREATE TABLE IF NOT EXISTS ticket_analysis_log (
  id BIGSERIAL PRIMARY KEY,
  skill_id BIGINT NOT NULL REFERENCES ticket_analysis_skill(id) ON DELETE CASCADE,
  ticket_no VARCHAR(32) NOT NULL,
  input_data JSONB DEFAULT NULL,
  output_result TEXT,
  output_structured JSONB DEFAULT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  analysis_duration_ms INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'success',
  error_message TEXT,
  operator_id VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_analysis_log_skill
  ON ticket_analysis_log (skill_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_analysis_log_ticket
  ON ticket_analysis_log (ticket_no, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_analysis_log_operator
  ON ticket_analysis_log (operator_id, created_at DESC);

-- 预置内置 Skill（仅保留：问题根因分析、风险等级评估、处理建议推荐）
INSERT INTO ticket_analysis_skill (
  name, description, api_base_url, api_key, model,
  max_tokens, temperature, system_prompt, analysis_prompt_template,
  input_fields, output_format, is_enabled, is_builtin, sort_order,
  creator_id, creator_name
) VALUES
(
  '问题根因分析',
  '基于问题描述和历史数据，智能推断问题根因类型',
  '',
  '',
  'gpt-4o',
  4096,
  0.3,
  '你是一个专业的数据库运维问题根因分析专家。请根据工单信息，分析问题的可能根因。',
  '请对以下运维工单进行根因分析：

工单编号：{ticket_no}
严重性：{severity}
当前节点：{current_node}
问题描述：{problem_description}

请按以下框架输出分析结果：
1. 问题类型判定
2. 可能根因（列出 TOP3）
3. 影响范围评估
4. 建议处理方案
5. 风险等级（高/中/低）',
  '{"fields": ["ticket_no", "severity", "current_node", "problem_description"], "include_flow_log": false}',
  '{"type": "structured", "schema": {"root_cause_type": {"type": "string"}, "risk_level": {"type": "string"}, "recommendations": {"type": "array"}}}',
  TRUE,
  TRUE,
  1,
  'system',
  '系统'
),
(
  '风险等级评估',
  '综合严重性、影响范围、处理时长，给出风险等级',
  '',
  '',
  'gpt-4o',
  4096,
  0.2,
  '你是一个风险评估专家，负责综合评估工单风险等级。',
  '请评估以下工单的风险等级：

工单编号：{ticket_no}
严重性：{severity}
影响范围：{location}
当前节点：{current_node}
问题描述：{problem_description}

请输出：
1. 风险因素分析
2. 风险等级（高危/高风险/中风险/低风险）
3. 紧急程度评估
4. 建议处置方案',
  '{"fields": ["ticket_no", "severity", "location", "current_node", "problem_description"], "include_flow_log": false}',
  '{"type": "structured", "schema": {"risk_level": {"type": "string"}, "risk_factors": {"type": "array"}, "urgency_level": {"type": "string"}}}',
  TRUE,
  TRUE,
  2,
  'system',
  '系统'
),
(
  '处理建议推荐',
  '基于问题类型和历史案例，推荐处理方案',
  '',
  '',
  'gpt-4o',
  4096,
  0.4,
  '你是一个运维问题处理专家，负责根据问题类型推荐处理方案。',
  '请为以下工单推荐处理方案：

工单编号：{ticket_no}
问题类型：{problem_kind}
严重性：{severity}
问题描述：{problem_description}

请输出：
1. 问题类型判定
2. 推荐处理步骤
3. 参考案例（如有）
4. 预计处理时长',
  '{"fields": ["ticket_no", "problem_kind", "severity", "problem_description"], "include_flow_log": false}',
  '{"type": "structured", "schema": {"problem_type": {"type": "string"}, "recommended_steps": {"type": "array"}, "estimated_duration": {"type": "string"}}}',
  TRUE,
  TRUE,
  3,
  'system',
  '系统'
);

-- 权限配置：新增白名单项
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
VALUES
  ('管理员', FALSE, '__whitelist__', 'stats_skills', 'editable', 'admin'),
  ('管理员', FALSE, '__whitelist__', 'stats_skills_edit', 'editable', 'admin'),
  ('管理员', FALSE, '__whitelist__', 'stats_skills_analyze', 'editable', 'admin'),
  ('管理员', FALSE, '__whitelist__', 'stats_skills_delete', 'editable', 'admin')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();

COMMIT;