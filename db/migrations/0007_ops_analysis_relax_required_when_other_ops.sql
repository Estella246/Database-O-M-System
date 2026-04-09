BEGIN;

-- 运维分析：处理方式为「提交其他运维分析」时，仅「处理方式」「下一步处理人」必填，其余选填
UPDATE node_field_def nfd
SET constraints_json = COALESCE(nfd.constraints_json, '{}'::jsonb)
  || jsonb_build_object(
    'optional_when_all',
    jsonb_build_array(
      jsonb_build_object(
        'field',
        'handle_mode',
        'values',
        jsonb_build_array('提交其他运维分析')
      )
    )
  )
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.field_key NOT IN ('handle_mode', 'next_handler')
  AND nfd.is_active = TRUE;

COMMIT;
