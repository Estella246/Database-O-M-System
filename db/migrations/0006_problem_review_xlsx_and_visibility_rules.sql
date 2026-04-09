BEGIN;

-- 问题审核：处理方式选项与最新 xlsx 对齐（去掉「返回HCS修改」）
UPDATE option_item oi
SET is_active = FALSE
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_PROBLEM_REVIEW_HANDLE_MODE'
  AND oi.option_value = '返回HCS修改';

-- 问题类型初步判断：增加「其他」，供「下一步处理人」联动使用
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT os.id, '其他', '其他', 10, TRUE
FROM option_set os
WHERE os.set_code = 'OS_PROBLEM_REVIEW_TYPE_JUDGE'
ON CONFLICT (option_set_id, option_value) DO UPDATE SET
  is_active = TRUE,
  sort_order = EXCLUDED.sort_order;

-- 问题审核：字段联动（特殊要求 → constraints_json）
WITH n AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'problem_review'
)
UPDATE node_field_def nfd
SET
  required = v.required,
  constraints_json = v.constraints_json::jsonb
FROM n
JOIN (
  VALUES
    (
      'issue_type_judge',
      FALSE,
      '{"visible_when_all":[{"field":"handle_mode","values":["提交其他运维审核"]}],"required_when_visible":true}'::text
    ),
    (
      'next_handler',
      FALSE,
      '{"visible_when_all":[{"field":"handle_mode","values":["提交其他运维审核"]},{"field":"issue_type_judge","values":["其他"]}],"required_when_visible":true}'::text
    )
) AS v(field_key, required, constraints_json) ON TRUE
WHERE nfd.node_id = n.node_id
  AND nfd.field_key = v.field_key;

-- 新增：关闭原因（仅「非问题关闭」时显示且必填）
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  n.node_id,
  'close_reason',
  '关闭原因',
  'text',
  FALSE,
  FALSE,
  'none',
  NULL,
  NULL,
  '{"visible_when_all":[{"field":"handle_mode","values":["非问题关闭"]}],"required_when_visible":true}'::jsonb,
  '{"inherit_previous":false}'::jsonb,
  4
FROM (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'problem_review'
) n
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

COMMIT;
