# 改进报告第三部分改为「一级/二级模块&特性」四图 — 测试与修改报告

**日期**：2026-08-23（审查修复轮：2026-08-24）
**分支**：qi_analytic_improve
**任务**：改进报告第三部分（三、质量改进领域分析）只展示一级与二级的「模块&特性柱状图」和「模块&特性占比饼图」（共 4 图），原「按责任田-模块逐块渲染」内容整体下线。

---

## 1. 任务概述

- **原第三部分**：按统计页责任田的二级模块逐块渲染，每模块 5 图（阶段占比/类别占比/提单分布/接纳率/在办）+ 责任田三率 chips。
- **新第三部分**：与统计页「从领域算起」粒度口径一致的**聚合四图**：
  - 一级（=领域本身）：柱状图「模块&特性分布（一级）」+ 饼图「模块&特性占比（一级）」；
  - 二级（=领域/模块路径首段）：柱状图「模块&特性分布（二级）」+ 饼图「模块&特性占比（二级）」。
- 数据窗口 = **YTD**（与第二部分整体分析一致）；空模块以「领域/未分类」伪段呈现（与统计页 COALESCE 口径一致，审查修复轮对齐）；空领域归「未分类」（与整体分析领域饼口径一致）；按数值降序，柱图与饼图共用同一序列。
- 导出同步：HTML 导出嵌 4 图 PNG（2×2）；Excel 导出两张 名称/数值 子表；JSON 编辑器提示新契约 `{level1[], level2[]}`。
- 旧存量第三段 JSON（`modules` 结构）在新版下无数据 → 显示空态提示「可点击导入重新生成」；进入编辑即按新契约起步（不再把旧结构原样保存回去）。

## 2. 计划与评审记录

- **方案要点**：后端 `_compute_domain` 重写为单条 GROUP BY（domain × module_feature）+ Python 两级聚合，返回 `{level1, level2}`；前端新增 `DOMAIN_CHART_DEFS` 四图定义，复用 `mr-insight-chart-grid` 4 列栅格与 `buildBarOption/buildPieOption`；整体删除 per-module 渲染、`ir-module-*/ir-rf-*` 样式与后端 `_module_matches/_user_disp` 死代码；四段契约、鉴权、归档机制不变。
- **评审**：计划已提交开发者，**通过（「通过，开始开发」）**后开工。
- **附加决策**：第三段标题**保持原标题**「三、质量改进领域分析」（开发者选定）。
- **方案偏离披露（1 处，审查修复轮）**：计划原文「空模块并入领域本身，与统计页 aggByLevel 语义一致」——后半句当时研究有误：统计页实际把空模块 COALESCE 为「未分类」（二级显示 `领域/未分类`，qi.py domain_module_rows + qi-page.js aggByLevel，jest qi-module-level 已锁定）。按计划意图（口径一致）对齐为「领域/未分类」伪段（见 §5 发现 3），m21 断言同步。其余无偏离。

## 3. 接口测试结果（阶段 3）

`PYTEST_SKIP_AUTO_MIGRATE=1`，`DATABASE_URL` 取自 `backend/.env`。

| 用例集 | 结果 |
| --- | --- |
| `test/test_m21_improvement_report.py` 全量（17 用例：骨架/非法月份/隐藏权限 403 fail-closed/四段 roundtrip/未知段拒绝/归档锁定/列表状态过滤/删除/overview 数字/空月/未入田闭环计数/overall KPI/`test_domain_levels`/`test_shared_field_merged_by_field`/monthly_new） | **17/17 通过** |
| jest `improvement-report-page.test.js`（结构哨兵：`DOMAIN_CHART_DEFS` 定义与 `ir-chart-domain-${d.id}` 模板、4 图 label、`domainHasData` 恰好 3 处调用、`DOMAIN_CHART_COLORS` 更名、编辑起步契约、`defaultSectionData("domain")` → `{level1, level2}`、**不含**旧 `MODULE_CHART_DEFS`/`MODULE_CHART_COLORS`/`ir-module-block`/`ir-rf-chip`；行为用例：`domainHasData` 含旧 modules 结构判空） | **19/19 通过** |

`test_domain_levels` 边界覆盖：多段路径取首段（`模块/子模块/孙模块` → 二级=`领域/模块`）、空模块 → `领域/未分类`、空领域 → 未分类 + 孤儿模块、数值降序、`{name, value}` 键契约；共享田字段用例同步断言 `level1 == [{领域: 3}]` 与两个二级模块分列。

## 4. 系统测试结果（阶段 4）

| 场景 | 结果 |
| --- | --- |
| 冒烟（:8000 实测）：`GET /api/improvement-report/202608/import/domain?operator_id=test_admin` → `level1=[SQL引擎:274, 管控问题:255]`；`level2=[管控问题/管控子模块:255, SQL引擎/驱动:171, SQL引擎/CBB:103]`；另以 June 窗口单插空模块行验证二级键=`IR测试领域/未分类` | 通过 |
| e2e `test/e2e/test_e2e_improvement_report.py` 全量 11 用例（菜单可见性×3、页面四段与工具栏、overview 导入、overall 导入 KPI+4 图、归档往返、归档页列表、整体分析双饼遮挡回归、**新 `test_domain_four_charts_level1_level2`**） | **11/11 通过** |
| 新 e2e 断言明细：`.ir-module-block` 归零、4 个 `ir-chart-domain-*` echarts 实例挂载、一级名全无 `/`、二级名含 `/`、`sum(level1)==sum(level2)>0`、按领域分组一致性、柱图与饼图同源、双饼几何约束（center ≤30% / radius ≤52%、图例含 `%`，沿用遮挡修复约定）、导入失败/空态 fail-fast 可读信息 | 通过 |
| jest 全量（103 套件）：**818/818 tests 通过**（审查修复轮后目标套件 19/19）；本任务相关套件全绿 | 通过（见存量问题说明） |

### 过程记录（如实）

1. **:8000 旧代码干扰（两轮）**：首轮冒烟返回旧 `modules` 结构（dev server 跑改动前代码），重启后按新契约复验通过；审查修复轮 m21 首跑 `test_domain_levels` 失败（KeyError `领域/未分类`）——api_client 走 `127.0.0.1:8000` 常驻服务，仍为修复前代码（旧口径把空模块折进领域键）。重启服务后 17/17。两轮根因均为测试环境进程陈旧，非代码缺陷。
2. **jest 全量 18 个套件「failed to run」为存量环境问题**：均为 `SyntaxError: Cannot use import statement outside a module`（0 tests，与本任务无关的 18 个套件）。已用 `git stash` 回基线单跑对照验证：改动前后同样失败 → 存量 ESM/transform 配置问题；818 个真实用例全部通过。已列入遗留事项。
3. **stash 恢复事故（未影响交付内容）**：对照实验中 `git stash pop` 被 jest 再生的 coverage 产物冲突挡下（stash 完好保留），`git checkout` 还原该产物后正常弹出，7 文件改动完整并复跑确认全绿。
4. **审查修复轮 e2e 首跑失败（新增测试代码缺陷）**：fail-fast 首版以「空态提示出现」为完成信号，但该提示在导入前的初始渲染即存在 → 断言先于异步导入完成执行而误报。改为等「导入完成」信号（编辑态出现保存按钮 / 报错文案）后再判空态，修正后按流程从阶段 3 重跑全部通过。

## 5. 代码审查记录（/code-review high，10 项发现处置）

**采纳并修复（6 项）**：

| # | 发现 | 处置 |
| --- | --- | --- |
| 3 | 空模块二级键与统计页不一致（统计页=`领域/未分类`，本处折进领域本身），而 docstring/注释宣称「与统计页一致」 | **修复**：二级空模块改以「领域/未分类」伪段呈现（对齐统计页 COALESCE 口径），docstring/注释/m21 断言同步；属计划内语义修正（见 §2 偏离披露） |
| 5 | `level1` 与第二段 `domain_pie` 同窗口同口径重复计算，单侧改动会使两段领域图静默不一致 | **修复**：抽 `_domain_module_rows(conn, ym)` 共享查询——overall 求和得 domain_pie、domain 派生一/二级，两段口径锁死一致（m21 overall/domain 用例双重覆盖） |
| 7 | level1/level2 非空谓词在渲染/HTML 导出/Excel 导出三处重复，三点同步隐患 | **修复**：抽 `domainHasData` helper 三处共用；jest 哨兵钉死「恰好 3 处调用」+ 行为用例（含旧 modules 结构判空） |
| 8 | 导出 HTML 两处内联 `<td>` 模板绕过既有 `cell()` helper | **修复**：`cell(id, width="25%")` 参数化，domain 行复用并传 `"50%"`。固定 `slice(0,2)/slice(2,4)` 保留——2×2 是设计布局，且 4 图定义被 jest 结构哨兵钉死，加图必改测试，非静默丢弃（部分采纳） |
| 9 | 新 e2e 空库时以 15s 不透明超时失败，而非可读的数据断言 | **修复**：点击导入后先等「导入完成」信号（保存按钮/报错文案），空态时给出「DENSE 演示数据是否就位」可读失败；顺带删除冗余 `wait_for_timeout(800)`（4 图同一同步回调原子挂载，实例轮询已足够）。首版实现有缺陷（见 §4 过程记录 4），修正后通过 |
| 2（前端部分） | 旧存量第三段进入编辑会把死结构原样保存回去，成功 toast 与实际效果不符 | **修复**：`startEdit` 检测 domain 段旧结构（无 level1/level2 数组）即按新契约默认值起步；jest 哨兵锁定。后端形状校验**不采纳**：四段 data 均为 `dict[str, Any]` 自由 JSON 属既有契约，单为 domain 加校验超范围 |

**不采纳（4 项，记录为后续事项）**：

| # | 发现 | 理由 |
| --- | --- | --- |
| 1 | 旧存量 section_domain 数据无迁移/回退渲染，屏显与导出均丢第三段 | 评审时已披露并批准的产品口径（旧内容为已下线的 per-module 呈现，回退渲染等于复活旧 UI）；已归档报告可「取消归档→导入→重新归档」按新口径重建（已补入遗留事项）。如需保留旧存量只读展示，单列任务 |
| 4 | 与 qi.py `domain_module_rows` 近重复，建议跨路由抽共享查询 | 跨路由重构超本任务范围；实际语义分歧（空模块 COALESCE）已被发现 3 消除。建议单列重构任务（参照 `qi_research_field.module_window_counts` 共享模式） |
| 6 | 领域名本身含 `/` 时二级键碰撞（`A/B` 空模块 vs `A`+模块 `B` 同键） | 潜在问题：领域经树下拉录入、现网无 `/` 领域；统计页 aggByLevel 同款歧义。口径变更（转义/换分隔符）需产品决策并两侧同改，单列任务 |
| 10 | 「未分类」内联字面量 17 处无共享常量，且各处 COALESCE 字段集不同 | 跨文件清理超范围；语义差异已被发现 3 对齐。建议单列常量化任务 |

**低于上限裁剪项**：`MODULE_CHART_COLORS` 随 `MODULE_CHART_DEFS` 移除更名 `DOMAIN_CHART_COLORS`（**采纳**，jest 哨兵同步）；新 e2e `pie_pairs/bar_pairs` 与 `test_e2e_qi_module_level.py` 重复可提 conftest（不采纳，触及既有套件，记录）；`wait_for_timeout(800)` 冗余（**采纳**，随发现 9 删除）。

## 6. 测试覆盖结果（改动清单逐项核对）

| 改动点 | 覆盖用例 |
| --- | --- |
| 后端 `_compute_domain` 重写（两级聚合/多段取首段/**空模块→领域/未分类**/未分类/降序） | m21 `test_domain_levels` + 冒烟实测（June 窗口单插空模块行验证二级键） |
| 后端 `_domain_module_rows` 共享查询（第二段 domain_pie 与第三段同源） | m21 `test_overall_kpi_and_charts`（domain_pie 值不变）+ `test_domain_levels`（level1 与 domain_pie 同口径） |
| 后端删除 `_module_matches`/`_user_disp` 死代码 | m21 全量回归（无引用残留由实现期 grep 确认） |
| 契约 `{level1, level2}`（导入+保存 roundtrip） | m21 `test_update_section_roundtrip_all_four`（domain 段新 payload）+ `test_domain_levels` 键契约 |
| 隐藏权限 fail-closed 对 domain 导入仍生效 | m21 `test_hidden_operator_forbidden_all_endpoints`（含 domain 导入 403 断言） |
| 前端 `DOMAIN_CHART_DEFS` 四图渲染与挂载（含 `DOMAIN_CHART_COLORS`） | jest 结构哨兵 + e2e `test_domain_four_charts_level1_level2`（4 实例） |
| `domainHasData` 共享判定（渲染/HTML 导出/Excel 导出） | jest 哨兵（恰好 3 处）+ 行为用例（空/单侧非空/旧结构） |
| `startEdit` 旧结构按新契约起步 | jest 哨兵（判定行） |
| 空态提示（旧存量 JSON/无数据） | jest 哨兵（渲染分支）+ e2e（导入完成信号 + 空态 fail-fast 断言） |
| 旧 per-module 结构移除（无残留渲染） | jest「不含旧结构」断言 + e2e `.ir-module-block` count==0 |
| 双饼几何不遮挡（center/radius/图例 %） | e2e `test_domain_four_charts_level1_level2` 几何断言 |
| HTML 导出 2×2 嵌图（cell 宽度参数化）/ Excel 两张 kv 子表 | jest 哨兵（`buildExportHtml`/`buildExportXlsx` 含 l1/l2 引用）；e2e 工具栏回归 |
| `report.css` 移除 `ir-module-*/ir-rf-*` 死样式 + 新高度规则 | jest「不含旧结构」断言 + e2e 页面无 JS 错误 |
| 共享田字段（`test_shared_field_merged_by_field`）适配新契约 | m21 该用例 domain 段断言改写后通过 |

覆盖缺口：无（上表逐项均有用例触达且全部通过）。

## 7. 修改清单

| 文件 | 变更要点 |
| --- | --- |
| `backend/routers/improvement_report.py` | `_compute_domain` 重写为 YTD 两级聚合返回 `{level1, level2}`（空模块→领域/未分类）；新增 `_domain_module_rows` 共享查询（第二段领域饼同源）；删除 `_module_matches`/`_user_disp` |
| `frontend/modules/pages/improvement-report-page.js` | 新增 `DOMAIN_CHART_DEFS` 四图定义、`domainHasData` 共享判定、`DOMAIN_CHART_COLORS`；`renderSectionDomain` 改 4 图栅格+空态提示；`mountDomainCharts` 按 def 挂载；`startEdit` 旧结构按新契约起步；HTML 导出 2×2（`cell` 宽度参数化）；Excel 两张 kv 子表；JSON 提示新字段；移除 per-module 渲染与 rf chips |
| `frontend/styles/report.css` | 删除 `.ir-module-*/.ir-rf-*` 死样式与相关媒体查询行；新增 `.mr-section--domain` 图高 240px |
| `test/test_m21_improvement_report.py` | `test_domain_modules` → `test_domain_levels`（新边界用例，空模块断言 `领域/未分类`）；共享田用例 domain 断言改写；roundtrip payload 新契约；隐藏权限断言含 domain |
| `test/frontend_tests/__tests__/improvement-report-page.test.js` | 哨兵与 defaultSectionData 用例改新契约 + `domainHasData`/更名/编辑起步哨兵与行为用例（19 用例） |
| `test/e2e/test_e2e_improvement_report.py` | `test_module_pie_geometry_and_cn_stage_names` → `test_domain_four_charts_level1_level2`（导入完成信号 fail-fast + 4 图/口径/同源/几何断言）；删除无用 `_pie_data_names` |
| `test/frontend_tests/coverage/lcov-report/index.html` | jest 产物（仓库惯例随最新一次全量输出提交） |

## 8. 遗留风险与后续事项

1. **存量第三段 JSON 需重新导入**（评审时已披露）：历史已保存/已归档的第三段是 `modules` 结构，新版读取不到数据 → 显示空态；未归档报告点「导入」即按新口径生成，已归档报告需「取消归档→导入→重新归档」。进入编辑不会再把旧结构保存回去。不影响闭环。
2. **18 个 jest 套件启动失败为存量环境问题**（ESM `Cannot use import statement outside a module`，stash 对照验证非本次引入；818/818 真实用例通过）。建议单列任务修 jest transform 配置。
3. **后续重构建议**（审查不采纳项，均已记录理由）：与 qi.py 抽共享的领域×模块查询 helper；`未分类` 字面量常量化；e2e `pie_pairs/bar_pairs` 提升 conftest。
4. **潜在口径决策**：领域名含 `/` 时二级键与统计页同款歧义（发现 6），如需消歧需两页同改。
5. 月度报告零改动（未触碰 monthly-report 相关文件），边界保持。
