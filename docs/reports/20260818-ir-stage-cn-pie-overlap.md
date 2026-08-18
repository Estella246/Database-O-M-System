# 改进报告阶段占比中文化 + 类型占比饼图与说明重合修复：测试与修改报告

- **日期**：2026-08-18
- **分支**：`qi_analytic_improve`（基于 `cc1773d`）
- **任务**：①阶段占比（及说明内容）用英文表示，改中文；②类型占比饼图和说明重合
- **流程**：ops-dev-workflow 5 阶段闭环（任务 #61-#65）

## 一、任务概述与根因

改进报告「三、质量改进领域分析」模块图表组两处缺陷：

1. **阶段占比图例/说明为英文**（analysis/closure/acceptance/review/propose）：`_compute_domain` 的
   `stage_pie` 聚合键直接用 `current_stage` 原始英文键，未走 `_stage_cn`（第二段整体 `stage_pie`
   已用 `_stage_cn` 输出中文，两段口径不一致）。页面图例/tooltip、xlsx 导出的「名称/数值」
   说明表、JSON 编辑器同源全为英文。
2. **类型占比饼图与说明（图例）重合**：`buildPieOption` 几何 `center 40% / radius 64%` 在窄卡片
   （每模块 5 图并排，~270px 宽）下饼体右缘 ≈172px 伸入右侧竖排图例区（长标签
   「质量加固和改进 12.6%」图例左缘 ≈121px），扇区与文字重合约 50px；7 项图例底部贴边裁剪。
   （截图证据：/tmp/ir_module_1.png 修复前后对比）

## 二、计划与评审记录

- AskUserQuestion 一轮：方案（后端 `_stage_cn` 中文名 + 前端饼体左置小半径为图例整列预留空间 +
  m21 断言中文化 + e2e 新增几何/中文名断言）获批「通过，开始开发」。无偏离。

## 三、修改清单

| 文件 | 变更 |
|---|---|
| `backend/routers/improvement_report.py` | `_compute_domain` 的 `stage_agg` 聚合键 `lambda r: str(r["s"])` → `lambda r: _stage_cn(str(r["s"]))`（`_stage_cn` 本文件已导入；未知键原样返回的兜底为既有 helper 行为） |
| `frontend/modules/pages/improvement-report-page.js` | `buildPieOption`：`center ["40%","50%"]→["25%","50%"]`、`radius ["40%","64%"]→["30%","50%"]`；图例 `height 90%→86%`、增 `itemGap: 6`、`textStyle: { fontSize: 11 }`。注释补充几何依据（最坏标签宽度验算）。该函数服务第二段两张饼 + 第三段每模块两张饼 |
| `test/test_m21_improvement_report.py` | `test_domain_modules` 的 stage 断言 `analysis/closure/review` → `确认/实施/评审`（契约随中文化更新） |
| `test/e2e/test_e2e_improvement_report.py` | `_pie_option_via_echarts` 增 `center0Num/radiusOuterNum`（百分比字符串→数值）；新增 `_pie_data_names`；新增 `test_module_pie_geometry_and_cn_stage_names`（模块两张饼：圆心横坐标 ≤30%、外半径 ≤52%、图例含百分比；stage_pie 扇区名 ∈ 中文五阶段集合） |

## 四、接口测试结果（阶段 3）

- `test_m21_improvement_report.py` 全量：**17 passed**（含更新后的中文名断言；其余契约不动）。
- 直接验证（live :8000，重启后）：`GET /api/improvement-report/202608/import/domain` →
  `stage_pie: [{确认 25}, {实施 24}, {验收 20}, {评审 17}, {提出 17}]`；
  `category_pie` 7 类中文不变（需求/定位定界/快速恢复/质量加固和改进/测试加固/资料/升级checklist）。
- 无其它接口消费方（`import/domain` 的 stage_pie 仅报告页/xlsx 导出使用，已全量检索确认）。

## 五、系统测试结果（阶段 4）

- `test/e2e/test_e2e_improvement_report.py`：**11 passed**（10 既有 + 1 新增，每条均挂
  `assert_no_js_errors`）。既有 `TestRatioPieOcclusionFix`（整体两张饼外置标签关闭/百分比入图例）
  回归通过——新几何未破坏既有遮挡修复契约。
- 截图目检（Playwright 探针，1720×1200）：修复后第三段模块图——阶段占比图例为中文五阶段；
  类型占比饼体左置、右侧图例整列完整可读（含末项「升级checklist 5.8%」不再裁剪），无重合。
- jest：不涉及（`improvement-report-page.js` 无 jest 用例属既有约定——渲染类逻辑由 e2e 覆盖）。

## 六、测试覆盖核对（改动清单逐项）

| 改动点 | 覆盖 |
|---|---|
| 后端 stage_pie 中文名 | m21 `test_domain_modules`（中文计数断言）+ 新 e2e 页面级扇区名断言 + live API 探针 |
| 前端饼体几何（center/radius） | 新 e2e `center0Num ≤ 30 / radiusOuterNum ≤ 52`（两张模块饼）+ 既有整体饼 e2e（标签关闭契约不变）+ 截图目检 |
| 前端图例排版（height/itemGap/fontSize） | 新 e2e 图例百分比样本 + 截图目检（7 项不裁剪） |
| m21 断言更新 | 全量 17 通过 |
| 整体段两张饼共用 builder 的回归 | 既有 `test_overall_two_pies_labels_off_and_pct_in_legend` 通过 |

**覆盖缺口：无。**

## 七、遗留风险与后续事项

- `buildPieOption` 几何按已知最坏标签（7 字中文 + " 100.0%"）调参；若未来出现 ≥10 字类目名，
  窄卡片下图例仍可能挤压——届时可按标签长度自适应半径或改横向滚动图例（tooltip 始终有全名）。
- 月报页 `/report/generate` 有独立饼图实现，不在本次范围（解耦边界，历次报告在案）。
