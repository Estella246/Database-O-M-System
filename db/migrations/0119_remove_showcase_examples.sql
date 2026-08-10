BEGIN;

-- 清理 0116_showcase_item.sql 迁入的系统示例；用户通过页面新增的条目没有 legacy_key，不受影响。
DELETE FROM showcase_item
WHERE legacy_key IN (
  'global-operations',
  'ticket-flow',
  'risk-sensing',
  'capacity-forecast',
  'quality-graph',
  'oncall-network',
  'ai-analytics',
  'monthly-insight',
  'release-tracking',
  'cost-analysis',
  'service-health',
  'incident-review'
);

COMMIT;
