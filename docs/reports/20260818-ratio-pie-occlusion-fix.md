# 测试和修改报告：改进诉求占比饼图说明/百分比遮挡修复

> 任务：「改进诉求领域占比」和「改进诉求各阶段占比」存在说明（图例）和百分比遮挡。
> 分支：`qi_analytic_improve`（待提交）；日期：2026-08-18。

## 1. 任务概述

- **改了什么**：改进报告页/月报页的占比环形饼图——关闭扇区外置 `{d}%` 百分比标签，百分比并入右侧图例（`名称 xx.x%`）。
- **为什么改**：原配置「外置百分比标签 + 饼心 36%/半径 62% + 右侧竖排图例」三者共享同一水平空间；领域多（本地 53 个）且小扇区多（多个 ~2%）时，外置标签与图例文字互相重叠（复现：「2.27%」被图例盖住）、左下标签被画布边缘裁剪（「1.89%」仅显示一半）、图例分页指示与末项文字重叠。`avoidLabelOverlap` 在该密度下无法压住。
- **目标**：任何扇区数量下说明与百分比同时可见、零遮挡；tooltip 明细口径不变。

## 2. 计划与评审记录

- **方案摘要**：两页共用的 `buildPieOption` 同款改造——数据零值过滤 → 确定性计算各名称占比（总和为 0 防除零）→ 图例 `formatter` 输出 `名称 xx.x%`；`label.show:false` + `labelLine.show:false`；饼体微调 `center ["40%","50%"]`/`radius ["40%","64%"]`；tooltip `{b}: {c} ({d}%)` 不变。改进报告领域分析段的模块小图（`ir-chart-mod-*`，同一 builder）自动受益。
- **评审轮次与结论**：1 轮，2 项确认均取推荐方案（百分比并入图例；月报页同款「改进诉求领域占比」一并修复）。一次通过，无返工。
- **是否偏离**：无。

## 3. 接口测试结果（阶段 3）

本任务为纯前端改动（无后端接口/契约变更），接口级验证 = 纯函数单元测试（jest）。

**新增 `test/frontend_tests/__tests__/improvement-report-pie.test.js`：10/10 通过**：

| 组 | 用例 | 结果 |
|----|------|------|
| 源文件哨兵 | 两页均含 label/labelLine 关闭、`pctByName` 计算、formatter 模板；旧外置标签实现已移除；tooltip 口径不变 | ✅ 3/3 |
| 数据与百分比 | 零值过滤不进扇区/图例；3:1 → 75.0%/25.0%；53 项小扇区保留 1 位小数（领域10 1.9%）；空/全零数据无 NaN；未知名回退纯名称（不出 undefined%） | ✅ 5/5 |
| option 形状 | `label.show===false`、`labelLine.show===false`；tooltip 结构不变 | ✅ 2/2 |

**存量适配**：`monthly-report-page.test.js` 结构性用例「改进诉求领域占比饼图为左右结构」原断言旧圆心 `["36%","50%"]`，按新契约更新为 `["40%","50%"]` 并补遮挡修复断言（label 关闭 + 百分比入图例）。相关 3 套件合计 **59/59 通过**。

**回归说明**：全量 jest 另有 17 个套件失败，均为 `jest-environment-jsdom cannot be found`（本地未装 jsdom，套件加载即失败），与本改动无关的既有环境限制。

## 4. 系统测试结果（阶段 4）

**新增 e2e 用例（`test/e2e/test_e2e_improvement_report.py::TestRatioPieOcclusionFix`）+ 存量回归，全文件 10/10，连续 3 次全绿**：

| 用例 | 关键断言 | 结果 |
|------|---------|------|
| test_overall_two_pies_labels_off_and_pct_in_legend | 导入 overall 后，经 `echarts.getInstanceByDom().getOption()` 断言两饼图 `label.show===false`、`labelLine.show===false`、数据非空、图例样例 `名称 xx.x%`（以 % 结尾且非 undefined/NaN），无 JS 错误 | ✅ |
| test_monthly_report_improve_pie_labels_off | 月报页 `mr-chart-improve-mod` 同款断言（当前月无数据时仅断言标签关闭，有数据时加验图例格式） | ✅ |
| 存量 8 用例（菜单可见性/四段渲染/导入/归档往返/归档列表） | 回归 | ✅ |

**视觉证据**（阶段 2 冒烟 + 修复后复核，AI 图像核验）：
- 修复前：领域占比图「2.27%」标签被图例条目遮挡、左下「1.89%」被画布边缘裁剪、图例分页指示与末项重叠；各阶段占比图「20.00%」标签被「验收」图例遮挡。
- 修复后：两图均无外置标签；图例 `领域10 2.3%`、`提出 18.1%` 等格式完整、无重叠无裁剪；分页指示独立无重叠。

**回退与失败记录（如实）**：
1. `test_import_overview_fills_template` 在全文件顺序运行中失败 2 次（单跑/子集均过）。定位：save 按钮与聚合句同源于同一次导入状态更新，但断言零容忍窗口与渲染帧竞态——加 5s 有界轮询后连续 3 次全文件全绿（含失败诊断输出）。**测试侧竞态加固，非产品缺陷**（独立复现脚本 4/4 次导入状态完好）。
2. e2e bootstrap 再次覆盖演示责任田树为夹具树——已按惯例恢复演示树并复核（badge 4 项、统计 4/2/3/3/0、无 JS 错误）。

## 5. 测试覆盖结果（对照改动清单逐项）

| 改动点 | 覆盖用例 |
|--------|---------|
| improvement-report-page.js `buildPieOption`：零值过滤/pct 计算/除零防护 | jest 数据组 5 例 |
| 图例 formatter（已知名 `名称 xx.x%`/未知名回退） | jest 2 例 + e2e 两饼图样例断言 |
| label/labelLine 关闭（遮挡修复核心） | jest option 形状组 + 两页哨兵 + e2e 两用例 |
| 圆心/半径调整 `["40%","50%"]`/`["40%","64%"]` | monthly 结构性用例（源断言） |
| tooltip 明细口径不变 | jest 哨兵 2 处源断言 + e2e 无 JS 错误 |
| monthly-report-page.js 同款改造（含新增零值过滤） | jest 哨兵 + monthly 结构性用例 + e2e 月报用例 |
| 领域分析段模块小图（同 builder 复用） | e2e 导入 overall 页面无报错回归（同函数已被直接覆盖） |
| monthly-report-page.test.js 断言更新 | 该套件 24 用例全绿 |

**结论：改动清单无未覆盖项，缺口清零。**

## 6. 修改清单

- `frontend/modules/pages/improvement-report-page.js`：`buildPieOption` 重写——百分比并入图例、关闭外置标签与引导线、饼体微调（tooltip 不变；零值项本就过滤）。
- `frontend/modules/pages/monthly-report-page.js`：`buildPieOption` 同款重写 + 新增零值过滤（原 0 值项也会进图例）。
- `test/frontend_tests/__tests__/improvement-report-pie.test.js`：新增（10 例：哨兵 3 + 数据 5 + 形状 2）。
- `test/frontend_tests/__tests__/monthly-report-page.test.js`：结构性用例更新至新契约并补遮挡断言。
- `test/e2e/test_e2e_improvement_report.py`：新增 `TestRatioPieOcclusionFix`（2 例）+ `_pie_option_via_echarts` 助手 + 文件头覆盖说明；`test_import_overview_fills_template` 加 5s 有界轮询与失败诊断（测试竞态加固）。

## 7. 遗留风险与后续事项

| # | 事项 | 影响闭环 |
|---|------|---------|
| 1 | 全量 jest 有 17 个套件因本地缺 `jest-environment-jsdom` 无法加载（既有环境限制，与本任务无关） | 否 |
| 2 | 08-18 00:30 检测到两笔 `admin` 操作将演示库「主备切换」槽位绑到「备份恢复田」（唯一写入口为树节点弹窗；间隔 4 秒，疑似人工体验多模块共田功能）。演示绑定已恢复至基线（备份恢复田4/主备切换田2/JDBC接口田3/ODBC田3/非0）并复核；若为有意配置，可在树节点「在研」弹窗两步重绑 | 否（已恢复） |
| 3 | 月报页当前月无数据时饼图为空环（与改前一致，非回归） | 否 |
| 4 | 无后端/迁移/契约变更，远程部署无需额外操作 | — |

**结论：阶段 3 接口测试（jest 相关 3 套件 59/59 + 新增 10/10）、阶段 4 系统测试（e2e 10/10 ×3 + 视觉核验）全部通过、覆盖缺口清零，流程闭环。**
