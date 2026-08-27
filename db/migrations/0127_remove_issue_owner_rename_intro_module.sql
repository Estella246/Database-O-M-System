BEGIN;

-- 工单流程：去掉「问题归属模块」，「问题引入模块」改名为「问题模块」
UPDATE node_field_def nfd
SET is_active = FALSE,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key IN ('ops_analysis', 'dev_analysis')
  AND nfd.field_key = 'issue_owner_module'
  AND nfd.is_active = TRUE;

UPDATE node_field_def nfd
SET field_name = '问题模块',
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key IN ('ops_analysis', 'dev_analysis')
  AND nfd.field_key = 'issue_intro_module'
  AND nfd.is_active = TRUE;

UPDATE option_set
SET set_name = '问题模块'
WHERE set_code = 'OS_RESPONSIBILITY_INTRO'
  AND set_name IS DISTINCT FROM '问题模块';

COMMIT;
