BEGIN;

-- 问题填写（创建工单）：局点改为自由文本，与 eCare单号 同为 text 类型
UPDATE node_field_def nfd
SET
  field_type = 'text',
  option_set_id = NULL
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'problem_fill'
  AND nfd.field_key = 'location';

COMMIT;
