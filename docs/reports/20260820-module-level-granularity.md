# 模块&特性柱状图「层级粒度」选择：测试与修改报告

- **日期**：2026-08-20
- **分支**：`qi_analytic_improve`（基于 `7c0958c`）
- **任务**：改进报表（质量改进页 → 分析 tab）「模块&特性」柱状图功能增强——可手动选择展示粒度（一级/二级/…/直到最深层级）
- **流程**：ops-dev-workflow 5 阶段闭环（任务 #71-#75）

## 一、任务概述

「模块&特性」柱状图（分析 tab → 领域/模块分布）此前固定按模块全路径聚合，无法切换层级。
本次在柱图卡新增「粒度」下拉：**最深（默认，行为不变）/ 一级 / 二级 / … / N 级**（N=当前筛选
数据的最深层级，动态推导）。口径按开发者确认：**从领域算起**——一级=领域本身，
二级=领域/首段模块，N 级=[领域, …模块路径前 N-1 段]；已选领域时展示层剥掉恒定领域前缀（计数口径不变）。

## 二、计划与评审记录

- AskUserQuestion 一轮两问：
  1. 「一级」计数口径 → 开发者选 **「从领域算起」**（一级=领域本身；未采用备选「领域下第一段模块」）。
  2. 开发计划（纯前端粒度下拉、默认最深行为不变、柱图+放大浮层同源跟随）→ **「通过，开始开发」**。
- 无偏离。

## 三、修改清单

| 文件 | 变更 |
|---|---|
| `frontend/modules/state/state.js` | 新增 `qiAnalyticsModuleLevelBar: 0`（0=最深，N=前 N 级；切窗不重置，属展示偏好） |
| `frontend/modules/pages/qi-page.js` | 分析 tab 渲染段：新增 `aggByLevel`（[领域, …模块路径] 截前 N 段聚合、同键合并、降序）、`barMaxDepth` 推导与超深收敛（`Math.min`）、`stripDomainPrefix`（已选领域去前缀）；`qiAnalyticsFull.moduleBar` 改存粒度应用后序列（页内 Top10 与放大浮层全量图自动同源）；柱图卡新增「粒度：」下拉（`data-qi-analytics-module-level-bar`，选项 最深+一级..N级中文名）；change 绑定纯前端重渲染（不重拉接口） |
| `test/frontend_tests/__tests__/qi-module-level.test.js` | 新增：哨兵（下拉存在/绑定/state 默认/moduleBar 同源）+ 纯函数行为（最深逐路径、一级按领域合并、二级叶子合并、短路径不截断、未分类/空段脏数据、降序、barMaxDepth 与收敛、去前缀）共 16 用例 |
| `test/e2e/test_e2e_qi_module_level.py` | 新增 3 条 e2e：默认最深+一级/二级切换（放大浮层 label→value 精确断言）；已选领域去前缀（二级 mA=3/mB=3；一级+选领域=单柱 {领域MLA:6}）；切窗后粒度持久；全程 `assert_no_js_errors` |
| `test/e2e/test_e2e_qi_analytics_api_contract.py` | 修复测试隔离缺陷（非本次功能代码问题，见下）：`research_field_stats.domain` 非空断言改为仅对**有关联**的田生效（查 `research_duty_field_binding`），无关联田（参数页可先建田后配关联的合法状态）domain 为空串不再误伤；另按 code-review 发现补显式 `pytest.skip`（无 DATABASE_URL 时跳过而非静默禁用断言） |

**默认视图的可见变化**（口径统一为「从领域算起」的自然结果）：「全部领域」+最深时，柱标签由
`驱动/JDBC/连接池` 变为 `SQL引擎/驱动/JDBC/连接池`（带领域前缀，自描述）；已选领域时不带前缀（剥掉恒定段）。

## 四、接口测试结果（阶段 3）

- 后端接口**零变更**（`/api/qi/analytics` 契约不动，`domain_module_distribution` 仍按领域+模块全路径 GROUP BY，粒度纯前端聚合）。
- m20 分析接口契约回归：`-k Analytics` **10 passed**。
- jest `qi-module-level.test.js`（新增）+ 相邻 `qi-bar-labels-and-version-fallback.test.js`：**27 passed**。
- 全量 jest：**814 passed / 0 failed**（test 级；18 个 suite 级失败为既有 node:test 误收集问题，历次报告在案）。

## 五、系统测试结果（阶段 4）

- 新 e2e `test_e2e_qi_module_level.py`：**3 passed**（首轮 3 条因测试取值缺陷失败——ECharts
  series.data 元素为 `{value:…}` 对象被 `Number()` 转 NaN，修用例取值后通过；粒度标签/合并在首轮即正确，非代码缺陷）。
- 受影响回归：`test_e2e_qi_bar_inline_zoom.py`、`test_e2e_qi_zoom_full.py`、`test_e2e_qi_one_chart_per_card.py`、契约测试共 **10 passed**（含契约修复后）。
- `test_qi_page_no_errors.py` 单独跑：**4 passed**。
- Playwright 冒烟（live :8000，DENSE 数据）：粒度选项 最深/一级/二级/三级/四级；切一级后柱图为两根领域柱（SQL引擎/管控问题），无 JS 错误。

**一次回退记录（如实）**：首轮系统测试契约 e2e 失败（`domain 应为非空合并文本`）。定位：本地库存在
用户手工造的无关联田「非」（`research_duty_field` id=481，0 binding）——两层模型下无关联田 domain='' 属
**合法状态**（参数页可先建田后配关联），测试对共享库的「所有田必有关联」假设过强。判定为**既有测试
隔离缺陷**（非本次实现/方案问题，产品行为符合设计），按测试阶段正常动作修用例精确化后全量重跑通过。

## 六、测试覆盖核对（改动清单逐项）

| 改动点 | 覆盖 |
|---|---|
| state 默认 0=最深 | jest 哨兵（`qiAnalyticsModuleLevelBar: 0`）+ e2e `input_value()=="0"` |
| aggByLevel（最深/一级/二级合并） | jest 行为 7 用例 + e2e 浮层数值断言（2/1/3/4 → 6/4 → 3/3/4） |
| barMaxDepth 推导 + 超深收敛 | jest 行为（空数据/单级/收敛）+ e2e 选项枚举到「四级」 |
| stripDomainPrefix | jest 行为 + e2e 专条（去前缀 3/3；一级+选领域单柱 {领域MLA:6}） |
| 粒度下拉渲染（data 属性/选项名/选中态） | jest 哨兵 + e2e option/input_value 断言 |
| change 绑定纯前端重渲染 | e2e select_option 实际切换后浮层重读 |
| moduleBar 同源（页内+浮层） | e2e 浮层数值 + 既有 zoom_full/inline_zoom 回归 |
| 切窗持久 + 无 JS 错误 | e2e 切近1周后 `input_value()=="1"` + assert_no_js_errors 全程 |
| API 契约不回归 | 契约 e2e + m20 Analytics 10/10 |
| 契约测试修复本身 | 修复后该测试通过（含无关联田场景实际触达） |

**覆盖缺口：无。**

## 七、代码审查记录（提交前 /code-review high）

代理两次因并行 finder stall 中断，第三次改为串行自查完成。结论与处置：

| 发现 | 判定 | 处置 |
|---|---|---|
| 契约测试 `domain` 非空断言在 DATABASE_URL 未设时被**静默禁用**（`_bound` 恒空集，后端此时仍以回退 DSN 正常起服务，测试绿但零覆盖） | 确认缺陷 | **已修**：无 DSN 时 `pytest.skip`（显式跳过）。注：根 conftest 会 `load_dotenv(backend/.env)`，常规跑法 DSN 恒在，该分支为纵深防御；带 DSN 路径修复后重跑 1 passed |
| jest 行为断言跑在「逻辑副本」上，源实现改动后副本不随之变（假保护风险） | 结构性建议 | **不改**：拷贝+哨兵是本仓库既有测试约定（历次报告在案）；真实行为由 e2e 页面级数值断言锁住。「提为可导出纯函数」记为后续改进项 |
| `_seed` INSERT 与取图助手在多个 e2e 文件逐字重复，schema 变更多处同步 | 结构性建议 | **不改**：e2e 各文件自含种子是既有布局（约十处同构）；抽公共 helper 属跨任务重构，记为后续改进项 |

其余候选（name+owner 撞键、DB/后端不一致、`_bound` 时序、覆盖率 html、固定 sleep）经复核均被驳回（唯一性有约束/conftest 复制 os.environ/单线程/仓库惯例）。

## 八、遗留风险与后续事项

- 粒度选项枚举到当前筛选数据的最深层级；跨数据源（如远程库路径普遍只有 2 段）选项数随之变少，属预期自适应。
- 本地库 `research_duty_field` 的手工测试田「非」（无关联、全零计数）会在分析页在研责任田表占一行空数据——建议在参数配置-在研责任田里删除（不影响本次闭环）。
- 「模块&特性占比」饼图未加粒度（需求仅柱状图）；如需同款粒度可复用 `aggByLevel` 后续扩展。
- 后续改进项（code-review 结构性建议，不影响闭环）：粒度聚合提为可导出纯函数供 jest 直测源实现；e2e 种子/取图助手抽公共 helper。
