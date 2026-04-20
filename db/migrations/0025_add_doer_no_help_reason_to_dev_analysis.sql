BEGIN;

WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'dev_analysis'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'doer_no_help_reason' AS field_key,
  '使用Doer，无帮助原因' AS field_name,
  'text' AS field_type,
  FALSE AS required,
  FALSE AS read_only,
  'none' AS default_type,
  NULL AS default_value,
  NULL::bigint AS option_set_id,
  '{"visible_when_all":[{"field":"use_doer_assist","values":["使用Doer，无帮助"]}],"required_when_visible":true,"optional_when_all":[{"field":"handle_mode","values":["提交其他开发分析","返回运维分析"]}]}'::jsonb AS constraints_json,
  '{"inherit_previous":true}'::jsonb AS ui_props_json,
  19 AS sort_order
FROM node_map nm
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
