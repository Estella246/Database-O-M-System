-- 运维分析节点不允许直达运维闭环，只保留：
-- 1) 下节点（开发分析）
-- 2) 下下节点（开发闭环）
-- 3) 本节点（提交其他运维分析）
UPDATE option_item oi
SET is_active = FALSE
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_OPS_ANALYSIS_HANDLE_MODE'
  AND oi.option_value = '提交运维闭环';
