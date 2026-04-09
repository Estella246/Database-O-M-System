BEGIN;

-- Keep common updated_at behavior in one place.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS workflow_template (
  id BIGSERIAL PRIMARY KEY,
  template_code VARCHAR(64) NOT NULL UNIQUE,
  template_name VARCHAR(128) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_workflow_template_updated_at
BEFORE UPDATE ON workflow_template
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS workflow_node (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES workflow_template(id) ON DELETE CASCADE,
  node_key VARCHAR(64) NOT NULL,
  node_name VARCHAR(128) NOT NULL,
  node_order INTEGER NOT NULL,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, node_key),
  UNIQUE (template_id, node_order)
);

CREATE TRIGGER trg_workflow_node_updated_at
BEFORE UPDATE ON workflow_node
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS option_set (
  id BIGSERIAL PRIMARY KEY,
  set_code VARCHAR(64) NOT NULL UNIQUE,
  set_name VARCHAR(128) NOT NULL,
  source_type VARCHAR(32) NOT NULL DEFAULT 'static',
  source_config JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_option_set_updated_at
BEFORE UPDATE ON option_set
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS option_item (
  id BIGSERIAL PRIMARY KEY,
  option_set_id BIGINT NOT NULL REFERENCES option_set(id) ON DELETE CASCADE,
  option_value VARCHAR(256) NOT NULL,
  option_label VARCHAR(256) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (option_set_id, option_value)
);

CREATE INDEX IF NOT EXISTS idx_option_item_set_sort
ON option_item (option_set_id, sort_order);

CREATE TRIGGER trg_option_item_updated_at
BEFORE UPDATE ON option_item
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS node_field_def (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES workflow_node(id) ON DELETE CASCADE,
  field_key VARCHAR(64) NOT NULL,
  field_name VARCHAR(128) NOT NULL,
  field_type VARCHAR(32) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  read_only BOOLEAN NOT NULL DEFAULT FALSE,
  default_type VARCHAR(32) NOT NULL DEFAULT 'none',
  default_value TEXT,
  option_set_id BIGINT REFERENCES option_set(id),
  constraints_json JSONB,
  ui_props_json JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (node_id, field_key),
  CONSTRAINT chk_node_field_type CHECK (
    field_type IN ('text', 'richtext', 'date', 'datetime', 'whitelist')
  ),
  CONSTRAINT chk_node_default_type CHECK (
    default_type IN ('none', 'literal', 'today', 'login_user')
  )
);

CREATE INDEX IF NOT EXISTS idx_node_field_def_node_sort
ON node_field_def (node_id, sort_order);

CREATE TRIGGER trg_node_field_def_updated_at
BEFORE UPDATE ON node_field_def
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ticket (
  id BIGSERIAL PRIMARY KEY,
  ticket_no VARCHAR(32) NOT NULL UNIQUE,
  template_id BIGINT NOT NULL REFERENCES workflow_template(id),
  title VARCHAR(256),
  current_node_id BIGINT REFERENCES workflow_node(id),
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  creator_id VARCHAR(64) NOT NULL,
  creator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ticket_status CHECK (
    status IN ('open', 'suspended', 'closed')
  )
);

CREATE INDEX IF NOT EXISTS idx_ticket_template_status
ON ticket (template_id, status);

CREATE TRIGGER trg_ticket_updated_at
BEFORE UPDATE ON ticket
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ticket_node_instance (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
  node_id BIGINT NOT NULL REFERENCES workflow_node(id),
  handler_id VARCHAR(64),
  handler_name VARCHAR(128),
  action_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ticket_node_action_status CHECK (
    action_status IN ('pending', 'processing', 'completed', 'returned', 'skipped')
  )
);

CREATE INDEX IF NOT EXISTS idx_ticket_node_instance_ticket
ON ticket_node_instance (ticket_id, created_at);

CREATE TRIGGER trg_ticket_node_instance_updated_at
BEFORE UPDATE ON ticket_node_instance
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ticket_node_data (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
  ticket_node_instance_id BIGINT NOT NULL REFERENCES ticket_node_instance(id) ON DELETE CASCADE,
  values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_snapshot JSONB,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_node_data_ticket_instance
ON ticket_node_data (ticket_id, ticket_node_instance_id);

CREATE TABLE IF NOT EXISTS ticket_flow_log (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
  from_node_id BIGINT REFERENCES workflow_node(id),
  to_node_id BIGINT REFERENCES workflow_node(id),
  action_type VARCHAR(32) NOT NULL,
  operator_id VARCHAR(64) NOT NULL,
  operator_name VARCHAR(128) NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ticket_flow_action_type CHECK (
    action_type IN ('submit', 'jump_submit', 'rollback', 'suspend', 'resume', 'close')
  )
);

CREATE INDEX IF NOT EXISTS idx_ticket_flow_log_ticket_time
ON ticket_flow_log (ticket_id, created_at DESC);

-- Seed from 字段.xlsx so a fresh environment can start directly.
INSERT INTO workflow_template (template_code, template_name, version)
VALUES ('HCS_INCIDENT', 'HCS问题处理模板', 1)
ON CONFLICT (template_code) DO NOTHING;

WITH t AS (
  SELECT id FROM workflow_template WHERE template_code = 'HCS_INCIDENT'
)
INSERT INTO workflow_node (template_id, node_key, node_name, node_order)
SELECT t.id, 'problem_fill', '问题填写', 1 FROM t
ON CONFLICT (template_id, node_key) DO NOTHING;

INSERT INTO option_set (set_code, set_name, source_type)
VALUES
  ('LOCATION_SET', '局点', 'static'),
  ('BIZ_ENV_SET', '业务环境', 'static'),
  ('SEVERITY_SET', '问题严重性', 'static'),
  ('COMPONENT_SET', '问题组件', 'static')
ON CONFLICT (set_code) DO NOTHING;

INSERT INTO option_item (option_set_id, option_value, option_label, sort_order)
SELECT os.id, v.option_value, v.option_label, v.sort_order
FROM option_set os
JOIN (
  VALUES
    ('LOCATION_SET', '农行', '农行', 1),
    ('LOCATION_SET', '建行', '建行', 2),
    ('BIZ_ENV_SET', '生产环境（运维）', '生产环境（运维）', 1),
    ('BIZ_ENV_SET', '生产环境（影响业务）', '生产环境（影响业务）', 2),
    ('BIZ_ENV_SET', '已投产业务测试环境', '已投产业务测试环境', 3),
    ('SEVERITY_SET', '一般', '一般', 1),
    ('SEVERITY_SET', '严重', '严重', 2),
    ('SEVERITY_SET', '致命', '致命', 3),
    ('COMPONENT_SET', '内核问题', '内核问题', 1),
    ('COMPONENT_SET', '管控问题', '管控问题', 2)
) AS v(set_code, option_value, option_label, sort_order)
ON os.set_code = v.set_code
ON CONFLICT (option_set_id, option_value) DO NOTHING;

WITH n AS (
  SELECT wn.id AS node_id
  FROM workflow_node wn
  JOIN workflow_template wt ON wt.id = wn.template_id
  WHERE wt.template_code = 'HCS_INCIDENT' AND wn.node_key = 'problem_fill'
),
sets AS (
  SELECT set_code, id FROM option_set
)
INSERT INTO node_field_def (
  node_id, field_key, field_name, field_type, required, read_only,
  default_type, default_value, option_set_id, sort_order
)
SELECT n.node_id, f.field_key, f.field_name, f.field_type, f.required, f.read_only,
       f.default_type, f.default_value, f.option_set_id, f.sort_order
FROM n
JOIN (
  SELECT
    'start_date'::varchar AS field_key, '起始日期'::varchar AS field_name, 'date'::varchar AS field_type,
    TRUE AS required, FALSE AS read_only, 'today'::varchar AS default_type, NULL::text AS default_value,
    NULL::bigint AS option_set_id, 1 AS sort_order
  UNION ALL SELECT
    'location', '局点', 'whitelist', TRUE, FALSE, 'none', NULL,
    (SELECT id FROM sets WHERE set_code = 'LOCATION_SET'), 2
  UNION ALL SELECT
    'biz_env', '业务环境', 'whitelist', TRUE, FALSE, 'none', NULL,
    (SELECT id FROM sets WHERE set_code = 'BIZ_ENV_SET'), 3
  UNION ALL SELECT
    'severity', '问题严重性', 'whitelist', TRUE, FALSE, 'none', NULL,
    (SELECT id FROM sets WHERE set_code = 'SEVERITY_SET'), 4
  UNION ALL SELECT
    'component', '问题组件', 'whitelist', TRUE, FALSE, 'none', NULL,
    (SELECT id FROM sets WHERE set_code = 'COMPONENT_SET'), 5
  UNION ALL SELECT
    'hcs_version', 'HCS版本号', 'text', FALSE, FALSE, 'none', NULL, NULL, 6
  UNION ALL SELECT
    'hcs_mode', 'HCS/轻量化', 'text', FALSE, FALSE, 'none', NULL, NULL, 7
  UNION ALL SELECT
    'ecare_ticket_no', 'eCare单号', 'text', TRUE, FALSE, 'none', NULL, NULL, 8
  UNION ALL SELECT
    'hcs_owner', 'HCS负责人', 'text', TRUE, TRUE, 'login_user', 'employee_id+name', NULL, 9
  UNION ALL SELECT
    'issue_desc', '问题描述', 'richtext', TRUE, FALSE, 'none', NULL, NULL, 10
) f ON TRUE
ON CONFLICT (node_id, field_key) DO NOTHING;

COMMIT;
