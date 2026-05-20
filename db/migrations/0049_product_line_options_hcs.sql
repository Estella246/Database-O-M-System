BEGIN;

-- 产品线选项：公有云、混合云（HCS）、混合云（轻量化）
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT os.id, v.option_value, v.option_label, v.sort_order, TRUE
FROM option_set os
JOIN (
  VALUES
    ('公有云', '公有云', 1),
    ('混合云（HCS）', '混合云（HCS）', 2),
    ('混合云（轻量化）', '混合云（轻量化）', 3)
) AS v(option_value, option_label, sort_order) ON TRUE
WHERE os.set_code = 'OS_PRODUCT_LINE'
ON CONFLICT (option_set_id, option_value) DO UPDATE SET
  option_label = EXCLUDED.option_label,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

UPDATE option_item oi
SET is_active = FALSE,
    updated_at = NOW()
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_PRODUCT_LINE'
  AND oi.option_value NOT IN (
    '公有云',
    '混合云（HCS）',
    '混合云（轻量化）'
  );

-- 历史工单：旧选项映射到新选项
UPDATE ticket_node_data
SET values_json = jsonb_set(values_json, '{product_line}', '"混合云（HCS）"'::jsonb, true)
WHERE values_json->>'product_line' = '混合云';

UPDATE ticket_node_data
SET values_json = jsonb_set(values_json, '{product_line}', '"混合云（轻量化）"'::jsonb, true)
WHERE values_json->>'product_line' = '轻量化';

COMMIT;
