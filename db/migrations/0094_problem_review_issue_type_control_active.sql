BEGIN;

-- 问题类型初步判断：恢复「管控问题」选项（提交专项轮值表时可选，走管控轮值表）
UPDATE option_item oi
SET is_active = TRUE,
    updated_at = NOW()
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_PROBLEM_REVIEW_TYPE_JUDGE'
  AND oi.option_value = '管控问题';

COMMIT;
