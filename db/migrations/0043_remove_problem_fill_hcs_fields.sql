BEGIN;

-- 问题填写：移除 HCS版本号、HCS/轻量化（停用字段定义，历史节点数据保留）
UPDATE node_field_def nfd
SET is_active = FALSE,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'problem_fill'
  AND nfd.field_key IN ('hcs_version', 'hcs_mode')
  AND nfd.is_active = TRUE;

-- 收紧后续字段 sort_order（product_line 仍为 6）
UPDATE node_field_def nfd
SET sort_order = CASE nfd.field_key
      WHEN 'ecare_ticket_no' THEN 7
      WHEN 'hcs_owner' THEN 8
      WHEN 'issue_desc' THEN 9
      ELSE nfd.sort_order
    END,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'problem_fill'
  AND nfd.field_key IN ('ecare_ticket_no', 'hcs_owner', 'issue_desc')
  AND nfd.is_active = TRUE;

COMMIT;
