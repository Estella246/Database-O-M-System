-- 运维闭环：协同处理人支持多选（与开发分析一致）
UPDATE node_field_def nfd
SET ui_props_json = COALESCE(ui_props_json, '{}'::jsonb) || '{"multiple": true}'::jsonb
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_closure'
  AND nfd.field_key = 'collaborator'
  AND nfd.is_active = TRUE;
