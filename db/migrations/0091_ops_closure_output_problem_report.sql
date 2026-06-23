-- 运维闭环：新增「是否输出问题报告」（是/否，必填）；选「是」时展示并必填「上传问题报告」
BEGIN;

WITH target_node AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_closure'
),
yes_no_set AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_YES_NO'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active
)
SELECT
  tn.node_id,
  'output_problem_report',
  '是否输出问题报告',
  'whitelist',
  TRUE,
  FALSE,
  'none',
  NULL,
  yns.option_set_id,
  '{"optional_when_all":[{"field":"handle_mode","values":["提交其他运维闭环","返回开发闭环","返回运维分析"]}]}'::jsonb,
  '{"inherit_previous":false}'::jsonb,
  10,
  TRUE
FROM target_node tn
CROSS JOIN yes_no_set yns
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  option_set_id = EXCLUDED.option_set_id,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

UPDATE node_field_def nfd
SET constraints_json = COALESCE(nfd.constraints_json, '{}'::jsonb)
  - 'required_if'
  || jsonb_build_object(
    'visible_when_all', jsonb_build_array(
      jsonb_build_object('field', 'output_problem_report', 'values', jsonb_build_array('是'))
    ),
    'required_when_visible', true
  ),
  required = FALSE,
  sort_order = 11,
  updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_closure'
  AND nfd.field_key = 'problem_report'
  AND nfd.is_active = TRUE;

WITH target_node AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_closure'
),
orders AS (
  SELECT * FROM (
    VALUES
      ('handle_mode', 1),
      ('next_handler', 2),
      ('fault_recovery_involved', 3),
      ('fault_to_recovery_duration', 4),
      ('is_quality_issue', 5),
      ('dts_no', 6),
      ('has_collaborator', 8),
      ('collaborator', 9),
      ('output_problem_report', 10),
      ('problem_report', 11),
      ('workaround', 12),
      ('root_cause', 13),
      ('issue_track', 14),
      ('dfx_gap', 15),
      ('error_archive_text', 16)
  ) AS t(field_key, sort_order)
)
UPDATE node_field_def nfd
SET sort_order = o.sort_order,
    updated_at = NOW()
FROM target_node n, orders o
WHERE nfd.node_id = n.node_id
  AND nfd.field_key = o.field_key
  AND nfd.is_active = TRUE;

COMMIT;
