-- 版本模块：基线版本与热补丁版本（参数配置）

CREATE TABLE IF NOT EXISTS param_baseline_version (
  id BIGSERIAL PRIMARY KEY,
  version_label VARCHAR(256) NOT NULL,
  commit_hash VARCHAR(128) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_param_baseline_sort
  ON param_baseline_version (sort_order, id);

CREATE TABLE IF NOT EXISTS param_hotfix_version (
  id BIGSERIAL PRIMARY KEY,
  baseline_id BIGINT NOT NULL REFERENCES param_baseline_version (id) ON DELETE RESTRICT,
  hotfix_label VARCHAR(256) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_param_hotfix_baseline
  ON param_hotfix_version (baseline_id, sort_order, id);
