-- Re-enable ops analysis mode per xlsx source-of-truth:
-- 「提交运维闭环」 should be selectable under OS_OPS_ANALYSIS_HANDLE_MODE.
UPDATE option_item oi
SET is_active = TRUE
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_OPS_ANALYSIS_HANDLE_MODE'
  AND oi.option_value = '提交运维闭环';
