-- 在研责任田：独立维护表（与工单责任田树 duty_field_node 不是同一概念）。
-- 每条 = 名称 + 责任人 + 关联「领域/模块」（模块可空=整领域），用于统计质量改进
-- 分析阶段后的处理情况（每个责任田的接纳率/闭环率/超期单数等）。
BEGIN;

CREATE TABLE IF NOT EXISTS research_duty_field (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  domain VARCHAR(256) NOT NULL DEFAULT '',
  module VARCHAR(256) NOT NULL DEFAULT '',
  owner VARCHAR(256) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 同 领域+模块 唯一，防止重复配桶
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_duty_field_dom_mod
  ON research_duty_field (BTRIM(domain), BTRIM(module));

-- 撤销早期开发中误加到责任田树的在研标记列（在研责任田已改为本表维护）
ALTER TABLE duty_field_node DROP COLUMN IF EXISTS research_flag;

-- 白名单铺开（仿 0059）：内置 admin/管理员 可编辑；已有「参数配置」的角色回填页面可见（只读）
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by) VALUES
  ('admin',   TRUE,  '__whitelist__', 'params_research_duty_field', 'editable', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'params_research_duty_field', 'editable', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT DISTINCT r.role_code, r.is_pl, '__whitelist__', 'params_research_duty_field', 'readonly', 'migration'
FROM role_permission_policy r
WHERE r.node_key = '__whitelist__' AND r.field_key = 'params_config'
  AND r.permission_level IN ('readonly', 'editable')
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
