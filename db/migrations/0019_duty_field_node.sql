-- 责任田模块：多级分类配置（邻接表，整树替换写入）
CREATE TABLE IF NOT EXISTS duty_field_node (
  id BIGSERIAL PRIMARY KEY,
  parent_id BIGINT REFERENCES duty_field_node (id) ON DELETE CASCADE,
  label VARCHAR(512) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_duty_field_node_parent_sort
  ON duty_field_node (parent_id, sort_order, id);
