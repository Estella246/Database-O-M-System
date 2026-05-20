BEGIN;

-- 开发分析、运维闭环：移除「磐石版本是否涉及」（停用字段定义，历史节点数据保留）
UPDATE node_field_def nfd
SET is_active = FALSE,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key IN ('dev_analysis', 'ops_closure')
  AND nfd.field_key = 'rock_version_involved'
  AND nfd.is_active = TRUE;

COMMIT;
