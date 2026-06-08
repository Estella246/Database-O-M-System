-- 工作台 HCS 工单列表快照（只服务 HCS_INCIDENT 列表读路径；ticket_node_data 仍 append-only）
CREATE TABLE IF NOT EXISTS ticket_list_snapshot (
  ticket_id BIGINT PRIMARY KEY REFERENCES ticket(id) ON DELETE CASCADE,
  ticket_no TEXT NOT NULL,
  template_code TEXT NOT NULL DEFAULT 'HCS_INCIDENT',
  status TEXT NOT NULL DEFAULT 'open',
  creator_id TEXT NOT NULL DEFAULT '',
  creator_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  node_key TEXT NOT NULL DEFAULT '',
  current_stage TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  biz_env TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT '一般',
  description_plain TEXT NOT NULL DEFAULT '',
  current_handler TEXT NOT NULL DEFAULT '',
  is_quality_issue TEXT NOT NULL DEFAULT '',
  extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  fields_by_node JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tls_ticket_no ON ticket_list_snapshot (ticket_no);

CREATE INDEX IF NOT EXISTS idx_tls_tpl_created
  ON ticket_list_snapshot (template_code, created_at DESC, ticket_id DESC);

CREATE INDEX IF NOT EXISTS idx_tls_tpl_creator
  ON ticket_list_snapshot (template_code, creator_id);

CREATE INDEX IF NOT EXISTS idx_tls_tpl_location
  ON ticket_list_snapshot (template_code, location);

CREATE INDEX IF NOT EXISTS idx_tls_tpl_severity
  ON ticket_list_snapshot (template_code, severity);

CREATE INDEX IF NOT EXISTS idx_tls_tpl_stage
  ON ticket_list_snapshot (template_code, current_stage);

-- pg_trgm 扩展（供 search_text GIN 索引；无权限时可跳过本扩展与 idx_tls_search_trgm）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_tls_search_trgm
  ON ticket_list_snapshot USING gin (search_text gin_trgm_ops);
