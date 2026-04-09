-- These handle modes should not have next_handler choices.
-- Disable mapping rows instead of hard delete for traceability.

UPDATE handle_mode_next_handler_whitelist
SET is_active = FALSE
WHERE (node_key = 'problem_review' AND handle_mode IN ('确认问题', '非问题关闭'))
   OR (node_key = 'audit_close' AND handle_mode IN ('问题解决关闭'));
