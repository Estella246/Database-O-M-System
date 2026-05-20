-- 移除未生效的「参数配置 / 问题根因编辑按钮」白名单项；
-- 问题根因页由 params_issue_root_cause（是否展示问题根因页面）控制可见与编辑。
BEGIN;

DELETE FROM role_permission_policy
WHERE node_key = '__whitelist__'
  AND field_key = 'params_issue_root_cause_edit';

COMMIT;
