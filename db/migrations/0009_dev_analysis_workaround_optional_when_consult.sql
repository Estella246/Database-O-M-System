BEGIN;

-- 开发分析：规避措施/恢复方法在以下任一场景下改为选填：
-- 1) 处理方式=提交其他开发分析/返回运维分析
-- 2) 是否咨询问题=是
UPDATE node_field_def nfd
SET constraints_json =
  (COALESCE(nfd.constraints_json, '{}'::jsonb) - 'optional_when_all')
  || jsonb_build_object(
    'optional_when_any',
    jsonb_build_array(
      jsonb_build_object('field', 'handle_mode', 'values', jsonb_build_array('提交其他开发分析', '返回运维分析')),
      jsonb_build_object('field', 'is_consult_issue', 'values', jsonb_build_array('是'))
    )
  )
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'dev_analysis'
  AND nfd.field_key = 'workaround'
  AND nfd.is_active = TRUE;

COMMIT;
