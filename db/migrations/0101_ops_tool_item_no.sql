BEGIN;

-- 运维工具广场资源编号：SKILL/TOOL + YYYYMMDD + 三位全局序号（规则同 YW 工单号）

ALTER TABLE ops_tool_item
  ADD COLUMN IF NOT EXISTS item_no VARCHAR(20);

INSERT INTO ticket_global_seq (seq_key, last_suffix)
VALUES ('SKILL', -1), ('TOOL', -1)
ON CONFLICT (seq_key) DO NOTHING;

DO $$
DECLARE
  r RECORD;
  seq_key text;
  prefix text;
  ymd text;
  a int;
  candidate text;
  guard int;
BEGIN
  ymd := to_char((NOW() AT TIME ZONE 'Asia/Shanghai')::date, 'YYYYMMDD');

  FOR r IN
    SELECT id, item_type
    FROM ops_tool_item
    WHERE item_no IS NULL OR item_no = ''
    ORDER BY id
  LOOP
    IF r.item_type = 'skill' THEN
      seq_key := 'SKILL';
      prefix := 'SKILL' || ymd;
    ELSE
      seq_key := 'TOOL';
      prefix := 'TOOL' || ymd;
    END IF;

    SELECT last_suffix INTO a FROM ticket_global_seq WHERE ticket_global_seq.seq_key = seq_key FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO ticket_global_seq (seq_key, last_suffix) VALUES (seq_key, -1);
      a := -1;
    END IF;

    guard := 0;
    LOOP
      a := (COALESCE(a, -1) + 1) % 1000;
      candidate := prefix || lpad(a::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM ops_tool_item o WHERE o.item_no = candidate);
      guard := guard + 1;
      IF guard >= 1000 THEN
        RAISE EXCEPTION 'ops_tool_item item_no backfill exhausted for %', seq_key;
      END IF;
    END LOOP;

    UPDATE ops_tool_item SET item_no = candidate WHERE id = r.id;
    UPDATE ticket_global_seq SET last_suffix = a WHERE ticket_global_seq.seq_key = seq_key;
  END LOOP;
END $$;

ALTER TABLE ops_tool_item
  ALTER COLUMN item_no SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_tool_item_no ON ops_tool_item (item_no);

COMMIT;
