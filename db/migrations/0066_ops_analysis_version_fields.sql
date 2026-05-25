-- 运维分析节点新增「引入版本」「修复版本」字段，用于评估工单影响。
-- 复用 0065 创建的 external_api 选项集 OS_RELEASE_VERSION（选项实时取自 param_baseline_version）。
-- 仅当「是否质量问题」选为「是（已知/新发现质量问题）」时该组字段可见并必填，
-- 沿用 0024 的 visible_when_all + required_when_visible 模式；
-- 处理方式为「提交其他运维分析」（停留本节点）时整组放宽为可选。
-- 修复版本支持多选（与 dev_analysis、协同处理人同机制：ui_props.multiple=true，全角分号拼接落库）。

BEGIN;

-- 1. 在 HCS_INCIDENT 的 ops_analysis 节点新增 引入版本 / 修复版本
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT' AND wn.node_key = 'ops_analysis'
),
set_map AS (
  SELECT id AS option_set_id FROM option_set WHERE set_code = 'OS_RELEASE_VERSION'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT nm.node_id, v.field_key, v.field_name, 'whitelist', FALSE, FALSE,
       'none', NULL, sm.option_set_id,
       '{"visible_when_all":[{"field":"is_quality_issue","values":["是（已知质量问题）","是（新发现质量问题）"]}],"required_when_visible":true,"optional_when_all":[{"field":"handle_mode","values":["提交其他运维分析"]}]}'::jsonb,
       v.ui_props::jsonb,
       v.sort_order
FROM node_map nm
CROSS JOIN set_map sm
CROSS JOIN (VALUES
  ('intro_version', '引入版本', '{"inherit_previous":true}',                  30),
  ('fix_version',   '修复版本', '{"inherit_previous":true,"multiple":true}',  31)
) AS v(field_key, field_name, ui_props, sort_order)
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
