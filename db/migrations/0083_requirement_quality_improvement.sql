BEGIN;

-- 「需求管理」重构为「质量改进」：直接 DROP + CREATE 重建 requirement / requirement_log。
-- 早期版本用 TRUNCATE + 一连串 ALTER 在原表上就地改造，但在存量/生产库上若遇到
-- 依赖、外键或约束问题会让整个事务回滚——表现为「老列一个都没删、新列也没加」。
-- 改为「整表重建」一步到位，幂等且不依赖原表的具体列状态。
-- 注意：此迁移会清空 requirement（含 requirement_log）的全部数据。

DROP TABLE IF EXISTS requirement_log CASCADE;
DROP TABLE IF EXISTS requirement CASCADE;

CREATE TABLE requirement (
  id BIGSERIAL PRIMARY KEY,
  requirement_no  VARCHAR(32) NOT NULL UNIQUE,        -- 编号（自增流水号）
  category        VARCHAR(32) NOT NULL DEFAULT '质量加固和改进',  -- 分类
  represent_issue TEXT NOT NULL DEFAULT '',           -- 代表问题
  domain          VARCHAR(128) NOT NULL DEFAULT '',   -- 所属领域
  module_feature  VARCHAR(256) NOT NULL DEFAULT '',   -- 模块&特性
  description     TEXT NOT NULL DEFAULT '',           -- 问题描述
  improvement     TEXT NOT NULL DEFAULT '',           -- 改进诉求
  priority        VARCHAR(8) NOT NULL DEFAULT '中',    -- 优先级 高/中/低
  proposer        VARCHAR(256) NOT NULL DEFAULT '',   -- 提出人
  proposed_at     DATE NOT NULL DEFAULT CURRENT_DATE, -- 提出时间
  status          VARCHAR(32) NOT NULL DEFAULT '已接纳', -- 接纳状态
  planned_version VARCHAR(128) NOT NULL DEFAULT '',   -- 计划版本
  creator_id      VARCHAR(64) NOT NULL,
  creator_name    VARCHAR(128) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_requirement_category
    CHECK (category IN ('定位定界', '测试加固', '快速恢复', '需求', '质量加固和改进')),
  CONSTRAINT chk_requirement_priority
    CHECK (priority IN ('高', '中', '低')),
  CONSTRAINT chk_requirement_status
    CHECK (status IN ('已实现', '已接纳', '部分接纳', '拒绝'))
);

CREATE INDEX IF NOT EXISTS idx_requirement_status ON requirement (status);
CREATE INDEX IF NOT EXISTS idx_requirement_category ON requirement (category);
CREATE INDEX IF NOT EXISTS idx_requirement_priority ON requirement (priority);
CREATE INDEX IF NOT EXISTS idx_requirement_proposer ON requirement (proposer);
CREATE INDEX IF NOT EXISTS idx_requirement_creator ON requirement (creator_id);
CREATE INDEX IF NOT EXISTS idx_requirement_proposed_at ON requirement (proposed_at);

CREATE TRIGGER trg_requirement_updated_at
BEFORE UPDATE ON requirement
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE requirement_log (
  id BIGSERIAL PRIMARY KEY,
  requirement_id BIGINT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32),
  changed_fields JSONB,
  comment TEXT NOT NULL DEFAULT '',
  operator_id VARCHAR(64) NOT NULL,
  operator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requirement_log_req ON requirement_log (requirement_id);

COMMIT;
