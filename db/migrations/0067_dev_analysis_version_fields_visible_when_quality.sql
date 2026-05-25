-- 开发分析：「引入版本」「修复版本」仅在「是否质量问题」为「是（已知/新发现）」时可见并必填，
-- 处理方式为「提交其他开发分析」或「返回运维分析」时整组放宽为可选（避免回流卡住）。
-- 与 ops_analysis 行为一致；复用 0024 的 visible_when_all + required_when_visible 模式。

BEGIN;

UPDATE node_field_def nfd
SET constraints_json = '{
  "visible_when_all": [
    {"field": "is_quality_issue", "values": ["是（已知质量问题）", "是（新发现质量问题）"]}
  ],
  "required_when_visible": true,
  "optional_when_all": [
    {"field": "handle_mode", "values": ["提交其他开发分析", "返回运维分析"]}
  ]
}'::jsonb,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'dev_analysis'
  AND nfd.field_key IN ('intro_version', 'fix_version')
  AND nfd.is_active = TRUE;

COMMIT;
