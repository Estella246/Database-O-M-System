BEGIN;

-- 产品线选项：去掉「轻量化」，仅保留公有云、混合云
UPDATE option_item oi
SET is_active = FALSE,
    updated_at = NOW()
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_PRODUCT_LINE'
  AND oi.option_value = '轻量化';

-- 问题填写：为 product_line 腾出 sort_order（插在「问题组件」之后）
UPDATE node_field_def nfd
SET sort_order = nfd.sort_order + 1,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'problem_fill'
  AND nfd.field_key IN ('hcs_version', 'hcs_mode', 'ecare_ticket_no', 'hcs_owner', 'issue_desc')
  AND nfd.is_active = TRUE;

-- 问题填写：新增「产品线」
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'problem_fill'
),
os AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_PRODUCT_LINE' LIMIT 1
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'product_line',
  '产品线',
  'whitelist',
  TRUE,
  FALSE,
  'none',
  NULL,
  os.option_set_id,
  NULL,
  '{"inherit_previous": false}'::jsonb,
  6
FROM node_map nm
CROSS JOIN os
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  read_only = EXCLUDED.read_only,
  default_type = EXCLUDED.default_type,
  default_value = EXCLUDED.default_value,
  option_set_id = EXCLUDED.option_set_id,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

-- 运维分析：产品线继承问题填写（及更前序节点）已提交取值
UPDATE node_field_def nfd
SET ui_props_json = '{"inherit_previous": true}'::jsonb,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.field_key = 'product_line'
  AND nfd.is_active = TRUE;

COMMIT;
