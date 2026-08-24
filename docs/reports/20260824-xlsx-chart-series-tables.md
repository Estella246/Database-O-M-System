# 改进报告 Excel 导出补齐二段图表源数据子表 — 测试与修改报告

**日期**：2026-08-24
**分支**：qi_analytic_improve
**任务**：用户提问「导出为 Excel 的时候，没有带上图表，合理吗」——调研定界后按方案 A 实施。

---

## 1. 任务概述

**调研定界（回答「合理吗」）**：
- **「Excel 无图」本身合理**：前端导出库为 xlsx-js-style（SheetJS 0.18.5 fork，仅比社区版多单元格样式），**不支持嵌入图片、不支持创建原生 Excel 图表**（库内无 addImage/xl-media 能力，已核实）；月报页 Excel 导出同为「数据表、无图」体例；带图需求由「导出 HTML」（echarts `getDataURL` PNG 内联 4+4 图）承担；Excel 定位为可二次加工的数据导出。
- **真正不合理处**：§2 整体分析的 4 张图（改进诉求领域占比/各阶段占比/责任田接纳率/责任田超期率）在 Excel 里**连源数据表都没有**（仅 KPI 行），而 §3 领域分析却有「名称/数值」子表——同一文件体例不一、数据不全。

**修复（方案 A）**：`buildExportXlsx` 在 §2 KPI 之后补 4 张图的「名称/数值」子表（四序列均为 `{name,value}[]`），复用 §3 既有 `pushKv` 模式（上提为两段共用，并扩展 `keepZero` 参数区分口径：两张率柱表走柱图口径——保留 0 值行并按数值降序，与页面柱图一致；两张饼表走饼图口径——过滤 ≤0 行、保持后端序，与页面饼图一致）。

## 2. 计划与评审记录

- **方案候选**（AskUserQuestion 提交开发者）：A 补齐数据表（推荐）；B 嵌图表 PNG（需 vendor exceljs ~1MB，数据不可加工、文件变大、两库并存或全站替换）；C=A+B；D 维持现状（§2 数据缺失不解决）。
- **评审结论**：开发者选定 **「A：补齐数据表（推荐）」**。
- **方案偏离**：无。
- **过程记录（如实，均为开发自检期发现并修复的测试侧问题，非产品缺陷）**：
  1. **新 e2e 单跑失败→定位为环境残留**：库里 `202608` 报告处于**已归档**态（归档态页面只读、无导入按钮）；且已归档报告直接 DELETE 返回 **409**，须先「取消归档」再删——采用与 `test_archive_page_lists_archived` 收尾同款的两步清理作前置，保证新用例可独立运行。
  2. **`download.path()` 无扩展名**：Playwright 下载落盘为无后缀临时文件，openpyxl 按扩展名识别格式抛 InvalidFileException——复制加 `.xlsx` 后缀后再读。
  3. **导出读「已保存」快照（产品既定口径，非缺陷）**：`importSection` 只把导入数据写进编辑草稿（`improvementReportDrafts`），Excel 导出读取已保存的 `improvementReportData`——「导入→核对→保存」为既定流程；测试补「保存本段」步骤后再导出。（HTML 导出为**混合来源**：文本取已保存数据、图表 PNG 取当前渲染实例——见 §3 发现 #2，存量行为记遗留。）
  4. **openpyxl 列表下标/行号错位**：`ws["A"]` 列表下标 0 起、`ws.cell(row=)` 行号 1 起，首版混用差一行把表头收进数据行——统一按下标遍历（行号=下标+1）。

## 3. 提交前代码审查记录（/code-review，high effort）

按约定（先 code-review 再提交）执行。审查返回 **10 项发现（9 CONFIRMED + 1 PLAUSIBLE，0 驳回）**，均非主路径阻断级（最强项 #1 由审查验证器实执行仓库自带 SheetJS 包复现：NaN 单元格写入 `<v>NaN</v>` 触发 Excel 修复提示）。逐项核实（源码定位/`type="month"` 输入确认/柱图降序 vs 后端序比对）后处置如下：

| # | 位置 | 发现摘要 | 核实结论 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | improvement-report-page.js:942 | `keepZero=true` 短路绕过旧 `>0` 过滤对非数值的隐式防护：JSON 编辑态存入 `"97.5%"` 这类值 → `Number()` 得 NaN 写入 xlsx `<v>NaN</v>`，Excel 打开弹「文件已损坏/修复」（验证器实执行 vendored 库复现） | 属实（正确性级） | **采纳**：`pushKv` 改为 map→`Number.isFinite` 过滤（两口径一致丢弃非有限值）→ keepZero 三元 → 降序；jest 哨兵锁 `.filter((d) => Number.isFinite(d.value))` |
| 2 | improvement-report-page.js:706 | `buildExportHtml` 混合数据源：KPI/文本取已保存状态、4 张图 PNG 取当前渲染实例（草稿优先）；且本 diff 新测试注释声称「HTML/Excel 导出一致按已保存快照导出」失实 | 属实（存量行为，非本 diff 引入 HTML 路径） | **部分采纳**：修正测试注释为如实表述（HTML 文本取已保存数据、图表 PNG 取当前实例）；**行为变更不采纳**——「导入未保存即导 HTML 得到新图旧数」属存量口径（改需产品决策），记入 §8 遗留 |
| 3 | improvement-report-page.js:968 | 两张率子表按后端桶序写入而页面柱图降序（`buildBarOption`），与「子表口径与图一致」注释矛盾；且 per-call-site keepZero 布尔重复表述图表层语义 | 属实（序不一致已核） | **采纳**：keepZero=true 时按数值降序（对齐柱图），注释改写为「饼图口径/柱图口径」双口径语义；**共享图表定义重构不采纳**——改动面大于收益，运行时行为已由 e2e 同源断言+jest 哨兵锁住 |
| 4 | test_e2e:504 | 率表断言 `pairs == {} or all(isinstance(...))` 空转——`{'（暂无数据）': None}`、空区域、keepZero 回归（丢 0 值行）均可通过；本 diff 唯一新产品行为（率表保留 0 值行）未被强制 | 属实 | **采纳**：率表与页面柱图 `bar_pairs` 严格相等断言（含 0 值行；dict 比较天然序不敏感） |
| 5 | test_e2e:420 | 前置清理硬编码 `YM=202608` 而页面首载默认当前月，2026-09 起清理变空操作、每次运行留一份已保存报告污染共享库；且保存后无 teardown（违背本文件收尾惯例） | 属实（`#ir-month-input` 为 `type="month"`，可显式定月） | **采纳**：进页 `fill` 定 YM + dispatch change；整测法包 `try/finally`，收尾两步清理（含归档态） |
| 6 | test_e2e:484 | `region_pairs` 硬上限 60 行静默截断——DENSE 数据 53 个领域仅余 7 行余量，`domain` 自由文本无界，>58 行时断言报出「似数据丢失」的误导性 diff；pushKv 每表恒带尾空行，上限无终止价值 | 属实 | **采纳**：去掉上限，靠空行/（暂无数据）/下一标题终止符 |
| 7 | test_e2e:427 | 导入完成门 `整体接纳率` 空转——该 KPI 标签随默认零值无条件渲染，导入失败也立刻放行，故障后移为不透明的保存按钮 10s 超时 | 属实 | **采纳**：改等 `[data-ir-save='overall']`（编辑态）或 `导入失败`，后者显式断言不出现 |
| 8 | test_e2e:440 | 保存后固定 `wait_for_timeout(800)` + 无守卫 `getInstanceByDom().getOption()`——保存触发的重渲染先 dispose 全部实例再 `setTimeout(0)` 重挂，CI 负载下 800ms 预算可耗尽 → `getOption of undefined` 间歇失败 | 属实 | **采纳**：`wait_for_function` 等四图实例 `series[0].data.length ≥ 1` 再取对照真值 |
| 9 | test_e2e:486 | `region_pairs` 终止集不含 `（暂无数据）` 占位行——空序列产出 `{'（暂无数据）': None}` 而非 `{}`，报出费解 diff（当前无应用路径触达，可达性弱） | 合理（PLAUSIBLE） | **采纳**：占位行加入终止集合 |
| 10 | test_e2e:443 | 新嵌套 `pie_pairs` 与同文件领域用例内闭包逐字符相同（同套件第 3 份拷贝）；本文件既有模块级读取器惯例（`_pie_option_via_echarts`/`pie_legend_gap`） | 属实 | **采纳**：提升模块级 `pie_pairs(page, cid)`/`bar_pairs(page, cid)`，领域用例与新用例共用，一处维护 |

**审查附注（提交范围）**：审查指出 coverage 工件（`test/frontend_tests/coverage/lcov-report/index.html`）为时间戳级扰动、可考虑排除出提交——处置：**沿仓库既有惯例**（全量 jest 随跑再生成并随提交）继续提交，于此注明其性质。

审查修复完成后按回退规则**从接口测试起重跑全部测试**（§4、§5 数字均为重跑后的最终值）。

## 4. 接口测试结果（阶段 3，审查修复后重跑）

本次无接口/契约变更（纯前端导出函数 + 测试代码），按流程全量回归受影响面：

| 用例集 | 结果 |
| --- | --- |
| `test/test_m21_improvement_report.py` 全量（17 用例） | **17/17 通过** |
| jest `improvement-report-page.test.js`（19 用例，含 `pushKv` 四调用 + `Number.isFinite` 防修复哨兵） | **19/19 通过** |

## 5. 系统测试结果（阶段 4，审查修复后重跑）

| 场景 | 结果 |
| --- | --- |
| e2e `test/e2e/test_e2e_improvement_report.py` 全量（原 11 + 新增 1 = **12 用例**） | **12/12 通过** |
| 新增 `TestXlsxExportChartSeries`（审查修复后版）：定月+两步清残留→导入（门=编辑态保存按钮/导入失败）→保存→等四图实例带数据→点「导出 Excel」捕获下载→openpyxl 实读 xlsx：单 sheet「改进报告」；四段章节标题在位；二段 4 张子表标题+「名称/数值」表头在位；**四表均与页面同源严格相等**（双饼=饼图口径过滤 ≤0、双率柱=柱图口径含 0 值行，对照真值取自 echarts 实例）；三段一级/二级子表保留未受重构影响；`try/finally` 收尾两步清理 | 通过（套件内 + **单独运行均过**，单跑 1/1） |
| jest 全量回归（`test/frontend_tests`，覆盖率工件随全量再生成） | **819/819 通过**（18 套件因既有 ESM 问题无法运行，非本次引入） |
| 月报页不受影响：本次未改月报侧任何文件（CSS/JS 零触碰） | 通过（改动面核查） |

## 6. 测试覆盖结果（改动清单逐项核对）

| 改动点 | 覆盖用例/场景 |
| --- | --- |
| `buildExportXlsx` §2 新增四图源数据子表 | e2e 新用例（四表与页面图同源严格相等断言）+ jest 调用哨兵 4 条 |
| `pushKv` 上提两段共用 + 双口径（柱图口径=保留 0 值降序；饼图口径=过滤 ≤0 后端序） | 柱图口径：e2e 率柱子表与页面柱图（含 0 值行）逐项相等；饼图口径：e2e 双饼子表与页面饼图（过滤口径）逐项相等 |
| `pushKv` `Number.isFinite` 过滤（审查 #1，防 NaN 损坏 xlsx） | jest 哨兵 `.filter((d) => Number.isFinite(d.value))`（锁源码不回归） |
| `improvement-report-page.js` 文件头注释更新 | 无行为变化；jest 19/19 回归确认无触碰 |
| §3 既有两子表在重构（pushKv 上提）后不回归 | e2e 新用例断言「模块&特性（一级/二级）」标题仍在 |
| e2e 模块级 `pie_pairs`/`bar_pairs` 读取器（审查 #10 提升） | 领域四图用例 + 导出新用例实际执行（两处调用点） |
| jest 哨兵 5 条 | 目标套件 19/19 实跑通过 |

覆盖缺口：无（上表逐项均有用例/场景触达且全部通过）。

## 7. 修改清单

| 文件 | 变更要点 |
| --- | --- |
| `frontend/modules/pages/improvement-report-page.js` | 文件头导出说明补「二/三段图表序列以名称/数值子表补齐」；`buildExportXlsx`：`pushKv` 上提为 §2/§3 共用并扩展双口径参数（柱图口径 keepZero=true：保留 0 值+数值降序；饼图口径：过滤 ≤0+后端序；两口径均 `Number.isFinite` 过滤防 NaN 损坏 xlsx）；§2 KPI 后新增「改进诉求领域占比/改进诉求各阶段占比/责任田接纳率(%)/责任田超期率(%)」四张「名称/数值」子表 |
| `test/frontend_tests/__tests__/improvement-report-page.test.js` | 导出工具栏用例补 `pushKv` 四调用哨兵 + `Number.isFinite` 防 NaN 修复哨兵 |
| `test/e2e/test_e2e_improvement_report.py` | 模块 docstring 补导出条目；`import openpyxl`；新增模块级 `pie_pairs`/`bar_pairs` echarts 读取器（领域用例复用，审查 #10）；新增 `TestXlsxExportChartSeries`：定月+两步清归档残留→导入（编辑态门）→保存→四图带数据守卫→下载→openpyxl 实读，四表与页面同源严格相等，`try/finally` 收尾清理 |
| `test/frontend_tests/coverage/lcov-report/index.html` | jest 全量回归随跑再生成（仓库惯例随提交；内容为时间戳级扰动，见 §3 附注） |
| `docs/reports/20260824-xlsx-chart-series-tables.md` | 本报告 |

## 8. 遗留风险与后续事项

1. **HTML 导出混合数据源（审查 #2，存量行为，行为变更未采纳）**：导入未保存时点「导出 HTML」得到「新图旧数」的自相矛盾文档（图 PNG 取当前渲染实例、KPI/文本取已保存快照）。属本任务之前即存在的口径（本 diff 未改 HTML 导出路径），改需产品决策（统一取已保存 / 导出前提示未保存段），不影响本次闭环。
2. **Excel 仍不含图片**（既定设计，非缺陷）：带图导出走「导出 HTML」；若未来需 Excel 内嵌图表 PNG，需引入 exceljs（方案 B，~1MB vendor）——已在方案评审中给出对比，未采纳，留待产品需要时再立项。
3. **keepZero 口径与图表层联动**：饼图口径/柱图口径由调用点布尔表述（未做共享图表定义重构，审查 #3 部分不采纳）；若未来图表过滤策略变更，子表口径需同步——jest 哨兵锁调用方式、e2e 同源断言锁运行时行为，口径人工变更时会显式失败提醒。
4. **覆盖率工件时间戳扰动**：按仓库惯例继续随全量 jest 再生成提交（审查附注曾建议排除）；如后续想减小提交噪声，可另议 .gitignore 策略。
5. 不影响闭环。
