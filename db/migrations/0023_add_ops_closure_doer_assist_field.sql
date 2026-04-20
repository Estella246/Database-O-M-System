BEGIN;

WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_closure'
),
set_map AS (
  SELECT id AS option_set_id
  FROM option_set
  WHERE set_code = 'OS_YES_NO'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'use_doer_assist' AS field_key,
  '是否使用Doer辅助' AS field_name,
  'whitelist' AS field_type,
  FALSE AS required,
  FALSE AS read_only,
  'none' AS default_type,
  NULL AS default_value,
  sm.option_set_id,
  NULL::jsonb AS constraints_json,
  '{"inherit_previous":false}'::jsonb AS ui_props_json,
  14 AS sort_order
FROM node_map nm
JOIN set_map sm ON TRUE
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
  is_active = TRUE;

COMMIT;
