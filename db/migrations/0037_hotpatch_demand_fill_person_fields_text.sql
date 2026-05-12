BEGIN;

-- 热补丁「诉求填写」：运维人员、开发责任人应为自由填写的人员信息文本（推荐「姓名+工号」等形式），
-- 不应配置为仅含单一占位说明项的白名单（否则只能选该字面量）。
UPDATE node_field_def nfd
SET
  field_type = 'text',
  option_set_id = NULL,
  constraints_json = NULL
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HOTPATCH'
  AND wn.node_key = 'hp_demand_fill'
  AND nfd.field_key IN ('运维人员', '开发责任人');

COMMIT;
