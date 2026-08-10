BEGIN;

-- 展示效果：轮播条目由前端新增，图片存 MinIO，展示元数据落库。
CREATE TABLE IF NOT EXISTS showcase_item (
  id BIGSERIAL PRIMARY KEY,
  legacy_key VARCHAR(64) UNIQUE,
  title VARCHAR(160) NOT NULL,
  detail_html TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_object_name TEXT NOT NULL DEFAULT '',
  created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_showcase_item_created_at
  ON showcase_item (created_at DESC);

DROP TRIGGER IF EXISTS trg_showcase_item_updated_at ON showcase_item;
CREATE TRIGGER trg_showcase_item_updated_at
BEFORE UPDATE ON showcase_item
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


COMMIT;
