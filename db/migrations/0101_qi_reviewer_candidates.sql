BEGIN;

-- QI 评审人/责任人固定名单，由系统管理员配置
CREATE TABLE IF NOT EXISTS qi_reviewer_candidates (
    account     VARCHAR(64) NOT NULL,
    updated_by  VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account)
);

-- 初始化：给管理员角色全员（作为默认值）
INSERT INTO qi_reviewer_candidates (account)
SELECT account FROM user_account WHERE is_active = TRUE
ON CONFLICT (account) DO NOTHING;

COMMIT;
