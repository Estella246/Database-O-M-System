-- QI 改进分类枚举变更（0129）
--   测试加固 / 需求 / 质量加固和改进 → 特性加固（三类归并，不可逆，先备份）
--   升级checklist → 升级（改名）
--   定位定界 / 快速恢复 / 资料 不变；易用性提升 / 产品规格 为新增项（无存量）。
-- 幂等：所有 UPDATE 均以旧值为 WHERE 条件，重跑 0 行命中。
BEGIN;

-- 0) 回滚备份：三类合并后无法从数据区分原值，此表支持精确回滚
CREATE TABLE IF NOT EXISTS qi_category_rename_0129 (
    id           INT PRIMARY KEY,
    old_category VARCHAR(64) NOT NULL,
    copied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO qi_category_rename_0129 (id, old_category)
SELECT r.id, r.category
FROM qi_request r
WHERE r.category IN ('测试加固', '需求', '质量加固和改进', '升级checklist')
ON CONFLICT (id) DO NOTHING;

-- 1) 主表归并（纯分类改名，不应污染 updated_at 口径；
--    trg_qi_request_updated_at(0100) 会在 UPDATE 时无条件改写 updated_at，故先停用，归并后恢复）
ALTER TABLE qi_request DISABLE TRIGGER trg_qi_request_updated_at;
UPDATE qi_request
SET category = CASE category
                 WHEN '测试加固'       THEN '特性加固'
                 WHEN '需求'           THEN '特性加固'
                 WHEN '质量加固和改进' THEN '特性加固'
                 WHEN '升级checklist'  THEN '升级'
               END
WHERE category IN ('测试加固', '需求', '质量加固和改进', '升级checklist');
ALTER TABLE qi_request ENABLE TRIGGER trg_qi_request_updated_at;

-- 2) 阶段数据 values_json->category 归并
--    现状仅 propose 阶段含 category；不按 stage_key 过滤，防御性覆盖任意阶段
UPDATE qi_stage_data
SET values_json = jsonb_set(values_json, '{category}', '"特性加固"'::jsonb, true)
WHERE values_json->>'category' IN ('测试加固', '需求', '质量加固和改进');

UPDATE qi_stage_data
SET values_json = jsonb_set(values_json, '{category}', '"升级"'::jsonb, true)
WHERE values_json->>'category' = '升级checklist';

-- 3) 收尾断言：残留旧值即失败（psql ON_ERROR_STOP / pytest 均会中断）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM qi_request
             WHERE category IN ('测试加固', '需求', '质量加固和改进', '升级checklist')) THEN
    RAISE EXCEPTION 'qi_request 仍存在旧分类值，迁移 0129 不完整';
  END IF;
  IF EXISTS (SELECT 1 FROM qi_stage_data
             WHERE values_json->>'category' IN ('测试加固', '需求', '质量加固和改进', '升级checklist')) THEN
    RAISE EXCEPTION 'qi_stage_data 仍存在旧分类值，迁移 0129 不完整';
  END IF;
END $$;

COMMIT;
