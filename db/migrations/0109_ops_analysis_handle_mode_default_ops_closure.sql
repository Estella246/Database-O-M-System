-- 运维分析：处理方式默认改为「提交运维闭环」（白名单无占位时取 sort_order 最小项）。
BEGIN;

UPDATE option_item oi
SET sort_order = v.sort_order,
    updated_at = NOW()
FROM option_set os
JOIN (
  VALUES
    ('提交运维闭环', 1),
    ('提交开发分析', 2),
    ('提交开发闭环', 3),
    ('提交其他运维分析', 4)
) AS v(option_value, sort_order) ON TRUE
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_OPS_ANALYSIS_HANDLE_MODE'
  AND oi.option_value = v.option_value;

COMMIT;
