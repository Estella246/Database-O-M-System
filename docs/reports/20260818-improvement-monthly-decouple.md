# 改进报告与月度报告解耦：测试与修改报告

- **日期**：2026-08-18
- **分支**：`qi_analytic_improve`（基于 origin/windows `7187b2f`）
- **任务**：用户要求——改进报告实现不得修改月度报告相关内容
- **流程**：ops-dev-workflow 5 阶段闭环（任务 #41-#45）

## 一、背景

上一轮提交（`4d11f7c`，已推 origin/windows）中，改进报告的 K1 去重引入了对月度报告的三处修改：
生命周期委托重构（monthly_report.py −195 行）、ymToTitle 后缀参数化（monthly-report-page.js）、
月报页饼图遮挡修复。用户明确边界：改进报告实现不动月度报告任何内容，评审时选择「饼图修复也还原」。

## 二、修改清单

| 文件 | 变更 |
|---|---|
| `backend/routers/monthly_report.py` | **整体还原为 origin 版本**（`git diff 7187b2f` 为空）：恢复内联生命周期实现 + origin 自带 SSO 鉴权 |
| `frontend/modules/pages/monthly-report-page.js` | **整体还原为 origin 版本**：ymToTitle 恢复无后缀原版；月报饼图恢复外置 {d}% 标签（含 radius/center 原值） |
| `test/frontend_tests/__tests__/monthly-report-page.test.js` | **整体还原为 origin 版本**（饼图断言随源还原） |
| `frontend/modules/pages/improvement-report-page.js` | 删除对 monthly-report-page.js 的 import；页内自持 `currentYm()` 与 `ymToTitle()`（输出「xxxx年x月改进报告」） |
| `backend/report_lifecycle.py` | 转为改进报告专属模块（唯一消费方 improvement_report.py，内容未改） |
| `test/frontend_tests/__tests__/improvement-report-page.test.js` | 哨兵反转：断言**不再** import 月报页、本地实现存在 |
| `test/frontend_tests/__tests__/improvement-report-pie.test.js` | 移除月报页源哨兵用例（保留改进页哨兵与全部纯函数用例） |
| `test/e2e/test_e2e_improvement_report.py` | 删除 `test_monthly_report_improve_pie_labels_off`（月报修复随源还原），留边界注释 |

**保留项**（评审确认）：`test_m14_monthly_report.py` 的 5 处 `operator_id=` 补参——origin 新增鉴权所需，
属测试适配非实现修改；m14 其余测试为分支既有。

## 三、评审记录

AskUserQuestion 单轮：基础方案（还原 K1 委托 + ymToTitle 解耦 + 测试同步）上追加选项「饼图修复也还原」，
用户选择后者 → 月报三文件整体还原，月报侧修复及其测试一并移除。无偏离。

## 四、测试结果

- **接口测试**：后端 5 文件批 **420 passed / 9 skipped**；jest **788 passed / 0 failed**（789→788=移除月报哨兵用例）；node --test 9 套件 **39 passed / 0 failed**。
- **系统测试**：e2e 改进报告+解决版本+工单关联 **21 passed**（22→21=删除月报饼图用例）；`test_qi_page_no_errors.py` 单独跑 **4 passed**。
- **等价性验证**：月报三文件与 `7187b2f` 逐字节一致（`git diff` 为空）；改进报告接口冒烟 200、鉴权 403 行为不变；改进页标题走本地 `ymToTitle`（e2e 四段/横幅断言通过）。

## 五、遗留说明

- 月报页「改进诉求领域占比」饼图恢复 origin 形态（外置 {d}% 标签），原遮挡问题在月报侧**重新存在**——这是用户明确选择的边界（月报修复应另行立项，不随改进报告改动）。
- `report_lifecycle.py` 的 ReportSpec 仍保留参数化字段（曾服务双路由，现单消费方），无功能影响，可在后续清理中简化。
