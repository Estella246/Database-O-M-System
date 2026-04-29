-- 0033: 人力分析模块 - 上传会话与配置版本表
-- 支持Excel导入、历史会话管理、配置版本化

BEGIN;

-- 上传会话主表
CREATE TABLE IF NOT EXISTS upload_session (
  id BIGSERIAL PRIMARY KEY,
  session_name VARCHAR(256) NOT NULL DEFAULT '',
  file_name VARCHAR(256) NOT NULL DEFAULT '',
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  import_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  available_sheets JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_mode VARCHAR(32) NOT NULL DEFAULT 'chart', -- chart | table | mixed
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  creator_id VARCHAR(64) NOT NULL DEFAULT '',
  creator_name VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按创建人和时间查询
CREATE INDEX IF NOT EXISTS idx_upload_session_creator
  ON upload_session (creator_id, is_deleted, created_at DESC);

-- 索引：按更新时间查询最新会话
CREATE INDEX IF NOT EXISTS idx_upload_session_updated
  ON upload_session (updated_at DESC) WHERE is_deleted = FALSE;

-- 触发器：自动更新 updated_at
CREATE TRIGGER trg_upload_session_updated_at
BEFORE UPDATE ON upload_session
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 会话配置版本表
CREATE TABLE IF NOT EXISTS session_config_version (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES upload_session(id) ON DELETE CASCADE,
  version_name VARCHAR(64) NOT NULL DEFAULT '',
  import_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_mode VARCHAR(32) NOT NULL DEFAULT 'chart',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  creator_id VARCHAR(64) NOT NULL DEFAULT '',
  creator_name VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按会话查询配置版本列表
CREATE INDEX IF NOT EXISTS idx_session_config_version_session
  ON session_config_version (session_id, created_at DESC);

-- 权限配置：允许管理员和普通用户访问人力分析
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
VALUES
  ('管理员', FALSE, '__whitelist__', 'upload_analysis', 'editable', 'admin'),
  ('普通用户', FALSE, '__whitelist__', 'upload_analysis', 'editable', 'admin')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET permission_level = EXCLUDED.permission_level;

COMMIT;