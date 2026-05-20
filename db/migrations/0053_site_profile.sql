BEGIN;

-- 局点档案：运维管理下的局点信息台账，共 28 个业务字段。
CREATE TABLE IF NOT EXISTS site_profile (
  id BIGSERIAL PRIMARY KEY,
  site_name VARCHAR(256) NOT NULL DEFAULT '',              -- 局点名称
  profile_type VARCHAR(128) NOT NULL DEFAULT '',           -- 类型
  product_component VARCHAR(256) NOT NULL DEFAULT '',      -- 产品组件
  onsite_contract VARCHAR(256) NOT NULL DEFAULT '',        -- 驻场合同
  industry VARCHAR(128) NOT NULL DEFAULT '',               -- 所属行业
  region VARCHAR(128) NOT NULL DEFAULT '',                 -- 地区
  representative_office VARCHAR(128) NOT NULL DEFAULT '',   -- 所属代表处
  stage VARCHAR(64) NOT NULL DEFAULT '',                   -- 阶段
  tags VARCHAR(256) NOT NULL DEFAULT '',                   -- 标签
  delivery_method VARCHAR(128) NOT NULL DEFAULT '',        -- 交付方式
  report_date DATE,                                        -- 汇报日期
  report_nature VARCHAR(128) NOT NULL DEFAULT '',          -- 回报性质
  ops_personnel VARCHAR(256) NOT NULL DEFAULT '',          -- 运维人员
  kernel_delivery VARCHAR(256) NOT NULL DEFAULT '',        -- 内核交付
  kernel_maintenance VARCHAR(256) NOT NULL DEFAULT '',     -- 内核维护
  service_support VARCHAR(256) NOT NULL DEFAULT '',        -- 服务支持
  tech_lead VARCHAR(128) NOT NULL DEFAULT '',              -- 技术组长
  da VARCHAR(128) NOT NULL DEFAULT '',                     -- DA
  sa VARCHAR(128) NOT NULL DEFAULT '',                     -- SA
  td VARCHAR(128) NOT NULL DEFAULT '',                     -- TD
  account_manager VARCHAR(128) NOT NULL DEFAULT '',        -- 客户经理
  project_manager VARCHAR(128) NOT NULL DEFAULT '',        -- 项目经理
  service_manager VARCHAR(128) NOT NULL DEFAULT '',        -- 服务经理
  software_revenue VARCHAR(64) NOT NULL DEFAULT '',        -- 软件收入
  service_revenue VARCHAR(64) NOT NULL DEFAULT '',         -- 服务收入
  confirm_receipt_time DATE,                               -- 确收时间
  risk_description TEXT NOT NULL DEFAULT '',               -- 风险描述
  dtrb_conclusion TEXT NOT NULL DEFAULT '',                -- DTRB结论
  creator_id VARCHAR(64) NOT NULL DEFAULT '',
  creator_name VARCHAR(128) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_profile_site_name ON site_profile (site_name);
CREATE INDEX IF NOT EXISTS idx_site_profile_region ON site_profile (region);
CREATE INDEX IF NOT EXISTS idx_site_profile_stage ON site_profile (stage);
CREATE INDEX IF NOT EXISTS idx_site_profile_created_at ON site_profile (created_at);

CREATE TRIGGER trg_site_profile_updated_at
BEFORE UPDATE ON site_profile
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO site_profile (
  site_name, profile_type, product_component, onsite_contract, industry, region,
  representative_office, stage, tags, delivery_method, report_date, report_nature,
  ops_personnel, kernel_delivery, kernel_maintenance, service_support, tech_lead,
  da, sa, td, account_manager, project_manager, service_manager,
  software_revenue, service_revenue, confirm_receipt_time, risk_description,
  dtrb_conclusion, creator_id, creator_name
) VALUES
('北京金融数据中心', '生产局点', 'GaussDB 内核/管控', '有', '金融', '华北', '北京代表处', '运维期', '重保',
 '驻场交付', '2026-05-10', '常规汇报', '张运维', '李交付', '王维护', '赵支持', '孙组长',
 '陈DA', '周SA', '吴TD', '郑客户经理', '冯项目经理', '钱服务经理', '1200', '300',
 '2026-04-30', '当前无重大风险，备份策略已校验。', '通过', 'admin', '管理员'),
('上海政务云局点', '生产局点', 'GaussDB 内核', '无', '政务', '华东', '上海代表处', '建设期', '新建',
 '远程交付', '2026-05-12', '专项汇报', '刘运维', '杨交付', '黄维护', '徐支持', '朱组长',
 '高DA', '林SA', '何TD', '罗客户经理', '梁项目经理', '宋服务经理', '800', '180',
 NULL, '迁移窗口紧张，需关注割接风险。', '有条件通过', 'admin', '管理员'),
('深圳运营商核心库', '生产局点', 'GaussDB 内核/管控', '有', '运营商', '华南', '深圳代表处', '运维期', '重保',
 '驻场交付', '2026-05-15', '常规汇报', '谢运维', '唐交付', '韩维护', '曹支持', '许组长',
 '邓DA', '萧SA', '冯TD', '曾客户经理', '彭项目经理', '蒋服务经理', '2000', '520',
 '2026-05-01', '容灾演练已完成，结果符合预期。', '通过', 'admin', '管理员');

COMMIT;
