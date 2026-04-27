-- 白名单严格对齐权限策略 xlsx：移除已废弃的 scope 限制项
DELETE FROM role_permission_policy
WHERE node_key = '__whitelist__'
  AND field_key IN ('ticket_list_scope_self', 'ticket_detail_scope_problem_fill');
