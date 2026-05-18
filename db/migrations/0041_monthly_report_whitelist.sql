-- 月度报告整组（问题报表 / 报告生成 / 报告归档）改由权限策略白名单 `monthly_report` 控制。
-- 之前由前端硬编码 admin 闸口拦截，本次去掉硬编码，统一走白名单：
--   - 默认：未配置时 hidden（前端 PERMISSION_DEFAULT_HIDDEN_KEYS）
--   - 管理员角色：本迁移种入 editable，确保现有 admin 用户继续可见
--
-- 同时 oncall_eva 也从「默认 readonly」改为「默认 hidden」，
-- 为「管理员/false」补一行 readonly，避免管理员角色失去入口。
BEGIN;

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by) VALUES
  ('admin',   TRUE,  '__whitelist__', 'monthly_report', 'editable', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'monthly_report', 'editable', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'oncall_eva',     'readonly', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key) DO NOTHING;

COMMIT;
