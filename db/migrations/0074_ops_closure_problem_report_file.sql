-- 运维闭环：新增「上传问题报告」文件字段（MinIO 存储，与富文本图片共用配置）
BEGIN;

ALTER TABLE node_field_def DROP CONSTRAINT IF EXISTS chk_node_field_type;
ALTER TABLE node_field_def ADD CONSTRAINT chk_node_field_type CHECK (
  field_type IN ('text', 'richtext', 'date', 'datetime', 'whitelist', 'file')
);

WITH target_node AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_closure'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order, is_active
)
SELECT
  tn.node_id,
  'problem_report',
  '上传问题报告',
  'file',
  FALSE,
  FALSE,
  'none',
  NULL,
  NULL,
  NULL,
  '{"inherit_previous":false}'::jsonb,
  14,
  TRUE
FROM target_node tn
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

COMMIT;
