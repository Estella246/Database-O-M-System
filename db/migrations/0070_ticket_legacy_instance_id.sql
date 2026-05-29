BEGIN;

-- 历史数据迁入：记录工单对应的老平台 T_WORK_FLOW_INSTANCE.id，
-- 用于迁移幂等（重复迁入跳过已迁过的实例）与增量迁移续跑。
ALTER TABLE ticket
  ADD COLUMN IF NOT EXISTS legacy_instance_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_legacy_instance_id
  ON ticket (legacy_instance_id)
  WHERE legacy_instance_id IS NOT NULL;

COMMIT;
