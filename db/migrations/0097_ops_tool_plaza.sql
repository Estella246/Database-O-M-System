BEGIN;

-- 运维工具广场：Skill / 工具分享，文件存 MinIO，元数据与下载量落库

CREATE TABLE IF NOT EXISTS ops_tool_item (
  id BIGSERIAL PRIMARY KEY,
  item_type VARCHAR(16) NOT NULL,
  title VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT '',
  file_name VARCHAR(256) NOT NULL,
  object_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  skill_md_content TEXT,
  skill_md_excerpt TEXT,
  download_count BIGINT NOT NULL DEFAULT 0,
  publisher_id VARCHAR(64) NOT NULL,
  publisher_name VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ops_tool_item_type CHECK (item_type IN ('skill', 'tool'))
);

CREATE INDEX IF NOT EXISTS idx_ops_tool_item_hot
  ON ops_tool_item (download_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_tool_item_category
  ON ops_tool_item (category);

CREATE INDEX IF NOT EXISTS idx_ops_tool_item_type
  ON ops_tool_item (item_type, download_count DESC);

CREATE TRIGGER trg_ops_tool_item_updated_at
BEFORE UPDATE ON ops_tool_item
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ops_tool_download_log (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES ops_tool_item(id) ON DELETE CASCADE,
  operator_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_tool_download_log_dedup
  ON ops_tool_download_log (item_id, operator_id, created_at DESC);

-- 白名单：广场浏览 / 发布
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
VALUES
  ('admin',   TRUE,  '__whitelist__', 'tool_plaza_list', 'readonly', 'system'),
  ('admin',   TRUE,  '__whitelist__', 'tool_plaza_publish', 'readonly', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'tool_plaza_list', 'readonly', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'tool_plaza_publish', 'readonly', 'system'),
  ('普通用户', FALSE, '__whitelist__', 'tool_plaza_list', 'readonly', 'system'),
  ('普通用户', FALSE, '__whitelist__', 'tool_plaza_publish', 'readonly', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();

COMMIT;
