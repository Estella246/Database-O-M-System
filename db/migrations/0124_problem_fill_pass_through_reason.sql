-- 问题填写：新增必填下拉「透传原因」。
BEGIN;

INSERT INTO option_set (set_code, set_name, source_type, source_config)
VALUES ('OS_PROBLEM_FILL_PASS_THROUGH_REASON', '问题填写-透传原因', 'static', NULL)
ON CONFLICT (set_code) DO UPDATE SET
  set_name = EXCLUDED.set_name,
  source_type = EXCLUDED.source_type,
  is_active = TRUE,
  updated_at = NOW();

WITH set_map AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_PROBLEM_FILL_PASS_THROUGH_REASON'
)
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT sm.option_set_id, v.option_value, v.option_label, v.sort_order, TRUE
FROM set_map sm
CROSS JOIN (VALUES
  ('问题紧急，协调RL恢复', '问题紧急，协调RL恢复', 1),
  ('产品文档无相关内容/现网无案例/AI分析无有效信息', '产品文档无相关内容/现网无案例/AI分析无有效信息', 2),
  ('问题场景复杂，无处理思路', '问题场景复杂，无处理思路', 3),
  ('产品质量问题透传', '产品质量问题透传', 4)
) AS v(option_value, option_label, sort_order)
ON CONFLICT (option_set_id, option_value) DO UPDATE SET
  option_label = EXCLUDED.option_label,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

UPDATE option_item oi
SET is_active = FALSE,
    updated_at = NOW()
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_PROBLEM_FILL_PASS_THROUGH_REASON'
  AND oi.option_value NOT IN (
    '问题紧急，协调RL恢复',
    '产品文档无相关内容/现网无案例/AI分析无有效信息',
    '问题场景复杂，无处理思路',
    '产品质量问题透传'
  );

-- 插在「提单人」之后、「问题描述」之前
UPDATE node_field_def nfd
SET sort_order = 10,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'problem_fill'
  AND nfd.field_key = 'issue_desc'
  AND nfd.is_active = TRUE;

WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'problem_fill'
),
os AS (
  SELECT id AS option_set_id
  FROM option_set
  WHERE set_code = 'OS_PROBLEM_FILL_PASS_THROUGH_REASON'
  LIMIT 1
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'pass_through_reason',
  '透传原因',
  'whitelist',
  TRUE,
  FALSE,
  'none',
  NULL,
  os.option_set_id,
  NULL,
  '{"inherit_previous": false}'::jsonb,
  9
FROM node_map nm
CROSS JOIN os
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  read_only = EXCLUDED.read_only,
  default_type = EXCLUDED.default_type,
  default_value = EXCLUDED.default_value,
  option_set_id = EXCLUDED.option_set_id,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

COMMIT;
