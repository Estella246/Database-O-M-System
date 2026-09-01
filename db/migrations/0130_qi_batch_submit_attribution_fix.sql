-- QI 工单闭环批量提交归属修复（0130）
--   背景：运维闭环静默批量提交草稿 QI 时，qi_flow_log.operator_* 与 propose 阶段
--         qi_stage_data.created_by 被记成闭环操作人，真实提出人（草稿创建人 creator_id）
--         失去阶段修改权（amend 仅限 last_submitter）与「我提出的」可见性。
--   口径：真实提出人 = qi_request.creator_id；operator_name = qi_request.proposer（创建时的「姓名 账号」）。
--   识别：submitted(propose→review) 且 operator_id <> creator_id。非批量 propose 提交必经
--         _verify_current_handler（提交人==proposer==creator），故该差异只可能来自批量提交；
--         合法例外必须排除：① propose 阶段转单（action='transferred' 会改写 proposer）；
--         ② 旧需求迁移行（migrate_legacy 不写 related_ticket_no，天然被 related_ticket_no<>''
--            排除——其 creator_id 兜底=迁移操作人造成的 operator≠creator 不是批量错置）。
--   幂等：UPDATE 均含「旧值<>目标值」闸门，重跑 0 行命中；comment 前缀带 NOT LIKE 闸门，
--         rollback（保留 comment）后重放不会叠加前缀；备份表 ON CONFLICT DO NOTHING。
--   安全：stage UPDATE 仅改有备份行的行（kind='stage' AND row_id=sd.id）——绝不做无备份写。
--   触发器：qi_stage_data / qi_flow_log 无触发器（仅 qi_request 有 trg_qi_request_updated_at，
--           本迁移不更新主表），无需 DISABLE TRIGGER。
BEGIN;

-- 0) 备份留底（kind='log' 流转日志 / kind='stage' 阶段数据行），支持精确回滚
CREATE TABLE IF NOT EXISTS qi_batch_attrib_fix_0130 (
    kind       VARCHAR(8)   NOT NULL,             -- 'log' / 'stage'
    row_id     BIGINT       NOT NULL,             -- qi_flow_log.id / qi_stage_data.id
    request_id BIGINT       NOT NULL,
    old_value  VARCHAR(64)  NOT NULL,             -- 原 operator_id / created_by（闭环操作人）
    old_name   VARCHAR(128) NOT NULL DEFAULT '',  -- 原 operator_name（stage 行为空）
    copied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, row_id)
);

-- 1) 备份错置的 submitted(propose→review) 日志
INSERT INTO qi_batch_attrib_fix_0130 (kind, row_id, request_id, old_value, old_name)
SELECT 'log', fl.id, fl.request_id, fl.operator_id, fl.operator_name
FROM qi_flow_log fl
JOIN qi_request r ON r.id = fl.request_id
WHERE fl.action = 'submitted' AND fl.from_stage = 'propose' AND fl.to_stage = 'review'
  AND fl.operator_id <> r.creator_id
  AND r.related_ticket_no <> ''
  AND NOT EXISTS (SELECT 1 FROM qi_flow_log t
                  WHERE t.request_id = r.id AND t.action = 'transferred')
ON CONFLICT (kind, row_id) DO NOTHING;

-- 2) 备份被识别单的 propose 非草稿 stage_data 行（错置来源=批量提交行；创建行本来就是 creator）
INSERT INTO qi_batch_attrib_fix_0130 (kind, row_id, request_id, old_value, old_name)
SELECT 'stage', sd.id, sd.request_id, sd.created_by, ''
FROM qi_stage_data sd
JOIN qi_request r ON r.id = sd.request_id
WHERE sd.stage_key = 'propose' AND sd.draft = FALSE AND sd.created_by <> r.creator_id
  AND r.related_ticket_no <> ''
  AND NOT EXISTS (SELECT 1 FROM qi_flow_log t
                  WHERE t.request_id = r.id AND t.action = 'transferred')
  AND EXISTS (SELECT 1 FROM qi_flow_log fl
              WHERE fl.request_id = r.id AND fl.action = 'submitted'
                AND fl.from_stage = 'propose' AND fl.to_stage = 'review'
                AND fl.operator_id <> r.creator_id)          -- 仅修被识别为错置的单
ON CONFLICT (kind, row_id) DO NOTHING;

-- 3) 修正流转日志（操作日志操作人 + 「我提出的」归属）
--    comment 前缀带 NOT LIKE 闸门：rollback 保留 comment 后重放不会叠加前缀（跨回滚/重放幂等）
UPDATE qi_flow_log fl
SET operator_id   = r.creator_id,
    operator_name = r.proposer,
    comment = CASE WHEN fl.comment LIKE '工单闭环批量提交归属修复%' THEN fl.comment
                   ELSE '工单闭环批量提交归属修复，原操作人：' || fl.operator_name || '（' || fl.operator_id || '）'
                        || CASE WHEN fl.comment <> '' THEN '；' || fl.comment ELSE '' END END
FROM qi_request r
WHERE r.id = fl.request_id
  AND fl.action = 'submitted' AND fl.from_stage = 'propose' AND fl.to_stage = 'review'
  AND fl.operator_id <> r.creator_id
  AND r.related_ticket_no <> ''
  AND NOT EXISTS (SELECT 1 FROM qi_flow_log t
                  WHERE t.request_id = r.id AND t.action = 'transferred');

-- 4) 修正 propose 非草稿 stage_data（amend 门禁 / 详情 last_submitter 数据源）
--    仅改有 kind='stage' 备份行的行：绝不产生无法回滚的写
UPDATE qi_stage_data sd
SET created_by = r.creator_id
FROM qi_request r
WHERE r.id = sd.request_id
  AND sd.stage_key = 'propose' AND sd.draft = FALSE AND sd.created_by <> r.creator_id
  AND EXISTS (SELECT 1 FROM qi_batch_attrib_fix_0130 b
              WHERE b.kind = 'stage' AND b.row_id = sd.id)
  AND NOT EXISTS (SELECT 1 FROM qi_flow_log t
                  WHERE t.request_id = r.id AND t.action = 'transferred');

-- 5) 收尾断言：仍存在错置即失败回滚（psql -v ON_ERROR_STOP=1）
DO $$
BEGIN
  IF EXISTS (  -- flow_log 无残留错置
    SELECT 1 FROM qi_flow_log fl
    JOIN qi_request r ON r.id = fl.request_id
    WHERE fl.action = 'submitted' AND fl.from_stage = 'propose' AND fl.to_stage = 'review'
      AND fl.operator_id <> r.creator_id AND r.related_ticket_no <> ''
      AND NOT EXISTS (SELECT 1 FROM qi_flow_log t WHERE t.request_id = r.id AND t.action = 'transferred')
  ) THEN RAISE EXCEPTION 'qi_flow_log 仍存在 propose 提交归属错置，迁移 0130 不完整'; END IF;
  IF EXISTS (  -- 本次/历史备份的 stage 行全部归位（与步骤 4 的备份限定的修复范围一致）
    SELECT 1 FROM qi_batch_attrib_fix_0130 b
    JOIN qi_stage_data sd ON sd.id = b.row_id
    JOIN qi_request r ON r.id = b.request_id
    WHERE b.kind = 'stage' AND sd.created_by <> r.creator_id
      AND NOT EXISTS (SELECT 1 FROM qi_flow_log t WHERE t.request_id = r.id AND t.action = 'transferred')
  ) THEN RAISE EXCEPTION 'qi_stage_data 仍存在 propose 提交归属错置，迁移 0130 不完整'; END IF;
END $$;

COMMIT;
