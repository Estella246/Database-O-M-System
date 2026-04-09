-- Map each handle_mode to allowed next_handler whitelist options.
-- For now, every mode allows: l30030745 李潇雨

CREATE TABLE IF NOT EXISTS handle_mode_next_handler_whitelist (
  id BIGSERIAL PRIMARY KEY,
  node_key TEXT NOT NULL,
  handle_mode TEXT NOT NULL,
  handler_value TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (node_key, handle_mode, handler_value)
);

WITH node_mode(node_key, set_code) AS (
  VALUES
    ('problem_review', 'OS_PROBLEM_REVIEW_HANDLE_MODE'),
    ('ops_analysis', 'OS_OPS_ANALYSIS_HANDLE_MODE'),
    ('dev_analysis', 'OS_DEV_ANALYSIS_HANDLE_MODE'),
    ('dev_closure', 'OS_DEV_CLOSURE_HANDLE_MODE'),
    ('ops_closure', 'OS_OPS_CLOSURE_HANDLE_MODE'),
    ('audit_close', 'OS_AUDIT_CLOSE_HANDLE_MODE')
),
all_modes AS (
  SELECT nm.node_key, oi.option_value AS handle_mode
  FROM node_mode nm
  JOIN option_set os ON os.set_code = nm.set_code
  JOIN option_item oi ON oi.option_set_id = os.id
  WHERE oi.is_active = TRUE
)
INSERT INTO handle_mode_next_handler_whitelist (node_key, handle_mode, handler_value, sort_order, is_active)
SELECT node_key, handle_mode, 'l30030745 李潇雨', 1, TRUE
FROM all_modes
ON CONFLICT (node_key, handle_mode, handler_value) DO UPDATE
SET is_active = EXCLUDED.is_active;
