-- 补丁管理「诉求填写」：局点信息附件改为 file 类型（与运维闭环「上传问题报告」同控件，MinIO 存储）
BEGIN;

UPDATE node_field_def nfd
SET
  field_type = 'file',
  ui_props_json = COALESCE(nfd.ui_props_json, '{}'::jsonb)
    || '{"inherit_previous":false}'::jsonb,
  updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HOTPATCH'
  AND wn.node_key = 'hp_demand_fill'
  AND nfd.field_key = '局点信息附件'
  AND nfd.is_active = TRUE;

COMMIT;
