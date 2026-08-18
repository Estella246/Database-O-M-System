# Code Review 报告（第 2 轮）：qi_analytic_improve 未提交工作树

- 日期：2026-08-18
- 审查方式：/code-review（high effort，7 角度 finder + 逐项验证）
- 范围：`git diff HEAD`（49 文件，~3.5k 行）+ 未跟踪新文件（improvement-report 模块、research-duty-field 参数页、迁移 0119–0123）；36 个未推提交作背景
- 结论：**10 项发现**（8 正确性 + 2 高价值清理），开发者决定「全部修复再提交」

## 发现清单

### 正确性（8）

**C1（严重）SLA 部分迁移环境超期检测静默失效** — `backend/routers/qi.py:1244`
`_load_stage_sla` 仅在整表缺失（UndefinedTable）时回退代码默认值；仅跑 0105（只有 propose/review/acceptance 行）未跑 0122 的库里，analysis/closure 无行 → 永不超期。sla_time 退役后无第二来源，60 天滞留单 `is_overdue=false`、analytics overtime=0、报告同样失真，且无 503/自愈。
**修复方向**：按 key 合并默认值（`{**QI_STAGE_SLA_HOURS, **表内行}`）——行存在（含 hours=0 显式停用）以表为准，缺行补默认，整表缺失全默认。

**C2 improvement-report 权限缺口** — `frontend/modules/utils/normalize.js:226` + `backend/routers/improvement_report.py`
前端 `getWhitelistKeyByActiveKey` 无 `improvement_report` 映射（monthly 的 report:* 已映射）→ 深链 `/report/improvement` 被当「永远可见」；后端全部端点无白名单校验，默认隐藏策略（PERMISSION_DEFAULT_HIDDEN_KEYS + 0121）只挡菜单。
**修复方向**：对齐 monthly_report 的前后端双校验模式。

**C3 管理员删除的版本被静态兜底复活** — `frontend/modules/pages/qi-page.js:1206`
fetch 成功后兜底把配置不知道的版本加回：管理员全量替换删掉 507.0 → 兜底重新提供 → 提交必 400「不在可选项中」。known 去重只挡「禁用」挡不住「删除」。
**修复方向**：fetch **成功**时以配置为准、不再合并兜底（兜底仅用于渲染期静态值与 fetch 失败路径）；0122 未迁移环境由 `_ensure_accept_version_table` 服务端自愈种子兜底。

**C4 fetch 迟到覆盖用户正在选的值** — `frontend/modules/pages/qi-page.js:1210`
异步重建用渲染时 `data-current-value` 而非 select 当前值：慢网络下用户已选 508.0 被 fetch 回包重置为 '--' 或回滚存量值 → 提交 400 或存错版本。
**修复方向**：重建取值改为 `sel.value || dataset.currentValue`，用户当前选择优先。

**C5 报告内两套闭环口径** — `backend/routers/improvement_report.py:327`
概览导入的月度「新增闭环诉求N条」与 `month.closed_count` = Σ`closed_by_field`（仅责任田桶内），同期 YTD 已实施闭环却按全量数——同报告两个分母。
**修复方向**：月度闭环数与 YTD 同源（全量当月闭环数）。

**C6 通用 td 省略号规则删除后未覆盖无 req-col 类表格** — `frontend/styles/requirement.css:10`
`.req-table--full td` 的 overflow:hidden/ellipsis 被删只补了 `.req-col-description`；工单详情两处关联改进表（ticket-page.js:3176 内联 / :4035 非内联，纯 th 无 req-col）fixed+nowrap 下长标题溢出压列。
**修复方向**：恢复通用截断或给两表补类（待调研后定）。

**C7 e2e 控制台护栏被削弱** — `test/e2e/conftest.py:24`
新增忽略模式 `'the server responded with a status of'` 无 URL 限定，全 e2e 吞掉一切 4xx/5xx 资源报错；真实回归（如 accept-versions 500 静默回落静态默认）不再被 assert_no_js_errors 抓住。
**修复方向**：忽略规则带 URL 限定（仅故意 route.fulfill 500 的用例路径）。

**C8 改进报告页 h1 空白** — `frontend/app.js:982`
isReport 扩展纳入 `report:improvement`/`report:improvement-archive`，但标题三元链无对应分支落到空串 → 标题行空白。
**修复方向**：补两个分支（与月度报告同文案「报告生成/报告归档」）。

### 清理（2）

**K1 improvement-report 整体 clone monthly-report** — `backend/routers/improvement_report.py:58`
路由 ~150 行 CRUD/归档/404/409 生命周期（:631-777）、前端页面 63%（含重复声明 monthly-report-page.js 已导出的 currentYm/ymToTitle、重declare 饼图构建）、~70 行复制 qi_analytics 责任田聚合。副本已漂移（buildPieOption 丢横条分支、_kv_sorted 多 filter）→ 同月数据两处口径分叉。
**修复方向**：抽共享（路由生命周期 helper、页面复用导出、`research_field_window_stats` 共享聚合）。

**K2 处理人 CASE SQL 三处复制** — `backend/routers/qi.py:1605`（另 :289、improvement_report.py:163）
analysis/closure→最新 responsible、acceptance→COALESCE(最新非空 acceptance.responsible, proposer)、review→reviewer、propose→proposer 的 CASE 在 list/analytics/report 三处手抄；本次验收分支已被迫三处同改，下次漏改即静默错归人。
**修复方向**：CASE 表达式定义一次（improvement_report._HANDLER_CASE 文本即准），三查询插值复用。

### 已确认但被 10 项上限截掉（记档）
- ticket-page.js:4038 `emptyCols=11` vs 10 列表头
- qi-page.js 图例滚轮后首次 click 被吞（__qiLegendHit）
- qi-page.js ECharts 挂载/聚合代码三重复
- params.py:238 与 qi.py:1344 责任田 loader 重复
- qi_analytics 无阶段筛选时全窗口查询冗余
