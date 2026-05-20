BEGIN;

-- 运维分析：新增「是否质量问题」（与开发分析/运维闭环同键、同选项集）
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_analysis'
),
os AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_DEV_ANALYSIS_QUALITY' LIMIT 1
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'is_quality_issue',
  '是否质量问题',
  'whitelist',
  TRUE,
  FALSE,
  'none',
  NULL,
  os.option_set_id,
  '{"optional_when_all":[{"field":"handle_mode","values":["提交其他运维分析"]}]}'::jsonb,
  '{"inherit_previous":false}'::jsonb,
  29
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

-- 开发分析、运维闭环：从运维分析（及更前序）自动继承同字段取值
UPDATE node_field_def nfd
SET ui_props_json = '{"inherit_previous": true}'::jsonb,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key IN ('dev_analysis', 'ops_closure')
  AND nfd.field_key = 'is_quality_issue'
  AND nfd.is_active = TRUE;

COMMIT;
