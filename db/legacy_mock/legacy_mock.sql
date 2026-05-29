-- 老平台（GaussDB）工单库的「模拟」表结构与数据，仅用于验证「迁入」功能。
-- 注意：这些表不属于新平台 schema，不要放进 db/migrations（不会自动执行）。
-- 本地验证：让后端 LEGACY_DATABASE_URL 指向当前库（默认即 DATABASE_URL），
-- 然后执行本文件灌入模拟数据，再点工作台「迁入」。
-- 重复执行安全：先 DROP 再建。

DROP TABLE IF EXISTS t_work_flow_task_parse CASCADE;
DROP TABLE IF EXISTS t_work_flow_task CASCADE;
DROP TABLE IF EXISTS t_work_flow_instance CASCADE;

-- 工单基本信息表（T_WORK_FLOW_INSTANCE）
CREATE TABLE t_work_flow_instance (
  id                          BIGINT PRIMARY KEY,
  work_flow_info_name         VARCHAR(128),
  current_work_flow_node_name VARCHAR(128),
  current_assignee            VARCHAR(128),
  current_assignee_id         VARCHAR(64),
  status                      VARCHAR(32),
  description                 VARCHAR(2000),
  issue_severity              VARCHAR(32),
  creator_time                VARCHAR(128),  -- 老库此列含义为「工单创建人姓名」
  creator_id                  VARCHAR(64),
  create_time                 TIMESTAMP,
  update_time                 TIMESTAMP,
  deleted                     VARCHAR(8) DEFAULT '0'
);

-- 流程任务表（T_WORK_FLOW_TASK）：每次节点流转一条
CREATE TABLE t_work_flow_task (
  id                          BIGINT PRIMARY KEY,
  work_flow_instance_id       BIGINT,
  current_work_flow_node_name VARCHAR(128),
  next_work_flow_node_name    VARCHAR(128),
  next_assignee               VARCHAR(128),
  next_assignee_id            VARCHAR(64),
  creator_name                VARCHAR(128),
  creator_id                  VARCHAR(64),
  create_time                 TIMESTAMP,
  status                      VARCHAR(32),
  deleted                     VARCHAR(8) DEFAULT '0'
);

-- 工单信息映射表（T_WORK_FLOW_TASK_PARSE）：column1..column64 固定列
CREATE TABLE t_work_flow_task_parse (
  id          BIGINT PRIMARY KEY,
  instance_id BIGINT,
  column1  VARCHAR(512), column2  VARCHAR(512), column3  VARCHAR(512), column4  VARCHAR(512),
  column5  VARCHAR(512), column6  VARCHAR(512), column7  VARCHAR(512), column8  VARCHAR(2000),
  column9  VARCHAR(2000), column10 VARCHAR(512), column11 VARCHAR(512), column12 VARCHAR(512),
  column13 VARCHAR(512), column14 VARCHAR(512), column15 VARCHAR(512), column16 VARCHAR(512),
  column17 VARCHAR(512), column18 VARCHAR(512), column19 VARCHAR(2000), column20 VARCHAR(512),
  column21 VARCHAR(512), column22 VARCHAR(512), column23 VARCHAR(512), column24 VARCHAR(512),
  column25 VARCHAR(512), column26 VARCHAR(512), column27 VARCHAR(512), column28 VARCHAR(2000),
  column29 VARCHAR(2000), column30 VARCHAR(2000), column31 VARCHAR(2000), column32 VARCHAR(512),
  column33 VARCHAR(2000), column34 VARCHAR(512), column35 VARCHAR(512), column36 VARCHAR(512),
  column37 VARCHAR(512), column38 VARCHAR(512), column39 VARCHAR(512), column40 VARCHAR(512),
  column41 VARCHAR(512), column42 VARCHAR(512), column43 VARCHAR(2000), column44 VARCHAR(512),
  column45 VARCHAR(512), column46 VARCHAR(512), column47 VARCHAR(512), column48 VARCHAR(512),
  column49 VARCHAR(512), column50 VARCHAR(512), column51 VARCHAR(512), column52 VARCHAR(512),
  column53 VARCHAR(512), column54 VARCHAR(512), column55 VARCHAR(512), column56 VARCHAR(512),
  column57 VARCHAR(512), column58 VARCHAR(512), column59 VARCHAR(2000), column60 VARCHAR(512),
  column61 VARCHAR(512), column62 VARCHAR(512), column63 VARCHAR(512), column64 VARCHAR(512)
);

-- ============ 模拟数据 ============

-- 实例 1001：进行中，停在「运维分析」（problem_fill→problem_review→ops_analysis）
-- 实例 1002：已关闭，走到「审核关闭」
-- 实例 1003：暂停，停在「开发分析」
-- 实例 1004：逻辑删除（deleted=1），迁入时应跳过
INSERT INTO t_work_flow_instance
  (id, work_flow_info_name, current_work_flow_node_name, current_assignee, current_assignee_id,
   status, description, issue_severity, creator_time, creator_id, create_time, update_time, deleted)
VALUES
  (1001, 'HCS问题处理', '运维分析', '李潇雨', 'l00002', '进行中',
   '农行生产环境实例频繁重启', '严重', '申宇', 's00001',
   '2025-11-03 09:12:00', '2025-11-04 10:00:00', '0'),
  (1002, 'HCS问题处理', '审核关闭', '徐齐刚', 'x00006', '关闭',
   '建行备份任务超时导致告警', '一般', '董海俊', 'd00004',
   '2025-10-21 14:30:00', '2025-10-28 18:20:00', '0'),
  (1003, 'HCS问题处理', '开发分析', '宋康', 's00007', '暂停',
   '内核出现 coredump，疑似并发场景', '致命', '刘宗超', 'l00005',
   '2025-12-01 08:05:00', '2025-12-02 11:40:00', '0'),
  (1004, 'HCS问题处理', '问题审核', '李长军', 'l00003', '进行中',
   '已废弃的测试单据', '一般', '申宇', 's00001',
   '2025-09-15 10:00:00', '2025-09-15 10:30:00', '1');

-- 解析列（每实例一条；只填有业务含义的列，未填列代表老库该字段为空）
INSERT INTO t_work_flow_task_parse
  (id, instance_id, column1, column2, column3, column4, column8, column9, column10, column11,
   column23, column50, column53, column54)
VALUES
  (1, 1001, '2025-11-03', '农行', '公有云', '生产环境（运维）',
   '农行生产环境实例频繁重启，疑似内存泄漏', 'ERROR: out of memory',
   '严重', '内核类', 'DTS2025110300012', '内核问题', 'eCare-AH-20251103', 'l00002 李潇雨'),
  (3, 1003, '2025-12-01', '建行', '公有云', '生产环境（影响业务）',
   '内核出现 coredump，疑似并发场景', 'SIGSEGV in xact_commit',
   '致命', '内核类', 'DTS2025120100099', '内核问题', 'eCare-CCB-20251201', 's00007 宋康');

-- 实例 1002（已关闭）解析列：含闭环类字段
INSERT INTO t_work_flow_task_parse
  (id, instance_id, column1, column2, column4, column8, column10, column17, column22, column31, column60)
VALUES
  (2, 1002, '2025-10-21', '建行', '生产环境（运维）',
   '建行备份任务超时导致告警', '一般', '已定位并修复，正常关闭', '是',
   '备份调度线程被长事务阻塞', '中');

-- 流转任务（每条 = 一次节点提交），按时间还原节点历史
-- 实例 1001 的流转：问题填写 → 问题审核 → 运维分析（停在运维分析）
INSERT INTO t_work_flow_task
  (id, work_flow_instance_id, current_work_flow_node_name, next_work_flow_node_name,
   next_assignee, next_assignee_id, creator_name, creator_id, create_time, status)
VALUES
  (10, 1001, '问题填写', '问题审核', '李长军', 'l00003', '申宇', 's00001', '2025-11-03 09:12:00', '提交'),
  (11, 1001, '问题审核', '运维分析', '李潇雨', 'l00002', '李长军', 'l00003', '2025-11-03 15:40:00', '提交');

-- 实例 1002 的流转：问题填写 → 问题审核 → 运维分析 → 开发分析 → 开发闭环 → 运维闭环 → 审核关闭
INSERT INTO t_work_flow_task
  (id, work_flow_instance_id, current_work_flow_node_name, next_work_flow_node_name,
   next_assignee, next_assignee_id, creator_name, creator_id, create_time, status)
VALUES
  (20, 1002, '问题填写', '问题审核', '李长军', 'l00003', '董海俊', 'd00004', '2025-10-21 14:30:00', '提交'),
  (21, 1002, '问题审核', '运维分析', '李潇雨', 'l00002', '李长军', 'l00003', '2025-10-22 09:00:00', '提交'),
  (22, 1002, '运维分析', '开发分析', '宋康',   's00007', '李潇雨', 'l00002', '2025-10-23 16:10:00', '提交'),
  (23, 1002, '开发分析', '开发闭环', '李博闻', 'l00008', '宋康',   's00007', '2025-10-25 10:20:00', '提交'),
  (24, 1002, '开发闭环', '运维闭环', '李潇雨', 'l00002', '李博闻', 'l00008', '2025-10-27 11:00:00', '提交'),
  (25, 1002, '运维闭环', '审核关闭', '徐齐刚', 'x00006', '李潇雨', 'l00002', '2025-10-28 17:00:00', '提交'),
  (26, 1002, '审核关闭', '',         '',       '',       '徐齐刚', 'x00006', '2025-10-28 18:20:00', '关闭');

-- 实例 1003 的流转：问题填写 → 问题审核 → 运维分析 → 开发分析（暂停在开发分析）
INSERT INTO t_work_flow_task
  (id, work_flow_instance_id, current_work_flow_node_name, next_work_flow_node_name,
   next_assignee, next_assignee_id, creator_name, creator_id, create_time, status)
VALUES
  (30, 1003, '问题填写', '问题审核', '李长军', 'l00003', '刘宗超', 'l00005', '2025-12-01 08:05:00', '提交'),
  (31, 1003, '问题审核', '运维分析', '李潇雨', 'l00002', '李长军', 'l00003', '2025-12-01 13:25:00', '提交'),
  (32, 1003, '运维分析', '开发分析', '宋康',   's00007', '李潇雨', 'l00002', '2025-12-02 11:40:00', '提交');
