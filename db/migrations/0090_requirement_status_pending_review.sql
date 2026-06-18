BEGIN;

-- 质量改进接纳状态新增「待评审」，并设为列默认值。
ALTER TABLE requirement DROP CONSTRAINT IF EXISTS chk_requirement_status;
ALTER TABLE requirement ADD CONSTRAINT chk_requirement_status
  CHECK (status IN ('待评审', '已实现', '已接纳', '部分接纳', '拒绝'));
ALTER TABLE requirement ALTER COLUMN status SET DEFAULT '待评审';

COMMIT;
