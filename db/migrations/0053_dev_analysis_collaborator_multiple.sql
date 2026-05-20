-- 开发分析：协同处理人支持多选（前端 ui_props.multiple + 存库「姓名 账号」以全角分号拼接）
UPDATE node_field_def nfd
SET ui_props_json = COALESCE(ui_props_json, '{}'::jsonb) || '{"multiple": true}'::jsonb
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'dev_analysis'
  AND nfd.field_key = 'collaborator'
  AND nfd.is_active = TRUE;
