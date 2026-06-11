BEGIN;

-- 删除工单分析历史记录表（子表，须先删，因 FK 引用主表）
DROP TABLE IF EXISTS ticket_analysis_log;

-- 删除工单分析 Skill 配置表（主表）
DROP TABLE IF EXISTS ticket_analysis_skill;

-- 移除与 Skill 相关的 4 条权限白名单
DELETE FROM role_permission_policy
WHERE node_key = '__whitelist__'
  AND field_key IN ('stats_skills', 'stats_skills_edit', 'stats_skills_analyze', 'stats_skills_delete');

COMMIT;