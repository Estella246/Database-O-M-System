-- Add l30030745 李潇雨 to all next_handler white lists.
-- Covers all handle modes that rely on the next_handler option sets.

DO $$
DECLARE
  v_set_id BIGINT;
  v_next_sort INT;
BEGIN
  FOR v_set_id IN
    SELECT id
    FROM option_set
    WHERE set_code IN ('OS_PROBLEM_REVIEW_NEXT_HANDLER', 'OS_OPS_ANALYSIS_NEXT_HANDLER')
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM option_item
      WHERE option_set_id = v_set_id
        AND option_value = 'l30030745 李潇雨'
    ) THEN
      SELECT COALESCE(MAX(sort_order), 0) + 1
      INTO v_next_sort
      FROM option_item
      WHERE option_set_id = v_set_id;

      INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
      VALUES (v_set_id, 'l30030745 李潇雨', 'l30030745 李潇雨', v_next_sort, TRUE);
    END IF;
  END LOOP;
END $$;
