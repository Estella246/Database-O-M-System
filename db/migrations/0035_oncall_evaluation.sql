-- oncall 绩效评议：加分项申报 + 红黑事件 两张支撑表。
-- SLA / 独立闭环率 / 工单量 / 综合得分均基于 ticket / ticket_flow_log 实时计算，不落库。
BEGIN;

CREATE TABLE IF NOT EXISTS oncall_eva_extra (
  id BIGSERIAL PRIMARY KEY,
  account VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  category VARCHAR(32) NOT NULL,
  description TEXT NOT NULL,
  evidence_url TEXT NOT NULL DEFAULT '',
  declared_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  reviewer_id VARCHAR(64) NOT NULL DEFAULT '',
  reviewer_name VARCHAR(128) NOT NULL DEFAULT '',
  review_comment TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  is_excellent BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_oncall_extra_category CHECK (category IN ('efficiency','enablement','knowledge','public','travel','other')),
  CONSTRAINT chk_oncall_extra_status CHECK (status IN ('pending','approved','rejected','withdrawn')),
  CONSTRAINT chk_oncall_extra_month CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT chk_oncall_extra_score CHECK (declared_score >= 0 AND declared_score <= 20)
);

CREATE INDEX IF NOT EXISTS idx_oncall_extra_lookup
ON oncall_eva_extra (period_year, period_month, account);

CREATE INDEX IF NOT EXISTS idx_oncall_extra_status
ON oncall_eva_extra (status, period_year, period_month);

CREATE TRIGGER trg_oncall_extra_updated_at
BEFORE UPDATE ON oncall_eva_extra
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE IF NOT EXISTS oncall_eva_event (
  id BIGSERIAL PRIMARY KEY,
  account VARCHAR(64) NOT NULL,
  user_name VARCHAR(128) NOT NULL DEFAULT '',
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  kind VARCHAR(8) NOT NULL,
  score NUMERIC(5,2) NOT NULL,
  summary TEXT NOT NULL,
  evidence_url TEXT NOT NULL DEFAULT '',
  recorder_id VARCHAR(64) NOT NULL,
  recorder_name VARCHAR(128) NOT NULL DEFAULT '',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_oncall_event_kind CHECK (kind IN ('red','black')),
  CONSTRAINT chk_oncall_event_month CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT chk_oncall_event_score CHECK (score >= 0 AND score <= 5)
);

CREATE INDEX IF NOT EXISTS idx_oncall_event_lookup
ON oncall_eva_event (period_year, period_month, account);


-- 把 oncall 评议入口加入权限白名单，初始仅 admin 角色可见。
INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT 'admin', TRUE, '__whitelist__', 'oncall_eva', 'editable', 'system'
WHERE NOT EXISTS (
  SELECT 1 FROM role_permission_policy
  WHERE role_code = 'admin' AND is_pl = TRUE
    AND node_key = '__whitelist__' AND field_key = 'oncall_eva'
);

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by)
SELECT 'admin', TRUE, '__whitelist__', 'oncall_eva_review', 'editable', 'system'
WHERE NOT EXISTS (
  SELECT 1 FROM role_permission_policy
  WHERE role_code = 'admin' AND is_pl = TRUE
    AND node_key = '__whitelist__' AND field_key = 'oncall_eva_review'
);

COMMIT;
