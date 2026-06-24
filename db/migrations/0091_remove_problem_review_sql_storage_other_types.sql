BEGIN;

-- 问题审核「问题类型初步判断」：移除「SQL引擎-其他问题」「存储引擎-其他问题」
UPDATE option_item oi
SET is_active = FALSE,
    updated_at = NOW()
FROM option_set os
WHERE oi.option_set_id = os.id
  AND os.set_code = 'OS_PROBLEM_REVIEW_TYPE_JUDGE'
  AND oi.option_value IN ('SQL引擎-其他问题', '存储引擎-其他问题');

COMMIT;
