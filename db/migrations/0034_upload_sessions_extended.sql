-- 0034: Excel分析模块扩展 - 增强会话与数据表结构
-- 支持数据预览、统计、配置版本管理等功能

BEGIN;

-- 扩展upload_session表结构
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS upload_date DATE;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS upload_time TIMESTAMPTZ;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS row_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS col_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS columns_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS sheet_name VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS selected_columns JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS display_names JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS column_types JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS chart_types JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS avg_columns JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS name_column VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS date_columns JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS numeric_describe JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS preview_rows JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS preview_truncated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS missing_counts JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS dtypes JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS shape_rows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upload_session ADD COLUMN IF NOT EXISTS shape_cols INTEGER NOT NULL DEFAULT 0;

-- 创建upload_data表存储原始数据行
CREATE TABLE IF NOT EXISTS upload_data (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES upload_session(id) ON DELETE CASCADE,
  sheet_name VARCHAR(256) NOT NULL DEFAULT '',
  row_index INTEGER NOT NULL DEFAULT 0,
  row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按会话查询数据行
CREATE INDEX IF NOT EXISTS idx_upload_data_session
  ON upload_data (session_id, sheet_name, row_index);

-- 扩展session_config_version表结构
ALTER TABLE session_config_version ADD COLUMN IF NOT EXISTS config_name VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE session_config_version ADD COLUMN IF NOT EXISTS selected_columns JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE session_config_version ADD COLUMN IF NOT EXISTS display_names JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE session_config_version ADD COLUMN IF NOT EXISTS column_types JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE session_config_version ADD COLUMN IF NOT EXISTS chart_types JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE session_config_version ADD COLUMN IF NOT EXISTS avg_columns JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE session_config_version ADD COLUMN IF NOT EXISTS name_column VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE session_config_version ADD COLUMN IF NOT EXISTS selected_sheets JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE session_config_version ADD COLUMN IF NOT EXISTS aggregate_mode VARCHAR(32) NOT NULL DEFAULT 'sum';

-- 添加备注
COMMENT ON TABLE upload_session IS 'Excel上传会话主表，支持多sheet导入和配置版本管理';
COMMENT ON TABLE upload_data IS '上传会话原始数据行表，按sheet存储';
COMMENT ON TABLE session_config_version IS '会话配置版本表，支持配置版本管理和回滚';

COMMIT;