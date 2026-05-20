BEGIN;

-- 运维分析：「是否有core堆栈」为「是」时，「Core堆栈（文字版）」必填
UPDATE node_field_def nfd
SET constraints_json = '{
  "plain_text_only": true,
  "required_if": {"has_core_stack": "是"}
}'::jsonb,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.field_key = 'core_stack_text'
  AND nfd.is_active = TRUE;

COMMIT;
