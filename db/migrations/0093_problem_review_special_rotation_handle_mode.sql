BEGIN;

-- 问题审核：新增处理方式「提交专项轮值表」
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT os.id, '提交专项轮值表', '提交专项轮值表', 3, TRUE
FROM option_set os
WHERE os.set_code = 'OS_PROBLEM_REVIEW_HANDLE_MODE'
ON CONFLICT (option_set_id, option_value) DO UPDATE SET
  is_active = TRUE,
  sort_order = EXCLUDED.sort_order,
  option_label = EXCLUDED.option_label;

-- 问题类型初步判断：仅「提交专项轮值表」时展示；管控问题不再作为该字段选项
UPDATE option_item oi
SET is_active = FALSE,
    updated_at = NOW()
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_PROBLEM_REVIEW_TYPE_JUDGE'
  AND oi.option_value = '管控问题';

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
  constraints_json = '{"visible_when_all":[{"field":"handle_mode","values":["提交专项轮值表"]}],"required_when_visible":true}'::jsonb,
  updated_at = NOW()
FROM n
WHERE nfd.node_id = n.node_id
  AND nfd.field_key = 'issue_type_judge';

COMMIT;
