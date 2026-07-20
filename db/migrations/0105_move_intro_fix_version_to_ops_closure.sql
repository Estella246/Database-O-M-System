-- 引入版本 / 修复版本：从运维分析移至运维闭环。
-- 弹出规则不变：仅当「是否质量问题」为「是（已知/新发现质量问题）」时可见并必填；
-- 回流处理方式（提交其他运维闭环 / 返回开发闭环 / 返回运维分析）时整组放宽为可选。
-- 启用 inherit_previous，取值优先从开发分析（及更前序同键非空）继承。
-- 运维分析侧字段停用（历史 ticket_node_data 保留）。

BEGIN;

-- 1. 停用运维分析的引入版本 / 修复版本
UPDATE node_field_def nfd
SET is_active = FALSE,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.field_key IN ('intro_version', 'fix_version')
  AND nfd.is_active = TRUE;

-- 2. 运维闭环新增引入版本 / 修复版本（复用 OS_RELEASE_VERSION）
WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT' AND wn.node_key = 'ops_closure'
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
       '{"visible_when_all":[{"field":"is_quality_issue","values":["是（已知质量问题）","是（新发现质量问题）"]}],"required_when_visible":true,"optional_when_all":[{"field":"handle_mode","values":["提交其他运维闭环","返回开发闭环","返回运维分析"]}]}'::jsonb,
       v.ui_props::jsonb,
       v.sort_order
FROM node_map nm
CROSS JOIN set_map sm
CROSS JOIN (VALUES
  ('intro_version', '引入版本', '{"inherit_previous":true}',                  7),
  ('fix_version',   '修复版本', '{"inherit_previous":true,"multiple":true}',  8)
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

-- 3. 重排运维闭环字段顺序（版本字段紧挨是否质量问题 / DTS）
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
      ('intro_version', 7),
      ('fix_version', 8),
      ('has_collaborator', 9),
      ('collaborator', 10),
      ('output_problem_report', 11),
      ('problem_report', 12),
      ('workaround', 13),
      ('root_cause', 14),
      ('issue_track', 15),
      ('dfx_gap', 16),
      ('error_archive_text', 17)
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
