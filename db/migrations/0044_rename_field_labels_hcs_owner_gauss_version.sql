BEGIN;

-- 问题填写：HCS负责人 → 提单人
UPDATE node_field_def nfd
SET field_name = '提单人',
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'problem_fill'
  AND nfd.field_key = 'hcs_owner'
  AND nfd.is_active = TRUE;

-- 运维分析：高斯版本 → 内核版本
UPDATE node_field_def nfd
SET field_name = '内核版本',
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.field_key = 'gauss_version'
  AND nfd.is_active = TRUE;

COMMIT;
