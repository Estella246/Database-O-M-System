BEGIN;

-- GaussDB 大事件本地演示数据；可重复执行，不进入正式迁移链。
INSERT INTO showcase_item (
  legacy_key, title, detail_html, image_url, image_object_name, created_by
)
VALUES
  (
    'local-demo-core-switch',
    '核心业务切换保障',
    '<h3>核心业务切换保障</h3><p>在变更窗口内完成主备状态核验、业务流量切换与关键指标观察，保障核心交易平稳迁移。</p><ul><li>切换前完成容量与复制状态检查</li><li>切换后持续观察性能、告警与业务成功率</li></ul>',
    '/assets/showcase/1.webp',
    '',
    'local-demo'
  ),
  (
    'local-demo-drill',
    '跨地域容灾演练',
    '<h3>跨地域容灾演练</h3><p>围绕数据库故障切换、应用重连和数据一致性开展联合演练，验证跨地域恢复链路。</p><ul><li>关键恢复步骤全部按预案完成</li><li>演练结论与改进项进入闭环跟踪</li></ul>',
    '/assets/showcase/3.png',
    '',
    'local-demo'
  ),
  (
    'local-demo-incident',
    '重大故障快速闭环',
    '<h3>重大故障快速闭环</h3><p>通过统一指挥、并行定位与分层止损快速恢复业务，并沉淀根因、时间线和预防措施。</p><ul><li>故障影响得到快速控制</li><li>复盘措施明确责任人与完成时间</li></ul>',
    '/assets/showcase/5.jpg',
    '',
    'local-demo'
  )
ON CONFLICT (legacy_key) DO UPDATE SET
  title = EXCLUDED.title,
  detail_html = EXCLUDED.detail_html,
  image_url = EXCLUDED.image_url,
  updated_at = NOW();

COMMIT;
