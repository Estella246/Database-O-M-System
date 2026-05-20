BEGIN;

-- 1) 选项集显示名：业务环境 → 问题阶段
UPDATE option_set
SET set_name = '问题阶段',
    updated_at = NOW()
WHERE set_code = 'BIZ_ENV_SET';

-- 2) 各节点字段显示名（field_key 仍为 biz_env）
UPDATE node_field_def nfd
SET field_name = '问题阶段',
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND nfd.field_key = 'biz_env'
  AND nfd.is_active = TRUE;

-- 3) 下拉选项对齐为 4 项
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT os.id, v.option_value, v.option_label, v.sort_order, TRUE
FROM option_set os
JOIN (
  VALUES
    ('生产环境', '生产环境', 1),
    ('已投产业务测试环境', '已投产业务测试环境', 2),
    ('POC阶段', 'POC阶段', 3),
    ('交付阶段', '交付阶段', 4)
) AS v(option_value, option_label, sort_order) ON TRUE
WHERE os.set_code = 'BIZ_ENV_SET'
ON CONFLICT (option_set_id, option_value) DO UPDATE SET
  option_label = EXCLUDED.option_label,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

UPDATE option_item oi
SET is_active = FALSE
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'BIZ_ENV_SET'
  AND oi.option_value NOT IN (
    '生产环境',
    '已投产业务测试环境',
    'POC阶段',
    '交付阶段'
  );

-- 4) 历史工单：原三种「生产环境（…）」合并为「生产环境」
UPDATE ticket_node_data
SET values_json = jsonb_set(values_json, '{biz_env}', '"生产环境"'::jsonb, true)
WHERE values_json->>'biz_env' IN (
  '生产环境（巡检）',
  '生产环境（运维）',
  '生产环境（影响业务）'
);

COMMIT;
