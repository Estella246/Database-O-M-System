-- 按当前问题阶段集合回填 problem_env，不改 biz_env。
-- 3 万工单一次顺序扫描；勿再对 fields_by_node 逐 ticket UPDATE。
--
-- 仅 problem_env 为空时写入：
--   生产环境 / 生产环境（运维|巡检|影响业务） → 生产环境
--   已投产业务测试环境 / POC阶段 / 交付阶段 / 在研版本试点 → 测试环境
--   空阶段、运维阶段且环境空 → 不写（统计侧不计入环境饼）
-- 幂等：已有 problem_env 不覆盖。

BEGIN;

CREATE TEMP TABLE _pe_map (
  old_biz text PRIMARY KEY,
  new_env text NOT NULL
) ON COMMIT DROP;

INSERT INTO _pe_map (old_biz, new_env) VALUES
  ('生产环境', '生产环境'),
  ('生产环境（运维）', '生产环境'),
  ('生产环境（巡检）', '生产环境'),
  ('生产环境（影响业务）', '生产环境'),
  ('已投产业务测试环境', '测试环境'),
  ('POC阶段', '测试环境'),
  ('交付阶段', '测试环境'),
  ('在研版本试点', '测试环境');

UPDATE ticket_node_data tnd
SET values_json = jsonb_set(
  tnd.values_json,
  '{problem_env}',
  to_jsonb(m.new_env),
  true
)
FROM _pe_map m
WHERE tnd.values_json->>'biz_env' = m.old_biz
  AND NULLIF(BTRIM(COALESCE(tnd.values_json->>'problem_env', '')), '') IS NULL;

UPDATE ticket_list_snapshot tls
SET extra_fields = jsonb_set(
  COALESCE(tls.extra_fields, '{}'::jsonb),
  '{problem_env}',
  to_jsonb(m.new_env),
  true
)
FROM _pe_map m
WHERE tls.biz_env = m.old_biz
  AND NULLIF(BTRIM(COALESCE(tls.extra_fields->>'problem_env', '')), '') IS NULL;

UPDATE ticket_list_snapshot tls
SET fields_by_node = jsonb_set(
  tls.fields_by_node,
  '{problem_fill}',
  jsonb_set(
    tls.fields_by_node->'problem_fill',
    '{problem_env}',
    to_jsonb(m.new_env),
    true
  )
)
FROM _pe_map m
WHERE tls.fields_by_node ? 'problem_fill'
  AND tls.fields_by_node->'problem_fill'->>'biz_env' = m.old_biz
  AND NULLIF(BTRIM(COALESCE(tls.fields_by_node->'problem_fill'->>'problem_env', '')), '') IS NULL;

UPDATE ticket_list_snapshot tls
SET fields_by_node = jsonb_set(
  tls.fields_by_node,
  '{ops_analysis}',
  jsonb_set(
    tls.fields_by_node->'ops_analysis',
    '{problem_env}',
    to_jsonb(m.new_env),
    true
  )
)
FROM _pe_map m
WHERE tls.fields_by_node ? 'ops_analysis'
  AND tls.fields_by_node->'ops_analysis'->>'biz_env' = m.old_biz
  AND NULLIF(BTRIM(COALESCE(tls.fields_by_node->'ops_analysis'->>'problem_env', '')), '') IS NULL;

COMMIT;
