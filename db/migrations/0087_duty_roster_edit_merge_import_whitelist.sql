-- 月历「下载模版」「导入」并入 duty_roster_edit，移除独立 duty_calendar_import 白名单项

DELETE FROM role_permission_policy
WHERE node_key = '__whitelist__'
  AND field_key = 'duty_calendar_import';
