-- 回滚误挂到已有工单上的「问题填写」提交（运维分析已先于问题填写落库的单据）。
-- 使用前将 :ticket_no 改为实际单号；建议先在事务内 SELECT 预览，确认后再 COMMIT。
--
-- 示例：psql ... -v ticket_no=YW20260616001 -f scripts/sql/rollback_misattached_problem_fill.sql

BEGIN;

-- ---------- 1) 预览将要删除的记录 ----------
WITH t AS (
  SELECT id FROM ticket WHERE ticket_no = :'ticket_no'
),
bad_pf AS (
  SELECT
    tni.id AS instance_id,
    tni.handler_name,
    tni.created_at AT TIME ZONE 'Asia/Shanghai' AS at_cst
  FROM t
  JOIN ticket_node_instance tni ON tni.ticket_id = t.id
  JOIN workflow_node wn ON wn.id = tni.node_id AND wn.node_key = 'problem_fill'
  CROSS JOIN LATERAL (
    SELECT MIN(tni2.created_at) AS first_ops_at
    FROM ticket_node_instance tni2
    JOIN workflow_node wn2 ON wn2.id = tni2.node_id AND wn2.node_key = 'ops_analysis'
    WHERE tni2.ticket_id = t.id
  ) ops
  WHERE ops.first_ops_at IS NOT NULL
    AND tni.created_at > ops.first_ops_at
)
SELECT 'bad_problem_fill_instance' AS kind, instance_id::text AS id, handler_name, at_cst::text
FROM bad_pf;

-- ---------- 2) 删除误挂数据并恢复 current_node_id ----------
WITH t AS (
  SELECT id FROM ticket WHERE ticket_no = :'ticket_no'
),
bad_pf AS (
  SELECT tni.id AS instance_id, tni.created_at
  FROM t
  JOIN ticket_node_instance tni ON tni.ticket_id = t.id
  JOIN workflow_node wn ON wn.id = tni.node_id AND wn.node_key = 'problem_fill'
  CROSS JOIN LATERAL (
    SELECT MIN(tni2.created_at) AS first_ops_at
    FROM ticket_node_instance tni2
    JOIN workflow_node wn2 ON wn2.id = tni2.node_id AND wn2.node_key = 'ops_analysis'
    WHERE tni2.ticket_id = t.id
  ) ops
  WHERE ops.first_ops_at IS NOT NULL
    AND tni.created_at > ops.first_ops_at
),
bad_flow AS (
  SELECT tfl.id
  FROM t
  JOIN ticket_flow_log tfl ON tfl.ticket_id = t.id
  JOIN workflow_node fn ON fn.id = tfl.from_node_id AND fn.node_key = 'problem_fill'
  WHERE EXISTS (
    SELECT 1
    FROM bad_pf bp
    WHERE tfl.created_at >= bp.created_at - INTERVAL '2 seconds'
      AND tfl.created_at <= bp.created_at + INTERVAL '2 seconds'
  )
),
del_data AS (
  DELETE FROM ticket_node_data
  WHERE ticket_node_instance_id IN (SELECT instance_id FROM bad_pf)
  RETURNING id
),
del_flow AS (
  DELETE FROM ticket_flow_log
  WHERE id IN (SELECT id FROM bad_flow)
  RETURNING id
),
del_inst AS (
  DELETE FROM ticket_node_instance
  WHERE id IN (SELECT instance_id FROM bad_pf)
  RETURNING id
),
last_flow AS (
  SELECT tfl.to_node_id
  FROM t
  JOIN ticket_flow_log tfl ON tfl.ticket_id = t.id
  ORDER BY tfl.created_at DESC, tfl.id DESC
  LIMIT 1
)
UPDATE ticket tk
SET
  current_node_id = COALESCE((SELECT to_node_id FROM last_flow), tk.current_node_id),
  updated_at = NOW()
FROM t
WHERE tk.id = t.id;

-- ---------- 3) 校验回滚结果 ----------
SELECT
  t.ticket_no,
  t.creator_name,
  wn.node_key AS current_node_key,
  wn.node_name AS current_node_name,
  t.updated_at AT TIME ZONE 'Asia/Shanghai' AS updated_cst
FROM ticket t
LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
WHERE t.ticket_no = :'ticket_no';

SELECT
  tfl.created_at AT TIME ZONE 'Asia/Shanghai' AS at_cst,
  tfl.operator_name,
  fn.node_name AS from_node,
  tn.node_name AS to_node
FROM ticket t
JOIN ticket_flow_log tfl ON tfl.ticket_id = t.id
LEFT JOIN workflow_node fn ON fn.id = tfl.from_node_id
LEFT JOIN workflow_node tn ON tn.id = tfl.to_node_id
WHERE t.ticket_no = :'ticket_no'
ORDER BY tfl.created_at ASC, tfl.id ASC;

-- 确认无误后执行 COMMIT；否则 ROLLBACK;
-- COMMIT;
