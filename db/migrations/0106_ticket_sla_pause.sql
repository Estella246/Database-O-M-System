-- 工单 SLA 挂起累计：暂时挂起期间不计入 SLA
-- suspended_at：当前挂起起点（非挂起态为 NULL）
-- sla_paused_seconds：已结束的挂起区间累计秒数（解除挂起/关单时累加）

ALTER TABLE ticket
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ NULL;

ALTER TABLE ticket
  ADD COLUMN IF NOT EXISTS sla_paused_seconds BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN ticket.suspended_at IS '当前暂时挂起起点；解除挂起或关单后清空';
COMMENT ON COLUMN ticket.sla_paused_seconds IS '已累计的挂起时长（秒），SLA=终点-建单-本值-（若仍挂起则含当前段）';

-- 存量挂起单：回填挂起起点（优先 suspend 流转，否则 updated_at）
UPDATE ticket t
SET suspended_at = COALESCE(
  (
    SELECT tfl.created_at
    FROM ticket_flow_log tfl
    WHERE tfl.ticket_id = t.id
      AND tfl.action_type = 'suspend'
    ORDER BY tfl.created_at DESC, tfl.id DESC
    LIMIT 1
  ),
  t.updated_at
)
WHERE t.suspended_at IS NULL
  AND (
    LOWER(TRIM(COALESCE(t.status, ''))) = 'suspended'
    OR TRIM(COALESCE(t.status, '')) = '暂时挂起'
  );
