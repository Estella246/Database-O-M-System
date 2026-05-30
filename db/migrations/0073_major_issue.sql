-- 重大问题（工单驱动）：当工单「事件级别」达到重大阈值时，自动流转到本表。
-- 与旧的手工录入表 major_problem（0036/0037）相互独立；本次「重大问题」页面改造为工单驱动后使用本表。
-- 触发流转的 event_level 取值：内部通报重大问题 / 管理升级预警 / 已管理升级 / 事故 / P1-P3事件。

CREATE TABLE IF NOT EXISTS major_issue (
  id BIGSERIAL PRIMARY KEY,
  ticket_no   VARCHAR(32) NOT NULL UNIQUE,   -- 运维单号（工单 ticket_no）
  report_date DATE,                          -- 通报日期 = 运维分析阶段最后一次提交时间
  site_name   VARCHAR(256),                  -- 局点名称（problem_fill.location）
  event_level VARCHAR(64),                   -- 事件级别（ops_analysis.event_level）
  description TEXT,                           -- 问题描述（problem_fill.issue_desc）
  ops_analyst VARCHAR(128),                  -- 运维分析人（运维分析阶段最后一个处理人）
  dev_analyst VARCHAR(128),                  -- 开发分析人（开发分析阶段最后一个处理人）
  status      VARCHAR(32) NOT NULL DEFAULT '进行中',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_major_issue_status CHECK (status IN ('进行中', '挂起', '关闭'))
);

CREATE INDEX IF NOT EXISTS idx_major_issue_status ON major_issue (status, report_date DESC);

CREATE TRIGGER trg_major_issue_updated_at
BEFORE UPDATE ON major_issue
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 进展跟踪：每日可追加一条进展记录（带时间、进展内容、风险消减措施）。
CREATE TABLE IF NOT EXISTS major_issue_progress (
  id BIGSERIAL PRIMARY KEY,
  major_issue_id BIGINT NOT NULL REFERENCES major_issue(id) ON DELETE CASCADE,
  progress_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- 进展时间
  content      TEXT NOT NULL,                        -- 进展内容
  risk_measure TEXT,                                 -- 风险消减措施
  creator_id   VARCHAR(64),
  creator_name VARCHAR(128),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_major_issue_progress
ON major_issue_progress (major_issue_id, progress_at DESC);
