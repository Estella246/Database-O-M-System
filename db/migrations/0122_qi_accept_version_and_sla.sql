-- 实施阶段「解决版本」下拉选项表（质量改进配置中维护，默认 507.0/507.1/508.0）
-- + 确认/实施阶段纳入阶段超期配置（此前：确认不超期、实施用单上填的 sla_time 判超期）
BEGIN;

CREATE TABLE IF NOT EXISTS qi_accept_version_option (
    id         BIGSERIAL PRIMARY KEY,
    version    VARCHAR(64) NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0,
    enabled    BOOL NOT NULL DEFAULT TRUE
);

INSERT INTO qi_accept_version_option (version, sort_order) VALUES
    ('507.0', 1),
    ('507.1', 2),
    ('508.0', 3)
ON CONFLICT (version) DO NOTHING;

-- 确认/实施参与超期：与 propose/review/acceptance 同范式（started_at + sla_hours）
INSERT INTO qi_stage_sla_config (stage_key, sla_hours) VALUES
    ('analysis', 72),
    ('closure', 336)
ON CONFLICT (stage_key) DO NOTHING;

COMMIT;
