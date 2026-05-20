BEGIN;

-- 「是否有core堆栈」专用选项集（避免改动共用 OS_YES_NO）
INSERT INTO option_set (set_code, set_name, source_type, source_config)
VALUES ('OS_HAS_CORE_STACK', '是否有core堆栈', 'static', NULL)
ON CONFLICT (set_code) DO UPDATE
SET set_name = EXCLUDED.set_name,
    source_type = EXCLUDED.source_type,
    source_config = EXCLUDED.source_config,
    updated_at = NOW();

WITH set_map AS (
  SELECT id AS option_set_id
  FROM option_set
  WHERE set_code = 'OS_HAS_CORE_STACK'
),
seed AS (
  SELECT * FROM (VALUES
    ('是', '是', 1),
    ('否', '否', 2),
    ('不涉及', '不涉及', 3)
  ) AS v(option_value, option_label, sort_order)
)
INSERT INTO option_item (option_set_id, option_value, option_label, sort_order, is_active)
SELECT sm.option_set_id, s.option_value, s.option_label, s.sort_order, TRUE
FROM set_map sm
JOIN seed s ON TRUE
ON CONFLICT (option_set_id, option_value) DO UPDATE
SET option_label = EXCLUDED.option_label,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE,
    updated_at = NOW();

UPDATE node_field_def nfd
SET option_set_id = os.id,
    updated_at = NOW()
FROM workflow_node wn
JOIN workflow_template wt ON wt.id = wn.template_id
JOIN option_set os ON os.set_code = 'OS_HAS_CORE_STACK'
WHERE nfd.node_id = wn.id
  AND wt.template_code = 'HCS_INCIDENT'
  AND wn.node_key = 'ops_analysis'
  AND nfd.field_key = 'has_core_stack'
  AND nfd.is_active = TRUE;

COMMIT;
