BEGIN;

-- 诉求填写：补齐「处理方式」「下一步处理人」并置顶（与其它阶段一致）
UPDATE node_field_def nfd
SET sort_order = nfd.sort_order + 2
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HOTPATCH'
  AND wn.node_key = 'hp_demand_fill'
  AND nfd.field_key NOT IN ('handle_mode', 'next_handler');

INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  wn.id,
  v.field_key,
  v.field_name,
  v.field_type,
  TRUE,
  FALSE,
  'none',
  NULL::text,
  NULL::bigint,
  v.constraints_json::jsonb,
  '{"inherit_previous": false}'::jsonb,
  v.sort_order
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
CROSS JOIN (
  VALUES
    ('handle_mode', '处理方式', 'whitelist', '{"static_options": ["提交开发人员"]}', 1),
    ('next_handler', '下一步处理人', 'whitelist', '{"static_options": ["temp"]}', 2)
) AS v(field_key, field_name, field_type, constraints_json, sort_order)
WHERE wt.template_code = 'HOTPATCH'
  AND wn.node_key = 'hp_demand_fill'
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

COMMIT;
