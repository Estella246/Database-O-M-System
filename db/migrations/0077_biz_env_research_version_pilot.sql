BEGIN;

-- 问题阶段（BIZ_ENV_SET）新增「在研版本试点」
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT os.id, '在研版本试点', '在研版本试点', 5, TRUE
FROM option_set os
WHERE os.set_code = 'BIZ_ENV_SET'
ON CONFLICT (option_set_id, option_value) DO UPDATE SET
  option_label = EXCLUDED.option_label,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

COMMIT;
