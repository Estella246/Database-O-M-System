BEGIN;

-- 工作台工单导出异步任务：后台生成文件，前端轮询完成后下载，避免网关 504
CREATE TABLE IF NOT EXISTS ticket_export_task (
  id SERIAL PRIMARY KEY,
  creator_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  -- pending → processing → ready | error | expired
  export_format VARCHAR(8) NOT NULL DEFAULT 'xlsx',
  export_range VARCHAR(16) NOT NULL DEFAULT 'selected',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  filename VARCHAR(255) NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  file_size BIGINT NOT NULL DEFAULT 0,
  total_rows INT NOT NULL DEFAULT 0,
  processed_rows INT NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_export_task_creator
  ON ticket_export_task (creator_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_export_task_status_updated
  ON ticket_export_task (status, updated_at);

COMMIT;
