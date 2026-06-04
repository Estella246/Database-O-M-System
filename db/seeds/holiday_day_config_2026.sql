-- 初始化 2026 年节假日配置（holiday_day_config）
-- 依据：国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7号）
-- day_type: workday | weekend_holiday
--
-- 用法：
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/holiday_day_config_2026.sql

BEGIN;

DELETE FROM holiday_day_config
WHERE holiday_date >= DATE '2026-01-01'
  AND holiday_date < DATE '2027-01-01';

INSERT INTO holiday_day_config (holiday_date, day_type, updated_by, updated_at)
SELECT
  d::date,
  CASE
    -- 调休上班（周末补班）
    WHEN d::date IN (
      DATE '2026-01-04',  -- 元旦调休
      DATE '2026-02-14',  -- 春节调休
      DATE '2026-02-28',  -- 春节调休
      DATE '2026-05-09',  -- 劳动节调休
      DATE '2026-09-20',  -- 国庆调休
      DATE '2026-10-10'   -- 国庆调休
    ) THEN 'workday'

    -- 法定节假日放假
    WHEN d::date BETWEEN DATE '2026-01-01' AND DATE '2026-01-03' THEN 'weekend_holiday'  -- 元旦
    WHEN d::date BETWEEN DATE '2026-02-15' AND DATE '2026-02-23' THEN 'weekend_holiday'  -- 春节
    WHEN d::date BETWEEN DATE '2026-04-04' AND DATE '2026-04-06' THEN 'weekend_holiday'  -- 清明
    WHEN d::date BETWEEN DATE '2026-05-01' AND DATE '2026-05-05' THEN 'weekend_holiday'  -- 劳动节
    WHEN d::date BETWEEN DATE '2026-06-19' AND DATE '2026-06-21' THEN 'weekend_holiday'  -- 端午
    WHEN d::date BETWEEN DATE '2026-09-25' AND DATE '2026-09-27' THEN 'weekend_holiday'  -- 中秋
    WHEN d::date BETWEEN DATE '2026-10-01' AND DATE '2026-10-07' THEN 'weekend_holiday'  -- 国庆

    -- 普通周末
    WHEN EXTRACT(DOW FROM d::date) IN (0, 6) THEN 'weekend_holiday'

    ELSE 'workday'
  END,
  'system',
  NOW()
FROM generate_series(DATE '2026-01-01', DATE '2026-12-31', INTERVAL '1 day') AS d;

COMMIT;
