-- 全局工单序号 a（000–999，跨日连续，仅 999 后回绕 000）；与当天日期拼 YW/HPM 单号。
CREATE TABLE IF NOT EXISTS ticket_global_seq (
  seq_key VARCHAR(8) PRIMARY KEY,
  last_suffix INT NOT NULL DEFAULT -1,
  CONSTRAINT chk_ticket_global_seq_suffix CHECK (last_suffix >= -1 AND last_suffix <= 999)
);

INSERT INTO ticket_global_seq (seq_key, last_suffix)
VALUES
  (
    'YW',
    COALESCE(
      (
        SELECT MAX(CAST(SUBSTRING(ticket_no FROM 11 FOR 3) AS INT))
        FROM ticket
        WHERE ticket_no ~ '^YW[0-9]{11}$'
      ),
      -1
    )
  ),
  (
    'HPM',
    COALESCE(
      (
        SELECT MAX(CAST(SUBSTRING(ticket_no FROM 12 FOR 3) AS INT))
        FROM ticket
        WHERE ticket_no ~ '^HPM[0-9]{11}$'
      ),
      -1
    )
  )
ON CONFLICT (seq_key) DO NOTHING;
