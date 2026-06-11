BEGIN;

-- 「需求管理」重构为「质量改进」：按新列重整 requirement 表。
-- 旧字段（标题/当前责任人/需求价值/关联问题/需求单号/计划日期/备注）移除；
-- 新增 代表问题/所属领域/模块&特性/改进诉求；分类、优先级、状态（接纳状态）改为新枚举。
-- 旧演示数据按新枚举默认值无法逐行映射，故整表清空重建（含 requirement_log，编号自增从 1 起）。

TRUNCATE TABLE requirement RESTART IDENTITY CASCADE;

-- 去除旧 CHECK 约束
ALTER TABLE requirement DROP CONSTRAINT IF EXISTS chk_requirement_status;
ALTER TABLE requirement DROP CONSTRAINT IF EXISTS chk_requirement_category;
ALTER TABLE requirement DROP CONSTRAINT IF EXISTS chk_requirement_value;
ALTER TABLE requirement DROP CONSTRAINT IF EXISTS chk_requirement_priority;

-- 移除旧列（依赖索引随列一并删除）
ALTER TABLE requirement DROP COLUMN IF EXISTS title;
ALTER TABLE requirement DROP COLUMN IF EXISTS assignee;
ALTER TABLE requirement DROP COLUMN IF EXISTS related_issues;
ALTER TABLE requirement DROP COLUMN IF EXISTS external_req_no;
ALTER TABLE requirement DROP COLUMN IF EXISTS planned_date;
ALTER TABLE requirement DROP COLUMN IF EXISTS remark;
ALTER TABLE requirement DROP COLUMN IF EXISTS value;

-- 新增列：代表问题 / 所属领域 / 模块&特性 / 改进诉求
ALTER TABLE requirement ADD COLUMN IF NOT EXISTS represent_issue TEXT NOT NULL DEFAULT '';
ALTER TABLE requirement ADD COLUMN IF NOT EXISTS domain VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE requirement ADD COLUMN IF NOT EXISTS module_feature VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE requirement ADD COLUMN IF NOT EXISTS improvement TEXT NOT NULL DEFAULT '';

-- 问题描述（description）保留为可空默认空串
ALTER TABLE requirement ALTER COLUMN description SET DEFAULT '';

-- 优先级：SMALLINT(1-10) → VARCHAR 高/中/低（表已清空，USING 直接给默认值）
ALTER TABLE requirement ALTER COLUMN priority DROP DEFAULT;
ALTER TABLE requirement ALTER COLUMN priority TYPE VARCHAR(8) USING '中';
ALTER TABLE requirement ALTER COLUMN priority SET DEFAULT '中';
ALTER TABLE requirement ADD CONSTRAINT chk_requirement_priority
  CHECK (priority IN ('高', '中', '低'));

-- 分类：新枚举
ALTER TABLE requirement ALTER COLUMN category SET DEFAULT '质量加固和改进';
ALTER TABLE requirement ADD CONSTRAINT chk_requirement_category
  CHECK (category IN ('定位定界', '测试加固', '快速恢复', '需求', '质量加固和改进'));

-- 接纳状态：沿用 status 列，新枚举
ALTER TABLE requirement ALTER COLUMN status SET DEFAULT '已接纳';
ALTER TABLE requirement ADD CONSTRAINT chk_requirement_status
  CHECK (status IN ('已实现', '已接纳', '部分接纳', '拒绝'));

CREATE INDEX IF NOT EXISTS idx_requirement_priority ON requirement (priority);

COMMIT;
