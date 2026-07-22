BEGIN;

-- 工具广场点赞：一人一赞可取消；热度 heat = 2 * like_count + download_count

ALTER TABLE ops_tool_item
  ADD COLUMN IF NOT EXISTS like_count BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ops_tool_like (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES ops_tool_item(id) ON DELETE CASCADE,
  operator_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ops_tool_like_item_operator UNIQUE (item_id, operator_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_tool_like_operator
  ON ops_tool_like (operator_id, created_at DESC);

-- 列表默认按热度降序（表达式索引）
CREATE INDEX IF NOT EXISTS idx_ops_tool_item_heat
  ON ops_tool_item ((2 * like_count + download_count) DESC, created_at DESC);

COMMIT;
