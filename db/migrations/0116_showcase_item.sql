BEGIN;

-- 展示效果：轮播条目由前端新增，图片存 MinIO，展示元数据落库。
CREATE TABLE IF NOT EXISTS showcase_item (
  id BIGSERIAL PRIMARY KEY,
  legacy_key VARCHAR(64) UNIQUE,
  title VARCHAR(160) NOT NULL,
  detail_html TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_object_name TEXT NOT NULL DEFAULT '',
  created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_showcase_item_created_at
  ON showcase_item (created_at DESC);

DROP TRIGGER IF EXISTS trg_showcase_item_updated_at ON showcase_item;
CREATE TRIGGER trg_showcase_item_updated_at
BEFORE UPDATE ON showcase_item
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 将原前端静态条目迁入数据库；重复执行不会覆盖页面中已编辑的数据。
INSERT INTO showcase_item (legacy_key, title, detail_html, image_url, created_by)
VALUES
  ('global-operations', '全域运行态势', '<p>统一观察数据库、网络与计算资源的实时健康状态，快速识别影响业务连续性的异常信号。</p>', '/assets/showcase/1.webp', 'system'),
  ('ticket-flow', '工单流转脉络', '<p>沿时间轴追踪问题从提出、分析到最终闭环的完整路径，让处理进度与责任关系清晰可见。</p>', '/assets/showcase/3.png', 'system'),
  ('risk-sensing', '风险感知中心', '<p>聚合告警、容量和变更信号，突出当前最值得关注的风险节点与潜在影响范围。</p>', '/assets/showcase/5.jpg', 'system'),
  ('capacity-forecast', '容量趋势预测', '<p>结合历史负载与增长趋势预测资源拐点，为扩容、调度和成本治理提供提前量。</p>', '/assets/showcase/6.png', 'system'),
  ('quality-graph', '质量改进图谱', '<p>将改进项、责任域、关联问题和闭环成效组织成可探索的质量关系图谱。</p>', '/assets/showcase/8.jpg', 'system'),
  ('oncall-network', '值班能量网络', '<p>展示当日值班力量、协同关系和关键岗位覆盖情况，帮助团队快速建立响应链路。</p>', '/assets/showcase/10.jpg', 'system'),
  ('ai-analytics', '智能分析引擎', '<p>把自然语言问题转化为数据检索、关联分析与可视化结果，缩短定位和决策时间。</p>', '/assets/showcase/13.png', 'system'),
  ('monthly-insight', '月度洞察报告', '<p>以空间化叙事浏览本月问题结构、处理效率、质量趋势和重点改进方向。</p>', '/assets/showcase/14.jpg', 'system'),
  ('release-tracking', '变更发布追踪', '<p>集中查看版本、补丁与发布窗口，追踪每次变更的执行状态、风险和回退准备。</p>', '/assets/showcase/15.png', 'system'),
  ('cost-analysis', '资源成本分析', '<p>从资源利用率、业务归属和增长趋势三个维度识别成本结构与优化机会。</p>', '/assets/showcase/16.png', 'system'),
  ('service-health', '服务健康画像', '<p>融合可用性、性能、告警和工单数据，形成面向服务的综合健康画像。</p>', '/assets/showcase/17.jpg', 'system'),
  ('incident-review', '事故复盘档案', '<p>沉淀事故时间线、根因、处置过程和改进措施，让经验可以被持续复用。</p>', '/assets/showcase/18.jpg', 'system')
ON CONFLICT (legacy_key) DO NOTHING;

COMMIT;
