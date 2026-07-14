BEGIN;

-- 导出任务工单号侧表：避免把数万条 ticket_no 塞进 payload_json
CREATE TABLE IF NOT EXISTS ticket_export_task_no (
  task_id INT NOT NULL REFERENCES ticket_export_task(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  ticket_no VARCHAR(64) NOT NULL,
  PRIMARY KEY (task_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ticket_export_task_no_ticket
  ON ticket_export_task_no (task_id, ticket_no);

COMMIT;
