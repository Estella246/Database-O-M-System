-- 一次性回滚 YW20260616001 误挂的 problem_fill（执行前请备份；确认预览结果后 COMMIT）
BEGIN;

-- 预览
WITH t AS (SELECT id FROM ticket WHERE ticket_no = 'YW20260616001'),
bad_pf AS (
  SELECT tni.id AS instance_id, tni.handler_name,
         tni.created_at AT TIME ZONE 'Asia/Shanghai' AS at_cst
  FROM t JOIN ticket_node_instance tni ON tni.ticket_id = t.id
  JOIN workflow_node wn ON wn.id = tni.node_id AND wn.node_key = 'problem_fill'
  CROSS JOIN LATERAL (
    SELECT MIN(tni2.created_at) AS first_ops_at
    FROM ticket_node_instance tni2
    JOIN workflow_node wn2 ON wn2.id = tni2.node_id AND wn2.node_key = 'ops_analysis'
    WHERE tni2.ticket_id = t.id
  ) ops
  WHERE ops.first_ops_at IS NOT NULL AND tni.created_at > ops.first_ops_at
)
SELECT * FROM bad_pf;

-- 删除 + 恢复 current_node_id
WITH t AS (SELECT id FROM ticket WHERE ticket_no = 'YW20260616001'),
bad_pf AS (
  SELECT tni.id AS instance_id, tni.created_at
  FROM t JOIN ticket_node_instance tni ON tni.ticket_id = t.id
  JOIN workflow_node wn ON wn.id = tni.node_id AND wn.node_key = 'problem_fill'
  CROSS JOIN LATERAL (
    SELECT MIN(tni2.created_at) AS first_ops_at
    FROM ticket_node_instance tni2
    JOIN workflow_node wn2 ON wn2.id = tni2.node_id AND wn2.node_key = 'ops_analysis'
    WHERE tni2.ticket_id = t.id
  ) ops
  WHERE ops.first_ops_at IS NOT NULL AND tni.created_at > ops.first_ops_at
),
bad_flow AS (
  SELECT tfl.id FROM t JOIN ticket_flow_log tfl ON tfl.ticket_id = t.id
  JOIN workflow_node fn ON fn.id = tfl.from_node_id AND fn.node_key = 'problem_fill'
  WHERE EXISTS (
    SELECT 1 FROM bad_pf bp
    WHERE tfl.created_at BETWEEN bp.created_at - INTERVAL '2 seconds'
                               AND bp.created_at + INTERVAL '2 seconds'
  )
)
DELETE FROM ticket_node_data WHERE ticket_node_instance_id IN (SELECT instance_id FROM bad_pf);

WITH t AS (SELECT id FROM ticket WHERE ticket_no = 'YW20260616001'),
bad_pf AS (
  SELECT tni.id AS instance_id, tni.created_at
  FROM t JOIN ticket_node_instance tni ON tni.ticket_id = t.id
  JOIN workflow_node wn ON wn.id = tni.node_id AND wn.node_key = 'problem_fill'
  CROSS JOIN LATERAL (
    SELECT MIN(tni2.created_at) AS first_ops_at
    FROM ticket_node_instance tni2
    JOIN workflow_node wn2 ON wn2.id = tni2.node_id AND wn2.node_key = 'ops_analysis'
    WHERE tni2.ticket_id = t.id
  ) ops
  WHERE ops.first_ops_at IS NOT NULL AND tni.created_at > ops.first_ops_at
),
bad_flow AS (
  SELECT tfl.id FROM t JOIN ticket_flow_log tfl ON tfl.ticket_id = t.id
  JOIN workflow_node fn ON fn.id = tfl.from_node_id AND fn.node_key = 'problem_fill'
  WHERE EXISTS (
    SELECT 1 FROM bad_pf bp
    WHERE tfl.created_at BETWEEN bp.created_at - INTERVAL '2 seconds'
                               AND bp.created_at + INTERVAL '2 seconds'
  )
)
DELETE FROM ticket_flow_log WHERE id IN (SELECT id FROM bad_flow);

WITH t AS (SELECT id FROM ticket WHERE ticket_no = 'YW20260616001'),
bad_pf AS (
  SELECT tni.id AS instance_id
  FROM t JOIN ticket_node_instance tni ON tni.ticket_id = t.id
  JOIN workflow_node wn ON wn.id = tni.node_id AND wn.node_key = 'problem_fill'
  CROSS JOIN LATERAL (
    SELECT MIN(tni2.created_at) AS first_ops_at
    FROM ticket_node_instance tni2
    JOIN workflow_node wn2 ON wn2.id = tni2.node_id AND wn2.node_key = 'ops_analysis'
    WHERE tni2.ticket_id = t.id
  ) ops
  WHERE ops.first_ops_at IS NOT NULL AND tni.created_at > ops.first_ops_at
)
DELETE FROM ticket_node_instance WHERE id IN (SELECT instance_id FROM bad_pf);

UPDATE ticket tk
SET current_node_id = sub.to_node_id, updated_at = NOW()
FROM (
  SELECT tfl.to_node_id
  FROM ticket t
  JOIN ticket_flow_log tfl ON tfl.ticket_id = t.id
  WHERE t.ticket_no = 'YW20260616001'
  ORDER BY tfl.created_at DESC, tfl.id DESC
  LIMIT 1
) sub
WHERE tk.ticket_no = 'YW20260616001';

-- 校验
SELECT tfl.created_at AT TIME ZONE 'Asia/Shanghai' AS at_cst,
       tfl.operator_name, fn.node_name AS from_node, tn.node_name AS to_node
FROM ticket t
JOIN ticket_flow_log tfl ON tfl.ticket_id = t.id
LEFT JOIN workflow_node fn ON fn.id = tfl.from_node_id
LEFT JOIN workflow_node tn ON tn.id = tfl.to_node_id
WHERE t.ticket_no = 'YW20260616001'
ORDER BY tfl.created_at;

-- COMMIT;
