BEGIN;

-- 记录因「同意申请」而置灰的请假单，用于请假结束后自动恢复当值
CREATE TABLE IF NOT EXISTS leave_duty_suspend (
  leave_application_id INT PRIMARY KEY REFERENCES leave_application(id) ON DELETE CASCADE,
  applicant_account VARCHAR(64) NOT NULL,
  span_end TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_duty_suspend_account ON leave_duty_suspend (applicant_account);
CREATE INDEX IF NOT EXISTS idx_leave_duty_suspend_span_end ON leave_duty_suspend (span_end);

-- 已为「同意申请」的历史单补登记，便于到期后自动恢复
INSERT INTO leave_duty_suspend (leave_application_id, applicant_account, span_end)
SELECT a.id, a.applicant_account, agg.span_end
FROM leave_application a
INNER JOIN (
  SELECT leave_application_id, MAX(end_at) AS span_end
  FROM leave_time_segment
  GROUP BY leave_application_id
) agg ON agg.leave_application_id = a.id
WHERE a.status = '同意申请'
ON CONFLICT (leave_application_id) DO NOTHING;

COMMIT;
