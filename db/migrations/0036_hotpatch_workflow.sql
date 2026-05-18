BEGIN;

ALTER TABLE ticket ADD COLUMN IF NOT EXISTS flow_context JSONB;

INSERT INTO workflow_template (template_code, template_name, version)
VALUES ('HOTPATCH', '热补丁管理', 1)
ON CONFLICT (template_code) DO NOTHING;

WITH t AS (SELECT id FROM workflow_template WHERE template_code = 'HOTPATCH')
INSERT INTO workflow_node (template_id, node_key, node_name, node_order, is_terminal)
SELECT t.id, 'hp_demand_fill', '诉求填写', 1, FALSE FROM t UNION ALL SELECT t.id, 'hp_dev_fill', '开发填写', 2, FALSE FROM t UNION ALL SELECT t.id, 'hp_ccb', '热补丁CCB', 3, FALSE FROM t UNION ALL SELECT t.id, 'hp_plan', '计划制定', 4, FALSE FROM t UNION ALL SELECT t.id, 'hp_assign_dev', '指定开发', 5, FALSE FROM t UNION ALL SELECT t.id, 'hp_assign_test', '指定测试', 6, FALSE FROM t UNION ALL SELECT t.id, 'hp_dev_analysis', '开发分析', 7, FALSE FROM t UNION ALL SELECT t.id, 'hp_test_analysis', '测试分析', 8, FALSE FROM t UNION ALL SELECT t.id, 'hp_walkthrough', '热补丁串讲', 9, FALSE FROM t UNION ALL SELECT t.id, 'hp_pm_check', 'PM自检', 10, FALSE FROM t UNION ALL SELECT t.id, 'hp_de_check', 'DE自检', 11, FALSE FROM t UNION ALL SELECT t.id, 'hp_tse_check', 'TSE自检', 12, FALSE FROM t UNION ALL SELECT t.id, 'hp_eng_check', '工程人员自检', 13, FALSE FROM t UNION ALL SELECT t.id, 'hp_transfer_start', '转测发起', 14, FALSE FROM t UNION ALL SELECT t.id, 'hp_transfer_confirm', '转测确认', 15, FALSE FROM t UNION ALL SELECT t.id, 'hp_test_verify', '测试验证', 16, FALSE FROM t UNION ALL SELECT t.id, 'hp_bu_conclusion', 'BU测试结论', 17, FALSE FROM t UNION ALL SELECT t.id, 'hp_review_publish', '评审发布', 18, FALSE FROM t
ON CONFLICT (template_id, node_key) DO NOTHING;

INSERT INTO option_set (set_code, set_name, source_type)
VALUES ('OS_HP_PROBLEM_TYPE', '热补丁问题类型', 'static')
ON CONFLICT (set_code) DO NOTHING;
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order)
SELECT os.id, v.ov, v.ol, v.so FROM option_set os
JOIN (VALUES
  ('OS_HP_PROBLEM_TYPE', '生产环境-问题首次发现', '生产环境-问题首次发现', 1),
  ('OS_HP_PROBLEM_TYPE', '生产环境-内部测试已知', '生产环境-内部测试已知', 2),
  ('OS_HP_PROBLEM_TYPE', '生产环境-巡检/运维类', '生产环境-巡检/运维类', 3),
  ('OS_HP_PROBLEM_TYPE', '生产环境-其他局点已发生', '生产环境-其他局点已发生', 4),
  ('OS_HP_PROBLEM_TYPE', '客户测试环境', '客户测试环境', 5),
  ('OS_HP_PROBLEM_TYPE', '下游测试环境', '下游测试环境', 6)
) AS v(set_code, ov, ol, so) ON os.set_code = v.set_code
ON CONFLICT (option_set_id, option_value) DO NOTHING;

INSERT INTO node_field_def (node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order)
 SELECT wn.id, 'fill_date', '填写日期', 'date', TRUE, FALSE,
  'today', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, 'dts_no', 'DTS单号', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, 'dts_desc', 'DTS描述', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, 'dts_baseline_version', 'DTS基线版本', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, 'problem_type', '问题类型', 'whitelist', TRUE, FALSE,
  'none', NULL::text, (SELECT id FROM option_set WHERE set_code = 'OS_HP_PROBLEM_TYPE' LIMIT 1), NULL::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, 'expected_patch_version', '期望补丁版本', 'whitelist', TRUE, FALSE,
  'none', NULL::text, (SELECT id FROM option_set WHERE set_code = 'OS_UPGRADE_BASELINE' LIMIT 1), NULL::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '期望补丁时间', '期望补丁时间', 'date', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 7
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '是否有规避手段', '是否有规避手段', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 8
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '是否接受冷不丁', '是否接受冷不丁', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 9
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '局点', '局点', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 10
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '问题登记人', '问题登记人', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 11
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '运维人员', '运维人员', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 12
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '开发责任人', '开发责任人', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 13
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '客户特殊诉求', '客户特殊诉求', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 14
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '热补丁必要性说明', '热补丁必要性说明', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 15
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '问题现象及触发场景', '问题现象及触发场景', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 16
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '备注', '备注', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 17
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, '局点信息附件', '局点信息附件', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, NULL::jsonb, NULL::jsonb, 18
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_demand_fill' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交热补丁CCB", "转交开发填写", "返回诉求填写"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, 'hp_de', 'DE', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, 'hp_se', 'SE', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, 'hp_pl', 'PL', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, 'hp_xm', 'XM', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '责任田_xm组_', '责任田（XM组）', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 7
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '是否支持热补丁', '是否支持热补丁', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 8
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '是否出过热补丁', '是否出过热补丁', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 9
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '已修复热补丁版本号', '已修复热补丁版本号', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 10
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '是否必现', '是否必现', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 11
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '总代码量_k_', '总代码量（k）', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 12
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '实际修改代码量_k_', '实际修改代码量（k）', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 13
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '问题现象', '问题现象', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 14
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '触发因素', '触发因素', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 15
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '触发概率', '触发概率', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 16
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '问题根因', '问题根因', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 17
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '问题影响', '问题影响', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 18
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, '规避措施', '规避措施', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发填写", "返回诉求填写"]}]}'::jsonb, NULL::jsonb, 19
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_fill' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交计划制定", "转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '热补丁是否修复', '热补丁是否修复', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '评审修复补丁版本', '评审修复补丁版本', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '结果确认', '结果确认', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}], "static_options": ["通过", "不通过"]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, 'ccb与会人', 'CCB与会人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '是否影响管控', '是否影响管控', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 7
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, 'ccb时间', 'CCB时间', 'date', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}]}'::jsonb, NULL::jsonb, 8
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '热补丁版本号', '热补丁版本号', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}]}'::jsonb, NULL::jsonb, 9
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '评审遗留问题', '评审遗留问题', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}]}'::jsonb, NULL::jsonb, 10
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '热补丁发布目的', '热补丁发布目的', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}]}'::jsonb, NULL::jsonb, 11
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '目标客户', '目标客户', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}]}'::jsonb, NULL::jsonb, 12
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '管控验证点', '管控验证点', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}]}'::jsonb, NULL::jsonb, 13
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, '问题现象', '问题现象', 'text', FALSE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁CCB", "返回开发填写", "裁决未通过（结束）"]}]}'::jsonb, NULL::jsonb, 14
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_ccb' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交指定开发/指定测试", "转交计划制定", "返回热补丁CCB"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_plan' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"visible_when_all": [{"field": "handle_mode", "values": ["转交计划制定", "返回热补丁CCB"]}], "required_when_visible": true, "static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_plan' UNION ALL SELECT wn.id, '测试人员', '测试人员', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交计划制定", "返回热补丁CCB"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_plan' UNION ALL SELECT wn.id, '开发人员', '开发人员', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交计划制定", "返回热补丁CCB"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_plan' UNION ALL SELECT wn.id, '热补丁单号', '热补丁单号', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交计划制定", "返回热补丁CCB"]}]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_plan' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交开发分析", "转交指定开发"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_dev' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_dev' UNION ALL SELECT wn.id, 'hp_de', 'DE', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交指定开发"]}], "static_options": ["姓名+工号"]}'::jsonb, '{"inherit_previous": true}'::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_dev' UNION ALL SELECT wn.id, 'hp_se', 'SE', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交指定开发"]}], "static_options": ["姓名+工号"]}'::jsonb, '{"inherit_previous": true}'::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_dev' UNION ALL SELECT wn.id, 'hp_pl', 'PL', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交指定开发"]}], "static_options": ["姓名+工号"]}'::jsonb, '{"inherit_previous": true}'::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_dev' UNION ALL SELECT wn.id, 'hp_xm', 'XM', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交指定开发"]}], "static_options": ["姓名+工号"]}'::jsonb, '{"inherit_previous": true}'::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_dev' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交测试分析", "转交指定测试"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_test' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_test' UNION ALL SELECT wn.id, 'hp_tse', 'TSE', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交指定测试"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_test' UNION ALL SELECT wn.id, 'hp_te', 'TE', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交指定测试"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_assign_test' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交热补丁串讲", "转交开发分析", "返回指定开发"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '热补丁dts单号', '热补丁DTS单号', 'text', FALSE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '此问题首次修复时间', '此问题首次修复时间', 'date', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '此问题首次修复对应版本号', '此问题首次修复对应版本号', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '补丁采用的是否为正式的修改方案', '补丁采用的是否为正式的修改方案', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '责任田se是否评审通过', '责任田SE是否评审通过', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 7
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '是否涉及内存野指针', '是否涉及内存野指针', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 8
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '是否涉及跨责任田', '是否涉及跨责任田', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 9
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '跨责任田确认人', '跨责任田确认人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 10
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '具体跨责任田', '具体跨责任田', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 11
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '是否需要长稳', '是否需要长稳', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 12
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '修改涉及架构模块', '修改涉及架构模块', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 13
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '修改涉及对外功能点', '修改涉及对外功能点', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 14
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '打补丁前是否需要执行前置操作', '打补丁前是否需要执行前置操作', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 15
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '打补丁后是否需要执行后置操作', '打补丁后是否需要执行后置操作', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 16
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '修改方案', '修改方案', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 17
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '举一反三', '举一反三', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 18
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '方案影响分析', '方案影响分析', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 19
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '开发自测情况', '开发自测情况', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 20
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '高斯热补丁制作规范自检', '高斯热补丁制作规范自检', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 21
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '涉及内存野指针的复现用例', '涉及内存野指针的复现用例', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 22
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '修改影响', '修改影响', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 23
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '开发测试建议', '开发测试建议', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 24
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, '定位过程', '定位过程', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交开发分析", "返回指定开发"]}]}'::jsonb, NULL::jsonb, 25
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_dev_analysis' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交热补丁串讲", "转交测试分析", "返回指定测试"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_analysis' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_analysis' UNION ALL SELECT wn.id, 'test_analysis_context', '处理方式', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试分析", "返回指定测试"]}]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_analysis' UNION ALL SELECT wn.id, '前期漏测分析', '前期漏测分析', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试分析", "返回指定测试"]}]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_analysis' UNION ALL SELECT wn.id, '测试方案', '测试方案', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试分析", "返回指定测试"]}]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_analysis' UNION ALL SELECT wn.id, '现网和测试环境的差异', '现网和测试环境的差异', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试分析", "返回指定测试"]}]}'::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_analysis' UNION ALL SELECT wn.id, 'ci范围', 'CI范围', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试分析", "返回指定测试"]}]}'::jsonb, NULL::jsonb, 7
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_analysis' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交自检", "转交热补丁串讲"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_walkthrough' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"visible_when_all": [{"field": "handle_mode", "values": ["转交热补丁串讲"]}], "required_when_visible": true, "static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_walkthrough' UNION ALL SELECT wn.id, '串讲是否通过', '串讲是否通过', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁串讲"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_walkthrough' UNION ALL SELECT wn.id, 'hp_tse', 'TSE', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁串讲"]}], "static_options": ["姓名+工号"]}'::jsonb, '{"inherit_previous": true}'::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_walkthrough' UNION ALL SELECT wn.id, 'hp_te', 'TE', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁串讲"]}], "static_options": ["姓名+工号"]}'::jsonb, '{"inherit_previous": true}'::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_walkthrough' UNION ALL SELECT wn.id, 'hp_pm', 'PM', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁串讲"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_walkthrough' UNION ALL SELECT wn.id, '工程人员', '工程人员', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交热补丁串讲"]}], "static_options": ["姓名+工号"]}'::jsonb, NULL::jsonb, 7
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_walkthrough' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交转测发起", "转交PM自检"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_pm_check' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_pm_check' UNION ALL SELECT wn.id, '补丁安装指导书是否就绪', '补丁安装指导书是否就绪', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交PM自检"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_pm_check' UNION ALL SELECT wn.id, '补丁说明书是否就绪', '补丁说明书是否就绪', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交PM自检"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_pm_check' UNION ALL SELECT wn.id, '截止完成时间', '截止完成时间', 'date', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交PM自检"]}]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_pm_check' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交转测发起", "转交DE自检"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_de_check' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_de_check' UNION ALL SELECT wn.id, '代码是否已合入', '代码是否已合入', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交DE自检"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_de_check' UNION ALL SELECT wn.id, 'cmc版本自检结果', 'Cmc版本自检结果', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交DE自检"]}], "static_options": ["通过", "不通过"]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_de_check' UNION ALL SELECT wn.id, '问题单是否走至cmo', '问题单是否走至cmo', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交DE自检"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_de_check' UNION ALL SELECT wn.id, '截止完成时间', '截止完成时间', 'date', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交DE自检"]}]}'::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_de_check' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交转测发起", "转交TSE自检"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_tse_check' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_tse_check' UNION ALL SELECT wn.id, 'ci范围是否圈定', 'CI范围是否圈定', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交TSE自检"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_tse_check' UNION ALL SELECT wn.id, '截止完成时间', '截止完成时间', 'date', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交TSE自检"]}]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_tse_check' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交转测发起", "转交工程人员自检"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_eng_check' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_eng_check' UNION ALL SELECT wn.id, 'cmc版本构建是否成功', 'CMC版本构建是否成功', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交工程人员自检"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_eng_check' UNION ALL SELECT wn.id, '截止完成时间', '截止完成时间', 'date', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交工程人员自检"]}]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_eng_check' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交转测确认", "转交转测发起"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_transfer_start' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_transfer_start' UNION ALL SELECT wn.id, '转测说明', '转测说明', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交转测发起"]}]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_transfer_start' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交测试验证", "转交转测确认", "返回转测发起"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_transfer_confirm' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_transfer_confirm' UNION ALL SELECT wn.id, '确认转测', '确认转测', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交转测确认", "返回转测发起"]}], "static_options": ["确认转测", "转测打回"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_transfer_confirm' UNION ALL SELECT wn.id, '转测打回原因', '转测打回原因', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交转测确认", "返回转测发起"]}]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_transfer_confirm' UNION ALL SELECT wn.id, '转测打回次数', '转测打回次数', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交转测确认", "返回转测发起"]}]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_transfer_confirm' UNION ALL SELECT wn.id, '说明', '说明', 'text', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交转测确认", "返回转测发起"]}]}'::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_transfer_confirm' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交BU测试结论", "转交测试验证", "返回转测确认"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '测试结论', '测试结论', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}], "static_options": ["验证通过", "带风险通过", "验证不通过"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '满足热补丁规范', '满足热补丁规范', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '补丁安装指导书是否撰写', '补丁安装指导书是否撰写', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '补丁安装指导书测试是否通过', '补丁安装指导书测试是否通过', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '补丁说明书哦测试是否通过', '补丁说明书哦测试是否通过', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 7
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '复现情况', '复现情况', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}]}'::jsonb, NULL::jsonb, 8
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '单点问题回归情况', '单点问题回归情况', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}]}'::jsonb, NULL::jsonb, 9
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '发散测试情况', '发散测试情况', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}]}'::jsonb, NULL::jsonb, 10
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, 'ci用例是否新增看护代码修改', 'CI用例是否新增看护代码修改', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}]}'::jsonb, NULL::jsonb, 11
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '代码测试覆盖分析', '代码测试覆盖分析', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}]}'::jsonb, NULL::jsonb, 12
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '性能测试情况', '性能测试情况', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}]}'::jsonb, NULL::jsonb, 13
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '兼容性测试情况', '兼容性测试情况', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}]}'::jsonb, NULL::jsonb, 14
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, '遗留风险', '遗留风险', 'richtext', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交测试验证", "返回转测确认"]}]}'::jsonb, NULL::jsonb, 15
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_test_verify' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["提交评审发布", "转交BU测试结论", "返回测试验证"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_bu_conclusion' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_bu_conclusion' UNION ALL SELECT wn.id, '混合云验证结果', '混合云验证结果', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交BU测试结论", "返回测试验证"]}], "static_options": ["通过", "不通过", "不涉及"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_bu_conclusion' UNION ALL SELECT wn.id, '公有云验证结果', '公有云验证结果', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交BU测试结论", "返回测试验证"]}], "static_options": ["通过", "不通过", "不涉及"]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_bu_conclusion' UNION ALL SELECT wn.id, 'handle_mode', '处理方式', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"static_options": ["完成", "转交评审发布", "返回BU测试结论"]}'::jsonb, NULL::jsonb, 1
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_review_publish' UNION ALL SELECT wn.id, 'next_handler', '下一步处理人', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"visible_when_all": [{"field": "handle_mode", "values": ["转交评审发布", "返回BU测试结论"]}], "required_when_visible": true, "static_options": ["temp"]}'::jsonb, NULL::jsonb, 2
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_review_publish' UNION ALL SELECT wn.id, '是否组织发布评审', '是否组织发布评审', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交评审发布", "返回BU测试结论"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 3
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_review_publish' UNION ALL SELECT wn.id, '资料评审是否通过', '资料评审是否通过', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交评审发布", "返回BU测试结论"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 4
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_review_publish' UNION ALL SELECT wn.id, 't2t是都完成', 'T2T是都完成', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交评审发布", "返回BU测试结论"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 5
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_review_publish' UNION ALL SELECT wn.id, 'orm电子流是否已签发', 'ORM电子流是否已签发', 'whitelist', TRUE, FALSE,
  'none', NULL::text, NULL::bigint, '{"optional_when_all": [{"field": "handle_mode", "values": ["转交评审发布", "返回BU测试结论"]}], "static_options": ["是", "否"]}'::jsonb, NULL::jsonb, 6
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = 'hp_review_publish'
ON CONFLICT (node_id, field_key) DO UPDATE SET field_name = EXCLUDED.field_name, field_type = EXCLUDED.field_type, required = EXCLUDED.required, constraints_json = EXCLUDED.constraints_json, ui_props_json = EXCLUDED.ui_props_json, sort_order = EXCLUDED.sort_order, is_active = TRUE;

COMMIT;
