BEGIN;

-- 1) 局点改为外部接口来源（不使用静态枚举项）
UPDATE option_set
SET source_type = 'external_api',
    source_config = '{"desc":"从另一个接口拉取数值"}'::jsonb
WHERE set_code = 'LOCATION_SET';

DELETE FROM option_item
WHERE option_set_id = (SELECT id FROM option_set WHERE set_code = 'LOCATION_SET');

-- 2) 业务环境按最新 xlsx 对齐为 6 个选项
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT os.id, v.option_value, v.option_label, v.sort_order, TRUE
FROM option_set os
JOIN (
  VALUES
    ('生产环境（巡检）', '生产环境（巡检）', 1),
    ('生产环境（运维）', '生产环境（运维）', 2),
    ('生产环境（影响业务）', '生产环境（影响业务）', 3),
    ('已投产业务测试环境', '已投产业务测试环境', 4),
    ('交付阶段', '交付阶段', 5),
    ('POC阶段', 'POC阶段', 6)
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
    '生产环境（巡检）',
    '生产环境（运维）',
    '生产环境（影响业务）',
    '已投产业务测试环境',
    '交付阶段',
    'POC阶段'
  );

COMMIT;
