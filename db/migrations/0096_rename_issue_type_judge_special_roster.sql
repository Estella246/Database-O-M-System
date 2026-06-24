BEGIN;

-- 问题审核字段显示名：问题类型初步判断 → 专项轮值表（field_key 仍为 issue_type_judge）
UPDATE option_set
SET set_name = '问题审核-专项轮值表',
    updated_at = NOW()
WHERE set_code = 'OS_PROBLEM_REVIEW_TYPE_JUDGE';

UPDATE node_field_def nfd
SET field_name = '专项轮值表',
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND nfd.field_key = 'issue_type_judge'
  AND nfd.is_active = TRUE;

COMMIT;
