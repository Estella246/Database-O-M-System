BEGIN;

-- GaussDB 大事件：业务时间（年月日），展示页按时间升序，最早为 01。
ALTER TABLE showcase_item
  ADD COLUMN IF NOT EXISTS event_date DATE;

UPDATE showcase_item
SET event_date = (created_at AT TIME ZONE 'Asia/Shanghai')::date
WHERE event_date IS NULL;

ALTER TABLE showcase_item
  ALTER COLUMN event_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_showcase_item_event_date
  ON showcase_item (event_date ASC, id ASC);

COMMIT;
