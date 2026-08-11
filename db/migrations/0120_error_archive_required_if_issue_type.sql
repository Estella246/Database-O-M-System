BEGIN;

-- 开发分析 / 运维闭环：运维分析「问题类型」为「错」或「coredump」时，
-- 「报错信息归档（core、报错、内存堆积上下文文字版）」提交必填
-- （保留 plain_text_only、optional_when_all 等既有约束）
UPDATE node_field_def nfd
SET constraints_json = COALESCE(nfd.constraints_json, '{}'::jsonb)
  || jsonb_build_object(
    'required_if',
    jsonb_build_object(
      'issue_type',
      jsonb_build_array('错', 'coredump')
    )
  ),
  updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key IN ('dev_analysis', 'ops_closure')
  AND nfd.field_key = 'error_archive_text'
  AND nfd.is_active = TRUE;

COMMIT;
