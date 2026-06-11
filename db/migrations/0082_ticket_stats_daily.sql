-- 统计图表日汇总预聚合：按 stats_day 预写 count，查询两年全量约 ~730 行
CREATE TABLE IF NOT EXISTS ticket_stats_daily (
  stats_day DATE NOT NULL,
  template_code TEXT NOT NULL DEFAULT 'HCS_INCIDENT',
  ticket_count INT NOT NULL DEFAULT 0,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (stats_day, template_code)
);

CREATE INDEX IF NOT EXISTS idx_ticket_stats_daily_tpl_day
  ON ticket_stats_daily (template_code, stats_day);

-- 单工单贡献态：submit / 快照 refresh 时增量加减日汇总
CREATE TABLE IF NOT EXISTS ticket_stats_ticket (
  ticket_id BIGINT PRIMARY KEY REFERENCES ticket(id) ON DELETE CASCADE,
  ticket_no TEXT NOT NULL,
  stats_day DATE NOT NULL,
  template_code TEXT NOT NULL DEFAULT 'HCS_INCIDENT',
  creator_id TEXT NOT NULL DEFAULT '',
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_stats_ticket_day
  ON ticket_stats_ticket (template_code, stats_day);

CREATE INDEX IF NOT EXISTS idx_ticket_stats_ticket_creator
  ON ticket_stats_ticket (template_code, creator_id);
