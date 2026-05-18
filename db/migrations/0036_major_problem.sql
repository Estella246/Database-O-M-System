BEGIN;

CREATE TABLE IF NOT EXISTS major_problem (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  ops_order_no VARCHAR(64) NOT NULL DEFAULT '',
  problem_no VARCHAR(64) NOT NULL UNIQUE,
  site_name VARCHAR(256) NOT NULL DEFAULT '',
  problem_type VARCHAR(64) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  root_cause TEXT NOT NULL DEFAULT '',
  solution TEXT NOT NULL DEFAULT '',
  root_cause_category VARCHAR(64) NOT NULL DEFAULT '',
  feature_category VARCHAR(64) NOT NULL DEFAULT '',
  impact_category VARCHAR(64) NOT NULL DEFAULT '',
  kernel_version VARCHAR(128) NOT NULL DEFAULT '',
  dts_bug_no VARCHAR(256) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '待处理',
  creator_id VARCHAR(64) NOT NULL,
  creator_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_major_problem_status CHECK (status IN ('待处理', '处理中', '已解决', '已关闭'))
);

CREATE INDEX IF NOT EXISTS idx_major_problem_report_date ON major_problem (report_date);
CREATE INDEX IF NOT EXISTS idx_major_problem_problem_no ON major_problem (problem_no);
CREATE INDEX IF NOT EXISTS idx_major_problem_site_name ON major_problem (site_name);
CREATE INDEX IF NOT EXISTS idx_major_problem_status ON major_problem (status);
CREATE INDEX IF NOT EXISTS idx_major_problem_problem_type ON major_problem (problem_type);

CREATE TRIGGER trg_major_problem_updated_at
BEFORE UPDATE ON major_problem
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO major_problem (report_date, ops_order_no, problem_no, site_name, problem_type, description, root_cause, solution, root_cause_category, feature_category, impact_category, kernel_version, dts_bug_no, status, creator_id, creator_name) VALUES
('2026-05-01', 'OPS20260501001', 'MP20260501001', '北京数据中心', '性能问题', '数据库查询响应时间超过5秒，影响业务处理效率', '索引缺失导致全表扫描', '创建复合索引 idx_query_time', '数据库优化', '查询性能', '性能影响', 'V5.2.1', 'DTS20260501001', '已解决', 'admin_001', '管理员'),
('2026-05-02', 'OPS20260502001', 'MP20260502001', '上海数据中心', '可用性问题', '主备切换失败，导致服务中断10分钟', '心跳检测超时配置不合理', '调整心跳超时时间为30秒', '配置错误', '高可用', '业务中断', 'V5.2.2', 'DTS20260502001', '处理中', 'admin_001', '管理员'),
('2026-05-03', 'OPS20260503001', 'MP20260503001', '深圳数据中心', '安全问题', '发现SQL注入漏洞，存在数据泄露风险', '输入参数未进行严格校验', '增加参数校验和白名单过滤', '代码缺陷', '安全防护', '安全风险', 'V5.1.3', 'BUG20260503001', '待处理', 'admin_002', '运维工程师'),
('2026-05-04', 'OPS20260504001', 'MP20260504001', '广州数据中心', '存储问题', '磁盘空间不足，导致数据库写入失败', '日志文件未定期清理', '增加日志自动清理策略', '存储管理', '日志管理', '数据丢失风险', 'V5.2.0', 'DTS20260504001', '已解决', 'admin_001', '管理员'),
('2026-05-05', 'OPS20260505001', 'MP20260505001', '成都数据中心', '网络问题', '网络延迟异常，跨机房同步失败', '网络带宽配置不足', '增加网络带宽至100Mbps', '网络配置', '数据同步', '同步延迟', 'V5.2.1', 'DTS20260505001', '已关闭', 'admin_003', '网络工程师'),
('2026-05-06', 'OPS20260506001', 'MP20260506001', '武汉数据中心', '兼容性问题', '新版本内核与旧版本存储不兼容', '版本升级未做兼容性测试', '回滚版本并制定升级测试流程', '版本管理', '兼容性', '功能受限', 'V5.3.0', 'BUG20260506001', '处理中', 'admin_002', '运维工程师'),
('2026-05-07', 'OPS20260507001', 'MP20260507001', '西安数据中心', '备份问题', '备份任务执行失败，数据未按时备份', '备份脚本执行权限不足', '调整脚本执行权限', '权限管理', '数据备份', '备份失败', 'V5.2.2', 'DTS20260507001', '待处理', 'admin_001', '管理员'),
('2026-05-08', 'OPS20260508001', 'MP20260508001', '杭州数据中心', '监控问题', '监控告警延迟，未能及时发现异常', '告警阈值设置过高', '调整告警阈值至合理范围', '监控配置', '告警机制', '响应延迟', 'V5.2.1', 'DTS20260508001', '已解决', 'admin_003', '网络工程师'),
('2026-05-09', 'OPS20260509001', 'MP20260509001', '南京数据中心', '性能问题', '批量导入数据时CPU占用率过高', '导入脚本未使用批量优化', '优化导入脚本使用批量提交', '代码优化', '数据导入', '资源占用', 'V5.2.3', 'BUG20260509001', '处理中', 'admin_002', '运维工程师'),
('2026-05-09', 'OPS20260509002', 'MP20260509002', '重庆数据中心', '可用性问题', '集群节点宕机，服务短暂不可用', '节点内存不足导致OOM', '增加节点内存并优化内存使用', '资源配置', '集群管理', '服务中断', 'V5.2.0', 'DTS20260509002', '待处理', 'admin_001', '管理员');

COMMIT;