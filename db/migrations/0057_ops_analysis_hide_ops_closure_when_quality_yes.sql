BEGIN;

-- 运维分析：「是否质量问题」为「是（已知/新发现）」时，处理方式不可选「提交运维闭环」（前后端按 constraints 联动）
UPDATE node_field_def nfd
SET constraints_json = COALESCE(nfd.constraints_json, '{}'::jsonb) || jsonb_build_object(
  'exclude_options_when_all',
  jsonb_build_array(
    jsonb_build_object(
      'field', 'is_quality_issue',
      'values', jsonb_build_array('是（已知质量问题）', '是（新发现质量问题）'),
      'options', jsonb_build_array('提交运维闭环')
    )
  )
),
updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.field_key = 'handle_mode'
  AND nfd.is_active = TRUE;

COMMIT;
