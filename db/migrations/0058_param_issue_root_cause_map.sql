-- 运维分析：问题类型 → 根因分类 联动配置（参数配置 / 问题根因）

CREATE TABLE IF NOT EXISTS param_issue_root_cause_map (
  issue_type VARCHAR(128) NOT NULL,
  root_cause_category VARCHAR(256) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issue_type, root_cause_category)
);

CREATE INDEX IF NOT EXISTS idx_param_issue_root_cause_issue_sort
  ON param_issue_root_cause_map (issue_type, sort_order, root_cause_category);

-- 预置：各问题类型共用一组根因分类（可在参数配置中调整）
INSERT INTO param_issue_root_cause_map (issue_type, root_cause_category, sort_order, updated_by)
SELECT it.issue_type, cat.root_cause_category, cat.sort_order, 'seed'
FROM (
  SELECT option_value AS issue_type, sort_order AS issue_ord
  FROM option_item oi
  JOIN option_set os ON os.id = oi.option_set_id
  WHERE os.set_code = 'OS_ISSUE_TYPE' AND oi.is_active = TRUE
) it
CROSS JOIN (
  VALUES
    ('数据库优化', 1),
    ('配置错误', 2)
) AS cat(root_cause_category, sort_order)
ON CONFLICT (issue_type, root_cause_category) DO NOTHING;
