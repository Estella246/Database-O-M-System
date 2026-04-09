BEGIN;

WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_closure'
),
set_map AS (
  SELECT id FROM option_set WHERE set_code = 'OS_YES_NO'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  seed.field_key,
  seed.field_name,
  seed.field_type,
  seed.required,
  FALSE AS read_only,
  'none' AS default_type,
  NULL AS default_value,
  CASE WHEN seed.field_key = 'fault_recovery_involved' THEN (SELECT id FROM set_map) ELSE NULL END AS option_set_id,
  seed.constraints_json,
  '{"inherit_previous":false}'::jsonb AS ui_props_json,
  seed.sort_order
FROM node_map nm
JOIN (
  VALUES
    (
      'fault_recovery_involved',
      '是否涉及故障恢复',
      'whitelist',
      TRUE,
      NULL::jsonb,
      3
    ),
    (
      'fault_to_recovery_duration',
      '故障到恢复用时',
      'text',
      FALSE,
      '{"required_if":{"fault_recovery_involved":"是"}}'::jsonb,
      4
    )
) AS seed(field_key, field_name, field_type, required, constraints_json, sort_order) ON TRUE
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  option_set_id = EXCLUDED.option_set_id,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

COMMIT;
