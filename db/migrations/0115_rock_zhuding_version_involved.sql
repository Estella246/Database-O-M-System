-- 开发分析 / 运维闭环：恢复「磐石版本是否涉及」，新增「铸鼎版本是否涉及」。
-- 仅当「是否质量问题」为「是（已知/新发现质量问题）」时可见并必填；
-- 回流处理方式时整组放宽为可选；运维闭环 inherit_previous 从开发分析继承。

BEGIN;

-- 1. 磐石选项集：按产品要求重排 sort_order（选项值不变）
INSERT INTO option_set (set_code, set_name, source_type, source_config)
VALUES ('OS_DEV_ANALYSIS_ROCK_VER', '开发分析-磐石版本是否涉及', 'static', NULL)
ON CONFLICT (set_code) DO UPDATE SET
  set_name = EXCLUDED.set_name,
  source_type = EXCLUDED.source_type,
  updated_at = NOW();

WITH set_map AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_DEV_ANALYSIS_ROCK_VER'
)
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT sm.option_set_id, v.option_value, v.option_label, v.sort_order, TRUE
FROM set_map sm
CROSS JOIN (VALUES
  ('505.2.1.SPC0800磐石版本无该问题', '505.2.1.SPC0800磐石版本无该问题', 1),
  ('505.2.1.SPC0800磐石版本引入该问题', '505.2.1.SPC0800磐石版本引入该问题', 2),
  ('505.2.1.SPC0800磐石版本涉及-历史版本引入', '505.2.1.SPC0800磐石版本涉及-历史版本引入', 3)
) AS v(option_value, option_label, sort_order)
ON CONFLICT (option_set_id, option_value) DO UPDATE SET
  option_label = EXCLUDED.option_label,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

-- 2. 铸鼎选项集
INSERT INTO option_set (set_code, set_name, source_type, source_config)
VALUES ('OS_DEV_ANALYSIS_ZHUDING_VER', '开发分析-铸鼎版本是否涉及', 'static', NULL)
ON CONFLICT (set_code) DO UPDATE SET
  set_name = EXCLUDED.set_name,
  source_type = EXCLUDED.source_type,
  updated_at = NOW();

WITH set_map AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_DEV_ANALYSIS_ZHUDING_VER'
)
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT sm.option_set_id, v.option_value, v.option_label, v.sort_order, TRUE
FROM set_map sm
CROSS JOIN (VALUES
  ('507.0.0.B071铸鼎版本无该问题', '507.0.0.B071铸鼎版本无该问题', 1),
  ('507.0.0.B071铸鼎版本引入该问题', '507.0.0.B071铸鼎版本引入该问题', 2),
  ('507.0.0.B071铸鼎版本涉及-历史版本引入', '507.0.0.B071铸鼎版本涉及-历史版本引入', 3)
) AS v(option_value, option_label, sort_order)
ON CONFLICT (option_set_id, option_value) DO UPDATE SET
  option_label = EXCLUDED.option_label,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

-- 3. 开发分析：磐石 + 铸鼎（紧挨引入/修复版本之前）
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT' AND wn.node_key = 'dev_analysis'
),
set_map AS (
  SELECT set_code, id AS option_set_id FROM option_set
  WHERE set_code IN ('OS_DEV_ANALYSIS_ROCK_VER', 'OS_DEV_ANALYSIS_ZHUDING_VER')
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT nm.node_id, v.field_key, v.field_name, 'whitelist', FALSE, FALSE,
       'none', NULL, sm.option_set_id,
       '{"visible_when_all":[{"field":"is_quality_issue","values":["是（已知质量问题）","是（新发现质量问题）"]}],"required_when_visible":true,"optional_when_all":[{"field":"handle_mode","values":["提交其他开发分析","返回运维分析"]}]}'::jsonb,
       '{"inherit_previous":true}'::jsonb,
       v.sort_order
FROM node_map nm
CROSS JOIN (VALUES
  ('rock_version_involved', '磐石版本是否涉及', 'OS_DEV_ANALYSIS_ROCK_VER', 20),
  ('zhuding_version_involved', '铸鼎版本是否涉及', 'OS_DEV_ANALYSIS_ZHUDING_VER', 21)
) AS v(field_key, field_name, set_code, sort_order)
JOIN set_map sm ON sm.set_code = v.set_code
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

-- 开发分析：引入/修复版本顺延到磐石/铸鼎之后
UPDATE node_field_def nfd
SET sort_order = CASE nfd.field_key
      WHEN 'intro_version' THEN 22
      WHEN 'fix_version' THEN 23
      ELSE nfd.sort_order
    END,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'dev_analysis'
  AND nfd.field_key IN ('intro_version', 'fix_version')
  AND nfd.is_active = TRUE;

-- 4. 运维闭环：磐石 + 铸鼎（紧挨 DTS 之后、引入/修复版本之前）
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT' AND wn.node_key = 'ops_closure'
),
set_map AS (
  SELECT set_code, id AS option_set_id FROM option_set
  WHERE set_code IN ('OS_DEV_ANALYSIS_ROCK_VER', 'OS_DEV_ANALYSIS_ZHUDING_VER')
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT nm.node_id, v.field_key, v.field_name, 'whitelist', FALSE, FALSE,
       'none', NULL, sm.option_set_id,
       '{"visible_when_all":[{"field":"is_quality_issue","values":["是（已知质量问题）","是（新发现质量问题）"]}],"required_when_visible":true,"optional_when_all":[{"field":"handle_mode","values":["提交其他运维闭环","返回开发闭环","返回运维分析"]}]}'::jsonb,
       '{"inherit_previous":true}'::jsonb,
       v.sort_order
FROM node_map nm
CROSS JOIN (VALUES
  ('rock_version_involved', '磐石版本是否涉及', 'OS_DEV_ANALYSIS_ROCK_VER', 7),
  ('zhuding_version_involved', '铸鼎版本是否涉及', 'OS_DEV_ANALYSIS_ZHUDING_VER', 8)
) AS v(field_key, field_name, set_code, sort_order)
JOIN set_map sm ON sm.set_code = v.set_code
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

-- 5. 重排运维闭环字段顺序
WITH target_node AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_closure'
),
orders AS (
  SELECT * FROM (
    VALUES
      ('handle_mode', 1),
      ('next_handler', 2),
      ('fault_recovery_involved', 3),
      ('fault_to_recovery_duration', 4),
      ('is_quality_issue', 5),
      ('dts_no', 6),
      ('rock_version_involved', 7),
      ('zhuding_version_involved', 8),
      ('intro_version', 9),
      ('fix_version', 10),
      ('has_collaborator', 11),
      ('collaborator', 12),
      ('output_problem_report', 13),
      ('problem_report', 14),
      ('workaround', 15),
      ('root_cause', 16),
      ('issue_track', 17),
      ('dfx_gap', 18),
      ('error_archive_text', 19)
  ) AS t(field_key, sort_order)
)
UPDATE node_field_def nfd
SET sort_order = o.sort_order,
    updated_at = NOW()
FROM target_node n, orders o
WHERE nfd.node_id = n.node_id
  AND nfd.field_key = o.field_key
  AND nfd.is_active = TRUE;

COMMIT;
