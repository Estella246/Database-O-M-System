-- 停用问题填写上残留的 Ask Doer iframe（旧 doer 实验字段，当前分支已无对应代码）。
BEGIN;

UPDATE node_field_def nfd
SET is_active = FALSE,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'problem_fill'
  AND nfd.field_key = 'ask_doer_iframe'
  AND nfd.is_active = TRUE;

COMMIT;
