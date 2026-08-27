-- 问题填写「问题阶段」拆成两个必填下拉：问题阶段 + 问题环境。
-- 派单仍只读 biz_env（POC阶段 / 在研版本试点）。
BEGIN;

-- 1) 问题阶段选项：POC / 交付 / 运维 / 在研版本试点
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT os.id, v.option_value, v.option_label, v.sort_order, TRUE
FROM option_set os
JOIN (
  VALUES
    ('POC阶段', 'POC阶段', 1),
    ('交付阶段', '交付阶段', 2),
    ('运维阶段', '运维阶段', 3),
    ('在研版本试点', '在研版本试点', 4)
) AS v(option_value, option_label, sort_order) ON TRUE
WHERE os.set_code = 'BIZ_ENV_SET'
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
  AND os.set_code = 'BIZ_ENV_SET'
  AND oi.option_value NOT IN ('POC阶段', '交付阶段', '运维阶段', '在研版本试点');

-- 2) 问题环境选项集
INSERT INTO option_set (set_code, set_name, source_type, source_config)
VALUES ('OS_PROBLEM_ENV', '问题环境', 'static', NULL)
ON CONFLICT (set_code) DO UPDATE SET
  set_name = EXCLUDED.set_name,
  source_type = EXCLUDED.source_type,
  is_active = TRUE,
  updated_at = NOW();

WITH set_map AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_PROBLEM_ENV'
)
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT sm.option_set_id, v.option_value, v.option_label, v.sort_order, TRUE
FROM set_map sm
CROSS JOIN (VALUES
  ('测试环境', '测试环境', 1),
  ('生产环境', '生产环境', 2)
) AS v(option_value, option_label, sort_order)
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
  AND os.set_code = 'OS_PROBLEM_ENV'
  AND oi.option_value NOT IN ('测试环境', '生产环境');

-- 3) 问题填写：问题环境插在问题阶段之后（已存在则不再挪后续字段，避免重跑把顺序冲掉）
UPDATE node_field_def nfd
SET sort_order = nfd.sort_order + 1,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'problem_fill'
  AND nfd.is_active = TRUE
  AND nfd.field_key <> 'problem_env'
  AND NOT EXISTS (
    SELECT 1 FROM node_field_def x
    WHERE x.node_id = nfd.node_id AND x.field_key = 'problem_env'
  )
  AND nfd.sort_order > (
    SELECT nfd2.sort_order
    FROM node_field_def nfd2
    WHERE nfd2.node_id = nfd.node_id
      AND nfd2.field_key = 'biz_env'
    LIMIT 1
  );

WITH node_map AS (
  SELECT wn.id AS node_id, nfd.sort_order AS biz_env_order
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  JOIN node_field_def nfd ON nfd.node_id = wn.id AND nfd.field_key = 'biz_env'
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'problem_fill'
),
os AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_PROBLEM_ENV' LIMIT 1
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'problem_env',
  '问题环境',
  'whitelist',
  TRUE,
  FALSE,
  'none',
  NULL,
  os.option_set_id,
  NULL,
  '{"inherit_previous": false}'::jsonb,
  nm.biz_env_order + 1
FROM node_map nm
CROSS JOIN os
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  read_only = EXCLUDED.read_only,
  default_type = EXCLUDED.default_type,
  default_value = EXCLUDED.default_value,
  option_set_id = EXCLUDED.option_set_id,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

-- 4) 运维分析：同步拆分并继承
UPDATE node_field_def nfd
SET sort_order = nfd.sort_order + 1,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.is_active = TRUE
  AND nfd.field_key <> 'problem_env'
  AND NOT EXISTS (
    SELECT 1 FROM node_field_def x
    WHERE x.node_id = nfd.node_id AND x.field_key = 'problem_env'
  )
  AND nfd.sort_order > (
    SELECT nfd2.sort_order
    FROM node_field_def nfd2
    WHERE nfd2.node_id = nfd.node_id
      AND nfd2.field_key = 'biz_env'
    LIMIT 1
  );

WITH node_map AS (
  SELECT wn.id AS node_id, nfd.sort_order AS biz_env_order
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  JOIN node_field_def nfd ON nfd.node_id = wn.id AND nfd.field_key = 'biz_env'
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_analysis'
),
os AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_PROBLEM_ENV' LIMIT 1
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'problem_env',
  '问题环境',
  'whitelist',
  TRUE,
  FALSE,
  'none',
  NULL,
  os.option_set_id,
  NULL,
  '{"inherit_previous": true}'::jsonb,
  nm.biz_env_order + 1
FROM node_map nm
CROSS JOIN os
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  read_only = EXCLUDED.read_only,
  default_type = EXCLUDED.default_type,
  default_value = EXCLUDED.default_value,
  option_set_id = EXCLUDED.option_set_id,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

-- 5) 历史工单：环境类取值拆到 problem_env，阶段改为运维阶段
UPDATE ticket_node_data
SET values_json = CASE values_json->>'biz_env'
  WHEN '生产环境' THEN
    jsonb_set(jsonb_set(values_json, '{biz_env}', '"运维阶段"'), '{problem_env}', '"生产环境"', true)
  WHEN '生产环境（运维）' THEN
    jsonb_set(jsonb_set(values_json, '{biz_env}', '"运维阶段"'), '{problem_env}', '"生产环境"', true)
  WHEN '生产环境（巡检）' THEN
    jsonb_set(jsonb_set(values_json, '{biz_env}', '"运维阶段"'), '{problem_env}', '"生产环境"', true)
  WHEN '生产环境（影响业务）' THEN
    jsonb_set(jsonb_set(values_json, '{biz_env}', '"运维阶段"'), '{problem_env}', '"生产环境"', true)
  WHEN '已投产业务测试环境' THEN
    jsonb_set(jsonb_set(values_json, '{biz_env}', '"运维阶段"'), '{problem_env}', '"测试环境"', true)
  ELSE values_json
END
WHERE values_json ? 'biz_env'
  AND values_json->>'biz_env' IN (
    '生产环境',
    '生产环境（运维）',
    '生产环境（巡检）',
    '生产环境（影响业务）',
    '已投产业务测试环境'
  );

UPDATE ticket_list_snapshot
SET extra_fields = CASE
      WHEN biz_env IN ('生产环境', '生产环境（运维）', '生产环境（巡检）', '生产环境（影响业务）') THEN
        jsonb_set(COALESCE(extra_fields, '{}'::jsonb), '{problem_env}', '"生产环境"', true)
      WHEN biz_env = '已投产业务测试环境' THEN
        jsonb_set(COALESCE(extra_fields, '{}'::jsonb), '{problem_env}', '"测试环境"', true)
      ELSE extra_fields
    END,
    biz_env = CASE
      WHEN biz_env IN (
        '生产环境',
        '生产环境（运维）',
        '生产环境（巡检）',
        '生产环境（影响业务）',
        '已投产业务测试环境'
      ) THEN '运维阶段'
      ELSE biz_env
    END
WHERE biz_env IN (
  '生产环境',
  '生产环境（运维）',
  '生产环境（巡检）',
  '生产环境（影响业务）',
  '已投产业务测试环境'
);

DO $$
DECLARE
  rec RECORD;
  fbn jsonb;
  nk text;
  old_env text;
  new_stage text;
  new_env text;
  changed boolean;
BEGIN
  FOR rec IN
    SELECT ticket_id, fields_by_node
    FROM ticket_list_snapshot
    WHERE fields_by_node IS NOT NULL
  LOOP
    fbn := rec.fields_by_node;
    changed := FALSE;
    FOREACH nk IN ARRAY ARRAY['problem_fill', 'ops_analysis']
    LOOP
      IF NOT (fbn ? nk) THEN
        CONTINUE;
      END IF;
      old_env := fbn->nk->>'biz_env';
      new_stage := NULL;
      new_env := NULL;
      IF old_env IN ('生产环境', '生产环境（运维）', '生产环境（巡检）', '生产环境（影响业务）') THEN
        new_stage := '运维阶段';
        new_env := '生产环境';
      ELSIF old_env = '已投产业务测试环境' THEN
        new_stage := '运维阶段';
        new_env := '测试环境';
      END IF;
      IF new_stage IS NOT NULL THEN
        fbn := jsonb_set(fbn, ARRAY[nk, 'biz_env'], to_jsonb(new_stage));
        fbn := jsonb_set(fbn, ARRAY[nk, 'problem_env'], to_jsonb(new_env), true);
        changed := TRUE;
      END IF;
    END LOOP;
    IF changed THEN
      UPDATE ticket_list_snapshot
      SET fields_by_node = fbn
      WHERE ticket_id = rec.ticket_id;
    END IF;
  END LOOP;
END $$;

COMMIT;
