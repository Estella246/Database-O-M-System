-- 拉群模版：按问题类型维护群名称 / 群公告 / 群组成员 / 首次通报 文案

CREATE TABLE IF NOT EXISTS param_group_template (
  problem_kind VARCHAR(32) PRIMARY KEY,
  group_name_tpl TEXT NOT NULL DEFAULT '',
  group_notice_tpl TEXT NOT NULL DEFAULT '',
  group_members_tpl TEXT NOT NULL DEFAULT '',
  first_report_tpl TEXT NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO param_group_template (problem_kind, group_name_tpl, group_notice_tpl, group_members_tpl, first_report_tpl, updated_by)
VALUES
  (
    'major',
    '【GaussDB内部】【XX 重大问题】{Ecare单号 客户名称} GaussDB {故障描述}',
    '',
    '',
    '',
    'seed'
  ),
  (
    'urgent',
    '【GaussDB内部】【XX 紧急问题】{Ecare单号 客户名称} GaussDB {故障描述}',
    '',
    '',
    '',
    'seed'
  ),
  (
    'itr',
    '【GaussDB内部】【ITR 管理升级】{Ecare单号 客户名称} GaussDB {故障描述}',
    '',
    '',
    '',
    'seed'
  ),
  (
    'general',
    '【GaussDB内部】【一般问题】{Ecare单号 客户名称} GaussDB {故障描述}',
    '',
    '',
    '',
    'seed'
  )
ON CONFLICT (problem_kind) DO NOTHING;
