BEGIN;

ALTER TABLE duty_calendar_assignment
  DROP CONSTRAINT IF EXISTS chk_duty_calendar_kind;

ALTER TABLE duty_calendar_assignment
  ADD CONSTRAINT chk_duty_calendar_kind
  CHECK (table_kind IN ('kernel', 'control', 'public_cloud', 'poc', 'research_version'));

COMMIT;
