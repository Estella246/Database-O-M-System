# 三级以下节点支持配置在研责任田：测试与修改报告

- **日期**：2026-08-18
- **分支**：`qi_analytic_improve`（基于 `b2949eb`）
- **任务**：责任田配置中，三级及以下节点无法配置在研责任田（「在研」按钮只出现在一、二级）
- **流程**：ops-dev-workflow 5 阶段闭环（任务 #46-#50）

## 一、任务概述

责任田树的「在研」按钮原仅在一級（整领域槽位）与二级（模块槽位）渲染，深度 ≥ 2 的节点既不渲染按钮、
点击路径也会被拒绝，导致三级以下无法配置在研责任田。本次放开到**任意层级**：深节点槽位口径为
**领域 = 一级（根）标签，模块 = 二级起至该节点的标签按 `/` 连接**（如三级节点 C（A>B>C）→ `(A, "B/C")`），
与 qi 单 `module_feature` 的存储格式（不含领域前缀的模块路径）严格对齐。**纯前端改动，后端/统计/表结构零改动**。

## 二、计划与评审记录

- 调研结论（阶段 1）：两道门导致不可配——渲染门 `ticket-page.js:1140` 的 `depth <= 1` 与点击门 `:1313` 的
  `parts.length > 2` 拒绝；后端 `PUT /api/params/research-duty-field/binding` 本就接受任意 (domain ≤256, module ≤256
  含 `/`)，`match_research_bucket` 前缀匹配天然支持多段模块，`research_scope_text`/弹窗 scope 文本直接可显示多段路径。
- AskUserQuestion 单轮评审：方案（纯前端放开、槽位口径如上、后端零改动、m07 补 1 条契约用例、e2e 改 1 条 + 新增 2 条）
  获批（选项「通过，开始开发」）；未选择「角标级联显示」变体（角标保持精确槽位匹配，父级绑定靠统计侧前缀匹配生效，
  与既有口径一致）。无偏离。

## 三、修改清单

| 文件 | 变更 |
|---|---|
| `frontend/modules/pages/ticket-page.js` | ① `renderDutyFieldTreeInnerHtml`：第 4 参 `parentLabel`（仅父标签）改为槽位上下文 `slot={domain, modulePath[]}` 递归下传；渲染门 `depth <= 1` 删除 → 任意层级出按钮（深度 0/1 的 domain/module 推导值与旧逻辑逐字一致）。② 「在研」点击 handler：删 `parts.length > 2` 拒绝；领域=parts[0] 节点标签，模块=parts[1..] 标签按 `/` 连接（一级为空=整领域），保留 `if (!domain) return;` |
| `test/test_m07_params.py` | 新增 `test_tc_m07_research_duty_field_binding_deep_module_path`：多段模块路径（`模块/特性/子项`）绑定/回读/与同前缀浅槽位互不冲突/解除，锁定深度绑定契约 |
| `test/e2e/test_e2e_qi_research_field.py` | ① `test_tree_module_node_binds_module_slot`：原「深度 2 不出按钮」断言反转为出按钮 + 弹窗锁定 `领域A／模块 A1/特性X` + 深度槽位独立落库 + 角标；② 新增 `test_tree_deep_node_level4_bind_and_unbind`（四级节点：三段模块路径绑定/角标/解除/田保留）；③ 新增 `test_research_deep_module_binding_attribution`（深度槽位统计归因：精确+前缀两单归田、更浅路径不误吞） |
| `test/e2e/conftest.py` | **存量基建修复**（与本任务改动无因果、由本轮系统测试暴露）：Chromium「Failed to load resource」console 消息的 `location.url` 为 None，URL 限定白名单（`/api/params/research-duty-field` 500 放行）永远匹配不上 → `test_edit_blocked_when_refresh_fails` 在 HEAD 上即确定性失败（已用 stash 验证）。新增 `failed_response_urls` fixture 记录 4xx/5xx 响应 URL，`assert_no_js_errors` 对无 location 的 console 消息用其兜底归因；`collect_js_errors` 的 list 契约不变（多个用例直接迭代） |

## 四、接口测试结果（阶段 3）

- `test_m07_params.py -k research_duty_field`：**15 passed**（14 既有 + 1 新增，全通过）。
- `test_m07_params.py` 全量：**60 passed / 5 failed**——5 个失败均为既有 `non_admin_rejected` 基线项
  （duty-field tree / baseline / hotfix / group-template / issue-root-cause，与本改动无关，此前轮次已记录在案）。
- 关键证据：新增用例三段路径 `E2E研模块A1/E2E研特性X/E2E研子项Y` 绑定 200、GET 回读 scopes 一致、
  与浅槽位 `E2E研模块A1` 各占 BTRIM 唯一键互不冲突、解除仅移除该槽位。

## 五、系统测试结果（阶段 4）

- `test/e2e/test_e2e_qi_research_field.py`：**16 passed / 0 failed**（3 参数页 + 4 分析图 + 9 树入口，含 2 个新增用例）。
- `test/e2e/test_e2e_params_page.py`（conftest 共享基建回归）：**14 passed**。
- `test/e2e/test_qi_page_no_errors.py`（按规则单独跑）：**4 passed**。
- jest 全量（`test/frontend_tests`）：**788 passed / 0 failed**。
- 关键证据：四级节点弹窗 scope 显示 `E2E研模块A1/E2E研特性X/E2E研子项Y`；落库 scopes 与树路径一致；
  归因用例接纳率 2/2=100%（若浅路径 `E2E研模块A1` 被误吞则为 2/3=67，反证前缀匹配不向上误吞）。

## 六、测试覆盖核对（改动清单逐项）

| 改动点 | 覆盖用例 |
|---|---|
| 渲染门放开（任意层级出按钮）| 深度 0/1：`test_tree_domain_node_binds_whole_domain_slot`、`test_tree_module_node_binds_module_slot`（既有，回归通过）；深度 2：同用例翻转断言；深度 3：`test_tree_deep_node_level4_bind_and_unbind` |
| slot 递归下传（modulePath 拼接）| 深度 2/3/4 弹窗 scope 文本 + 落库 scopes 断言（渲染与点击两侧推导一致性由同一断言锁死）|
| 点击门放开 + 路径→槽位推导 | `_open_research_modal(page, "0.0.0")` / `("0.0.0.0")` 的 scope 断言；空领域守卫为既有分支未改动 |
| 深度绑定统计归因 | `test_research_deep_module_binding_attribution`（精确/前缀命中、浅路径不误吞）|
| 多段模块 binding 契约 | m07 新增用例（绑定/互不冲突/解除）|
| conftest `failed_response_urls` 兜底归因 | `test_edit_blocked_when_refresh_fails`（由红转绿）+ params page 14 用例（`assert_no_js_errors` 广谱回归）|

**覆盖缺口：无。**

## 七、遗留风险与后续事项

- conftest 兜底归因在「同一页面存在多个不同 4xx/5xx 响应」时按白名单子串宽松匹配（无 location 的消息可能被
  误放行到同页其它失败 URL）——影响面仅测试过滤宽松度，不影响产品代码；如需精确归因可后续按请求时序对齐。
- 极深树（层级很多）时多段模块路径可能超 256 字符 → 后端 400（弹窗正常提示），属可预期行为。
- m07 的 5 个 `non_admin_rejected` 基线失败为存量问题，建议另行立项处理（不影响本闭环）。
