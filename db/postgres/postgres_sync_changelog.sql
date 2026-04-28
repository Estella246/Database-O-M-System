-- =============================================================================
-- PostgreSQL 同步日志（append-only）
-- 与 db/migrations 或会话中已执行 SQL 对齐；每段以「同步时间」开头，精确到秒。
-- 详见：.cursor/rules/db-postgres-sql-sync.mdc
-- =============================================================================

-- （以下由每次迁移/执行后追加，勿改写上文。）

-- =============================================================================
-- 同步时间: 2026-04-11 12:00:00
-- 来源: db/migrations/0016_duty_calendar_assignment.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS duty_calendar_assignment (
  id BIGSERIAL PRIMARY KEY,
  table_kind VARCHAR(16) NOT NULL,
  duty_date DATE NOT NULL,
  account VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  shift VARCHAR(16) NOT NULL,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_duty_calendar_kind CHECK (table_kind IN ('kernel', 'control')),
  CONSTRAINT chk_duty_calendar_shift CHECK (shift IN ('full', 'night'))
);

CREATE INDEX IF NOT EXISTS idx_duty_calendar_kind_date
  ON duty_calendar_assignment (table_kind, duty_date);

-- =============================================================================
-- 同步时间: 2026-04-11 16:30:00
-- 来源: db/migrations/0017_duty_roster_extended.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS duty_rotation_entry (
  roster_kind VARCHAR(40) NOT NULL,
  position INT NOT NULL CHECK (position >= 0 AND position < 10000),
  account VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  last_accept_at VARCHAR(64) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (roster_kind, position),
  CONSTRAINT chk_duty_rotation_status CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_duty_rotation_kind
  ON duty_rotation_entry (roster_kind);

CREATE TABLE IF NOT EXISTS duty_site_oncall_row (
  position INT NOT NULL CHECK (position >= 0 AND position < 10000),
  site_name VARCHAR(256) NOT NULL,
  account VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  last_accept_at VARCHAR(64) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (position),
  CONSTRAINT chk_duty_site_oncall_status CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS duty_rl_oncall_row (
  duty_date DATE NOT NULL PRIMARY KEY,
  primary_account VARCHAR(64) NOT NULL,
  primary_user_name VARCHAR(128) NOT NULL DEFAULT '',
  primary_phone VARCHAR(32) NOT NULL DEFAULT '',
  backup_account VARCHAR(64) NOT NULL DEFAULT '',
  backup_user_name VARCHAR(128) NOT NULL DEFAULT '',
  backup_phone VARCHAR(32) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 同步时间: 2026-04-11 20:15:00
-- 来源: db/migrations/0018_leave_application.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS leave_approver_whitelist (
  account VARCHAR(64) PRIMARY KEY,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_application (
  id SERIAL PRIMARY KEY,
  application_no VARCHAR(32) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL,
  application_type VARCHAR(64) NOT NULL,
  applicant_account VARCHAR(64) NOT NULL,
  applicant_display VARCHAR(256) NOT NULL,
  approver_account VARCHAR(64) NOT NULL,
  approver_display VARCHAR(256) NOT NULL,
  cc_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_handler_account VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  CONSTRAINT chk_leave_app_status CHECK (
    status IN ('待提交', '审批中', '同意申请', '拒绝申请', '已取消')
  )
);

CREATE INDEX IF NOT EXISTS idx_leave_application_status ON leave_application (status);
CREATE INDEX IF NOT EXISTS idx_leave_application_handler ON leave_application (current_handler_account);
CREATE INDEX IF NOT EXISTS idx_leave_application_applicant ON leave_application (applicant_account);

CREATE TABLE IF NOT EXISTS leave_time_segment (
  id SERIAL PRIMARY KEY,
  leave_application_id INT NOT NULL REFERENCES leave_application(id) ON DELETE CASCADE,
  seq INT NOT NULL CHECK (seq >= 0 AND seq < 1000),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  duration_hours NUMERIC(14, 4) NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  UNIQUE (leave_application_id, seq),
  CONSTRAINT chk_leave_seg_time CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS leave_application_log (
  id SERIAL PRIMARY KEY,
  leave_application_id INT NOT NULL REFERENCES leave_application(id) ON DELETE CASCADE,
  step_label VARCHAR(64) NOT NULL,
  operator_account VARCHAR(64) NOT NULL,
  operator_display VARCHAR(256) NOT NULL,
  action VARCHAR(32) NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_app_log_app ON leave_application_log (leave_application_id);

COMMIT;

-- =============================================================================
-- 同步时间: 2026-04-28 10:00:00
-- 来源: db/migrations/0028_requirement_management.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS requirement (
  id BIGSERIAL PRIMARY KEY,
  requirement_no VARCHAR(32) NOT NULL UNIQUE,
  title VARCHAR(256) NOT NULL,
  description TEXT NOT NULL,
  proposer VARCHAR(256) NOT NULL,
  assignee VARCHAR(256) NOT NULL,
  related_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_req_no VARCHAR(64) NOT NULL DEFAULT '',
  planned_version VARCHAR(128) NOT NULL DEFAULT '',
  planned_date DATE,
  priority SMALLINT NOT NULL DEFAULT 5,
  remark TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '待分析',
  creator_id VARCHAR(64) NOT NULL,
  creator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_requirement_status CHECK (status IN ('待分析', '待RAT决策', '开发中', '已经落地')),
  CONSTRAINT chk_requirement_priority CHECK (priority >= 1 AND priority <= 10)
);

CREATE INDEX IF NOT EXISTS idx_requirement_status ON requirement (status);
CREATE INDEX IF NOT EXISTS idx_requirement_assignee ON requirement (assignee);
CREATE INDEX IF NOT EXISTS idx_requirement_proposer ON requirement (proposer);
CREATE INDEX IF NOT EXISTS idx_requirement_creator ON requirement (creator_id);
CREATE INDEX IF NOT EXISTS idx_requirement_planned_date ON requirement (planned_date);

CREATE TRIGGER trg_requirement_updated_at
BEFORE UPDATE ON requirement
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS requirement_log (
  id BIGSERIAL PRIMARY KEY,
  requirement_id BIGINT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32),
  changed_fields JSONB,
  comment TEXT NOT NULL DEFAULT '',
  operator_id VARCHAR(64) NOT NULL,
  operator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requirement_log_req ON requirement_log (requirement_id);

COMMIT;

-- =============================================================================
-- 同步时间: 2026-04-11 22:00:00
-- 来源: db/migrations/0019_duty_field_node.sql
-- =============================================================================

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

-- =============================================================================
-- 同步时间: 2026-04-11 23:45:00
-- 来源: db/migrations/0020_param_release_version.sql
-- =============================================================================

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

-- =============================================================================
-- 同步时间: 2026-04-12 12:00:00
-- 来源: db/migrations/0021_seed_duty_field_example.sql
-- =============================================================================

DO $$
DECLARE
  root_id bigint;
  drv_id bigint;
  slow_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM duty_field_node LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO duty_field_node (parent_id, label, sort_order, updated_by)
  VALUES (NULL, 'SQL引擎', 0, 'seed')
  RETURNING id INTO root_id;

  INSERT INTO duty_field_node (parent_id, label, sort_order, updated_by) VALUES
  (root_id, 'CBB', 0, 'seed'),
  (root_id, '驱动', 1, 'seed'),
  (root_id, '慢SQL', 2, 'seed');

  SELECT id INTO drv_id FROM duty_field_node WHERE parent_id = root_id AND label = '驱动' ORDER BY id LIMIT 1;
  SELECT id INTO slow_id FROM duty_field_node WHERE parent_id = root_id AND label = '慢SQL' ORDER BY id LIMIT 1;

  INSERT INTO duty_field_node (parent_id, label, sort_order, updated_by) VALUES
  (drv_id, 'JDBC', 0, 'seed'),
  (drv_id, 'ODBC', 1, 'seed'),
  (slow_id, '等待时间', 0, 'seed'),
  (slow_id, '代价模型不足', 1, 'seed');
END $$;

-- =============================================================================
-- 同步时间: 2026-04-11 18:22:00
-- 来源: db/migrations/0022_param_group_template.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS param_group_template (
  problem_kind VARCHAR(32) PRIMARY KEY,
  group_name_tpl TEXT NOT NULL DEFAULT '',
  group_notice_tpl TEXT NOT NULL DEFAULT '',
  group_members_tpl TEXT NOT NULL DEFAULT '',
  first_report_tpl TEXT NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO param_group_template (problem_kind, group_name_tpl, group_notice_tpl, group_members_tpl, first_report_tpl, updated_by)
VALUES
  (
    'major',
    '【GaussDB内部】【XX 重大问题】{Ecare单号 客户名称} GaussDB {故障描述}',
    '',
    '',
    '',
    'seed'
  ),
  (
    'urgent',
    '【GaussDB内部】【XX 紧急问题】{Ecare单号 客户名称} GaussDB {故障描述}',
    '',
    '',
    '',
    'seed'
  ),
  (
    'itr',
    '【GaussDB内部】【ITR 管理升级】{Ecare单号 客户名称} GaussDB {故障描述}',
    '',
    '',
    '',
    'seed'
  ),
  (
    'general',
    '【GaussDB内部】【一般问题】{Ecare单号 客户名称} GaussDB {故障描述}',
    '',
    '',
    '',
    'seed'
  )
ON CONFLICT (problem_kind) DO NOTHING;

-- =============================================================================
-- 同步时间: 2026-04-20 15:21:11
-- 来源: db/migrations/0023_add_ops_closure_doer_assist_field.sql
-- =============================================================================

BEGIN;

WITH node_map AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT'
    AND wn.node_key = 'ops_closure'
),
set_map AS (
  SELECT id AS option_set_id
  FROM option_set
  WHERE set_code = 'OS_YES_NO'
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order
)
SELECT
  nm.node_id,
  'use_doer_assist' AS field_key,
  '是否使用Doer辅助' AS field_name,
  'whitelist' AS field_type,
  FALSE AS required,
  FALSE AS read_only,
  'none' AS default_type,
  NULL AS default_value,
  sm.option_set_id,
  NULL::jsonb AS constraints_json,
  '{"inherit_previous":false}'::jsonb AS ui_props_json,
  14 AS sort_order
FROM node_map nm
JOIN set_map sm ON TRUE
ON CONFLICT (node_id, field_key) DO UPDATE SET
  field_name = EXCLUDED.field_name,
  field_type = EXCLUDED.field_type,
  required = EXCLUDED.required,
  read_only = EXCLUDED.read_only,
  default_type = EXCLUDED.default_type,
  default_value = EXCLUDED.default_value,
  option_set_id = EXCLUDED.option_set_id,
  constraints_json = EXCLUDED.constraints_json,
  ui_props_json = EXCLUDED.ui_props_json,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

COMMIT;
