# 第 2 轮审查修复：测试与修改报告

- **日期**：2026-08-18
- **分支**：`qi_analytic_improve`
- **任务**：修复第 2 轮 `/code-review` 全部 10 项发现（审查报告：`20260818-code-review-round2-qi-analytic-improve.md`）
- **流程**：ops-dev-workflow 5 阶段闭环（任务 #36-#40），第 1 轮修复报告见 `20260818-test-report-qi-review-fixes.md`

## 一、任务概述

第 1 轮修复提交审查后产出 10 项新发现（C1-C8 严重/一般项 + K1-K2 重复代码项）。用户决策「全部修复再提交」。本报告覆盖 10 项的修复实现、接口测试、系统测试与覆盖核对。

## 二、修复清单（10/10）

| 项 | 级别 | 问题 | 修复 |
|---|---|---|---|
| C1 | 严重 | `_load_stage_sla` 表行整表覆盖默认 SLA，缺行=无 SLA | 逐键合并 `{**QI_STAGE_SLA_HOURS, **table_rows}`，缺行回落代码默认值 |
| C2 | 严重 | 改进报告 8 端点无鉴权，深链可直达 | 后端全部加 `operator_id` Query + `_require_visible`（fail-closed：空/未知/默认 hidden → 403）；前端 normalize.js 映射 `report:improvement[-archive] → improvement_report` + 6 处 fetch 带 operator_id；迁移 0121 种管理员角色 |
| C3 | 一般 | accept-versions fetch 成功后仍合并静态兜底，管理员删除项复活 | fetch 成功=启用项全量权威，不合并静态；兜底仅初始渲染 + `.catch`；存量/遗留值缺失时追加 |
| C4 | 一般 | 下拉重建用 `dataset.currentValue`，覆盖用户进行中的选择 | `sel.value \|\| sel.dataset.currentValue`，用户选择优先 |
| C5 | 一般 | 月度闭环数=Σ桶计数，桶外闭环被丢 | `len(closed_rows)` 全量计数（与 YTD 同源），文案同步 |
| C6 | 一般 | `.req-table--full td` 通用截断被误删；内联空态 colspan 10≠表头 8 | 恢复通用 td 规则（nowrap+hidden+ellipsis）；`emptyCols = isInline ? 8 : 10` |
| C7 | 一般 | e2e conftest 裸吞一切「server responded with status of」 | 改 (文本, URL 子串) 二元组，仅放行 `/api/params/research-duty-field`（用例故意 500） |
| C8 | 一般 | app.js h1 缺改进报告分支，深链标题空白 | 追加 `isReportImprovement ? "报告生成" : isReportImprovementArchive ? "报告归档"` |
| K1 | 重复 | 报告生命周期/研究田聚合/年月工具三处重复 | ① `report_lifecycle.py`：ReportSpec 参数化 8 端点生命周期，improvement/monthly 两路由委托；② `qi_research_field.py`：buckets/match/scope_text + 共享 `module_window_counts`；③ 改进报告页复用月报页 `currentYm`/`ymToTitle`（后缀参数化） |
| K2 | 重复 | 处理人 SQL 大小写分支两处维护 | `_HANDLER_CASE_SQL` 单一来源 |

## 三、计划与评审记录

- 计划：10 项修复方案 + 测试策略，AskUserQuestion 提交审批 → 用户选「通过，开始开发（推荐）」。
- 偏离：无。C2 范围纪律——月报后端本就无鉴权（审查仅点名改进报告），不擅自扩面。

## 四、接口测试结果（阶段 3）

**后端批**（`test_m20_qi_workflow / test_m14_monthly_report / test_m21_improvement_report / test_m21_qi_list_filters / test_ticket_assistant`）：
**415 passed, 7 skipped**（较上轮 +2：C1/C5 定向用例）。

**前端 jest 全量**：**779 passed / 0 failed**（100 suite 中 17 个 suite 级失败为既有 node:test 误收集，`node --test` 单独验证；本轮新增 C6 哨兵 suite +2 用例）。

**node --test（8→9 个 .mjs 套件）**：**32 passed / 0 failed**（新增 normalize 映射回归 +2）。

**本轮新增/改写的接口用例**：
- C1：`TestQiOverdueUnified::test_stage_sla_missing_rows_fall_back_to_code_defaults`（删 analysis/closure 配置行、保留其余行——证明逐键而非整表回落；100h 卡分析阶段 → 72h 默认判超期）。
- C5：`TestImportOverview::test_overview_closed_count_counts_unbucketed`（桶外领域/模块的闭环单计入 closed_count=2、closed_by_field 仍按桶=1、文案「新增闭环诉求2条」）。
- C2：`test_hidden_operator_forbidden_all_endpoints`（7 端点 × {test_user01, 空} → 403）；本轮修 3 处 httpx `params=` 覆盖路径查询串的坑（params 会替换 URL 上已有 query，须全部走 `params={"operator_id", "status"}`）。
- K1：m14/m21 既有生命周期用例双路由等价回归全绿。

## 五、系统测试结果（阶段 4）

| 批次 | 文件 | 结果 |
|---|---|---|
| 改进报告+解决版本 | test_e2e_improvement_report / test_e2e_qi_closure_version | **15 passed** |
| 工单关联改进 | test_e2e_ticket_qi_create | **7 passed** |
| qi 回归六件套 | acceptance / analytics_api_contract / bar_inline_zoom / config / others_muted / zoom_full | **34 passed** |
| 页面无错（单独跑） | test_qi_page_no_errors | **4 passed** |

**运行态鉴权矩阵**（uvicorn 8000 实测）：`GET /{ym}`、`GET /{ym}/import/overview`、`GET /api/improvement-report`（精确路径）均为 admin=200 / 空账号=403 / 未知账号=403 / test_user01=403，403 detail=「无改进报告权限（improvement_report 隐藏）」。
（注：尾斜杠/不存在路径返回 200 是 SPA index.html 兜底，不返回任何数据，非鉴权漏洞。）

**演示数据基线**（e2e 全量跑完后核验）：qi_request 非 draft 总数=529（DENSE 529 全在）、E2E/TEST 残留=0；kpi 529/113/3；research_field_stats 5 桶 [4,2,3,3,0]（第 5 桶「非」=0 为既有口径）。

## 六、覆盖核对（改动清单 × 用例）

| 改动 | 覆盖用例 |
|---|---|
| C1 逐键 SLA 回落 | m20 新增定向用例（缺行配置+其余行保留） |
| C2 后端 403 ×8 | m21 forbidden 全端点用例 + 运行态矩阵实测 |
| C2 前端映射/带参 | node:test `get-whitelist-key-by-active-key.regression.mjs` + e2e 普通用户菜单/深链重定向 + 页面 fetch 带 operator_id（15 用例内） |
| C3 权威选项 | e2e `test_closure_accept_version_fetch_success_is_authoritative`（route-mock 单启用项+停用项 → 选项恰为 `["", "E2E-ONLY-9.9"]`）+ 既有存量值/静态兜底两用例 |
| C4 用户选择优先 | jest 哨兵 `const saved = sel.value \|\| sel.dataset.currentValue \|\| ""` + e2e 存量值选中 |
| C5 全量闭环数 | m21 unbucketed 定向用例 |
| C6 截断/colspan | jest `req-table-full-cell-truncation.test.js`（CSS 规则+`isInline ? 8 : 10` 哨兵）+ e2e `test_inline_qi_list_empty_state_colspan_matches_header`（空态 colspan=th=8） |
| C7 错误白名单收窄 | e2e conftest 生效于上述全部 60 用例（assert_no_js_errors 不再吞真实 4xx/5xx） |
| C8 h1 分支 | e2e `test_admin_deep_link_h1_titles`（报告生成/报告归档）+ 普通用户深链不停留 |
| K1 三处去重 | m14/m21 生命周期等价回归 + jest `ymToTitleShared(ym, "改进报告")` 哨兵 + m20 聚合基线（rf [4,2,3,3,0]） |
| K2 SQL 单源 | m20 处理人聚合既有用例全绿 |

覆盖缺口处理：初审出 3 处缺口（C1/C5 定向用例、C6 哨兵、normalize 映射）全部补齐并跑通，终态无未覆盖改动。

## 七、回退与失败记录（如实）

1. **阶段 3 首轮 2 失败**：m21 status 过滤用例 403——httpx `params=` 替换而非合并 URL 查询串致 operator_id 丢失；另 1 处漏加 `?{OPQ}`。修测试后全量重跑至 413→415 全绿。
2. **阶段 4 首轮 1 失败**：`test_archive_page_lists_archived`——用例 API 造数未带 operator_id 被 C2 正确 403 拦截（预期行为的正向证明）；补 `?operator_id=test_admin` 后重跑 15 全绿。
3. **新增 C6 e2e 首跑超时**：内联表格在折叠区块内不可见，`wait_for_selector` 改 `state="attached"`（结构断言）后通过。
4. **误杀 dev server**：冒烟后 pkill uvicorn 8000 导致阶段 3 复跑 422 个连接拒绝 ERROR；重启后 415 全绿（重跑记录）。
5. 曾发生 1 次测试文件改写事故（python one-liner 误伤 m21 文件，`git checkout --` 对未跟踪文件无效），已用纯字面替换修复并在阶段 3 全量验证。

## 八、修改清单

**后端**：`qi.py`（C1 SLA 合并、analytics 复用共享聚合、accept-versions 无改动）、`improvement_report.py`（C2 鉴权、C5 计数、K1 委托）、`monthly_report.py`（K1 委托）、新增 `report_lifecycle.py` / `qi_research_field.py`（K1）、`db/migrations/0121_*`（角色种子）。
**前端**：`qi-page.js`（C3/C4）、`improvement-report-page.js`（C2 带参、K1 复用）、`monthly-report-page.js`（ymToTitle 后缀参数）、`normalize.js`（C2 映射）、`ticket-page.js`（C6）、`app.js`（C8）、`requirement.css`（C6）。
**测试**：`test_m20_qi_workflow.py`、`test_m21_improvement_report.py`、`test/e2e/conftest.py`（C7）、`test_e2e_improvement_report.py`（h1 用例+种子鉴权）、`test_e2e_qi_closure_version.py`（权威选项用例）、`test_e2e_ticket_qi_create.py`（空态 colspan 用例）、jest `qi-bar-labels-and-version-fallback` / `improvement-report-page` / 新增 `req-table-full-cell-truncation`、node:test 新增 `get-whitelist-key-by-active-key.regression.mjs`。

## 九、遗留风险

- 月报路由（monthly_report）仍无鉴权——审查未点名，按范围纪律未扩面；建议列入下轮。
- jest 17 个 suite 级误收集失败为存量现象（用例 0 失败，node --test 验证通过），建议后续在 jest 配置排除 `*.mjs`。
- 以上均不影响本次闭环。
