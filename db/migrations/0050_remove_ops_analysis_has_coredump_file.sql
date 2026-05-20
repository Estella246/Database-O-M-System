BEGIN;

-- 运维分析：移除「是否有coredump文件」（停用字段定义，历史节点数据保留）
UPDATE node_field_def nfd
SET is_active = FALSE,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.field_key = 'has_coredump_file'
  AND nfd.is_active = TRUE;

COMMIT;
