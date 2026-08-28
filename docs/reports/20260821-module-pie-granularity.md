# 模块&特性占比饼图「层级粒度」选择 — 测试与修改报告

**日期**：2026-08-21（审查修复轮：2026-08-23）
**分支**：qi_analytic_improve
**任务**：改进报表「模块&特性占比」饼图补齐与柱图同款的展示粒度（层级）选择——一级/二级/…/直到最深。

---

## 1. 任务概述

上一任务（20260820-module-level-granularity）为「模块&特性」柱状图实现了层级粒度选择，饼图（模块&特性占比）当时在范围外。本次将同一粒度能力补齐到饼图：

- 饼图卡新增「粒度」下拉（与柱图同款语义：**从领域算起**——一级=领域本身，N 级=[领域, …模块路径前 N-1 段]，0=最深=领域+完整模块路径）。
- 选项枚举到当前筛选数据的最深层级；存储层级超出时**收敛为有效层级并落账 state**（显示值 === 提交值）。
- 已选领域时展示层剥掉恒定领域前缀（计数口径仍从领域算起）。
- **柱图/饼图粒度互不耦合**（与两张卡各自的领域筛选口径一致），粒度切换纯前端重聚合（不重拉接口），跨时间窗口持久。

## 2. 计划与评审记录

- 方案要点：复用柱图粒度的聚合逻辑，抽出共享 `moduleLevelItems` / `moduleLevelFilterHtml`，饼图卡接入 `qiAnalyticsModuleLevelPie` state 与独立 change 绑定；`qiAnalyticsFull.modulePie` 直接消费粒度应用后的序列（页内 Top10 与放大浮层全量图自动同源跟随）。
- 接口契约零变更（纯前端，`/api/qi/analytics` 不动）。
- 评审：计划已提交开发者，**通过（「通过，开始开发」）**后开工。审查修复轮的「收敛即落账」属缺陷修复（见 §5），未改变方案结构。

## 3. 接口测试结果（阶段 3）

纯前端改动，接口层验证 = 前端单测 + 后端契约无回归：

| 用例集 | 结果 |
| --- | --- |
| jest `qi-module-level.test.js`（哨兵 + 纯函数：组合/收敛/去前缀/柱饼互不耦合/收敛落账哨兵） | **21/21 通过** |
| `test_m20_qi_workflow.py -k Analytics`（后端分析契约无回归） | **10/10 通过** |

审查修复轮后从阶段 3 重跑：均仍全绿。

## 4. 系统测试结果（阶段 4）

| 场景 | 结果 |
| --- | --- |
| 冒烟（:8000 实测）：饼图粒度下拉渲染、默认「最深」、切「一级」后扇区合并为领域（SQL引擎:274 / 管控问题:255）；收敛落账渲染期写 state 无 JS 错误、无渲染循环 | 通过 |
| `test_e2e_qi_module_level.py`：默认最深逐路径计数 / 一级按领域合并 / 二级合并叶子 / **柱饼互不耦合** / **收敛即落账（浅领域收敛→切回宽口径不跳回→仍可切层级）** / **切窗后柱图与饼图粒度均持久** | **5/5 通过** |
| 分析页回归：`test_e2e_qi_analytics_api_contract.py` + `test_e2e_qi_bar_inline_zoom.py` + `test_e2e_qi_one_chart_per_card.py` + `test_e2e_qi_zoom_full.py` | **7/7 通过** |
| `test_e2e_qi_config.py`（含饼图/柱图领域筛选独立性与跟随粒度的去前缀展示；标签断言改从放大浮层读全量） | **26/26 通过** |
| `test_qi_page_no_errors.py`（按约定单独跑） | **4/4 通过** |

### 过程记录（如实）

1. **补跑暴露既有用例期望过期**：`test_e2e_qi_config.py::test_module_filter_by_domain` 首跑 1 失败——其「全部领域默认」断言仍期望裸模块名，而任务 B 已评审通过的粒度口径下默认最深标签为 `领域/模块` 全路径。属**测试期望落后于已批准的行为变更**，非代码缺陷（判定依据：口径在任务 B 计划评审明确并通过）。修正两处断言为前缀形式后 26/26 通过；选定领域后的裸模块名断言（去前缀展示）原样保留并验证通过。
2. **覆盖缺口补齐**：饼图粒度的切窗持久化机制与柱图相同但无 e2e 触达——在 `test_level_persists_across_window_switch` 中补设饼图粒度并断言切窗后保持。
3. **流程偏差披露**：任务 B 的系统测试回归清单未包含 `test_e2e_qi_config.py`，本次补跑才暴露上述期望过期。已在本任务修正；柱图粒度行为本身与任务 B 评审口径一致，无需回改产品代码。
4. **审查修复轮回退记录**：/code-review（high）提出 9 项发现（见 §5），其中「收敛只改显示不改 state」为真实缺陷 → 回阶段 2 修复；修复期间 e2e 辅助函数首轮实现有误（点击后立即断言 hidden，浮层为 setTimeout 异步打开 → 5 用例全红），修正为「轮询浮层可见 + 轮询实例就绪」后按流程从阶段 3 重跑全部通过。新用例首版一处全等断言被窗口内 DENSE 数据击破，改子集断言。

## 5. 代码审查记录（/code-review high，9 项发现处置）

**采纳并修复（6 项）**：

| # | 发现 | 处置 |
| --- | --- | --- |
| 1 | 粒度收敛只改显示不改 state：重选当前显示项不触发 change、领域切回宽口径静默跳回更深层级（柱图既有缺陷，本次复制到饼图） | **修复**：`moduleLevelItems` 返回 `eff`，渲染期 `state.qiAnalyticsModuleLevel{Bar,Pie} = eff` 幂等落账；新增 e2e `test_clamp_persists_effective_level` 锁定 |
| 4 | `_open_module_*_zoom` 固定 500ms 等待，慢机下浮层实例未就绪 → `pairs.get` 抛 AttributeError | **修复**：`wait_for(state="visible")` + `wait_for_function` 轮询实例与数据就绪（8s 上限），并同步用于 qi_config 的浮层读取 |
| 5 | qi_config 默认视图断言读页内 Top10 图，种子计数=1 可能被窗口内其它数据挤出（伪失败） | **修复**：`labels()` 改为点击卡片 → 轮询就绪 → 从放大浮层读全量数据 → Esc |
| 6 | 重构遗留死代码：`mdItemsBar`（Top10 切片无人消费）与 `mdItemsFullBar/Pie` 纯别名 | **修复**：删除，`qiAnalyticsFull` 直接用 `barLvl.items`/`pieLvl.items`；jest 哨兵同步 |
| 8 | `count() >= 1` 弱断言无法发现粒度下拉重复渲染 | **修复**：改 `count() == 1`（柱/饼两处） |
| 9 | `selVal` 冗余三元（`raw > 0 ? String(eff) : "0"` 与 `String(eff)` 恒等） | **修复**：源码与 jest 副本同步简化为 `String(eff)` |

**不采纳（3 项，超本任务范围的重构建议，记录为后续事项）**：

| # | 发现 | 理由 |
| --- | --- | --- |
| 2 | 绑定块第 4 份拷贝，建议 `[attr, stateKey, resetOnPreset]` 注册表循环统一 4 处绑定与 2 处重置清单 | 纯可维护性重构，触及稳定的既有绑定/重置结构（含跨 3 文件 4 处），风险收益比不划算；粒度键不随窗口重置的意图已有 e2e 锁定。建议单列重构任务 |
| 3 | jest 哨兵钉死源码局部变量名、行为测试跑手工同步副本；建议把纯函数提到模块作用域导出 | 仓库既定测试约定即「copy+sentinel，e2e 锁真实行为」；导出渲染内部纯函数需改变 qi-page.js 结构，超出本任务边界 |
| 7 | 第三个近似的 `label+select` 脚手架构造器，建议抽通用 `selectRowHtml` | 同 2：触及既有两张卡稳定代码的三处共性重构，建议单列任务 |

## 6. 测试覆盖结果（改动清单逐项核对）

| 改动点 | 覆盖用例 |
| --- | --- |
| `state.js`：`qiAnalyticsModuleLevelPie: 0` 默认（默认行为不变） | jest 哨兵（state 默认 0）；e2e 默认值断言 |
| `qi-page.js`：共享 `moduleLevelItems`（柱/饼各自领域筛选×粒度组合、超深收敛含 `eff`、去前缀） | jest 纯函数（组合/0=最深/收敛 9→3 与按领域收敛/柱饼互不耦合） |
| `qi-page.js`：**收敛即落账**（渲染期 `state = eff`，显示值 === 提交值） | jest 哨兵（两处赋值行）+ e2e `test_clamp_persists_effective_level`（浅领域收敛→切宽口径不跳回→仍可切层级） |
| `qi-page.js`：饼图卡「粒度」下拉渲染（共享 `moduleLevelFilterHtml`，选项枚举到最深层级） | jest 哨兵；e2e（含 `count() == 1` 防重复渲染） |
| `qi-page.js`：饼图 change 绑定写 `state.qiAnalyticsModuleLevelPie` 并纯前端重渲染 | jest 哨兵；e2e 切一级扇区合并 + 冒烟 |
| `qi-page.js`：`qiAnalyticsFull.modulePie/Bar` 直接消费粒度序列（页内 Top10 与放大浮层同源） | e2e `_open_module_{pie,bar}_zoom` 全量断言（免疫 Top10 截断）；死代码删除由 jest 哨兵锁定新结构 |
| 饼图粒度 × 领域筛选组合（选定领域剥前缀、计数口径不变） | `test_e2e_qi_config.py` 步骤 2/3 裸模块名断言 |
| 柱/饼粒度互不耦合 | e2e（先柱二级、再饼一级，互不影响） |
| 切窗持久（柱+饼各自独立保存） | e2e `test_level_persists_across_window_switch` |
| 移除死代码 `aggModules` / `mdItemsBar` / `mdItemsFull*` 别名 | 移除项，无行为；jest 哨兵锁定新结构 |

**覆盖缺口：无。**

## 7. 修改清单

| 文件 | 变更 |
| --- | --- |
| `frontend/modules/state/state.js` | 新增 `qiAnalyticsModuleLevelPie: 0`（柱图键注释扩为柱/饼共用说明） |
| `frontend/modules/pages/qi-page.js` | 抽出共享 `moduleLevelItems` / `moduleLevelFilterHtml`（柱/饼各传各的领域筛选、粒度、maxDepth）；饼图卡接入「粒度」下拉与 change 绑定；`moduleLevelItems` 返回 `eff` 且渲染期落账 state（收敛即落账）；`selVal` 简化为 `String(eff)`；删除死代码 `aggModules` / `mdItemsBar` / `mdItemsFull*` 别名，`qiAnalyticsFull` 直接用 `barLvl.items` / `pieLvl.items` |
| `test/frontend_tests/__tests__/qi-module-level.test.js` | 哨兵更新至新结构（含收敛落账两行）；`moduleLevelItems` 逻辑副本同步（`eff`/`String(eff)`）；新增组合断言与按领域收敛用例（共 21） |
| `test/e2e/test_e2e_qi_module_level.py` | 新增 `_pie_pairs` / `_open_module_pie_zoom` / `_wait_zoom_chart_ready`（轮询替代固定等待）；`_open_module_*_zoom` 改「浮层可见轮询 + 实例就绪轮询」；新增 `test_pie_level_granularity_and_bar_independence` 与 `test_clamp_persists_effective_level`；切窗持久用例补饼图断言；`count() == 1` 严格断言 |
| `test/e2e/test_e2e_qi_config.py` | 两处断言对齐粒度口径（全部领域默认带 `领域/` 前缀）；`labels()` 改从放大浮层读全量数据（点击卡片→轮询就绪→读取→Esc），消除页内 Top10 截断的伪失败风险 |
| `test/frontend_tests/coverage/lcov-report/index.html` | jest 覆盖率产物（随跑更新，仓库惯例一并提交） |

**接口变更：无**（`/api/qi/analytics` 契约未动）。

## 8. 遗留风险与后续事项

- 不影响闭环的遗留项：
  - 审查发现 #2/#3/#7（绑定注册表统一、纯函数导出供测试、select 脚手架统一）为可选重构，建议单列任务处理。
- 提示：远程 47.95.244.175 部署更新时，本改动纯前端无新迁移；仍待用户按手册执行 0119→0123 五个迁移（前次诊断结论，与本任务无关）。
