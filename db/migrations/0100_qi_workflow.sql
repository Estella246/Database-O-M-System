BEGIN;

-- 质量改进（Quality Improvement）5 阶段工作流：提出 → 评审 → 改进项分析 → 闭环 → 验收
-- 与旧 requirement 单表共存（方案 B），独立 qi_* 表族，主单唯一编号 QI-YYYY-NNN。

-- 【主诉求单】全流程不变量；所有阶段通过 request_id 关联回此表
CREATE TABLE IF NOT EXISTS qi_request (
    id                BIGSERIAL PRIMARY KEY,
    qi_no             VARCHAR(32) NOT NULL UNIQUE,        -- QI-YYYY-NNN
    category          VARCHAR(64) NOT NULL,
    proposer          VARCHAR(256) NOT NULL,              -- 提出人（姓名 账号）
    title             VARCHAR(512) NOT NULL,              -- 诉求标题
    related_ticket_no VARCHAR(64) NOT NULL DEFAULT '',    -- 关联运维系统单号
    description       TEXT NOT NULL,                      -- 诉求描述（富文本）
    expected_goal     TEXT NOT NULL,                      -- 改进诉求（富文本）
    priority          VARCHAR(8) NOT NULL DEFAULT '中',
    domain            VARCHAR(128) NOT NULL DEFAULT '',
    module_feature    VARCHAR(256) NOT NULL DEFAULT '',
    planned_version   VARCHAR(128) NOT NULL DEFAULT '',
    reviewer          VARCHAR(256) NOT NULL DEFAULT '',   -- 评审人（提出阶段指定）
    current_stage     VARCHAR(16) NOT NULL DEFAULT 'propose',
    current_status    VARCHAR(16) NOT NULL DEFAULT 'draft',
    creator_id        VARCHAR(64) NOT NULL,
    creator_name      VARCHAR(128) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_qi_priority CHECK (priority IN ('高', '中', '低')),
    CONSTRAINT chk_qi_stage CHECK (current_stage IN ('propose', 'review', 'analysis', 'closure', 'acceptance')),
    CONSTRAINT chk_qi_status CHECK (current_status IN ('draft', 'in_progress', 'rejected', 'closed'))
);
CREATE INDEX IF NOT EXISTS idx_qi_request_proposer ON qi_request (proposer);
CREATE INDEX IF NOT EXISTS idx_qi_request_creator ON qi_request (creator_id);
CREATE INDEX IF NOT EXISTS idx_qi_request_stage ON qi_request (current_stage);
CREATE INDEX IF NOT EXISTS idx_qi_request_status ON qi_request (current_status);
CREATE INDEX IF NOT EXISTS idx_qi_request_priority ON qi_request (priority);
CREATE INDEX IF NOT EXISTS idx_qi_request_created ON qi_request (created_at DESC);

CREATE TRIGGER trg_qi_request_updated_at
    BEFORE UPDATE ON qi_request
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 【阶段实例】每次进入某阶段建一行；打回重进 sequence+1，旧行保留为审计
CREATE TABLE IF NOT EXISTS qi_stage (
    id                BIGSERIAL PRIMARY KEY,
    request_id        BIGINT NOT NULL REFERENCES qi_request(id) ON DELETE CASCADE,
    stage_key         VARCHAR(16) NOT NULL,               -- propose/review/analysis/closure/acceptance
    sequence          INT NOT NULL DEFAULT 1,             -- 第几次进入（打回递增）
    status            VARCHAR(16) NOT NULL DEFAULT 'pending',
    responsible       VARCHAR(256) NOT NULL DEFAULT '',   -- 责任人（评审填入，继承到分析/闭环）
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,
    CONSTRAINT chk_qi_stage_key CHECK (stage_key IN ('propose', 'review', 'analysis', 'closure', 'acceptance')),
    CONSTRAINT chk_qi_stage_status CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected'))
);
CREATE INDEX IF NOT EXISTS idx_qi_stage_request ON qi_stage (request_id);
CREATE INDEX IF NOT EXISTS idx_qi_stage_key ON qi_stage (request_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_qi_stage_active ON qi_stage (request_id, stage_key, sequence);

-- 【阶段字段值】每阶段字段集不同，存 JSONB
CREATE TABLE IF NOT EXISTS qi_stage_data (
    id                BIGSERIAL PRIMARY KEY,
    stage_id          BIGINT NOT NULL REFERENCES qi_stage(id) ON DELETE CASCADE,
    request_id        BIGINT NOT NULL REFERENCES qi_request(id) ON DELETE CASCADE,
    stage_key         VARCHAR(16) NOT NULL,
    values_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    amended           BOOLEAN NOT NULL DEFAULT FALSE,     -- 补录（编辑已走过阶段）
    draft             BOOLEAN NOT NULL DEFAULT FALSE,     -- 草稿（save_only 保存，未流转）
    created_by        VARCHAR(64) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qi_stage_data_stage ON qi_stage_data (stage_id);
CREATE INDEX IF NOT EXISTS idx_qi_stage_data_request ON qi_stage_data (request_id, stage_key);

-- 【进展子项】仅 analysis/closure 阶段，可逐条独立提交
CREATE TABLE IF NOT EXISTS qi_progress_item (
    id                BIGSERIAL PRIMARY KEY,
    request_id        BIGINT NOT NULL REFERENCES qi_request(id) ON DELETE CASCADE,
    stage_id          BIGINT NOT NULL REFERENCES qi_stage(id) ON DELETE CASCADE,
    stage_key         VARCHAR(16) NOT NULL,
    seq               INT NOT NULL,                       -- 该阶段内子项序号（自增）
    content           TEXT NOT NULL,                      -- 进展说明
    submitter_id      VARCHAR(64) NOT NULL,
    submitter_name    VARCHAR(128) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qi_progress_request ON qi_progress_item (request_id);
CREATE INDEX IF NOT EXISTS idx_qi_progress_stage ON qi_progress_item (stage_id);
CREATE INDEX IF NOT EXISTS idx_qi_progress_seq ON qi_progress_item (stage_id, seq);

-- 【流转日志】
CREATE TABLE IF NOT EXISTS qi_flow_log (
    id                BIGSERIAL PRIMARY KEY,
    request_id        BIGINT NOT NULL REFERENCES qi_request(id) ON DELETE CASCADE,
    action            VARCHAR(32) NOT NULL,               -- created/submitted/rejected/closed/updated/migrated
    from_stage        VARCHAR(16) NOT NULL DEFAULT '',
    to_stage          VARCHAR(16) NOT NULL DEFAULT '',
    changed_fields    JSONB,
    operator_id       VARCHAR(64) NOT NULL,
    operator_name     VARCHAR(128) NOT NULL,
    comment           TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qi_flow_log_request ON qi_flow_log (request_id);
CREATE INDEX IF NOT EXISTS idx_qi_flow_log_created ON qi_flow_log (request_id, created_at DESC);

-- 【编号序列】仅 QI，每年独立计数
CREATE TABLE IF NOT EXISTS qi_no_seq (
    seq_key           VARCHAR(4) NOT NULL DEFAULT 'QI',
    year_part         INT NOT NULL,
    last_suffix       INT NOT NULL DEFAULT 0,
    PRIMARY KEY (seq_key, year_part)
);

COMMIT;
