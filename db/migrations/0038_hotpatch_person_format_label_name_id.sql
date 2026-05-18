BEGIN;

-- 热补丁：人员类占位说明由「工号+姓名」改为「姓名+工号」（与产品表述一致）。
UPDATE node_field_def nfd
SET constraints_json = replace(nfd.constraints_json::text, '工号+姓名', '姓名+工号')::jsonb
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HOTPATCH'
  AND nfd.constraints_json IS NOT NULL
  AND nfd.constraints_json::text LIKE '%工号+姓名%';

COMMIT;
