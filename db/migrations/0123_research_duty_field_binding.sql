-- 在研责任田拆两层：田目录（research_duty_field）+ 节点关联（research_duty_field_binding）。
-- 动机：树节点「在研」弹窗只能下拉选择目录中已有的田（不允许凭空新增），
-- 且不同责任田模块可对应同一个田（多模块共田，统计按田合并）。
-- 原 domain/module 列迁入关联表（每田可有多条关联），田表只留 名称/责任人。
BEGIN;

CREATE TABLE IF NOT EXISTS research_duty_field_binding (
  id BIGSERIAL PRIMARY KEY,
  field_id BIGINT NOT NULL REFERENCES research_duty_field(id) ON DELETE CASCADE,
  domain VARCHAR(256) NOT NULL DEFAULT '',
  module VARCHAR(256) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 同 领域+模块 槽位唯一：一个树节点（或整领域槽位）只能绑一个田
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_duty_field_binding_dom_mod
  ON research_duty_field_binding (BTRIM(domain), BTRIM(module));

-- 存量数据迁移：每条旧田行 → 目录田 + 一条关联
INSERT INTO research_duty_field_binding (field_id, domain, module, updated_by)
SELECT id, domain, module, updated_by FROM research_duty_field;

-- 田表去掉关联列（依赖的唯一索引随列自动删除），单一事实源移到关联表
ALTER TABLE research_duty_field DROP COLUMN IF EXISTS domain;
ALTER TABLE research_duty_field DROP COLUMN IF EXISTS module;

-- updated_at 触发器（同 0119 之后的惯例：有则不改）
CREATE OR REPLACE FUNCTION set_updated_at_0123() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_research_duty_field_binding_updated_at ON research_duty_field_binding;
CREATE TRIGGER trg_research_duty_field_binding_updated_at
  BEFORE UPDATE ON research_duty_field_binding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_0123();

COMMIT;
