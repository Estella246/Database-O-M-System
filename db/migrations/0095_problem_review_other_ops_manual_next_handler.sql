BEGIN;

-- 问题审核「提交其他运维审核」：展示并必填「下一步处理人」（手选）
WITH n AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'problem_review'
)
UPDATE node_field_def nfd
SET
  required = FALSE,
  constraints_json = '{"visible_when_all":[{"field":"handle_mode","values":["提交其他运维审核"]}],"required_when_visible":true}'::jsonb,
  updated_at = NOW()
FROM n
WHERE nfd.node_id = n.node_id
  AND nfd.field_key = 'next_handler';

COMMIT;
