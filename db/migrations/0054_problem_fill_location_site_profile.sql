BEGIN;

-- 问题填写：局点由自由文本改回下拉选择，选项来自「局点档案」的局点名称。
-- LOCATION_SET 自 0005 起即为 external_api（无静态枚举项），此处重新断言来源类型，
-- 并把 problem_fill.location 字段挂回该选项集；选项值由后端按 site_profile.site_name 实时填充。
UPDATE option_set
SET source_type = 'external_api',
    source_config = '{"desc":"局点档案-局点名称"}'::jsonb,
    updated_at = NOW()
WHERE set_code = 'LOCATION_SET';

UPDATE node_field_def nfd
SET
  field_type = 'whitelist',
  option_set_id = (SELECT id FROM option_set WHERE set_code = 'LOCATION_SET'),
  updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'problem_fill'
  AND nfd.field_key = 'location';

COMMIT;
