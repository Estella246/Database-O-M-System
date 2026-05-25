-- 开发分析节点新增「引入版本」「修复版本」字段，用于评估工单影响。
-- 两个字段共用 external_api 选项集 OS_RELEASE_VERSION，选项值由后端实时取自
-- param_baseline_version（参数配置-版本模块-基线版本）。

BEGIN;

-- 1. 新建 external_api 选项集；选项值由后端实时填充，无静态枚举项
INSERT INTO option_set (set_code, set_name, source_type, source_config)
VALUES ('OS_RELEASE_VERSION', '版本（基线版本）', 'external_api',
        '{"desc":"参数配置-版本模块-基线版本"}'::jsonb)
ON CONFLICT (set_code) DO UPDATE SET
  set_name = EXCLUDED.set_name,
  source_type = EXCLUDED.source_type,
  source_config = EXCLUDED.source_config;

-- 2. 在 HCS_INCIDENT 的 dev_analysis 节点新增 引入版本 / 修复版本
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT' AND wn.node_key = 'dev_analysis'
),
set_map AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_RELEASE_VERSION'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT nm.node_id, v.field_key, v.field_name, 'whitelist', FALSE, FALSE,
       'none', NULL, sm.option_set_id, NULL::jsonb,
       '{"inherit_previous":true}'::jsonb, v.sort_order
FROM node_map nm
CROSS JOIN set_map sm
CROSS JOIN (VALUES
  ('intro_version', '引入版本', 20),
  ('fix_version',   '修复版本', 21)
) AS v(field_key, field_name, sort_order)
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
