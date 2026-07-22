-- 阶段超期时间配置（propose/review/acceptance 可配；closure 用用户填的 sla_time；analysis 不超期）
BEGIN;

CREATE TABLE IF NOT EXISTS qi_stage_sla_config (
    stage_key  VARCHAR(16) PRIMARY KEY,
    sla_hours  INT NOT NULL DEFAULT 0
);

INSERT INTO qi_stage_sla_config (stage_key, sla_hours) VALUES
    ('propose', 24),
    ('review', 48),
    ('acceptance', 48)
ON CONFLICT (stage_key) DO NOTHING;

COMMIT;
