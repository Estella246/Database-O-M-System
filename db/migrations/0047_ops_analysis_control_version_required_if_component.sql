BEGIN;

-- 运维分析：问题组件为「管控问题」时，「管控版本」必填（「提交其他运维分析」仍仅处理方式/下一步处理人必填）
UPDATE node_field_def nfd
SET constraints_json = '{
  "required_if": {"component": "管控问题"},
  "optional_when_all": [{"field": "handle_mode", "values": ["提交其他运维分析"]}]
}'::jsonb,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.field_key = 'control_version'
  AND nfd.is_active = TRUE;

COMMIT;
