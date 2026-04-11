-- 责任田示例树：仅在表为空时插入（SQL引擎 → CBB / 驱动(JDBC,ODBC) / 慢SQL(等待时间,代价模型不足)）
DO $$
DECLARE
  root_id bigint;
  drv_id bigint;
  slow_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM duty_field_node LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO duty_field_node (parent_id, label, sort_order, updated_by)
  VALUES (NULL, 'SQL引擎', 0, 'seed')
  RETURNING id INTO root_id;

  INSERT INTO duty_field_node (parent_id, label, sort_order, updated_by) VALUES
  (root_id, 'CBB', 0, 'seed'),
  (root_id, '驱动', 1, 'seed'),
  (root_id, '慢SQL', 2, 'seed');

  SELECT id INTO drv_id FROM duty_field_node WHERE parent_id = root_id AND label = '驱动' ORDER BY id LIMIT 1;
  SELECT id INTO slow_id FROM duty_field_node WHERE parent_id = root_id AND label = '慢SQL' ORDER BY id LIMIT 1;

  INSERT INTO duty_field_node (parent_id, label, sort_order, updated_by) VALUES
  (drv_id, 'JDBC', 0, 'seed'),
  (drv_id, 'ODBC', 1, 'seed'),
  (slow_id, '等待时间', 0, 'seed'),
  (slow_id, '代价模型不足', 1, 'seed');
END $$;
