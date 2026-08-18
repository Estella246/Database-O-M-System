# 测试和修改报告：在研责任田「田目录 + 节点关联」两层模型

> 任务：责任田树节点配置的在研责任田必须从参数配置-在研责任田现有条目中**下拉选择**，不得自由填写凭空新增；支持**多模块共田**；统计**按田合并**。
> 分支：`qi_analytic_improve`（待提交）；日期：2026-08-17。

## 1. 任务概述

- **改了什么**：`research_duty_field` 由「一行 = 田名+责任人+一个固定关联」改为两层模型——**田目录**（`research_duty_field`：id/name/owner/sort_order）+ **节点关联**（新表 `research_duty_field_binding`：field_id + (domain, module) 槽位，`ON DELETE CASCADE`）。
- **为什么改**：原结构下树节点弹窗名称/责任人均为自由文本，保存即凭空造田，违背「在研责任田必须来自参数配置」的口径；且 `(domain, module)` 唯一约束决定一个田只能挂一个范围，无法多模块共田。
- **目标**：树节点弹窗改为下拉选目录田；同一田可关联多个模块槽位；识别/接纳/超期/改进报告统计自动按田合并；参数页只管田（名称/责任人），关联只在树节点配、参数页只读展示。

## 2. 计划与评审记录

- **方案摘要**：迁移 0123 拆两表（存量自动搬迁、drop 旧列）；后端 `GET/PUT /api/params/research-duty-field`（带 id 全量替换）+ 新增 `PUT /api/params/research-duty-field/binding`（单槽位原子 upsert）；统计层 `_research_field_buckets` 每田一桶 + `_match_research_bucket` 桶×scope 匹配（模块优先、整领域兜底）；前端参数页去掉关联编辑、树弹窗改 select；m07/m20/m21/e2e/jest 同批改造。
- **评审轮次与结论**：1 轮计划评审（计划模式），经 1 次需求澄清（用户补充「不同模块可共田」）与 2 项 AskUserQuestion 确认（**按田合并统计**、**参数页只管田，关联只在树上配**）后，ExitPlanMode 一次通过。无方案级返工。
- **是否偏离**：无。实现与批准计划一致（`~/.claude/plans/abundant-inventing-micali.md`）。

## 3. 接口测试结果（阶段 3）

**`test/test_m07_params.py::TestResearchDutyField` 重写：14/14 通过**（完整文件 59 通过 + 5 个既有 non_admin 基线失败，为存量项、超出本任务范围，见 §7）。

| # | 用例 | 关键断言 | 结果 |
|---|------|---------|------|
| 1 | GET 目录 | items 含 id/name/owner/scopes | ✅ |
| 2 | PUT 全量往返（无 id=INSERT） | 响应回带新 id | ✅ |
| 3 | PUT id 语义三态 | 有 id=UPDATE 保 id 保关联；缺 id=DELETE 级联删关联；解除绑定为幂等 no-op | ✅ |
| 4 | PUT 空列表清空 | 目录+关联全清 | ✅ |
| 5 | PUT 空名称 400 | 「名称不能为空」 | ✅ |
| 6 | PUT 目录内名称重复 400 | API 层校验 | ✅ |
| 7 | PUT id 重复 400 | — | ✅ |
| 8 | PUT 条目不存在 400 | 「在研责任田条目不存在：{id}」 | ✅ |
| 9 | PUT 超长 400 | >256 | ✅ |
| 10 | PUT 普通人员 403 | 白名单 `params_research_duty_field` | ✅ |
| 11 | PUT /binding 往返 | 绑定/换绑/两模块共田/解除/幂等/整领域槽位 | ✅ |
| 12 | PUT /binding 校验 | domain 空 400、field_id 不存在 400、≤256 | ✅ |
| 13 | PUT /binding 普通人员 403 | 同白名单键 | ✅ |
| 14 | 表缺失 503 | GET/PUT/binding 503 带 0119+0123 提示；analytics 503「在研责任田表未就绪」 | ✅ |

补充：`test/e2e/test_e2e_qi_analytics_api_contract.py` 契约回归通过——`research_field_stats` 元素含 13 字段；两层模型新不变式：`module` 恒 `""`、`domain` 为非空合并文本（如 `D1/M1、D2（整领域）`）、分项超期 ≤ 分母。

## 4. 系统测试结果（阶段 4）

| 套件 | 结果 | 说明 |
|------|------|------|
| `test/test_m20_qi_workflow.py` 全量 | **119/119 ✅** | 含 TestQiAnalyticsResearchField（含新增 `test_rf_shared_field_merge` 共田合并）、TestQiRfStatsOverdueFields（双表 SQL 造数） |
| `test/test_m21_improvement_report.py` | **15/15 ✅** | 含新增 `TestImportSharedField::test_shared_field_merged_by_field`：两模块共田 → closed_by_field/overdue_new_by_field 按田合并、rf_accept_rate 100%、rf_overdue_rate 50% |
| `test/e2e/test_e2e_qi_research_field.py`（重写） | **14/14 ✅** | 参数页 CRUD/只读关联/权限、分析图表、树弹窗（下拉选择/整领域槽位/模块槽位/回显换绑/解除关联保田/两模块共田同名 badge/跨页一致性/权限隐藏） |
| e2e 回归（contract + params_page + ticket_qi_create） | **通过 ✅** | 32 项通过；center-title 2 项失败为 HEAD 既有（见 §7） |
| jest `research-duty-field-params.test.js`（新增） | **12/12 ✅** | scopeText 5 例 + rowFor 槽位谓词 5 例 + 源文件哨兵 2 例 |
| `test/e2e/test_qi_page_no_errors.py` 单独跑 | **4/4 ✅** | 页面无 JS 错误 |

**端到端关键证据**（阶段 2 冒烟 + 阶段 4 复核，本地演示库）：
- 树弹窗下拉选既有田（空选项「请选择在研责任田」，label `名称（责任人）`），责任人只读联动；目录为空时 select 禁用 + 引导文案 + 保存禁用；未选择保存 → alert 引导去参数配置。
- 同一田绑两个模块节点 → 两处 badge 同名；`/api/qi/analytics` 单桶合并（验证用例 `tree_two_modules_share_one_field` / `test_rf_shared_field_merge`）。
- 「解除关联」→ badge 消失、目录田与其它关联保留；参数页删田 → 级联删其全部关联。
- 演示数据终态（e2e bootstrap 覆盖夹具树后已恢复）：树 SQL引擎→[备份恢复， 主备切换， JDBC接口， ODBC]，badge「在研：备份恢复田/主备切换田/JDBC接口田/ODBC田」齐全，统计 total 4/2/3/3、「非」（整领域）0，页面无 JS 报错。

**回退记录**：无方案级回退。开发期修复（不触发回退规则的测试期前自检修正）：m07 503 用例重建 DDL 漏 trigger → 已补 `set_updated_at_0123`；m21 共田用例 `_seed_request` 硬编码 DOMAIN 导致 closed_count=0 → 加 `domain` kwarg 修正后通过。

## 5. 测试覆盖结果（对照改动清单逐项）

| 改动点 | 覆盖用例 |
|--------|---------|
| 迁移 0123（建表/存量搬迁/drop 列/trigger） | 本地手工执行 + m07-14 重建 DDL 一致性；503 用例覆盖表缺失分支 |
| GET 目录（含 scopes 排序） | m07-1、e2e 参数页 crud/readonly |
| PUT 全量替换 id 三态 + 级联 | m07-2/3/4/7/8、e2e crud（删除） |
| PUT 校验（空名/重名/超长/403） | m07-5/6/9/10 |
| PUT /binding upsert/解除/幂等/共田/校验/403 | m07-11/12/13、e2e tree_* 全场景、m20 `_put_rf_rows` 双写 |
| 表缺失 503（含 analytics） | m07-14 |
| `_research_field_buckets`（每田一桶） | m20 rf 聚合 + shared_field_merge、m21 报告合并 |
| `_match_research_bucket`（模块优先/整领域兜底/前缀匹配） | m20 `test_rf_first_hit_ordering`、rf_stats_aggregation（整领域）、前缀回归 |
| 桶聚合→stats 13 字段 + 超期率四分项 | m20 TestQiRfStatsOverdueFields、contract 契约不变式 |
| improvement_report 按田合并 | m21 test_shared_field_merged_by_field、overall rf 键控断言 |
| 前端参数页（编辑只留名称/责任人、只读 scopes 文本、空态） | e2e crud_flow/readonly_scope_text_and_edit_preserves_binding/edit_blocked_when_refresh_fails |
| 前端树弹窗（select/owner 只读/空目录/未选/解除/回显换绑） | e2e tree_modal_empty_catalog/…_unselected/…_whole_domain/…_module_slot/…_prefill_and_rebind/…_unbind_keeps_catalog |
| badge 渲染 + researchFieldRowFor 槽位谓词 | jest 12 例（含哨兵防源漂移）、e2e tree_two_modules_share_one_field、跨页一致性 |
| state.js（researchFieldNodeFieldId 等） | e2e 树弹窗全场景间接覆盖 |
| 白名单隐藏 | e2e tree_research_entry_hidden_by_whitelist、m07-10/13 |

**结论：改动清单无未覆盖项，缺口清零。**

## 6. 修改清单

**后端**
- `db/migrations/0123_research_duty_field_binding.sql`（新增）：binding 表 + 存量搬迁 + drop domain/module 列 + updated_at trigger。
- `backend/models/params.py`：`ResearchDutyFieldItem` 增 `id`、去 domain/module；新增 `ResearchDutyFieldBindingPayload`。
- `backend/routers/params.py`：GET 返回 scopes；PUT 改带 id 全量替换（增/改/删+级联、目录内名称唯一等校验）；新增 `PUT /api/params/research-duty-field/binding`（SELECT→UPDATE/INSERT/DELETE 保守写法，GaussDB 不用 ON CONFLICT 推断）。
- `backend/routers/qi.py`：`_research_field_buckets`/`_match_research_bucket` 改两表 JOIN 每田一桶；`research_field_stats` 响应 domain=合并文本、module=""；表缺失 503 提示含 0123。

**前端**
- `frontend/modules/pages/research-duty-field-params.js`：参数页编辑行只留名称+责任人+只读关联文本（去树选项懒加载）；树节点弹窗名称改 `<select>`（目录田下拉、owner 只读联动、空目录禁用引导、未选 alert）；保存/解除走 `/binding`；`researchFieldRowFor` 改 scopes 槽位匹配。
- `frontend/modules/state/state.js`：`researchFieldNodeFieldId` 等状态字段适配。

**测试**
- `test/test_m07_params.py`：TestResearchDutyField 重写（14 例）。
- `test/test_m20_qi_workflow.py`：rf 造数双写 + 共田合并 + 超期/过滤用例 rekey。
- `test/test_m21_improvement_report.py`：双表造数 + 新增共田报告合并用例。
- `test/e2e/test_e2e_qi_research_field.py`：全面重写（14 例）。
- `test/e2e/test_e2e_qi_analytics_api_contract.py`：两层模型契约断言。
- `test/frontend_tests/__tests__/research-duty-field-params.test.js`：新增（12 例）。

## 7. 遗留风险与后续事项

| # | 事项 | 影响闭环 |
|---|------|---------|
| 1 | **破坏性变更**：PUT 契约与表结构不兼容旧版（已盘点全部消费方同批改造，无遗漏）；回滚需手工 SQL 从 binding 回填并还原 0119 列结构 | 否（已验证） |
| 2 | **远程部署**：需在 0119→0122 之上**按序手工执行 0123**（`pytest_migration_applied` 不覆盖，同既往惯例） | 否（部署事项） |
| 3 | 目录名称唯一为 API 层校验（未加 DB 唯一索引，防存量重名迁移失败） | 否 |
| 4 | m07 存量 5 个 non_admin 基线失败、e2e center-title TC-01/TC-05 失败：经 HEAD worktree 取证均为**本任务之前已存在**（TC-05 为已提交的 h1 改名与断言不一致；TC-01 为 operator-name 脆弱断言），与本任务改动无关 | 否 |
| 5 | e2e bootstrap 会覆盖责任田树为夹具树——本地演示树已在测试后手工恢复并复核（badge/统计/无报错） | 否（已处理） |

**结论：阶段 3 接口测试 14/14 通过、阶段 4 系统测试全量通过、覆盖缺口清零，流程闭环。**
