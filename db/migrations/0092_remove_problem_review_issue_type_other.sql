BEGIN;

-- 问题审核「问题类型初步判断」：移除「其他」
UPDATE option_item oi
SET is_active = FALSE,
    updated_at = NOW()
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_PROBLEM_REVIEW_TYPE_JUDGE'
  AND oi.option_value = '其他';

-- 问题审核「下一步处理人」：不再手选，仅由后端派单写入
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
  constraints_json = '{"visible_when_all":[{"field":"handle_mode","values":[]}]}'::jsonb,
  updated_at = NOW()
FROM n
WHERE nfd.node_id = n.node_id
  AND nfd.field_key = 'next_handler';

COMMIT;
