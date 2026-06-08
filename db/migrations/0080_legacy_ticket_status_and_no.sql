BEGIN;

-- 迁入工单：流程 ID 取自老库 process_id（可能长于 32）；status 保留老库中文原值
ALTER TABLE ticket DROP CONSTRAINT IF EXISTS chk_ticket_status;

ALTER TABLE ticket
  ALTER COLUMN ticket_no TYPE VARCHAR(64);

COMMIT;
