# 测试与修改报告：code-review 10 项发现修复（qi_analytic_improve）

- 日期：2026-08-18
- 分支：`qi_analytic_improve`（推 `thd:qi_analytic_improve`）
- 上游输入：`docs/reports/20260818-code-review-qi-analytic-improve.md`（10 项 CONFIRMED 发现）
- 流程：ops-dev-workflow 五阶段闭环（本报告为阶段 5 产出）

## 1. 任务概述

修复 code-review 确认的 10 项问题：S1 阶段 SLA 全量 DELETE 重插、H1 验收阶段处理人不一致、V1 accept-version DDL 双份/种子缺失/排序冲突/静默跳过校验、V2 解决版本必填 select 无静态兜底且吞错、S2 sla_time 死字段彻底退役、R4 `_strip_html` 无实体反转义、Q1 柱状图数值标签与 aria 死参、Q4 tooltip e2e 覆盖缺失、F3 `_load_stage_sla` 连接错位、F2 improvement_report 重复查询与 N+1。

## 2. 计划与评审记录

- 评审轮次：**1 轮通过，无修订**。方案（10 项逐条改法 + S2 方向）经 AskUserQuestion 获开发者明确批准：「通过，开始开发（推荐）」；S2 处置方向：「彻底退役（推荐）」。
- 实现与方案的偏离：无方向性偏离；过程中按测试反馈做了 4 处实现级修正（见 §3 回退记录），均属实现细节修正而非方案变更。

## 3. 回退记录（如实）

接口/系统测试期间共 4 次回到阶段 2 修正实现，每次均从阶段 3 起重跑全部接口测试：

| # | 现象 | 根因 | 修正 |
|---|------|------|------|
| R1 | `TestQiAcceptVersionConfig` 3 例 500：`'Connection' object has no attribute 'executemany'` | psycopg3 Connection 无 executemany | 改逐条 `execute` 种子（3 行） |
| R2 | 自愈用例后表仍缺失：`SELECT COUNT(*) … UndefinedTable` | 建表+种子发生在 submit 请求事务内，校验 400 回滚连带回滚 DDL | `_ensure_accept_version_table()` 改**独立连接**自建自提交（含 DuplicateTable 并发竞争防护），GET/POST/submit 三处调用方解耦 |
| R3 | jest：禁用版本 507.1 被静态兜底复活 | 兜底去重只看「启用项」 | qi-page 合并改按 `known`（全部已知版本）去重：兜底只补配置完全不知道的版本，管理员禁用意图优先 |
| R4 | e2e：存量值为空时 select 显示 507.0 而非「--」 | 初始渲染无空选项，未选值静默回落首个种子 | accept_version 增加 `empty_option: true`，两处渲染器初始即带「--」（与 fetch 合并后状态一致；fetch 失败时也不会静默替用户选中） |

另有 2 处**测试基建**修正（非代码缺陷，不触发回退）：
- `test_m21_qi_list_filters.py` 三处造数仍用已退役的 `sla_time` 造超期 → 改 `started_at` 回拨 400h 口径（与 m20 同惯用法）；
- 同文件 `_list` helper `page_size=50` 被本地 DENSE 演示数据（529 条、优先级排序高中在前）挤出低优先级 TEST-FILTER 记录 → 改翻页收集全量（≤32 页）+ 「矛盾筛选」用例改断言本批记录为空。该污染与代码版本无关（ORDER BY 子句本次未改，属既有环境问题）。

另修复 2 处 e2e 用例自身缺陷：tooltip 用例三处选择器不一致（hover 饼图画布死区 / showTip 打柱图 / 文本读首个 host）→ 统一锚定 `#qi-analytics-echart-domain-bar`，hover 落点改画布 1/4 宽（首柱带中心）。

## 4. 接口测试结果（阶段 3）

命令：`PYTEST_SKIP_AUTO_MIGRATE=1 backend/.venv/bin/python -m pytest <files>`（对运行中 uvicorn :8000）

| 文件 | 结果 |
|------|------|
| test/test_m20_qi_workflow.py（含新增 TestQiAcceptVersionConfig 11 例、部分 payload 保种子、验收处理人 COALESCE 等） | 全部通过 |
| test/test_m21_improvement_report.py | 全部通过 |
| test/test_m21_qi_list_filters.py（重写造数口径后） | 全部通过 |
| test/test_ticket_assistant.py（含新增实体反转义用例） | 全部通过 |
| **合计** | **386 passed, 7 skipped, 0 failed** |

前端（`test/frontend_tests` 目录 `node node_modules/jest/bin/jest.js`）：
- 定向批次（stats-helpers / qi-bar-labels-and-version-fallback / improvement-report-pie / monthly-report-page）：**168 passed**；
- 全量 jest：**777 passed, 0 failed**（17 个套件为 `node:test` 风格文件被 jest 误收集、环境缺 jsdom——既有情况，与本次改动无关；其中 2 个动态 import ticket-page.js 的套件已用 `node --test` 单独验证：4+4 全过）。

关键证据摘录：
- `GET /api/qi?operator_id=admin` → `total:529`，所有 item 无 `sla_time` 键；`DENSE-RF-A2`（acceptance）`current_handler="张伟 zhangwei"`（stage.responsible 生效）；
- `GET /api/qi/config/accept-versions` → `[507.0, 507.1, 508.0]`，`sort_order=[1,2,3]`（DROP 后自愈复现验证）；
- submit 校验 400 后表仍存在且 ≥3 行（R2 修复的直接断言）。

## 5. 系统测试结果（阶段 4）

e2e（Playwright，`PYTEST_SKIP_AUTO_MIGRATE=1`）分批执行，最终全部通过：

| 批次 | 文件 | 结果 |
|------|------|------|
| 1 | qi_config + qi_closure_version + analytics_api_contract | 30 例（初跑 28 过 2 挂→修正后全过） |
| 2 | qi_config + qi_acceptance + qi_amend_render + qi_create_required + qi_one_chart_per_card + qi_others_muted + qi_preset_seg | 36 passed |
| 3 | qi_bar_inline_zoom + qi_zoom_full + qi_research_field + improvement_report | 29 passed |
| 4 | ticket_detail + ticket_qi_create + ticket_workflow + ticket_workflow_extended | 63 passed |
| 5 | test_qi_page_no_errors.py（单独跑） | 4 passed |

环境完整性核验：DENSE 演示数据 529 条在；责任田 5 田 5 绑定在（rf_guard 全量替换恢复，id 随之刷新，属预期）；`/api/qi/analytics` 责任田桶基线 **4/2/3/3/0** 与基线一致（第 5 桶「非」= 整领域绑定 0 单桶，为基线组成部分）。

## 6. 覆盖核对（改动清单 × 用例映射，缺口=0）

| 发现 | 改动 | 覆盖用例 |
|------|------|----------|
| S1 | `set_stage_sla_config` 全量 DELETE 重插 → 合并 upsert（hours=0 显式停用） | m20 `test_stage_sla_partial_payload_keeps_unsent_stages`（未提交阶段种子保留 72/336） |
| H1 | 列表/analytics/`_verify_current_handler` 统一 COALESCE(最新非空 acceptance.responsible, proposer) | m20 `test_acceptance_list_handler_uses_stage_responsible`（未指派→proposer；转办→被转让人）+ 冒烟 DENSE-RF-A2 |
| V1 | DDL 收敛 `_ensure_accept_version_table`；信息库预检区分「新建则种子」vs「存在不补种」；sort_order 1 起；submit 前自愈不再静默跳过校验 | m20 `TestQiAcceptVersionConfig` 11 例（含 DROP→GET 复种、sort [1,2,3]、DROP→submit 400+表存续、closure 免 sla_time 提交）+ e2e closure_version 3 例 |
| V2 | `QI_ACCEPT_VERSION_FALLBACK` 静态兜底；`.catch` 显式 warn；合并按 known 去重（禁用不复活）；`empty_option` 初始「--」 | jest（纯函数 4 例 + 源哨兵 6 例）+ e2e `test_closure_accept_version_static_fallback_on_fetch_fail`（route.abort→3 种子渲染）、`test_closure_accept_version_empty_option_exists` |
| S2 | sla_time 全链路退役：表单/校验/列表/导出/详情列/参数页提示 | m20（`"sla_time" not in items`、导出无「SLA时间」列、免填提交）+ m21 造数重写 + jest 源哨兵（3 文件无残留）+ ticket e2e（详情表头）|
| R4 | `_strip_html` 复用 `strip_html_plain`（实体反转义） | `test_strip_html_unescapes_entities`（&amp;/&nbsp;/&lt;br/&gt; + 标题截取） |
| Q1 | `buildStatsLaborEchartBarOption` 支持 `showValues`（>0 才标）+ `aria.label.description`；qi 四图与放大弹窗传参 | jest stats-helpers（默认关/showValues 开/aria 映射/0 值留空）+ e2e `test_qi_analytics_bars_show_value_labels_and_aria`（3 图 getOption 断言） |
| Q4 | tooltip e2e 重写（真实 hover + showTip 兜底，锚点统一） | e2e `test_bar_hover_shows_tooltip`（tooltip DOM 文本非空且含数字） |
| F3 | `_load_stage_sla(_conn)` 尊重调用方连接；list 调用点移入 with 块（修复暴露的连接错位） | 全部 /api/qi、analytics、improvement-report 用例隐式覆盖（回归期 0 例连接错误） |
| F2 | `_module_window_counts` 单查询复用；inflight/buckets 请求内去重传参；_compute_domain Python 聚合替代 N+1 | test_m21_improvement_report 全量 + e2e improvement_report + 冒烟 overall rf rows=5 |

## 7. 修改清单

后端：
- `backend/routers/qi.py`：S1 合并语义；H1 COALESCE；V1 `_ACCEPT_VERSION_SEEDS`/`_ensure_accept_version_table()`（独立连接自愈）；submit 校验接入；导出列删 SLA时间；`_load_stage_sla(_conn)` 尊重传入连接 + list 调用点入 with；`_compute_overdue` 文档更新
- `backend/qi_config.py`：closure 字段表删 sla_time
- `backend/routers/ticket_assistant.py`：`_strip_html` → `utils.html_text.strip_html_plain`
- `backend/routers/improvement_report.py`：F2（`_module_window_counts`/`_rf_rates(conn=…, buckets=, inflight=)`/`_compute_domain` Python 聚合）

前端：
- `frontend/modules/constants/qi.js`：`QI_ACCEPT_VERSION_FALLBACK` + accept_version `empty_option: true` + 删 sla_time 字段
- `frontend/modules/pages/qi-page.js`：fetch 合并（known 去重 + warn）；两处渲染器 `empty_option`「--」；四图/放大传 `showValues:true` + aria
- `frontend/modules/pages/stats.js`：`buildStatsLaborEchartBarOption` showValues/aria/grid.top 自适应
- `frontend/modules/pages/ticket-page.js`：删 SLA时间 列
- `frontend/modules/pages/params-page.js`：阶段 SLA 提示措辞（sla_time 已退役）

测试：
- `test/test_m20_qi_workflow.py`：适配 + 新增 3 组用例
- `test/test_m21_qi_list_filters.py`：造数改 started_at 口径、`_list` 翻页抗污染、矛盾筛选用例调整
- `test/test_ticket_assistant.py`：新增实体反转义用例
- `test/frontend_tests/__tests__/stats-helpers.test.js`：同步新实现 + 4 新例
- `test/frontend_tests/__tests__/qi-bar-labels-and-version-fallback.test.js`：新增（哨兵 + 纯函数）
- `test/e2e/test_e2e_qi_config.py`：hint 断言更新、新增数值标签/aria 用例、tooltip 用例重写
- `test/e2e/test_e2e_qi_closure_version.py`：新增 fetch 失败静态兜底用例

## 8. 遗留风险与后续事项

1. **远程部署**：无新迁移（V1 种子为运行时自愈）；远端需按序补 0119→0123 后再发本版代码（既有事项，不影响本次闭环）。
2. **jest 全量中 17 个套件**为 `node:test` 风格被 jest 误收集（缺 jsdom/ESM），属既有环境项；相关 2 套已用 `node --test` 验证通过。
3. **V2 语义微调**：管理员禁用的版本不再被静态兜底复活（配置意图优先）；如需「兜底永远提供种子」旧行为需另评审。
4. 提交前另需按惯例执行 `/code-review`（high effort）审查本轮修复 diff（需开发者手动触发）。

**闭环结论**：计划评审通过（1 轮）+ 接口测试全通过（386/7s + jest 777）+ 系统测试全通过（e2e 162 例）+ 覆盖缺口清零 + 本报告输出 —— 五阶段闭环成立。
