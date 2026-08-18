# 代码审查报告：qi_analytic_improve 分支待提交变更（4 任务合并）

> 审查方式：/code-review（high effort，7 角度并行查找 + 逐项对抗验证）；审查对象：当前工作区未提交变更（Task A/B + 在研责任田两层模型 + 占比饼图遮挡修复）。
> 执行说明：审查期间机器反复休眠，杀死主流程 1 次、子代理 9 次；已通过逐次恢复 + 转录抢救补齐，**验证阶段全部完成**。查找角度 A1（ticket 系细读）/A2（前端逐行）/C（跨文件追踪）未完成，如实标注为覆盖缺口。

## 最终 Top 10（按严重度排序，均经对抗验证 CONFIRMED）

| # | 位置 | 问题 | 失败场景 |
|---|------|------|---------|
| 1 | `backend/routers/qi.py:1306` | `set_stage_sla_config` 全量 DELETE 后按 payload 重插：**部分 payload 会清掉未提交阶段的 SLA 行** | 旧版参数页只发 propose/review/acceptance（历史上正是如此）→ 0122 种子的 analysis/closure SLA 行被删；`_compute_overdue` 对缺失阶段 hours=0 恒 False → 列表/分析/报告的**超期检测静默失效** |
| 2 | `backend/routers/qi.py:1611`（对比 `:293`） | 验收阶段当前处理人两处口径不一致：列表 SQL 无条件取 proposer，analytics SQL 取 COALESCE(qi_stage.responsible, proposer) | `transfer_qi` 转单只写 qi_stage.responsible 不改 proposer → 转单后的验收单在 analytics 的 handler_stage_distribution 显示受让人、列表「当前处理人」显示提出人 |
| 3 | `backend/routers/qi.py:2187/2222/804` | accept-version：DDL 在两个端点重复；GET 在未迁移环境建**空表**（缺 507.x 种子）；POST 全删重插 sort_order 0..N-1 与 0122 种子的 1,2,3 **冲突**；`submit_qi` 表缺失/为空时**静默跳过校验** | 未迁移环境提交必填的解决版本 → 存入空值/任意值，无报错 |
| 4 | `frontend/modules/constants/qi.js:71` + `frontend/modules/pages/qi-page.js:1190` | 解决版本必填 select 无静态选项，选项仅靠 fetch 注入且 `.catch(()=>{})` 吞错 | fetch 失败 → 空 select 提交 "" → 后端 400「解决版本为必填项」阻塞闭环提交且无前端提示；存量自由文本草稿重新提交 → 400「不在可选项中」 |
| 5 | `backend/routers/qi.py:1265` | `_compute_overdue` 不再使用 `sla_time`（旧逻辑闭环超期=用户承诺时间）；该字段仍必填、仍展示、仍导出但**完全失效** | 用户承诺早于 started_at+336h 的 SLA 日期 → 闭环项仍显示不超期（绿灯）直至 336h 窗口耗尽 |
| 6 | `backend/routers/ticket_assistant.py:74` | `_strip_html` 只做标签剥离，**丢失实体反转义**（与 `utils/html_text.strip_html_plain` 重复且行为更弱） | 富文本描述生成工单标题 → 标题保留字面 `&nbsp;`/`&amp;` |
| 7 | `frontend/modules/pages/qi-page.js:762` + `frontend/modules/pages/stats.js:1436` | SVG→ECharts 迁移后柱状图**丢失数值标签**（原 showValues:true）；`opts.aria` 参数成死参数 | 用户只能悬停看值，无法一眼读数；无障碍标注丢失 |
| 8 | `test/e2e/test_e2e_qi_config.py:301` | 删除了 `test_e2e_qi_zoom_tooltip.py`，替代用例只断言 canvas 可见 | qi 图表 hover/tooltip 内容**零覆盖**，tooltip 回归无护栏 |
| 9 | `backend/routers/qi.py:1257` | `_load_stage_sla` 无视传入的 `_conn` 参数，每次调用新建无池化 psycopg 连接 | 每个分析请求 1 次额外 TCP+认证握手；改进报告导入每次 2 次 |
| 10 | `backend/routers/improvement_report.py:426/514/556` | 重查询双 LATERAL `_inflight_rows` 每请求执行 2-3 次；`_research_field_buckets` 重复拉取；`_compute_domain` 循环内每模块一条含双相关 EXISTS 的聚合 SQL（与 `_rf_rates` 已算好的分组重复） | N 个责任田模块 = N 次额外全窗扫描；报告导入延迟与 DB 负载放大 |

## Cap 之外已验证发现（列出备查，未进 Top 10）

- **H2**：`improvement_report.py:163-173` `_HANDLER_CASE` 与 `qi.py:1608-1618` analytics SQL 逐字重复（含 LATERAL join）——应抽共享 helper（该文件已有从 routers.qi import 的先例）
- **Q2**：`qi-page.js:273/687/735` 图表挂载三份拷贝有漂移（仅 resize 有 isDisposed 守卫）
- **Q3（仅清理）**：`qi-page.js:668/771/807` 堆叠聚合三份重复（行为差异未证实，漂移风险真实）
- **M1**：`db/migrations/0121_qi_accept_version_whitelist.sql` 文件名与内容不符（实际种子是 improvement_report 白名单）；迁移追踪按文件名判重，任何记录过其它 0121 的环境永远不执行这些 INSERT → 管理员看不到「改进报告」菜单且无报错（PLAUSIBLE，部署为手工 psql）
- **M2**：0119/0123 create-then-drop 反复折腾 + 未提交的重命名，陈旧库对账不确定（PLAUSIBLE）
- **F4**：`improvement_report.py:399-429` `_compute_overall` 5 条独立 COUNT 扫同一窗口（3 条相同 EXISTS）→ 单条 COUNT(*) FILTER
- **F5**：`showcase-page.js:413` 每次重渲染 dispose+重建 three.js WebGL 轮播并无缓存重拉 /api/showcase（模块变量 showcaseItems 从未复用）
- **F6**：`improvement-report-page.js:1096` 每次绑定全量 dispose+重挂 4+5N 个 echarts 实例（20 模块=每次渲染 104 个实例）
- **R1**：`params.py:238` 与 `qi.py:1347` 在研责任田加载逻辑完全重复
- **R2/R3**：月报 helper 前后端逐字拷贝（monthly-report-page ↔ backend）
- **R5**：同文件 harvest/sync 重复

## 已驳回（对抗验证不成立，如实记录）

- **M3**：0105 的编辑仅涉注释 → 无行为影响
- **V3**：analytics 草稿排除是刻意设计且有测试锁定
- **Q3 行为差异主张**：仅保留重复清理项

## 覆盖缺口（如实标注）

- 查找角度 A1（ticket-assistant 后端细读）、A2（前端逐行扫描）、C（跨文件 seam 追踪）因机器反复休眠未完成——ticket-page.js / ticket-assistant-page.js / showcase 内部无系统逐行覆盖；跨文件追踪仅覆盖验证代理触达的范围
- 规范角度（conventions）为空：仓库与用户目录均无 CLAUDE.md
- 效率角度（F）与验证结论完整；SLA/处理人/迁移/图表角度完整

## 结论

10 项 CONFIRMED（含 5 项正确性级：#1 SLA 清空、#2 处理人口径、#3 校验跳过、#4 表单阻塞、#5 死字段），提交前建议至少修复正确性级发现；效率/清理项可后续任务处理。
