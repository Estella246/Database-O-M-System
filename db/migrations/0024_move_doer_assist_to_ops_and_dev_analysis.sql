BEGIN;

-- 1) 下线旧位置（运维闭环）的字段
UPDATE node_field_def nfd
SET is_active = FALSE,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HCS_INCIDENT'
  AND wn.id = nfd.node_id
  AND wn.node_key = 'ops_closure'
  AND nfd.field_key = 'use_doer_assist';

-- 2) 新增/更新 Doer 辅助使用下拉选项集
INSERT INTO option_set (set_code, set_name, source_type, source_config)
VALUES ('OS_DOER_ASSIST_USAGE', 'Doer辅助使用情况', 'static', NULL)
ON CONFLICT (set_code) DO UPDATE
SET set_name = EXCLUDED.set_name,
    source_type = EXCLUDED.source_type,
    source_config = EXCLUDED.source_config,
    updated_at = NOW();

WITH set_map AS (
  SELECT id AS option_set_id
  FROM option_set
  WHERE set_code = 'OS_DOER_ASSIST_USAGE'
),
seed AS (
  SELECT * FROM (VALUES
    ('使用Doer，问题定位/解决', '使用Doer，问题定位/解决', 1),
    ('使用Doer，仅提供思路/辅助提效', '使用Doer，仅提供思路/辅助提效', 2),
    ('使用Doer，无帮助', '使用Doer，无帮助', 3),
    ('未使用Doer', '未使用Doer', 4),
    ('紧急疑难工单', '紧急疑难工单', 5)
  ) AS v(option_value, option_label, sort_order)
)
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT sm.option_set_id, s.option_value, s.option_label, s.sort_order, TRUE
FROM set_map sm
JOIN seed s ON TRUE
ON CONFLICT (option_set_id, option_value) DO UPDATE
SET option_label = EXCLUDED.option_label,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE,
    updated_at = NOW();

-- 3) 运维分析：新增必填“是否使用Doer辅助”
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_analysis'
),
set_map AS (
  SELECT id AS option_set_id
  FROM option_set
  WHERE set_code = 'OS_DOER_ASSIST_USAGE'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'use_doer_assist' AS field_key,
  '是否使用Doer辅助' AS field_name,
  'whitelist' AS field_type,
  TRUE AS required,
  FALSE AS read_only,
  'none' AS default_type,
  NULL AS default_value,
  sm.option_set_id,
  '{"optional_when_all":[{"field":"handle_mode","values":["提交其他运维分析"]}]}'::jsonb AS constraints_json,
  '{"inherit_previous":false}'::jsonb AS ui_props_json,
  28 AS sort_order
FROM node_map nm
JOIN set_map sm ON TRUE
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

-- 4) 运维分析：当“使用Doer，无帮助”时显示并必填“原因”文本框
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_analysis'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'doer_no_help_reason' AS field_key,
  '使用Doer，无帮助原因' AS field_name,
  'text' AS field_type,
  FALSE AS required,
  FALSE AS read_only,
  'none' AS default_type,
  NULL AS default_value,
  NULL::bigint AS option_set_id,
  '{"visible_when_all":[{"field":"use_doer_assist","values":["使用Doer，无帮助"]}],"required_when_visible":true,"optional_when_all":[{"field":"handle_mode","values":["提交其他运维分析"]}]}'::jsonb AS constraints_json,
  '{"inherit_previous":false}'::jsonb AS ui_props_json,
  29 AS sort_order
FROM node_map nm
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

-- 5) 开发分析：继承并保留同名字段（必填）
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'dev_analysis'
),
set_map AS (
  SELECT id AS option_set_id
  FROM option_set
  WHERE set_code = 'OS_DOER_ASSIST_USAGE'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'use_doer_assist' AS field_key,
  '是否使用Doer辅助' AS field_name,
  'whitelist' AS field_type,
  TRUE AS required,
  FALSE AS read_only,
  'none' AS default_type,
  NULL AS default_value,
  sm.option_set_id,
  '{"optional_when_all":[{"field":"handle_mode","values":["提交其他开发分析","返回运维分析"]}]}'::jsonb AS constraints_json,
  '{"inherit_previous":true}'::jsonb AS ui_props_json,
  18 AS sort_order
FROM node_map nm
JOIN set_map sm ON TRUE
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

COMMIT;
