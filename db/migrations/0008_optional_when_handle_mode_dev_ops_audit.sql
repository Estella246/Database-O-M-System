BEGIN;

-- 开发分析：处理方式为「提交其他开发分析」或「返回运维分析」时，仅「处理方式」「下一步处理人」必填，其余选填
UPDATE node_field_def nfd
SET constraints_json = COALESCE(nfd.constraints_json, '{}'::jsonb)
  || jsonb_build_object(
    'optional_when_all',
    jsonb_build_array(
      jsonb_build_object(
        'field', 'handle_mode',
        'values', jsonb_build_array('提交其他开发分析', '返回运维分析')
      )
    )
  )
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'dev_analysis'
  AND nfd.field_key NOT IN ('handle_mode', 'next_handler')
  AND nfd.is_active = TRUE;

-- 开发闭环：处理方式为「提交其他开发闭环」「返回开发分析」「返回运维分析」时，仅「处理方式」「下一步处理人」必填，其余选填
UPDATE node_field_def nfd
SET constraints_json = COALESCE(nfd.constraints_json, '{}'::jsonb)
  || jsonb_build_object(
    'optional_when_all',
    jsonb_build_array(
      jsonb_build_object(
        'field', 'handle_mode',
        'values', jsonb_build_array('提交其他开发闭环', '返回开发分析', '返回运维分析')
      )
    )
  )
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'dev_closure'
  AND nfd.field_key NOT IN ('handle_mode', 'next_handler')
  AND nfd.is_active = TRUE;

-- 运维闭环：处理方式为「提交其他运维闭环」「返回开发闭环」「返回运维分析」时，仅「处理方式」「下一步处理人」必填，其余选填
UPDATE node_field_def nfd
SET constraints_json = COALESCE(nfd.constraints_json, '{}'::jsonb)
  || jsonb_build_object(
    'optional_when_all',
    jsonb_build_array(
      jsonb_build_object(
        'field', 'handle_mode',
        'values', jsonb_build_array('提交其他运维闭环', '返回开发闭环', '返回运维分析')
      )
    )
  )
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_closure'
  AND nfd.field_key NOT IN ('handle_mode', 'next_handler')
  AND nfd.is_active = TRUE;

-- 审核关闭：处理方式为「提交其他审核关闭」「返回运维闭环」时，仅「处理方式」「下一步处理人」必填，其余选填
UPDATE node_field_def nfd
SET constraints_json = COALESCE(nfd.constraints_json, '{}'::jsonb)
  || jsonb_build_object(
    'optional_when_all',
    jsonb_build_array(
      jsonb_build_object(
        'field', 'handle_mode',
        'values', jsonb_build_array('提交其他审核关闭', '返回运维闭环')
      )
    )
  )
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'audit_close'
  AND nfd.field_key NOT IN ('handle_mode', 'next_handler')
  AND nfd.is_active = TRUE;

COMMIT;
