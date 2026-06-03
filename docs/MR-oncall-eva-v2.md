# MR：迁入无流转单不臆造中间阶段 + 运维效率按组分流口径(v2)

> 分支 `dev_com2` → `windows`。本文件随分支提交，便于在 Gitee 上发 MR 时直接引用。

## 概述

延续「迁入工单各阶段处理人塌缩为提单人」的修复，并按新需求把运维效率三项指标重构为
ONCALL / R&D 按组分流口径，附带两处前端展示改进。

（前置修复 `aaf3ada` next_assignee 还原、`4207df9` 迁入诊断脚本已随 #14/#15 合入 `windows`。）

含 4 个提交：

| commit | 内容 |
| --- | --- |
| `d12a2f9` | fix(legacy): 迁入无流转记录工单不臆造中间阶段处理人 |
| `06bb40d` | feat(oncall-eva): 运维效率三项指标改为按组分流口径(v2) |
| `3be89bd` | feat(oncall-eva): 团队条月度闭环/工单门槛按组展示明细 |
| `dc95f11` | feat(oncall-eva): 第一幅图默认聚焦本组得分最高者 |

## 1. 迁入无流转记录的工单（`backend/legacy_migration.py`）

**问题**：老库 `t_work_flow_task` 对某实例无任何流转记录时，原兜底分支把每个已完成阶段
都填成提单人 → 迁入后各阶段「最后处理人」全部塌缩成提单人，污染运维效率归属/SLA/独立闭环。

**修复**：源库没有逐阶段处理人就不臆造中间阶段，只还原确知两段——「问题填写」(提单人
`creator`) +「当前/末节点」(当前处理人 `current_assignee`，闭单即审核关闭人)，中间阶段不生成
节点实例/流转日志。

**后果**：这类历史工单因无运维分析记录，不计入运维效率（真实数据缺失，而非算错人）。

## 2. 运维效率口径 v2（`backend/routers/oncall_eva.py`）

- **当月基准（三项共用）**：去掉 `action_type='close'`/status 判断 → 工单流转中到达过
  `dev_closure`/`ops_closure`/`audit_close` 任一节点即算闭环（到了就算，含未关闭单）；
  月份按提单月 `ticket.created_at`。
- **按 `user_account.group_name` 分流 ONCALL / R&D**：

  | | ONCALL | R&D |
  | --- | --- | --- |
  | 归属 | 运维分析 `ops_analysis` 最后提交人 | 开发分析 `dev_analysis` 最后提交人 |
  | 独立闭环率（非独立条件） | 走过 运维分析→开发分析 | 开发分析节点 `collaborator` 非空 或 开发分析多人处理 |
  | SLA | 问题审核+运维分析+开发分析+运维闭环 四段累加（维持） | 仅开发分析阶段停留 |

- **工单门槛 / 月度闭环按组分别统计**（人均×0.8），`team.groups` 返回各组
  `headcount/total_tickets/ticket_threshold`，打分时每人对照本组门槛。

## 3. 前端展示（`frontend/modules/pages/oncall-eva-page.js`）

- 团队条「月度闭环 / 工单门槛」下以小字展示各组明细（如 `ONCALL 3 · R&D 2`），
  消除「全部」视图合计跨组双算的歧义。
- 第一幅图（主角成绩单）默认聚焦本组得分最高者（原默认当前登录人）；点击排行/矩阵/明细
  仍可切换，切组后重置回榜首。

## 测试

- 后端：`test/test_m12_legacy_migration.py`(6) + `test/test_m13_oncall_eva.py`(36，含
  ONCALL 060~063、R&D 080~085) = **42 passed**。
- 前端：`oncall-eva-team-breakdown`(6) + `oncall-eva-focus`(4) = **10 passed**。

## 部署注意 ⚠️

1. **需重启后端**让新逻辑生效。
2. **存量已迁工单是修复前脏数据**，受影响工单需删除后重迁（`legacy_instance_id` 唯一索引
   保证幂等）；可用 `scripts/diagnose_migrated_handler.py YW单号` 抽查。
3. 运维效率依赖 `user_account.group_name ∈ {ONCALL, R&D}`，请确认生产用户已正确分组。
4. 确认生产已执行迁移 `0072_user_account_expert_domain.sql`。

## 风险

- 运维效率历史月份数字将随老单陆续闭环而增长（提单月口径，非定格），符合需求确认。
- 「全部」视图顶部月度闭环为两组合计，跨组单会双算；准确分组数见 `team.groups` 及团队条小字明细。
