BEGIN;

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
      ('rock_version_involved', 7),
      ('collaborator', 8),
      ('workaround', 9),
      ('root_cause', 10),
      ('issue_track', 11),
      ('dfx_gap', 12),
      ('error_archive_text', 13)
  ) AS t(field_key, sort_order)
)
UPDATE node_field_def nfd
SET sort_order = o.sort_order
FROM target_node n, orders o
WHERE nfd.node_id = n.node_id
  AND nfd.field_key = o.field_key;

COMMIT;
