# Database-O-M-System

**运维工单平台** — 一个面向数据库运维团队的自动化工单流转与管理系统。

---

## 目录

- [工程概述](#工程概述)
- [核心功能](#核心功能)
- [技术架构](#技术架构)
- [安装部署指南](#安装部署指南)
- [使用说明](#使用说明)
- [目录结构](#目录结构)
- [开发规范](#开发规范)
- [API文档](#api文档)
- [功能测试](#功能测试)
- [常见问题解答](#常见问题解答)
- [CHANGELOG](#changelog)
- [版权信息](#版权信息)

---

## 工程概述

### 项目背景

Database-O-M-System 是一个流程型运维工单系统，核心特征是「节点流转 + 历史可追溯 + 多端状态一致」。该系统旨在为数据库运维团队提供标准化的工单处理流程，支持从问题填写到最终闭环的全生命周期管理。

### 设计理念

- **后端真值优先**：流程状态、字段取值、权限判定等核心逻辑由后端统一管控，前端仅负责渲染与交互编排。
- **规则驱动开发**：通过 `.cursor/rules/` 下的规则文件定义业务语义，确保跨模块实现的一致性。
- **可追溯性**：所有工单流转、字段变更均有完整日志记录，支持审计与回溯。

### 适用场景

- GaussDB/PostgreSQL 数据库运维工单管理
- HCS（华为云服务）问题处理流程
- 多团队协作的运维工作流转

---

## 核心功能

### 1. 工单流程管理

系统支持完整的工单生命周期管理，包含以下节点：

| 节点 | 节点键 | 说明 |
|------|--------|------|
| 问题填写 | `problem_fill` | 发起工单，填写基础信息 |
| 问题审核 | `problem_review` | 审核问题范围与严重性 |
| 运维分析 | `ops_analysis` | 运维侧问题定位与分析 |
| 开发分析 | `dev_analysis` | 开发侧问题深入分析 |
| 开发闭环 | `dev_closure` | 开发侧问题修复与验证 |
| 运维闭环 | `ops_closure` | 运维侧问题闭环确认 |
| 审核关闭 | `audit_close` | 最终审核与工单关闭 |

### 2. 流转动作

- **提交下一节点**：按处理方式流转至指定节点
- **跳转提交**：跨节点流转
- **回退**：仅支持回退至上一节点
- **挂起/恢复**：暂停与恢复工单处理
- **关闭**：最终关闭工单

### 3. 处理人规则

- 每个节点仅一名处理人
- 支持发起人选择或规则自动带出
- 白名单机制控制可选处理人范围

### 4. 权限管理（RBAC）

- 基于角色的权限控制
- 支持权限级联约束
- 白名单功能权限配置

### 5. 值班管理

- 内核/管控/公有云/POC/在研版本值班日历
- 月历值班表 Excel 批量导入（整月覆盖）：各月历块提供「下载模板」「导入」，模板由前端生成；与「编辑」按钮共用权限项 `duty_roster_edit`（白名单控制）
- 内核/管控/公有云/POC/在研版本轮值表管理
- 专项轮值（慢SQL、性能、升级、扩容、备份、容灾）
- RL值班表公开页面（`/rl-oncall`）：独立 URL，不要求登录认证，无侧边栏，只读展示值班纪律、今日值班横幅与排期表格；后端 GET `/api/duty/rl-oncall` 免认证（方法限定白名单，仅 GET 豁免，PUT 仍需认证）
- 请假申请与审批

### 6. 质量改进（原「需求管理」）

- 侧栏入口标签为「质量改进」（路由键仍为 `req:manage`）；表格宽度铺满内容区，列自适应
- 表格列（迁移 `0083_requirement_quality_improvement.sql` 重整模型 + `0084` 增「提出时间」）：**编号（自增）/ 分类 / 代表问题 / 所属领域 / 模块&特性 / 问题描述 / 改进诉求 / 优先级 / 提出人 / 提出时间 / 接纳状态 / 计划版本**
  - 提出时间为可编辑日期（`proposed_at`），新建默认当天、随导入/导出/编辑一并维护
  - 分类：定位定界 / 测试加固 / 快速恢复 / 需求 / 质量加固和改进
  - 优先级：高 / 中 / 低（列表按 高→中→低 排序）
  - 接纳状态：待评审 / 已实现 / 已接纳 / 部分接纳 / 拒绝（新建默认「待评审」；可直接编辑，无流转约束）
- 编号为全局自增流水号（建项时分配，导入时编号为空=新增、填写已有编号=更新该项）
- 新建 / 编辑 / 删除：弹窗表单覆盖上述字段（**改进诉求、提出人必填**）；删除仅创建人可操作
- 搜索：编号 / 分类 / 代表问题 / 领域 / 模块&特性 / 问题描述 / 改进诉求 / 提出人 / 接纳状态 / 优先级 / 计划版本（防抖 400ms）
- 筛选与范围：支持「全部 / 我提出的」范围，分类 / 优先级 / 接纳状态多值筛选；分页
- 分析看板（📊 分析）：质量改进总数 / 已实现 / 拒绝 KPI，接纳状态分布、分类分布、优先级（高/中/低）分布、新建趋势、提出人 Top10
- 操作日志：记录创建 / 编辑 / 状态变更
- 导出：点击「导出」导出全部为 Excel，列与导入模板完全一致（不含创建人/时间戳列），**导出文件可直接再导入**；权限项 `requirement_export` 控制按钮显示（默认 hidden，需白名单授予）
- 导入：点击「下载模板」获取 Excel 模板（表头按上述列名匹配，**第 2 行起为数据；模板第 2 行为示例，导入前请改为真实数据或删除**），填写后「导入」批量入库；「改进诉求」为空的行自动跳过；非法枚举（分类/优先级/接纳状态）自动回落默认值；权限项 `requirement_import` 控制「下载模板」与「导入」按钮显示
- 权限控制（权限策略 → 配置白名单）：`requirement_list` 控制侧栏「质量改进」入口与页面访问（深链 `/requirements` 无权限时回落到首个可见页）；`requirement_create` 控制「新建」及编辑/删除；`requirement_import` 控制「下载模板」「导入」；`requirement_export` 控制「导出」（默认 hidden）。子项与父项级联：父项为不展示时子项策略不可高于父项
- 后端：`backend/routers/requirement.py`（`/api/requirements`）+ `db/migrations/0083_requirement_quality_improvement.sql`

### 7. 数据统计与导出

- **统计图表**（`/stats/charts`）：人力投入、问题归属、Doer 三 Tab 通过 `GET /api/stats/charts` 按时间范围服务端聚合，不再将全量工单载入浏览器；数据源优先 `ticket_stats_daily` 日汇总（约 730 行/两年），未回填时回退 `ticket_list_snapshot` 行级聚合；时间口径为 `start_date`（无则回落 `created_at` 日历日）；工单 submit / 快照 refresh 时增量维护日汇总

- 工单列表多维度筛选
- 工单搜索功能
  - 在工作台搜索框输入关键词，实时搜索工单
  - 搜索匹配全部文本字段（约87个字段，包含所有节点数据）
  - 支持搜索工单号、标题、处理人、描述、局点、问题阶段、DTS单号等
  - 搜索结果自动适配权限策略（仅显示用户可见的工单）
  - 中文输入支持（防抖 800ms，Enter 键立即搜索）
- SLA 时间计算：列表以 `ticket.created_at` 为起点；未关闭工单用当前时间，已关闭工单以 `closedAt`（最后一次 close 流转）为终点，关闭后不再增长
- 表格列选择功能
  - 点击「选择列」按钮可自定义表格展示列
  - 支持选择各流程阶段的文本字段（约87个可选）
  - 默认展示9列：流程ID、当前阶段、起始日期、问题严重性、局点、问题阶段、当前处理人、问题描述、SLA时间
  - 支持同字段名不同节点的列同时显示（如同时显示「运维分析-是否咨询问题」和「开发分析-是否咨询问题」）
  - 列配置保存到 localStorage，最多选择15列
  - 提供搜索功能快速定位列名
- 开发分析/运维分析「引入版本」「修复版本」下拉支持输入关键字检索（选项实时取自参数配置「版本模块」的基线版本与热补丁版本）；「修复版本」在版本选项之外额外提供「未修复」选项（引入版本不含），且支持多选
- 数据导出功能
  - 导出格式：Excel (.xlsx) 默认、CSV (.csv) 可选
  - 导出范围：已选中工单、全部工单（当前筛选条件下的全部可见工单）
  - 字段选择：支持选择各流程阶段的文本字段（约87个），默认全选，可按节点分组展开/折叠
  - 文件名：默认格式 `{账号}_{日期}`，可自定义前缀
  - 权限控制：`workbench_export` 权限项控制按钮显示
  - 大批量导出：工作台服务端分页列表或导出条数超过 500 时，由 `POST /api/tickets/export-file` 在服务端按批查询并生成文件；浏览器仅传递选中单号或列表筛选条件，不将数万条工单载入内存（上限 50000 条）

### 8. UI 主题

- 浅色/暗黑（NOC 暗色）/护眼/粉色/蓝紫五套主题
- 支持自定义背景图
- 预设背景皮肤

### 9. 智能助手（AI Assistant）

- 多轮对话：用户可通过自然语言提问，AI 通过 ReAct 模式查询数据库并给出分析答案
- TOP10 快捷问题模板：预设常用问题，支持用户自定义快捷问题
- ReAct 推理引擎：Thought → Action → Observation 循环，自动生成 SQL 查询数据库
- 安全只读：仅允许 SELECT 查询，禁止 INSERT/UPDATE/DELETE 等修改操作
- 双级 LLM 配置：系统级默认大模型 + 用户级个人大模型，用户配置优先
- 连通性测试：系统配置和个人配置均支持测试 LLM API 连通性
- 推理过程透明：可展开查看 AI 的推理步骤、执行的 SQL 和查询结果
- 会话管理：创建/切换/删除对话，自动以首条消息命名会话标题

### 10. 深度分析（AI Export）

- 入口：左侧导航「智能助手 → 深度分析」
- 四步骤向导式流程（方案 C — 每步只回答一个问题）：
  1. 查询数据：自然语言描述 → LLM 生成 WHERE 子句 → 确认匹配数
  2. 选择字段：92 字段复选框（复用工作台导出结构）+ 数据预览 → 确认内容
  3. 清洗规则：自然语言描述 → LLM 翻译为结构化规则（mapping/computed/llm_reasoning）
  4. 导出/报告：全量处理后导出 Excel，或 LLM 生成 ECharts 分析报告 HTML
- LLM WHERE 生成：`POST /api/ai-export/query-by-description` — 只生成 WHERE + COUNT，不创建 task
- 数据预览：`POST /api/ai-export/preview-rows` — 全量字段预览（前端过滤显示列）
- 规则类型：mapping（值映射）、computed（数值计算）、llm_reasoning（LLM 推理判断）
- System 字段注入：processId、currentStage、currentHandler、creatorName、closed_at、created_at（slaTime 待完善）
- LLM 推理分批处理：每批 50 行，独立事务，失败不阻断
- 分析报告：LLM 根据聚合数据 + 用户提示词生成自包含 HTML（内联 ECharts JS），DOMPurify 清洗后渲染
- 规则模板：预设模板 + 用户自建模板可复用（含 natural_description + where_sql）
- 权限控制：白名单键 `ai_export`（入口可见性）、`ai_export_template`（模板管理），默认 hidden
- 后端：`db/migrations/0080_ai_export.sql` + `0085_ai_export_natural_query.sql` + `backend/routers/ai_export.py`

### 11. SSO 单点登录

- 企业 SSO 集成：与企业统一认证系统对接，实现单点登录
- 自动认证检测：前端自动检测 SSO Cookie，无 Cookie 时重定向到登录页
- 用户头像组件：右上角显示用户名首字符头像，悬停显示下拉菜单
- 个人信息查看：点击头像下拉菜单查看用户详细信息（用户名、域账户、邮箱、角色、用户组）
- 安全注销：清除 localStorage 和 SSO Cookie，重定向到 SSO 登录页
- 测试模式支持：通过环境变量 `SKIP_SSO_AUTH=1` 跳过认证（测试/开发环境）

### 12. 运维效率（原 oncall 评议）

- 综合得分：基于 SLA(35%)、独立闭环率(30%)、工单量(20)、加分项(≤15) 与红/黑事件加成自动计算
- 三项指标判定依据（口径 v2，**按组分流**；占比与分数算法不变）：
  - **当月工单基准（三项共用）**：以**提单月**（`ticket.created_at`）归月；工单只要流转中**到达过** `dev_closure`/`ops_closure`/`audit_close` 任一节点即算「闭环」计入，**不再要求** `action_type='close'` 或 status 关闭（到了就算，含未关闭工单）
  - **分组**：按 `user_account.group_name` —— `ONCALL`（运维组）/ `R&D`（研发组），两组各用各的归属与算法
  - **归属人**：ONCALL=运维分析阶段最后一次提交人（`from_node=ops_analysis`）；R&D=开发分析阶段最后一次提交人（`from_node=dev_analysis`）。同一张单可分别计入一个 ONCALL 人和一个 R&D 人
  - **工单数量**：各自归属到的单数
  - **独立闭环率（非独立条件）**：ONCALL=走过「运维分析→开发分析」；R&D=开发分析节点 `collaborator` 字段非空，或开发分析阶段有多个不同处理人
  - **SLA**：ONCALL=「问题审核+运维分析+开发分析+运维闭环」四段停留之和（维持原样）；R&D=仅「开发分析」阶段停留时长
  - **工单门槛 / 月度闭环**：按组分别统计（人均×0.8），避免两组互相稀释；`team.groups` 返回各组 `headcount/total_tickets/ticket_threshold`；页面顶部团队条在「月度闭环 / 工单门槛」下以小字展示各组明细（如 `ONCALL 3 · R&D 2`）
  - **评议对象只含在册组成员**：仅取 `user_account` 中的活跃非 admin 用户（按组），**不**把「有单但不在花名册」的账号（多为迁移历史工单的老操作人）补入列表——否则会把团队人数与门槛分母撑大（如 ONCALL 在册 32 人被算成 80+）。归属到非在册账号的工单不计入任何人
  - **工单数置信因子**：SLA、独立闭环率是「率/均值」，1 个又快又独立的单就能拿满质量分(65)；为此质量分按 `vol_factor = clamp(个人工单数 / 团队基准(人均×0.8), 0.3, 1.0)` 缩放——工单少按比例打折、达基准满分、设 0.3 下限避免被压到接近 0。返回里含 `vol_factor` 与缩放前 `sla_base/closure_base`
- 关键指标：页面顶部固定展示评议规则口径，便于成员对照打分逻辑
- 评议周期：支持月/季度自动切换，季度模式聚合 3 个月数据
- 组别筛选：评议周期旁的「组别」下拉框，选项来自 `user_account.group_name` 去重非空值（`GET /api/oncall-eva/groups`）；选中后 `GET /api/oncall-eva/scores?group_name=` 仅返回该组**在册**成员，「全部组别」不过滤
- 部门筛选（**多选**）：「组别」旁的「部门」勾选下拉（组内细分），选项取自 `user_account.min_dept`（`GET /api/oncall-eva/departments?group_name=`，传 group_name 时仅列该组内的部门）；勾选多个部门取**并集**，请求 `GET /api/oncall-eva/scores?group_name=&min_dept=&min_dept=…`（min_dept 可重复传多个），按所选部门收敛人员，**工单门槛随之按「组∩所选部门(并集)」内成员人均×0.8 重算**，ONCALL / R&D 仍各算各的（不混合）。不勾=全部部门；切换组别会清空已选部门并按新组重拉部门列表
- 列表视图：以 list 方式呈现成员排名、各维度得分、加分项与红黑事件，支持点击行展开明细
- 加分项申报与审批：支持效率/赋能/知识/公共事务/出差五大类目，含撤回与优秀拉满
- 红/黑事件：管理员可录入正/负向事件，单次 ≤5 分，不计权重直接加减总分
- 权限控制：入口由权限策略白名单 `oncall_eva` 控制（默认 hidden；迁移 0035/0041 已为内置「admin」「管理员」角色种入可见态）；`oncall_eva_review` 控制审批与红黑事件录入

### 13. 月度报告

- 入口：左侧导航「数据报表 → 月度报告」展开「问题报表 / 报告生成 / 报告归档」三个子项
- 问题报表：支持上传两份 Excel（历史问题列表、新增问题列表），以新增列表的字段为 schema，按 `DTS 单号` 在历史列表中匹配并补齐空白字段，未命中字段保持为空
- DTS 列识别：自动识别 `DTS / DTS单号 / DTS号` 等列名，匹配大小写与首尾空白不敏感
- 表格导出：合并结果可一键导出为 `.xlsx`，列顺序与新增列表一致
- 报告生成：占位页面，后续迭代输出
- 权限控制：「月度报告」整组（父菜单 + 问题报表 / 报告生成 / 报告归档）由权限策略白名单 `monthly_report` 统一控制可见性（默认 hidden；迁移 0041 已为内置「admin」「管理员」角色种入 editable）。未授权角色侧栏不渲染入口，深链 `/report/issue`、`/report/generate`、`/report/archive` 不会停留在月报页

### 14. 现网重大问题月度分析报告

- 入口：左侧导航「数据报表 → 月度报告 → 报告生成」分段编辑+归档
- 顶部横幅：暗红色标题块（`xxxx现网重大问题月度分析（YYYY年M月）` 标题 30px + `拟制 / 审核` 行 20px），横幅右上角内置「编辑/保存/取消」按钮，无需滚到「整体情况」即可改写产品名与拟制/审核人（与 overview 段共用编辑态）；HTML 导出字号与字体/配色均与网页一致
- 富文本编辑：整体情况 4 段、问题详情段、重大问题/改进诉求表格单元格的编辑区均支持**加粗 + 预设字体颜色**（工具条 `frontend/modules/ui/rich-text.js`，execCommand 实现，DOMPurify 清洗，仅允许 b/strong/i/em/u/span/font/br/div/p 与 color/font-weight 样式）；存储为清洗后的 HTML。网页只读与 **HTML 导出**输出同一份 HTML，字号/加粗/颜色一致；**Excel 导出**经 `richToPlainText` 退化为纯文本
- 五段结构（均按段保存）：
  - 一、整体情况：4 个文本段（重大事故 / 问题分析 / 风险模块 / 质量改进反馈）
  - 二、问题透视：KPI 卡片 + 4 个 ECharts 图（影响分类 / Top 模块 / Top1 / Top2 拆解），数据通过 JSON 编辑
  - 三、重大问题：5 个分类（coredump / 数据正确性&一致性 / 满 / hang/慢 / 升级），10 列表格（局点 / 版本 / 问题编号 / 描述 / 根因 / 影响 / 领域 / 模块 / 责任 XM）；列宽用 `MAJOR_COL_WIDTHS` 固定，HTML 导出与网页一致（`table-layout:fixed` + 同一 colgroup）
  - 四、改进诉求：合并标题行 +「编号 / 问题描述 / 改进目标 / 负责领域 / 责任人」5 列
  - 五、问题详情&质量改进记录：单一段落（textarea ↔ 只读），不再使用表格
- 段头样式：天蓝色横条
- 从本月工单导入（问题透视 / 重大问题 / 改进诉求各段头「编辑本段」左侧的「导入」按钮；归档态隐藏）：按所选报告月份从工单聚合计算后填入草稿，进入编辑态供核对，再「保存本段」。归月口径 = 工单 `created_at`（Asia/Shanghai 自然月）；**内核质量问题** = 问题组件（`component`）为「内核问题」且 是否质量问题（`is_quality_issue`）∈{是（已知质量问题）, 是（新发现质量问题）}，字段按「流程最后出现节点」取有效值；其中 `is_quality_issue` 的质量结论具有**粘性**——分析阶段一旦判定为质量问题，后续回退/重提改回「否」不翻案（避免漏计），仅在两种质量取值间更新为最后一次质量判定。磐石版本相关暂不计算（KPI 的 `pansh_*` 保留页面手填值）
  - 问题透视（`GET /api/monthly-report/{ym}/import/insight`）：KPI 问题总数/已知/新发现按内核质量问题计数；影响分类只统计 `issue_type` ∈ {coredump, 数据不一致, 慢, 满, hang, 集群状态异常}（按 DTS 单号去重）；Top 模块取引入模块（`issue_intro_module`）第二级子模块去重 Top10；Top1/Top2 拆解分别为 coredump / 满 的根因分类（`root_cause_category`）去重分布
  - 重大问题（`GET /api/monthly-report/{ym}/import/major`）：取本月**内核质量问题**，按 `issue_type` 归 5 类（coredump / 数据不一致→数据正确性&一致性 / 满 / hang·慢）——「重大问题类型」即指这 5 个分类（问题性质），**与工单事件级别无关、不按 `event_level` 过滤**；未命中类型但「是否涉及内核升级」为「是」归「升级」组，其余（错 / 集群状态异常 / 咨询问题等且非内核升级）不导入（不去重，每单一行）；列映射：局点←`location`、版本←`gauss_version`、问题编号←`dts_no`、问题描述←`issue_desc`、根因/进展←`root_cause`、问题影响←`event_level`、问题领域←引入模块第一层、模块/特性←引入模块第二层及以后；责任 XM 不导入、手动填写
  - 改进诉求（`GET /api/monthly-report/{ym}/import/improve`）：数据来自「质量改进」(requirement)。**领域占比 / SQL 领域改进 / 存储领域改进**取**全部**质量改进数据（不限月份）——领域占比按 `domain`（所属领域）分组计数，SQL/存储分别取 domain 含「SQL」/「存储」的项按 `module_feature`（模块&特性）分组计数；**本月新增改进诉求**表仅取 `proposed_at`（提出时间）落在所选月份的项（按业务提出时间归月，而非入库时间 `created_at`——避免批量补录时把历史月份的诉求全部计入当月），映射 编号←requirement_no / 问题描述←description / 改进目标←improvement / 负责领域←domain / 责任人←proposer（表格列宽：编号6字符、负责领域/责任人各20字符、问题描述与改进目标等宽，HTML 导出同步）
- 归档/取消归档：归档后所有段不可编辑、月报不可删除；可一键导出 HTML 或 Excel
- 导出 Excel：单 sheet 堆叠 5 段（与 HTML 排版一致），含暗红色横幅、天蓝段头、表头底色与边框；问题透视 4 个图表数据按 2x2 网格、改进诉求 3 个图表数据按 1x3 网格横向并列（贴合 HTML chart-grid 分布），依赖 xlsx-js-style
- 后端：`db/migrations/0036_monthly_report.sql` + `backend/routers/monthly_report.py`，5 段以 JSONB 存储，无字段级 schema 校验

### 15. 小鲁班消息推送

- 功能：通过第三方小鲁班消息服务发送通知消息
- 生产环境配置：需在 `backend/.env` 中设置 `XIAOLUBAN_MESSAGE_URL` 和 `XIAOLUBAN_MESSAGE_SEND_TOKEN`
- 响应格式：`{"success": true/false, "message": "结果说明"}`
- 工单流转通知：HCS工单流转到「问题审核」「运维分析」「开发分析」节点时，自动向该节点处理人推送小鲁班通知消息（包含工单号、当前节点、起始日期、严重性、局点、问题组件、问题描述、工单链接）；问题描述超长时截取前100字符；正向流转、回退、重分配均触发通知；通知失败仅打印error日志，不影响工单主流程；工单链接为完整 URL：`{链接前缀}/tickets/{工单号}`，链接前缀优先取 `APP_PUBLIC_BASE_URL`，未配置时默认 `https://gaussdb-ops.rnd.huawei.com`
- 问题审核群通知：工单在「问题审核」节点选择「确认问题」提交后，向指定群推送通知（含流程ID、起始日期、局点、问题阶段、产品线、问题严重性、问题组件、eCare单号、问题描述；问题描述超长时截取前100字符）；群号通过 `XIAOLUBAN_GROUP_CHAT_ID` 配置
- 问题审核催办通知：工单到达「问题审核」节点后开始计时，根据「问题严重性」按不同节奏向通知群发送催办消息：一般级别（15分钟后1次）、严重级别（15/30/45分钟各1次）、致命级别（每15分钟1次，上限10次）。模板：`@{处理人中文名} 你有一条{严重性}级别现网问题未处理，请及时确认！`。工单离开问题审核即停止催办。**迁入存量**时写入的流转日志（`comment=历史数据迁入`）**不计入**催办 SLA 起点；若仅有迁入流转、或进入该节点已超过对应严重性 SLA 窗口且从未催办，则**不补发**催办。使用 APScheduler 后台调度，检查间隔通过 `REMINDER_CHECK_INTERVAL_SECONDS` 配置；成功催办写入 audit 日志 `event=ticket.reminder.sent`；发送失败由 `utils.xiaoluban_message` 输出含 HTTP 状态与响应摘要的 WARNING（带 `reminder ticket_no=...` 上下文），启动时若小鲁班仍为测试默认配置会额外 WARNING 提示
- 请假申请通知：提交请假申请时，自动向审批人与抄送人推送小鲁班消息（含申请人、申请类型、时间段及事由、审批链接）；审批人与抄送人重复时仅推送一次；审批人同意或拒绝后，自动向申请人推送审批结果通知（含申请编号、审批结果、审批人、审批意见、申请类型、时间段及事由、详情链接）；通知失败仅打印 warning 日志，不影响申请主流程；审批/详情链接为完整 URL：`{链接前缀}/leave-application?id={申请ID}`，链接前缀规则同工单链接

### 16. Welink 拉群

- 功能：工作台右上角「拉群」按钮，编辑模板后一键创建 Welink 群组并发送卡片消息
- 四种场景：重大问题、紧急问题、ITR管理升级、一般问题（场景切换由弹窗顶部标签页控制）
- 字段映射：群名称→group_name、群公告→manifesto、群组成员→invite_list（逗号分隔"工号 姓名"，后端解析提取工号）、首次通报→message
- title 自动推导：重大/紧急/ITR→"WarRoom已拉起，请按规范刷新进展"；一般→"请按规范刷新进展"
- 群主(owner)：从 SSO 认证的 `w3_account` 自动获取
- 权限控制：白名单项 `workbench_group`（展示/不展示）

### 17. 局点档案

- 入口：左侧导航「运维管理 → 局点档案」
- 列表呈现：以表格展示全部局点，含「序号」+ 28 个业务字段（局点名称 / 类型 / 产品组件 / 驻场合同 / 所属行业 / 地区 / 所属代表处 / 阶段 / 标签 / 交付方式 / 汇报日期 / 回报性质 / 运维人员 / 内核交付 / 内核维护 / 服务支持 / 技术组长 / DA / SA / TD / 客户经理 / 项目经理 / 服务经理 / 软件收入 / 服务收入 / 确收时间 / 风险描述 / DTRB结论），表格横向滚动
- 关键词搜索：匹配局点名称、地区、代表处、运维人员、客户/项目/服务经理、风险描述等文本字段（防抖 800ms，与工作台搜索一致；支持中文输入法 composition 与 Enter 立即搜索），支持分页（每页 10/20/50/100 条）
- 新增 / 编辑 / 删除：弹窗表单覆盖 28 个字段（局点名称必填，「汇报日期」「确收时间」为日期、「风险描述」「DTRB结论」为多行文本）；点击列表行打开详情弹窗，详情内可编辑或删除；列表工具栏「新增」右侧提供「删除」按钮，勾选行后批量删除（交互与工作台一致：先选中、二次确认条数、调用 `/api/site-profiles/bulk-delete`）
- 导入：上传 Excel（.xlsx），表头按 28 个中文列名匹配，「局点名称」为空的行跳过，批量入库
- 导出：将当前筛选结果导出为 Excel（.xlsx），表头与导入列名一致，导出文件可直接再导入
- 权限控制（权限策略 → 配置白名单）：`site_profile_list` 控制侧栏「局点档案」入口与页面访问（深链 `/site-profiles` 无权限时回落到首个可见页）；`site_profile_create` 控制「新增」及详情内编辑/删除；`site_profile_export` 控制「导出」；`site_profile_import` 控制批量导入接口。子项与父项级联：父项为不展示时子项策略不可高于父项；默认均为可见
- 工单联动：工单「问题填写」的「局点」字段为下拉选择，选项实时取自本表的「局点名称」；下拉支持搜索并可直接输入新局点名，工单提交时若该局点名不在档案中，后端自动建一条只含「局点名称」的档案记录
- 后端：`db/migrations/0053_site_profile.sql`（`site_profile` 表，`id` + 28 业务列 + 创建人/时间戳）+ `backend/routers/site_profile.py`

### 17.1 重大问题（工单驱动）

- 入口：左侧导航「运维管理 → 重大问题」（菜单键 `major:problem`，查看权限 `major_problem_list`）
- **工单自动流转**：工作台工单的「事件级别」（`ops_analysis.event_level`）命中重大阈值时，自动出现在本页面。阈值集合：`内部通报重大问题` / `管理升级预警` / `已管理升级` / `事故` / `P1-P3事件`（不含 `一般问题`、`P4事件`）
- **惰性同步**：列表接口每次拉取前先扫描命中阈值的工单并 upsert 到 `major_issue`；快照字段（局点 / 级别 / 描述 / 运维分析人 / 开发分析人 / 通报日期）随之刷新，进展记录不受同步影响；已生成的问题行即使工单级别后续变化也不自动删除
- 从工单保留的核心字段：序号、通报日期（= 运维分析阶段最后提交时间）、运维单号（`ticket_no`）、局点名称（`problem_fill.location`）、事件级别、问题描述（`problem_fill.issue_desc`）、运维分析人（运维分析阶段最后处理人）、开发分析人（开发分析阶段最后处理人）
- **整体状态**：进行中 / 挂起 / 关闭（顶部状态 tab 可筛选），在详情中切换；**自动关闭**——当对应工单流转到「审核关闭（`audit_close`）」节点时，同步时自动将该重大问题置为「关闭」（后端真值优先，覆盖进行中 / 挂起）
- **进展跟踪（按天）**：每个重大问题**按天记录**进展（带时间、进展内容、风险消减措施、记录人）。**同一天（Asia/Shanghai）再次提交会覆盖当天的历史进展**，不追加新行；详情以「按天的 list 树状」展示——**最新一天默认展开，历史天数折叠**（「展开历史进展（N 天）」可切换）。列表页「进展&消减措施」列显示最新一天的进展+消减措施与天数计数
- 搜索：按运维单号、局点、问题描述、分析人模糊匹配（防抖 400ms），支持分页
- 布局：列表表格宽度自适应铺满内容区；详情弹窗的「新增进展」「关闭」按钮统一置于右下角（新增进展在前、关闭在后）
- 权限控制：查看复用 `major_problem_list`；写操作（改状态 / 加进展）复用 `major_problem_create`（与工作台白名单同体系，未新增默认隐藏键）
- 后端：`db/migrations/0073_major_issue.sql`（`major_issue` + `major_issue_progress` 两表）+ `backend/routers/major_issue.py`（`/api/major-issues`，阶段最后处理人取数复用 `oncall_eva` 的口径）；前端 `frontend/modules/pages/major-issue-page.js`
- 兼容性：原手工录入的重大问题表 `major_problem`（迁移 `0036`/`0037`、路由 `major_problem.py`、页面 `major-problem-page.js`、脚本 `generate_major_problems.py`）**已废弃保留**，不再挂载到菜单；月报「三、重大问题」段为 JSONB 自由文本，**不读取** `major_problem` 表，故不受本次改造影响

### 18. 历史数据迁入（老平台 GaussDB → 新平台）

- 入口：工作台「删除」按钮旁的「迁入」按钮（仅工作台 HCS 列表）；点击后弹出选择框，可按 **process_id** 勾选单条/多条迁入，或点「迁入全部」；权限受白名单 `workbench_migrate`（非 hidden 即可见/可迁）控制
- 用途：将老运维问题单平台（GaussDB）的历史工单迁移到新平台工单表，迁入后直接出现在工作台、可在工单详情查看完整流转
- 连接方式：后端**直连老库**，按 `t_work_flow_instance.id` 游标**分批读取 + 分批提交**，内存恒定、适合大数据量；老库连接串由 `LEGACY_DATABASE_URL` 配置（未配置时回退当前库 `DATABASE_URL`，便于本地用模拟老表验证）
- 幂等 / 增量：以 `ticket.legacy_instance_id`（迁移 `0070`，唯一索引）记录来源实例，重复迁入自动跳过已迁工单，中断可续跑；老库 `deleted<>'0'` 的逻辑删除单据跳过
- 重建粒度：依据 `t_work_flow_task` 流转记录**逐节点重建** `ticket_node_instance` / `ticket_node_data` / `ticket_flow_log`，字段值取自 `t_work_flow_task_parse`（`column1..column64`）并按新平台 `node_field_def` 的归属节点落位；当前节点/处理人/状态由 `t_work_flow_instance` 决定（`进行中→open`、`暂停→suspended`、`关闭/完成/非问题关闭→closed`）
- 各节点处理人还原：老库 `t_work_flow_task.creator_id` 是任务记录创建人（真实数据中多恒为工单发起人），**不能**当作各节点处理人；某节点处理人取**上一条任务的 `next_assignee`**（即把工单指派进该节点的人），首个节点（问题填写）取工单创建人。否则迁入后各阶段「最后处理人」会全部塌缩成问题填写人，并污染运维效率的归属/SLA/独立闭环口径
- 无流转记录的工单：当老库 `t_work_flow_task` 对该实例**无任何流转记录**时，源库不含逐阶段处理人，迁移**不臆造中间阶段**——只还原确知的两段：「问题填写」(提单人 `creator`) + 「当前/末节点」(当前处理人 `current_assignee`，闭单即审核关闭人)，中间阶段（问题审核/运维分析/开发分析…）一律不生成节点实例与流转日志。**后果**：这类历史工单因无运维分析阶段记录，不计入任何人的运维效率（属真实「数据缺失」，而非算错人）
- 工单号：取自老库 `t_work_flow_instance.process_id`（或 `t_work_flow_task.instance_process_id` 兜底），**原样**写入 `ticket.ticket_no` 作为流程 ID，不再按建单日重新分配 `YW…` 序号
- 状态：`ticket.status` **保留**老库 `instance.status` 原值（如「进行中」「关闭」「暂停」「问题审核关闭」），不再映射为 open/suspended/closed；列表/详情展示终态时兼容识别中文关闭态。**注意**：「问题审核关闭」表示停在审核关闭节点待终态关闭，**不是**终态；终态仍为「关闭」「完成」「非问题关闭」「已关闭」
- 字段映射：`column1→start_date`、`column2→location`、`column8→issue_desc`、`column10→severity`、`column23→dts_no`、`column50→component`、`column53→ecare_ticket_no` 等共 50 个列（完整映射见 `backend/legacy_migration.py` 的 `PARSE_COLUMN_TO_FIELD`；新平台无对应字段的列忽略）
- 老库节点别名：更老流程首节点「HCS人员填写」「BU人员填写」（`node_id=8`）与标准「问题填写」同义，迁入时映射为 `problem_fill`；其它别名见 `LEGACY_NODE_NAME_TO_KEY`（如「运维人员分析」→运维分析）。**歧义**：`status` 含「审核关闭」或末条 task 已在「运维闭环」时，实例 `current_work_flow_node_name` / task `next_work_flow_node_name` 误存「问题审核」会按 **审核关闭**（`audit_close`）处理；运维闭环下一节点永不映射为 `problem_review`；task 上 `next_work_flow_node_id=7` 优先于节点名
- 接口：`POST /api/tickets/migrate-legacy`，可选请求体 `process_ids`（流程 ID 数组，仅迁入指定工单）；不传则迁入全部。**迁入全部**时前端默认每批 `max_total=100`、`after_legacy_instance_id` 游标续跑，全部完成后单独请求 `refresh_snapshot: true` 重建列表快照（避免单次 HTTP 超时）。`GET /api/tickets/migrate-legacy/candidates` 列出老库可选工单（按 `process_id`）。**存量已迁但元数据不对**（流程 ID / status / 当前节点）：迁入弹窗 **修复已迁**，或 `POST /api/tickets/migrate-legacy/repair`（默认仅更新 `ticket_no` / `status` / `current_node_id`）。**流转日志/审核关闭阶段异常**：弹窗 **重建流转**，或同一接口传 `rebuild_workflow: true` 按老库 task 重建节点与 `flow_log`；可选 `process_ids` 仅处理指定单，或 `python scripts/repair_legacy_migrated_tickets.py`。**删除已迁**：迁入弹窗 **删除已迁** / **删除全部已迁**，或 `GET /api/tickets/migrate-legacy/migrated-count` 统计、`POST /api/tickets/migrate-legacy/delete-migrated` 删除（以 `ticket.legacy_instance_id IS NOT NULL` 识别，不可恢复）；命令行 `python scripts/delete_legacy_migrated_tickets.py`（支持 `--dry-run`）。返回 `{ ok, migrated, skipped_existing, skipped_deleted, skipped_not_found, failed, errors, ticket_nos, processed, has_more, next_after_legacy_instance_id }`（repair 返回 `repaired, skipped_unchanged, …`；delete 返回 `deleted, …`）
- 后端：`backend/legacy_migration.py` + `db/migrations/0070_ticket_legacy_instance_id.sql`
- 模拟老库与演示数据：
  - **批量演示库（2000 条）**：`backend/.venv/bin/python db/legacy_mock/gen_legacy_orders.py` 会在当前 PG 实例创建独立库 `legacy_orders`（复用 `DATABASE_URL` 的连接凭据，仅换库名），按 `origin_orders` 设计文档建出**全部 8 张老表**（`t_work_flow_info` / `t_work_flow_node` / `t_work_flow_instance` / `t_work_flow_task` / `t_work_flow_field_config` / `t_work_flow_field_config_option` / `t_work_flow_task_parse` / `t_work_flow_file_info`），并生成 2000 条**全部「审核关闭」终态**的历史工单（`status=关闭`、当前节点停在「审核关闭」）。流转「日志流」（`t_work_flow_task`）分两类：**完整链路**（问题填写→问题审核→运维分析→开发分析→开发闭环→运维闭环→审核关闭→关闭，7 条）与**独立闭环**（约 `LEGACY_INDEPENDENT_RATIO`，默认 35%：运维分析后直接进入运维闭环、**不经开发分析/开发闭环**，问题填写→问题审核→运维分析→运维闭环→审核关闭→关闭，5 条），后者用于产出新平台「运维效率」**独立闭环率非 0** 的样本（独立闭环 = 运维分析阶段最后一人之后不再进入开发分析）。**同一工单各阶段处理人两两不同**（从 20 人池 `rng.sample` 去重），其中**「运维分析」与（存在时）「开发分析」阶段随机指派 `yunwei_ticket.user_account` 中的真实活跃用户**（其余阶段沿用老库账号），含 parse 解析列；`instance.id` 用高位段 `200001+`，单日工单数远低于 `YW` 号段上限。迁入后每张工单在详情「操作日志」均可见对应链路的流转记录、各阶段操作人各不相同。生成后在 `backend/.env` 配置 `LEGACY_DATABASE_URL=postgresql://<user>:<pwd>@<host>:<port>/legacy_orders` 并**重启后端**，工作台点「迁入」即可把这 2000 条迁入新平台。可用环境变量 `LEGACY_ROWS` / `LEGACY_DB_NAME` / `LEGACY_INDEPENDENT_RATIO` 调整条数、库名与独立闭环占比。
  - **轻量样例（4 条）**：`db/legacy_mock/legacy_mock.sql` 建出老表并灌入 4 条样例（进行中/已关闭/暂停/已删除）；不配 `LEGACY_DATABASE_URL` 时回退当前库 `DATABASE_URL`，把该 SQL 灌入当前库即可点「迁入」验证。
- 自动化测试：`test/test_m12_legacy_migration.py`。测试夹具用低位 id（`1001-1004`）以「建表 `IF NOT EXISTS` + `INSERT`」方式灌入后端实际所读老库（不 DROP 表，保护演示库的 2000 条），迁移调用传 `batch_size=4`/`max_total=4`，按 `id` 升序只处理最低的 4 条夹具单，与演示数据互不干扰。

---

## 技术架构

### 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端 | 原生 JavaScript (ES6+)、CSS3、ECharts |
| 后端 | Python 3.x、FastAPI |
| 数据库 | PostgreSQL / GaussDB |
| 驱动 | psycopg[binary] |
| 对象存储（富文本图片） | MinIO（S3 兼容 API） |

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  工作台     │  │  工单详情   │  │  管理后台   │         │
│  │  (列表)     │  │  (流程)     │  │  (权限/值班)│         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                         │                                   │
│                    REST API                                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                        后端层                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    FastAPI 应用                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ 工单路由 │ │ 用户路由 │ │ 值班路由 │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ 权限路由 │ │ 参数路由 │ │ 统计路由 │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │  ┌──────────┐ ┌──────────┐                          │   │
│  │  │ AI路由   │ │ 需求路由 │                          │   │
│  │  └──────────┘ └──────────┘                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│                    psycopg                                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                       数据库层                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              PostgreSQL / GaussDB                    │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌─────────────┐  │   │
│  │  │workflow_     │ │ ticket_*     │ │ user_*      │  │   │
│  │  │template/node │ │ (工单表)      │ │ (用户表)     │  │   │
│  │  └──────────────┘ └──────────────┘ └─────────────┘  │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌─────────────┐  │   │
│  │  │ option_*     │ │ duty_*       │ │ param_*     │  │   │
│  │  │ (选项集)      │ │ (值班表)      │ │ (参数配置)   │  │   │
│  │  └──────────────┘ └──────────────┘ └─────────────┘  │   │
│  │  ┌──────────────┐ ┌──────────────┐                   │   │
│  │  │ ai_*         │ │ requirement  │                   │   │
│  │  │ (智能助手)    │ │ (需求管理)    │                   │   │
│  │  └──────────────┘ └──────────────┘                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 核心数据模型

```
workflow_template (流程模板)
    └── workflow_node (流程节点)
            └── node_field_def (节点字段定义)
                    └── option_set (选项集)
                            └── option_item (选项项)

ticket (工单)
    ├── ticket_node_instance (节点实例)
    │       └── ticket_node_data (节点数据)
    └── ticket_flow_log (流转日志)

user_account (用户账户)
    └── role_permission_policy (角色权限策略)

ai_conversation (AI 会话)
    └── ai_message (AI 消息，含 ReAct 步骤、SQL、查询结果)

ai_quick_template (快捷问题模板)

param_llm_config (系统大模型配置)

ai_user_llm_config (用户个人大模型配置)
```

---

## 安装部署指南

### 环境要求

- Python **3.10+**（一键启动脚本 `scripts/start.py` 会校验；用于富文本 MinIO、pytest 与类型注解等）
- PostgreSQL 12+ 或 GaussDB
- 现代浏览器（仅支持 Chromium 内核：Chrome/Edge）

### 一键启动（推荐）

项目提供一键启动脚本，自动完成虚拟环境创建、依赖安装、数据库检测与初始化、服务启动。

**Windows**:
```bash
scripts\start.bat
```

**Linux/Mac**:
```bash
./scripts/start.sh
```

**命令参数**:
| 参数 | 说明 |
|------|------|
| `--reset-db` | 强制重新初始化数据库（清空数据） |
| `--skip-check` | 跳过数据库检查，直接启动服务 |

**首次使用流程**:
1. 安装 **Python 3.10+** 并保证在 PATH 中（macOS/Linux 下 `start.sh` 会依次尝试 `python3.13` … `python3.10`；Windows 下 `start.bat` 优先使用 `py -3.13` … `py -3.10`）
2. 确保 PostgreSQL 已安装并运行
3. 创建空数据库（如 `yunwei_ticket`）
4. 执行一键启动脚本（会创建 `backend/.venv`、安装依赖、写入或补全 `backend/.env`）
5. 若 `backend/.env` 中尚无 `MINIO_ENDPOINT=` 配置行，脚本会在文件末尾**追加 MinIO 可选变量模板**（富文本图片存储；留空则不上传图片，接口返回 503）
6. 脚本会自动检测数据库状态并执行迁移初始化
7. 服务启动后访问 http://localhost:8000

### 数据库初始化

库结构、种子数据、选项集等**仅以 `db/migrations/` 为准**（按文件名排序依次执行）。不再维护 `db/postgres/`、`db/gaussdb/` 并行目录。

**推荐：一键启动自动迁移**

```bash
# 空库时 start.py 会按序执行 db/migrations/*.sql
python scripts/start.py
```

**手动 / CI 冒烟**

```bash
export DATABASE_URL="postgresql://USER:PASS@localhost:5432/yunwei_ticket"
./scripts/ci/migrate-smoke.sh
```

或单文件调试：

```bash
psql "$DATABASE_URL" -f db/migrations/0001_init_workflow_schema.sql
# ... 按编号继续至最新迁移
```

详见 `db/migrations/README.md`。

### 生成测试数据

项目提供测试数据生成脚本，可生成模拟的 GaussDB 运维工单数据用于开发调试。

```bash
# 设置数据库连接
set DATABASE_URL=postgresql://postgres:123@localhost:5432/yunwei_ticket

# 生成25条测试工单（默认）
python scripts/generate_test_tickets.py

# 生成指定数量的工单
python scripts/generate_test_tickets.py --count 50

# 清空已有测试数据并重新生成
python scripts/generate_test_tickets.py --reset --count 30

# 仅预览将生成的数据（不写入数据库）
python scripts/generate_test_tickets.py --dry-run
```

**生成的测试数据特征**：
- 人员：申宇、李潇雨、李长军、董海俊、刘宗超、徐齐刚、宋康、李博闻、李洋、胡宝生、周晨雷、刘开宇
- 日期范围：2026年5月1日-30日
- 局点：自由文本（与 eCare 单号同类输入框）
- 严重性：一般(50%)、严重(30%)、致命(20%)
- 问题组件：内核问题(60%)、管控问题(40%)
- 流程阶段：分布在各节点（问题审核、运维分析、开发分析、开发闭环、运维闭环、审核关闭、已关闭）

### 后端部署

```bash
# 进入后端目录
cd backend

# 创建虚拟环境（只需执行一次）
py -3 -m venv .venv

# 激活虚拟环境
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

# 安装依赖（只需执行一次）
python -m pip install -r requirements.txt

# 配置数据库连接
# Windows:
set DATABASE_URL=postgresql://postgres:123@localhost:5432/yunwei_ticket
# Linux/Mac:
export DATABASE_URL="postgresql://postgres:123@localhost:5432/yunwei_ticket"

# 启动服务（默认关闭逐请求 access log，仅输出关键业务 audit 与 WARNING+ 日志）
python -m uvicorn app:app --host localhost --port 8000 --no-access-log --log-level warning
```

### 前端部署

**方式一：后端托管（推荐）**

后端默认托管前端静态文件，访问 `http://127.0.0.1:8000/` 即可。

**方式二：独立前端服务**

```bash
cd frontend
python serve_spa.py
# 默认端口 8080，访问 http://127.0.0.1:8080/
```

### 环境变量

后端启动时由 `app.py` **固定读取** `backend/.env`（与进程当前工作目录无关），便于在仓库根目录或其它路径执行 `uvicorn` 时仍能加载数据库与 MinIO 等配置。

**日志行为（默认）**

- 关闭 Uvicorn 逐请求 access log（`LOG_ACCESS=0`），避免 `GET /api/... 200 OK` 刷屏。
- 压低 APScheduler 例行 INFO（如 `apscheduler.executors.default` 每轮 `Running job ...`），仅保留 WARNING+；催办等定时任务的关键动作写入 `[audit]`（如 `event=ticket.reminder.sent`），失败与异常仍输出 WARNING/ERROR。
- 关键业务事件写入 `[audit]` 日志，例如 SSO 会话建立（`event=auth.login`）、管理端批量变更、工单流转/关闭。
- 重复 WARNING/ERROR 在 `LOG_RATE_LIMIT_SECONDS` 窗口内合并，窗口结束补打 `(suppressed N similar messages ...)` 摘要，避免 SSO 不可用等错误撑爆磁盘。
- 日志输出到 **stdout**；容器部署建议配合 Docker 日志轮转，例如：`docker run --log-opt max-size=50m --log-opt max-file=3 ...`
- 若配置 **`LOG_DIR`**（Linux 绝对路径，如 `/var/log/yunwei`），同时写入本地文件：**每个自然日一个主文件**，单文件超过 **`LOG_MAX_BYTES`** 后同日递增序号新建（如 `yunwei-2026-06-08.log` → `yunwei-2026-06-08.1.log`）；超过 **`LOG_RETENTION_DAYS`** 的历史文件自动删除
- 调试时可设 `LOG_ACCESS=1` 恢复 access log，或临时去掉 `--no-access-log` 启动参数。

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DATABASE_URL` | 数据库连接串 | `postgresql://estella@localhost:5432/yunwei_ticket` |
| `LEGACY_DATABASE_URL` | 历史数据「迁入」的老平台（GaussDB）连接串；本地演示库由 `db/legacy_mock/gen_legacy_orders.py` 生成（`legacy_orders`，2000 条全「审核关闭」终态） | 未配置时回退 `DATABASE_URL`（本地读模拟老表） |
| `SERVE_FRONTEND` | 是否托管前端 | `1`（托管） |
| `SKIP_SSO_AUTH` | 跳过 SSO 认证（测试/开发环境） | 空（生产环境必须 SSO 登录） |
| `SSO_BASE_URL` | SSO 服务器地址 | `http://login.bluezone.com:5000` |
| `SSO_COOKIE_DOMAIN` | SSO Cookie 域名 | `.bluezone.com` |
| `SESSION_CACHE_ENABLED` | 是否启用会话缓存 | `1`（启用，提升性能） |
| `SESSION_CACHE_MAXSIZE` | 缓存最大条目数 | `500` |
| `SESSION_CACHE_TTL` | 缓存有效期（秒） | `300`（5分钟） |
| `LOG_LEVEL` | 应用日志级别（`audit` 命名空间始终 INFO） | `INFO` |
| `UVICORN_LOG_LEVEL` | Uvicorn 自身日志级别 | `WARNING` |
| `LOG_ACCESS` | 是否开启 Uvicorn 逐请求 access log | `0`（关闭） |
| `LOG_RATE_LIMIT_SECONDS` | 重复 WARNING/ERROR 限流窗口（秒） | `60` |
| `LOG_DIR` | 本地日志目录（Linux 绝对路径）；为空则仅 stdout | （空） |
| `LOG_FILE_BASENAME` | 日志文件名前缀 | `yunwei` |
| `LOG_MAX_BYTES` | 单个日志文件最大字节数，超出后同日新建序号文件 | `52428800`（50MB） |
| `LOG_MAX_FILES_PER_DAY` | 同一自然日最多分段文件数；`0` 表示不限 | `0` |
| `LOG_RETENTION_DAYS` | 保留最近若干天的日志文件，更早的自动删除 | `30` |
| `LOG_STDOUT` | 配置 `LOG_DIR` 后是否仍同时输出到 stdout | `1`（是） |
| `MINIO_ENDPOINT` | MinIO 地址（不含协议），如 `localhost:9000` | （空则富文本图片上传接口返回 503） |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | MinIO 访问密钥 | 同上 |
| `MINIO_BUCKET` | 存储桶名称；不存在时上传接口会尝试创建 | 同上 |
| `MINIO_USE_SSL` | 是否 HTTPS 连接 MinIO，`true`/`1` 表示启用 | 默认否 |
| `MINIO_PUBLIC_BASE_URL` | 浏览器可访问的**对象 URL 前缀**（不含尾部 `/`），如经网关暴露为 `https://files.example.com/my-bucket`；设置后富文本中写入该前缀 + 对象键；**不设置**则返回 **7 天有效**的预签名 GET URL | （可选） |
| `APP_PUBLIC_BASE_URL` | 前端站点公网地址（不含尾部 `/`），用于小鲁班通知中的工单/请假链接；优先于 `XIAOLUBAN_LINK_BASE_URL` | （可选） |
| `XIAOLUBAN_LINK_BASE_URL` | 小鲁班通知链接默认公网前缀（不含尾部 `/`） | `https://gaussdb-ops.rnd.huawei.com` |
| `XIAOLUBAN_MESSAGE_URL` | 小鲁班消息推送服务地址（生产环境必填） | `http://test.xiaoluban-message.com`（测试默认值） |
| `XIAOLUBAN_MESSAGE_SEND_TOKEN` | 小鲁班消息发送认证Token（生产环境必填） | `test_xxx`（测试默认值） |
| `XIAOLUBAN_GROUP_CHAT_ID` | 问题审核节点群通知群号（生产环境必填） | `test_group_chat_001`（测试默认值） |
| `REMINDER_CHECK_INTERVAL_SECONDS` | 催办通知检查间隔（秒） | `60` |
| `WELINK_APP_ID` | Welink 应用 ID（拉群 API 签名） | 生产环境必填 |
| `WELINK_APP_SECRET` | Welink 应用密钥（拉群 API 签名） | 生产环境必填 |
| `WELINK_HIS_APP_ID` | Welink HIS 应用 ID（动态 Token） | 生产环境必填 |
| `WELINK_HIS_STATIC_TOKEN` | Welink HIS 静态 Token（动态 Token） | 生产环境必填 |
| `WELINK_DYNAMIC_TOKEN_URL` | Welink 动态 Token 获取地址 | 生产环境必填 |
| `WELINK_CREATE_GROUP_URL` | Welink 群组创建 API 地址 | 生产环境必填 |
| `WELINK_CARD_MESSAGE_URL` | Welink 卡片消息发送地址 | 生产环境必填 |
| `AI_EXPORT_CLEANUP_INTERVAL_SECONDS` | 清理任务检查间隔（秒） | `21600`（6小时） |
| `AI_EXPORT_DRAFT_TIMEOUT_SECONDS` | draft/preview 状态超时（秒） | `7200`（2小时） |
| `AI_EXPORT_RETENTION_DAYS` | ready 状态数据保留天数 | `7` |
| `AI_EXPORT_HARD_DELETE_DAYS` | expired 状态硬删除天数 | `30` |
| `AI_EXPORT_PROCESSING_TIMEOUT_SECONDS` | processing 状态超时（秒） | `3600`（1小时） |
| `AI_EXPORT_MAX_CONCURRENT_TASKS` | 全局最大并发处理任务数 | `3` |
| `AI_EXPORT_BATCH_SIZE` | LLM 推理每批行数 | `50` |
| `AI_EXPORT_MAX_LLM_CALLS` | 单任务最大 LLM 调用次数 | `200` |
| `ECHARTS_JS_PATH` | ECharts min.js 文件路径（报告 HTML 内联注入） | `backend/static/echarts.min.js` |

### SSO 单点登录

系统支持与企业 SSO 系统集成，实现单点登录认证。

**认证流程**：
1. 前端检测浏览器是否存在 SSO Cookie（`hwssot` 或 `login_sid`）
2. 若无 Cookie，重定向到 SSO 登录页（带上当前 URL 作为 `redirect` 参数）
3. SSO 登录成功后，浏览器获得 Cookie 并重定向回应用
4. 前端调用 `/api/auth/me` 验证会话有效性，后端向 SSO 服务验证 Cookie
5. 后端检查用户是否已在本地 `user_account` 表注册且处于激活状态
6. 认证成功后，用户信息存入 localStorage 并启动应用

**环境配置**：

```bash
# backend/.env
# 登录地址（用户重定向到该页面进行登录）
SSO_LOGIN_URL=http://app.bulezone.com/login

# 验证地址（后端调用该接口验证Cookie有效性）
SSO_PROFILE_URL=http://login.bulezone.com/account/profile

# Cookie域名（注销时需要清除Cookie）
SSO_COOKIE_DOMAIN=.bulezone.com

# 测试环境跳过 SSO 认证
SKIP_SSO_AUTH=1

# 兼容旧配置：如果设置了SSO_BASE_URL，会自动推导登录和验证地址
# SSO_BASE_URL=http://login.bluezone.com:5000
#   → SSO_LOGIN_URL=http://login.bluezone.com:5000/login
#   → SSO_PROFILE_URL=http://login.bluezone.com:5000/account/profile
```

**注意事项**：
- `SSO_LOGIN_URL` 和 `SSO_PROFILE_URL` 可以是不同域名
- 登录地址用于前端重定向（用户浏览器访问）
- 验证地址用于后端调用（验证用户Cookie）

**会话缓存（性能优化）**：
系统使用会话级缓存避免重复SSO验证，提升API响应速度：
- 缓存命中：API响应时间约10ms（跳过SSO远程验证）
- 缓存未命中：首次验证约100-500ms（含SSO验证+数据库查询）
- 缓存TTL：5分钟（小于SSO会话有效期）
- 缓存管理API：
  - `GET /api/auth/cache-stats` - 查看缓存统计（命中率、条目数）
  - `POST /api/auth/cache-clear` - 清空所有缓存（紧急重置）

**用户头像与注销**：
- 登录成功后右上角显示用户头像（用户名首字符）
- 鼠标悬停头像显示下拉菜单：个人信息、注销
- 注销时清除 localStorage 和 SSO Cookie，重定向到 SSO 登录页

---

## 使用说明

### 工单编号规则

工单编号格式：`YW` + `YYYYMMDD` + `nnn`

- `YW`：固定前缀
- `YYYYMMDD`：建单自然日
- `nnn`：全局序号（000-999），跨日连续递增，用尽后从 000 循环（不按日重置）

示例：`YW20260402001`（2026年4月2日第1号工单）

### 页面导航

| 页面 | 路径 | 说明 |
|------|------|------|
| 我的主页 | `/home` | 个人待办、SLA 统计、值班信息 |
| 质量改进 | `/requirements` | 质量改进项管理（原「需求管理」） |
| 工作台 | `/workbench` | 工单列表、创建、导出（HCS_INCIDENT，不含热补丁单）；**列表读 `ticket_list_snapshot` 快照表**：服务端分页、全量搜索/页签/列筛选在 SQL 层完成，仅返回当前页；列筛选 ⏷ 支持 **whitelist（下拉）** 及默认可筛列（**不含起始日期、问题描述、richtext**）；可选值走 `GET /api/tickets/facets`（全量 distinct） |
| 补丁管理 | `/hotpatch` | 热补丁（HOTPATCH）工单列表与创建；列表/筛选等交互与工作台一致；**「创建」弹窗固定从「诉求填写」节点（`hp_demand_fill`）起单**，与工作台 HCS 起单节点（问题填写/运维分析）无关；侧栏入口受 `patch_manage` 控制；**列表「删除」按钮**受 **`patch_manage_delete`** 白名单控制（展示/不展示），与工作台 **`workbench_delete`** 独立；**创建中仅本地的占位单带 `templateCode: HOTPATCH`，合并进 `getAllTickets` 时只进补丁列表，不混入工作台**；**默认流程号（`ticket_no`）格式 `HPM` + `YYYYMMDD`（本地创建日）+ 全局三位序号 `000`–`999`（跨日连续递增、用尽后从 `000` 循环；与 `YW…` 分存储键），首落库时后端亦接受/分配同格式**；**列表默认展示列**（未改「选择列」时）为：流程 ID、当前阶段、当前处理人、起始日期、创建者，列配置独立存储键 `ticket_list_columns_patch`，与工作台 `ticket_list_columns_list` 互不覆盖 |
| 工单详情 | `/tickets/:id` | 工单流程详情与操作；顶栏进度条（问题填写→审核关闭）**点击节点文字**可展开下方对应节点卡片并滚动定位；**深链打开时仅预载当前单**（`GET /api/tickets?ticket_no=…`），加载中显示「加载中…」，加载完成且库中无该单才提示「未找到」 |
| 值班表 | `/duty` | 值班日历、轮值表管理 |
| RL值班表（公开） | `/rl-oncall` | RL值班表独立只读页面，不要求登录认证，无侧边栏；后端 GET `/api/duty/rl-oncall` 免认证（仅 GET 豁免，PUT 仍需认证） |
| 请假申请 | `/leave` | 请假申请与审批；**新建申请**时「申请人」默认当前登录账号，支持**姓名/账号关键字搜索**选择（与审批白名单添加人员交互一致）；**「抄送人」**复用工单**协同处理人**同款多选扁平下拉；**审批人**仍为白名单下拉单选；**「所有申请」页签**数据范围由白名单 **`leave_application_all`** 控制（`readonly` = 全部请假单，`editable` = 仅申请人为本人的请假单；后端 `GET /api/leave/applications?scope=all` 同步过滤）；**列表/详情「删除」按钮**受 **`leave_delete`** 控制，与 **`leave_apply`**、**`leave_whitelist`** 独立；`DELETE /api/leave/applications/{id}` 须该键非 hidden；**审批白名单**弹窗展示当前审批人姓名列表，通过搜索框添加/移除，不再列出全部用户勾选 |
| 用户管理 | `/admin/users` | 用户账户管理 |
| 权限策略 | `/admin/permissions` | 角色权限配置 |
| 统计图表 | `/stats` | 数据统计分析 |
| 参数配置 | `/params` | 各子页由白名单「是否展示 xx 页面」控制侧栏与路由：`params_duty_field_edit`（责任田）、`params_version_edit`（版本）、`params_group_template_edit`（拉群模板）、`params_issue_root_cause`（问题根因，运维分析问题类型→根因分类联动）、`params_llm_config`（大模型配置）；父项 `params_config` 仍控制「参数配置」入口 |
| 智能助手 | `/ai-assistant` | AI 对话、快捷问题、数据库查询 |
| 深度分析 | `/ai-export` | 数据清洗 + Excel 导出 + 分析报告 |
| 问题报表 | `/report/issue` | 月度报告 - 历史/新增问题列表合并与导出 |
| 报告生成 | `/report/generate` | 现网重大问题月度分析报告 - 5 段编辑 + 归档 |

### 工单列表筛选

- **待处理**：当前处理人为当前登录人的工单
- **全局**：所有可见工单
- **我创建**：创建人为当前登录人的工单

### 字段继承规则

同一字段在多个节点重复出现时，展示、统计、导出以**流程顺序上最后出现的节点**中的内容为准。

---

## 目录结构

```
database-o-m-system/
├── .cursor/                      # Cursor IDE 配置
│   ├── rules/                    # 业务规则定义
│   │   ├── db-migrations-only.mdc        # 数据库迁移规则（仅 db/migrations）
│   │   ├── frontend-theme-readability.mdc # 主题可读性规则
│   │   ├── home-ticket-list-columns.mdc  # 列表列定义
│   │   ├── my-home-page.mdc              # 主页规则
│   │   ├── process-flow-id-format.mdc    # 工单编号规则
│   │   ├── ticket-detail-passed-nodes.mdc # 已走过节点展示规则
│   │   └── ticket-inherited-fields-latest-node.mdc # 字段继承规则
│   └── skills/                   # 技能定义
│       └── workflow-node-visibility/
│           └── SKILL.md          # 节点可见性技能
├── backend/                      # 后端代码
│   ├── app.py                    # FastAPI 应用主文件（路由注册与SPA配置）
│   ├── config.py                 # 配置常量
│   ├── database.py               # 数据库连接
│   ├── models.py                 # Pydantic模型定义
│   ├── sso_config.py             # SSO 认证配置（集中管理）
│   ├── routers/                  # 路由模块（按业务域拆分）
│   │   ├── __init__.py           # 路由导出
│   │   ├── auth.py               # SSO 认证路由
│   │   ├── health.py             # 健康检查
│   │   ├── permission.py         # 权限管理
│   │   ├── user.py               # 用户管理
│   │   ├── duty.py               # 值班管理
│   │   ├── leave.py              # 请假管理
│   │   ├── params.py             # 参数配置
│   │   ├── requirement.py        # 需求管理
│   │   ├── ai.py                 # 智能助手
│   │   ├── ai_export.py            # 深度分析路由
│   │   ├── nodes.py              # 节点schema
│   │   ├── tickets.py            # 工单流程
│   │   ├── xiaoluban.py          # 小鲁班消息推送
│   │   ├── welink.py             # Welink拉群
│   │   └── home.py               # 首页统计
│   ├── utils/                    # 工具函数
│   │   ├── __init__.py           # 工具导出
│   │   ├── ticket_no.py          # 工单编号
│   │   ├── person_display.py     # 人员显示
│   │   ├── validators.py         # 字段验证
│   │   ├── date_helpers.py       # 日期处理
│   │   ├── xiaoluban_message.py  # 小鲁班消息推送
│   │   ├── ticket_reminder.py    # 工单催办通知
│   │   └── WelinkHelper.py       # Welink群创建与消息推送
│   ├── requirements.txt          # Python 依赖
│   └── README.md                 # 后端说明
├── db/                           # 数据库脚本
│   └── migrations/               # 唯一来源：按序执行的迁移 SQL
│       ├── README.md
│       ├── 0001_init_workflow_schema.sql
│       ├── 0002_seed_all_node_fields_from_xlsx.sql
│       ├── 0010_add_rbac_tables.sql
│       └── ...                   # 更多迁移脚本
├── docs/                         # 项目文档
│   ├── AI驱动全栈项目开发复盘-规则与技能体系.md
│   └── 运维工单系统-实现与后续.md
├── scripts/                      # 脚本工具
│   ├── start.py                  # 一键启动脚本（跨平台 Python）
│   ├── start.bat                 # Windows 入口脚本
│   ├── start.sh                  # Linux/Mac 入口脚本
│   └── ci/                       # CI/CD 脚本
│       ├── run-tests.sh          # 一键运行全量测试
│       └── migrate-smoke.sh      # 迁移脚本语法验证
├── frontend/                     # 前端代码
│   ├── app.js                    # 应用主逻辑（ES Module 入口）
│   ├── index.html                # 入口页面
│   ├── styles.css                # 样式文件
│   ├── devserver.py              # 开发服务器
│   ├── serve_spa.py              # SPA 服务器
│   ├── modules/                  # 前端模块化拆分
│   │   ├── constants/            # 常量定义
│   │   │   ├── duty.js           # 值班相关常量
│   │   │   ├── permission.js     # 权限相关常量
│   │   │   ├── theme.js          # 主题/UI常量
│   │   │   ├── workflow.js       # 工单流程常量
│   │   │   └── ai-export-fields.js   # 导出字段定义
│   │   ├── pages/                # 页面级模块
│   │   │   ├── admin.js          # 管理后台纯函数（权限白名单、用户筛选）
│   │   │   ├── duty.js           # 值班表页面纯函数
│   │   │   ├── home.js           # 首页/热力图纯函数与常量
│   │   │   ├── params.js         # 参数配置页面纯函数
│   │   │   ├── requirement.js    # 需求管理/工单字段规则纯函数
│   │   │   ├── stats.js          # 统计图表页面纯函数与常量
│   │   │   ├── ticket.js         # 工单流程纯函数（节点转换、表单渲染）
│   │   │   └── ai-export-page.js     # 深度分析页面
│   │   ├── services/             # 服务层
│   │   │   └── api.js            # API 基础配置与工具函数
│   │   ├── state/                # 状态管理
│   │   │   └── index.js          # 全局状态定义
│   │   └── utils/                # 工具函数
│   │       ├── date.js           # 日期工具
│   │       ├── escape.js         # HTML 转义
│   │       ├── dompurify-wrapper.js  # DOMPurify 封装
│   │       ├── format.js         # 格式化函数
│   │       └── normalize.js      # 规范化函数
│   └── assets/                   # 静态资源
│       └── skin-presets/         # 皮肤预设
├── README.md                     # 本文档
├── test/                         # 功能测试
│   ├── test_plan.md              # 测试方案文档
│   ├── conftest.py               # pytest全局配置
│   ├── run_tests.py              # 测试执行入口与报告生成
│   ├── test_data/                # 测试数据
│   ├── reports/                  # 测试报告输出
│   ├── e2e/                      # E2E端到端测试
│   │   ├── conftest.py           # E2E测试配置（后端服务、Playwright、JS错误捕获）
│   │   ├── test_e2e_page_load.py # 页面加载测试（12个页面无JS错误）
│   │   ├── test_e2e_navigation.py # 导航测试（侧边栏、前进后退、深链接）
│   │   └── test_e2e_module_import.py # 模块加载完整性测试
│   ├── test_m01_health.py        # 健康检查测试
│   ├── test_m02_ticket.py        # 工单流程测试
│   ├── test_m03_permission.py    # 权限管理测试
│   ├── test_m04_user.py          # 用户管理测试
│   ├── test_m05_duty.py          # 值班管理测试
│   ├── test_m06_leave.py         # 请假管理测试
│   ├── test_m07_params.py        # 参数配置测试
│   ├── test_m08_stats.py         # 个人统计测试
│   ├── test_stats_charts.py      # 统计图表聚合 API / 模块测试
│   ├── test_m09_spa.py           # 前端SPA测试
│   ├── test_m10_requirement.py   # 需求管理测试
│   └── test_m11_ai_assistant.py  # 智能助手测试
├── 字段.xlsx                     # 字段定义表
└── 权限策略.xlsx                 # 权限策略表
```

---

## 开发规范

### 规则体系（Rules）

项目采用规则驱动开发模式，所有关键业务语义在 `.cursor/rules/` 下定义：

| 规则文件 | 适用范围 | 说明 |
|----------|----------|------|
| `process-flow-id-format.mdc` | 前后端 | 工单编号格式与分配规则 |
| `ticket-detail-passed-nodes.mdc` | 前端 | 已走过节点展示规则 |
| `ticket-inherited-fields-latest-node.mdc` | 前后端 | 字段继承与覆盖规则 |
| `home-ticket-list-columns.mdc` | 前端 | 列表列定义与排序规则 |
| `db-migrations-only.mdc` | 数据库 | 仅 `db/migrations` 维护 SQL，禁止并行 postgres/gaussdb 目录 |
| `frontend-theme-readability.mdc` | 前端 | 主题可读性约束 |

### 技能体系（Skills）

复杂任务通过 Skill 编排执行链路：

- `workflow-node-visibility`：工单详情页节点可见性控制

### 数据库迁移规范

1. 新增 SQL **只**写入 `db/migrations/`（勿恢复 `db/postgres`、`db/gaussdb`）
2. 文件命名：`NNNN_description.sql`
3. 采用 append-only，不修改已在共享环境执行过的历史迁移
4. 空库初始化：`./scripts/ci/migrate-smoke.sh` 或 `scripts/start.py` 按序执行全部迁移
5. 执行后须验证通过

### 前端开发规范

1. 所有富文本字段放到表单后面
2. 白名单、文本框字段长宽保持一致
3. 样式修改需保证主题可读性
4. 禁止无需求依据的展示增量

### 后端开发规范

1. 当前节点、可编辑性、历史数据读取统一由后端状态驱动
2. 关键 ID 以服务端返回结果为准
3. 人员字段格式统一为「姓名 账号」

---

## API文档

### 基础接口

#### 健康检查

```
GET /health
```

**响应**：
```json
{
  "status": "ok"
}
```

### SSO 认证接口

#### 获取 SSO 配置

```
GET /api/auth/config
```

**响应**：
```json
{
  "login_url": "http://app.bulezone.com/login",
  "profile_url": "http://login.bulezone.com/account/profile",
  "cookie_domain": ".bulezone.com",
  "cookie_names": ["env_token", "hwsso_login", "hwssot", "hwssot3", "idss_cid", "lang", "login_logFlag", "login_sid", "login_uid", "suid", "ztsg_ruuid"]
}
```

> `login_url` 用于前端重定向登录，`profile_url` 用于后端验证Cookie

#### 验证当前用户

```
GET /api/auth/me
```

> 验证 SSO Cookie，检查用户是否在本地注册且激活。

**成功响应**：
```json
{
  "success": true,
  "sso_user": {
    "lname": "张三",
    "userName": "zhangsan",
    "email": "zhangsan@example.com"
  },
  "local_user": {
    "account": "zhangsan",
    "user_name": "张三",
    "role_code": "admin",
    "group_name": "内核组"
  },
  "w3Account": "zhangsan"
}
```

**失败响应**：
- `401`：无 Cookie / SSO 会话无效
- `403`：用户未注册或已禁用

#### 认证模块健康检查

```
GET /api/auth/health
```

**响应**：
```json
{
  "status": "ok",
  "sso_login_url": "http://login.bluezone.com:5000/login"
}
```

### 统计图表接口

#### 按视图聚合（人力投入 / 问题归属 / Doer）

```
GET /api/stats/charts
```

**Query 参数**：

| 参数 | 说明 |
|------|------|
| `operator_id` | 操作人账号 |
| `view` | `labor` \| `ownership` \| `doer` |
| `start_date` / `end_date` | `YYYY-MM-DD`，闭区间 |
| `product_line` | 人力投入：产品线筛选（可选） |
| `precision` | 问题归属：`day` \| `month` \| `year` |
| `quality` / `component` | 问题归属：`quality` 仅影响部分图表（见下方）；`component` 作用于全 Tab。质量问题取值：`all` / `yes` / `known` / `new` / `no` |

**响应**：`{ view, range, ticket_count, payload [, quality_scoped] }`。`payload` 为全量（`quality=all`）预聚合；当 `quality≠all` 时另含 `quality_scoped`（按版本/模块/来源/R/CORE/高发模块等 8 类视图专用），其余图表仍读 `payload`。

#### 分批回填日汇总（运维）

```
POST /api/stats/charts/backfill
```

**权限**：`workbench_snapshot_rebuild` 非 hidden（与「重建列表快照」相同）。

**Body（JSON）**：

| 字段 | 说明 |
|------|------|
| `operator_id` | 操作人账号 |
| `reset` | `true` 时清空 `ticket_stats_daily` / `ticket_stats_ticket` 后从首条快照重算 |
| `after_ticket_id` | 游标：仅处理 `ticket_id` 大于该值的快照行 |
| `batch_size` | 每批条数，默认 50，最大 500 |

**响应**：`{ ok, processed, done_cumulative, total, has_more, next_after_ticket_id, logs[] }`。前端统计图表页 **回填日汇总** 按钮循环调用直至 `has_more=false`。

### 工单接口

#### 获取节点 Schema

```
GET /api/nodes/{node_key}/schema
```

**参数**：
- `node_key`: 节点键（如 `problem_fill`）

**响应**：
```json
{
  "fields": [
    {
      "key": "start_date",
      "label": "起始日期",
      "type": "date",
      "required": true,
      "readonly": false
    }
  ]
}
```

#### 获取工单节点数据

```
GET /api/tickets/{ticket_no}/nodes/{node_key}/data
```

**响应**：
```json
{
  "values": {
    "start_date": "2026-04-02",
    "location": "华北-北京",
    "severity": "严重"
  }
}
```

#### 提交节点数据

```
POST /api/tickets/{ticket_no}/nodes/{node_key}/submit
```

**请求体**：
```json
{
  "values": {
    "start_date": "2026-04-02",
    "location": "华北-北京"
  },
  "operator_id": "demo_001",
  "operator_name": "Demo User",
  "next_node_key": "problem_review"
}
```

**响应**：
```json
{
  "ticket_no": "YW20260402001",
  "node_key": "problem_fill",
  "status": "submitted"
}
```

#### 富文本图片上传（MinIO）

工单表单内富文本插入图片时（**工具栏「图片」选择文件**或**在编辑区粘贴剪贴板中的二进制图片**，如截图、从看图软件复制），前端均调用本接口上传文件，**返回 URL** 写入编辑器（不再使用 base64 塞进 `values_json`）。

```
POST /api/richtext/upload-image?operator_id=demo_001
```

**请求**：`multipart/form-data`，字段名 `file`，`Content-Type` 为 `image/jpeg` | `image/png` | `image/gif` | `image/webp`，单文件最大 **5MB**。

**响应**：
```json
{
  "ok": true,
  "url": "https://…",
  "object_name": "richtext/….png"
}
```

需配置环境变量 `MINIO_ENDPOINT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`（详见上文「环境变量」）。未配置时返回 **503**。

#### 工单附件上传（MinIO，与图片共用配置）

运维闭环等节点的 **file** 类型字段（如「上传问题报告」）在表单中选择本地文件后自动调用本接口上传，落库为 JSON（`url`、`file_name`、`object_name`）。

```
POST /api/richtext/upload-file?operator_id=demo_001
```

**请求**：`multipart/form-data`，字段名 `file`；支持常见文档与压缩包（如 pdf/doc/docx/xls/xlsx/txt/zip 等），单文件最大 **20MB**。未配置 MinIO 时返回 **503**。

### 小鲁班消息推送接口

#### 发送消息

```
POST /api/xiaoluban/send-message
```

**请求体**：
```json
{
  "operator_id": "demo_001",
  "content": "消息内容",
  "receiver": "接收者标识"
}
```

**成功响应**：
```json
{
  "success": true,
  "message": "消息发送成功"
}
```

**失败响应**：
```json
{
  "success": false,
  "message": "消息发送失败"
}
```

**环境配置**：
生产环境需在 `backend/.env` 中配置：
- `XIAOLUBAN_MESSAGE_URL`：小鲁班消息服务地址
- `XIAOLUBAN_MESSAGE_SEND_TOKEN`：认证Token

### Welink 拉群接口

#### 创建群组

```
POST /api/welink/create-group
```

**请求体**：
```json
{
  "problem_kind": "major",
  "group_name": "【GaussDB内部】【XX 重大问题】…",
  "manifesto": "群公告内容",
  "group_members": "zhangsan001 张三,lisi004 李四",
  "message": "首次通报内容",
  "operator_id": "zhangsan001"
}
```

> `group_members` 格式为逗号分隔的"工号 姓名"，后端自动解析提取工号列表。`problem_kind` 取值：`major`/`urgent`/`itr`/`general`。群主(owner)从 SSO 认证 `w3_account` 自动获取。

**成功响应**：
```json
{
  "ok": true,
  "group_id": "welink_group_xxxx"
}
```

**失败响应**：
```json
{
  "detail": "Welink create group failed: ..."
}
```

**环境配置**：
生产环境需在 `backend/.env` 中配置：
- `WELINK_APP_ID`、`WELINK_APP_SECRET`：应用签名凭证
- `WELINK_HIS_APP_ID`、`WELINK_HIS_STATIC_TOKEN`：动态Token获取凭证
- `WELINK_DYNAMIC_TOKEN_URL`、`WELINK_CREATE_GROUP_URL`、`WELINK_CARD_MESSAGE_URL`：API地址

#### 获取工单列表

```
GET /api/tickets
GET /api/tickets/facets
POST /api/tickets/snapshot/rebuild
```

**工作台 HCS 列表（快照模式，默认启用）**

- 环境变量 `TICKET_LIST_SNAPSHOT_ENABLED=1`（默认）；设为 `0` 时 HCS 列表回退 legacy 全量 merge（**回退方案**，见下）。
- 请求须带 `page>=1`（及 `template_code=HCS_INCIDENT`）走快照分页；`page=0` 或不传 page 且非 `ticket_no` 深链时仍为 legacy（供主页/旧客户端）。
- 迁移 `0079_ticket_list_snapshot.sql` 建表后执行：`python scripts/backfill_ticket_list_snapshot.py` 或 `POST /api/tickets/snapshot/rebuild`；工作台顶栏（须 `workbench_snapshot_rebuild` 非 hidden）提供 **重建列表快照** 按钮，效果与上述两种方式相同。
- 节点 `submit` 成功后自动刷新该工单快照；`ticket_node_data` 仍为 append-only。

**列表查询参数（快照）**：

- `page` / `page_size`：分页（默认 page_size=20，最大 200）
- `tab`：`all` | `pending` | `created`（全量语义，SQL 层过滤）
- `q`：关键词，匹配预聚合 `search_text`（全量）
- `column_filters`：JSON，如 `{"location":["北京","（空）"]}`
- `operator_name`：待处理页签与 `current_handler` 展示串匹配
- 其余：`operator_id`、`created_from` / `created_to`、`ticket_no`（深链单条）

**列表响应（快照）**：`{ items, total, page, page_size, list_mode: "snapshot" }`

**facets 查询参数**：与列表相同上下文 + `column`（如 `location`）+ 可选 `prefix`（弹层内搜索）

**完整回退步骤**：

1. 部署前/set env：`TICKET_LIST_SNAPSHOT_ENABLED=0`，重启后端 → 工作台仍可用 legacy 列表（前端传 `page` 时会收到 legacy 全量并本地分页）。
2. 可选执行 `db/migrations/0079_ticket_list_snapshot_down.sql` 删除快照表。
3. 恢复 env 为 `1` 并重建：跑迁移 0079 + `python scripts/backfill_ticket_list_snapshot.py`。

```
GET /api/tickets
```

**查询参数**：
- `operator_id`：当前操作人账号（白名单与「仅看自己创建」等）
- `q`：关键词，匹配列表展示及节点文本字段
- `ticket_no`：可选，**精确工单号**（`YW…` / `HPM…`）；在 SQL 层只查该单，供工单深链预载，避免拉全量列表
- `created_from` / `created_to`：可选，工单 **`ticket.created_at` 建单时间** 的筛选边界，值为 **`YYYY-MM-DD`**；按 **`Asia/Shanghai`** 时区取日历日，**闭区间**（含起止日）。非法格式忽略，不传则不限

**响应**：
```json
{
  "items": [
    {
      "ticket_no": "YW20260402001",
      "currentStage": "开发闭环",
      "createdAt": "2026-04-02T12:00:00Z",
      "currentHandler": "李潇雨",
      "severity": "致命"
    }
  ]
}
```

#### 批量删除工单（工作台 / 补丁管理）

```
POST /api/tickets/bulk-delete
```

**请求体 JSON**：`operator_id`、`ticket_nos`（单号数组）、`template_code`（与列表一致：`HCS_INCIDENT` 或 `HOTPATCH`）。`template_code = HOTPATCH` 时须角色白名单中 **`patch_manage_delete` 不为 hidden**；`HCS_INCIDENT` 时须 **`workbench_delete` 不为 hidden**（与前端按钮展示一致；权限策略「配置白名单」写入 `is_pl=false`，**PL 用户**未单独配置时**回落**到该基线，未配置键缺省为 `readonly` 即允许删除）。删除范围与 `GET /api/tickets` 相同模板下「仅看自己创建」口径一致。成功响应含 `deleted`（已从库删除的单号）、`absent`（请求单号在库中未命中 `ticket.ticket_no`）。前端点击删除时先弹出「此操作将删除 n 条工单，是否继续？」确认框；**仅**根据 `deleted` 从本地列表与详情缓存中移除；`absent` 仅弹窗提示并随后 `syncTicketsFromServer` 对齐，避免「库未删却从列表消失」。

#### 历史数据迁入（老平台 GaussDB → 新平台）

**列出可迁入工单（按 process_id 选择）**

```
GET /api/tickets/migrate-legacy/candidates?operator_id=demo_001&search=&limit=500
```

**成功响应**：`{ ok, items: [{ legacy_id, process_id, status, current_node, description, create_time, is_deleted, migrated, selectable }], total, truncated }`

**执行迁入**

```
POST /api/tickets/migrate-legacy
```

**请求体 JSON**：`operator_id`、可选 `process_ids`（流程 ID 字符串数组，**仅迁入指定工单**；不传则迁入全部）、可选 `batch_size`（默认 200，1–1000）、可选 `max_total`（限制本次最多处理实例数；`0` 表示不迁入、仅配合 `refresh_snapshot` 重建快照）、可选 `after_legacy_instance_id`（分批游标，配合 `max_total` 续跑）、可选 `refresh_snapshot`（默认 `false`；为 `true` 时在当次迁入完成后全量重建 HCS 列表快照）。权限须 **`workbench_migrate` 不为 hidden**。后端从 `LEGACY_DATABASE_URL`（未配置回退 `DATABASE_URL`）直连老库；三张老表通过 `instance.id` = `parse.instance_id` = `task.work_flow_instance_id` 关联读取，按 `t_work_flow_task` 逐节点重建新平台 `ticket` 及其节点实例/数据/流转日志，并以 `ticket.legacy_instance_id` 幂等去重。流程 ID 取自 `instance.process_id`（或 `task.instance_process_id`）。**工作台「迁入全部」**默认每批 100 条、最后一批完成后单独 `refresh_snapshot: true`。

**成功响应**：
```json
{
  "ok": true,
  "migrated": 3,
  "skipped_existing": 0,
  "skipped_deleted": 1,
  "skipped_not_found": 0,
  "failed": 0,
  "errors": [],
  "ticket_nos": ["YW20251103001", "YW20251021002", "YW20251201003"],
  "processed": 100,
  "has_more": true,
  "next_after_legacy_instance_id": 200100
}
```

- 找不到老表（`t_work_flow_instance` 等）：返回 **400**，提示检查 `LEGACY_DATABASE_URL`
- 单条实例迁移失败不阻断整体，计入 `failed` 并在 `errors`（最多 50 条）记录 `legacy_id` 与原因

**修复已迁工单（流程 ID / 当前阶段）**

```
POST /api/tickets/migrate-legacy/repair
```

**请求体 JSON**：`operator_id`、可选 `process_ids`、可选 `rebuild_workflow`（默认 `false`：仅校正流程 ID/status/当前节点；`true` 时额外重建 `ticket_node_instance` / `ticket_node_data` / `ticket_flow_log`）、可选 `backfill_fields_from_legacy`（`true` 时从老库补全占位 title「Order YW…」与各节点空字段，**不删流转日志**；批量默认仅处理 `title LIKE 'Order YW%'`）、可选 `backfill_placeholder_only`（默认 `true`）、可选 `limit`（每批 1–500，**修复全部已迁 / 重建全部流转** 时前端默认 100 分批）、可选 `after_legacy_instance_id`（分批游标）。**工作台**：**修复已迁**（元数据）、**重建流转**（日志/节点）、**补全占位描述**（字段回填）三套按钮。**若目标 `process_id` 已被其他工单占用**：先将占用方让位再写入；响应含 `ticket_no_displaced`。重建流转会从老库 `t_work_flow_task` 读取完整节点字段（含 `current_work_flow_node_id` / `next_work_flow_node_id`，并兼容末次关闭 task 节点名误存为「关闭」、节点名为空仅带 id 等情况）；**节点字段值**优先保留新平台已落库内容，老库 `t_work_flow_task_parse` 仅作补充；若老库有 task 但**全部**无法映射到流程节点，接口会 **中止重建**（计入 `failed`，错误信息含未映射节点名）以免再次清空历史——曾被错误重建的工单在升级后需再执行一次 **重建流转** 恢复节点与日志。

**成功响应**：
```json
{
  "ok": true,
  "repaired": 12,
  "skipped_unchanged": 3,
  "skipped_not_found": 0,
  "failed": 0,
  "errors": [],
  "ticket_nos": ["YW20260501313"],
  "processed": 12,
  "has_more": false,
  "next_after_legacy_instance_id": null
}
```

命令行：`backend/.venv/bin/python scripts/repair_legacy_migrated_tickets.py`（会自动加载 `backend/.env`，与前端/后端同一套 `DATABASE_URL` / `LEGACY_DATABASE_URL`；默认每批 200 条）、`--process-id YW20260501313`、`--batch-size 0` 一次处理全部（不经 HTTP 网关，适合大批量）。勿用未加载 `.env` 的 shell 直接 `python scripts/…`，否则老库可能回退到默认 `DATABASE_URL` 而找不到 `t_work_flow_instance`。

**删除已迁工单**

```
GET /api/tickets/migrate-legacy/migrated-count?operator_id=demo_001
POST /api/tickets/migrate-legacy/delete-migrated
```

**识别规则**：`ticket.legacy_instance_id IS NOT NULL`（迁移 `0070` 写入，与迁入幂等一致）。**仅删除迁入工单**，不影响在本平台新建的工单。

**请求体 JSON**（delete）：`operator_id`、可选 `process_ids`（仅删指定流程 ID 的已迁单）、可选 `limit` / `after_legacy_instance_id`（分批删除全部已迁，前端默认每批 100）、可选 `dry_run`（仅统计不删）、可选 `refresh_snapshot`（删完后重建 HCS 列表快照）。**工作台**：迁入弹窗 **删除已迁（所选）** / **删除全部已迁**。

**成功响应**（delete）：
```json
{
  "ok": true,
  "deleted": 100,
  "skipped_not_found": 0,
  "processed": 100,
  "ticket_nos": ["YW20260501313"],
  "has_more": true,
  "next_after_legacy_instance_id": 200100,
  "dry_run": false
}
```

命令行：`backend/.venv/bin/python scripts/delete_legacy_migrated_tickets.py --dry-run`（先看数量）、`--process-id YW20260501313`、`--batch-size 100`、`--refresh-snapshot`。

**日志**：迁入/修复输出批次汇总（`migrate_legacy request/response`、`migrate_legacy batch start/done`、`repair_legacy batch start/done`）与逐单关键项（`migrate_legacy instance ok/failed`、`repair_legacy workflow rebuilt` 含 status/current_key/节点序列，`repair_legacy ticket ok` 含字段是否变更）；删除见 `migrate_legacy_delete request/response`、`delete_legacy_migrated done`；快照重建见 `migrate_legacy snapshot rebuild start/done`。审计日志不含逐条 `ticket_nos` 列表，仅 `ticket_nos_count`。前端迁入/修复/删除进度见浏览器控制台 `[migrate-legacy]` / `[migrate-legacy-repair]` / `[migrate-legacy-delete]`，弹窗内显示当前批次进度。

### 用户管理接口

#### 获取用户列表

```
GET /api/users
```

#### 批量更新用户

```
POST /api/users/bulk
```

### 权限管理接口

#### 获取权限策略

```
GET /api/permissions
```

#### 批量更新权限策略

```
POST /api/permissions/bulk
```

#### 删除权限组

```
DELETE /api/admin/permissions/group?role_code={角色编码}
```

删除指定 `role_code` 下的全部策略记录。内置权限组 `管理员` 不可删除；若仍有用户绑定该权限组则返回 409。白名单项 `admin_permissions_delete` 控制前端「删除权限组」按钮。

### 值班管理接口

#### 获取值班日历

```
GET /api/duty/calendar?kind=kernel&year=2026&month=4
```

#### 更新值班日历

```
PUT /api/duty/calendar
```

#### 批量导入月历值班表

```
POST /api/duty/calendar/import
```

表单字段：`file`（.xlsx）、`operator_id`、`kind`（kernel/control/public_cloud/poc/research_version）、`year`、`month`。表头：日期、账号、姓名、班次（全天/晚班）；第 2 行起为数据（模板第 2 行为填写示例，导入前请改为真实排班或删除）。导入整月覆盖；账号须在用户管理中存在，否则整批失败。权限项 `duty_roster_edit`（与编辑、下载模板、导入按钮共用，白名单控制）。

#### 获取轮值表

```
GET /api/duty/rotation
```

### 需求管理接口

#### 获取需求列表

```
GET /api/requirements
```

### 智能助手接口

#### 获取会话列表

```
GET /api/ai/conversations?operator_id=xxx
```

#### 创建新会话

```
POST /api/ai/conversations
```

**请求体**：
```json
{
  "operator_id": "demo_001",
  "title": "新对话"
}
```

#### 删除会话

```
DELETE /api/ai/conversations/{conv_id}?operator_id=xxx
```

#### 获取会话消息

```
GET /api/ai/conversations/{conv_id}/messages?operator_id=xxx&page_size=200
```

#### 发送对话消息

```
POST /api/ai/conversations/{conv_id}/chat
```

**请求体**：
```json
{
  "operator_id": "demo_001",
  "content": "最近1周新增了多少个工单？"
}
```

**响应**：
```json
{
  "role": "assistant",
  "content": "最近1周共新增了 15 个工单。",
  "react_steps": [
    {"thought": "需要查询最近1周的工单数量", "action": "db_query", "sql": "SELECT COUNT(*) AS cnt FROM ticket WHERE created_at >= NOW() - INTERVAL '7 days'", "observation": [{"cnt": 15}]}
  ],
  "sql_query": "SELECT COUNT(*) AS cnt FROM ticket WHERE created_at >= NOW() - INTERVAL '7 days'",
  "query_result": [{"cnt": 15}]
}
```

#### 获取快捷问题模板

```
GET /api/ai/quick-templates?operator_id=xxx
```

#### 创建快捷问题模板

```
POST /api/ai/quick-templates
```

#### 删除快捷问题模板

```
DELETE /api/ai/quick-templates/{tpl_id}?operator_id=xxx
```

#### 获取系统大模型配置

```
GET /api/params/llm-config?operator_id=xxx
```

> 需要管理员权限。API Key 返回脱敏值。

#### 更新系统大模型配置

```
PUT /api/params/llm-config
```

> 需要管理员权限。

#### 测试系统大模型连通性

```
POST /api/params/llm-config/test
```

#### 获取个人大模型配置

```
GET /api/ai/my-llm-config?operator_id=xxx
```

**响应**：
```json
{
  "effective": {"api_base_url": "...", "model": "gpt-4o", ...},
  "user_override": {"model": "my-model"},
  "system_default": {"api_base_url": "...", "model": "gpt-4o", ...},
  "has_user_config": true
}
```

#### 更新个人大模型配置

```
PUT /api/ai/my-llm-config
```

#### 测试个人大模型连通性

```
POST /api/ai/my-llm-config/test
```

#### 刷新数据库 Schema 缓存

```
POST /api/ai/refresh-schema?operator_id=xxx
```

**查询参数**：
- `operator_id`: 操作人ID
- `scope`: 范围（all/mine/assigned）
- `q`: 搜索关键词
- `status`: 状态筛选（逗号分隔）
- `priority`: 优先级筛选（逗号分隔）
- `category`: 需求分类筛选（逗号分隔，可选值：管控需求/内核需求/管控和内核需求/其他）
- `value`: 需求价值筛选（逗号分隔，可选值：质量加固/性能提升/竞争力提升/定位能力提升/恢复能力提升/感知能力提升）
- `page`: 页码
- `page_size`: 每页数量

**响应**：
```json
{
  "items": [
    {
      "id": 1,
      "requirement_no": "RQ20260428001",
      "title": "需求标题",
      "status": "待分析",
      "priority": 3,
      "category": "管控需求",
      "value": "质量加固",
      "proposer": "张三",
      "assignee": "李四"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20
}
```

#### 创建需求

```
POST /api/requirements
```

**请求体**：
```json
{
  "operator_id": "demo_001",
  "title": "需求标题",
  "description": "详细描述",
  "proposer": "张三",
  "assignee": "李四",
  "related_issues": ["DTS-001"],
  "external_req_no": "EXT-001",
  "planned_version": "V8.2.0",
  "planned_date": "2026-06-30",
  "priority": 5,
  "category": "管控需求",
  "value": "质量加固",
  "remark": "备注"
}
```

#### 获取需求详情

```
GET /api/requirements/{req_id}
```

#### 更新需求

```
PATCH /api/requirements/{req_id}
```

**请求体**：
```json
{
  "operator_id": "demo_001",
  "title": "更新后的标题",
  "status": "待RAT决策",
  "comment": "流转备注"
}
```

**状态流转规则**：仅允许正向流转一步或回退一步
- 待分析 → 待RAT决策（正向）
- 待RAT决策 → 开发中（正向）
- 开发中 → 已经落地（正向）
- 待RAT决策 → 待分析（回退）
- 开发中 → 待RAT决策（回退）
- 已经落地 → 开发中（回退）

#### 获取需求操作日志

```
GET /api/requirements/{req_id}/logs
```

#### 删除需求

```
DELETE /api/requirements/{req_id}?operator_id=xxx
```

> 仅「待分析」状态的创建人可删除

#### 需求分析

```
GET /api/requirements/analytics?start_date=&end_date=&precision=week
```

**参数**：
- `start_date` / `end_date` — 日期范围，默认近 90 天
- `precision` — 时间粒度：`week`（默认）/ `month`

**返回**：
- `kpi` — 总数、各状态数量、平均优先级、按时落地率、延期数
- `status_distribution` — 状态分布（饼图数据）
- `category_distribution` — 需求分类分布（饼图数据）
- `value_distribution` — 需求价值分布（条形图数据）
- `priority_distribution` — 优先级分组分布（紧急/高/低）
- `trend` — 按时间粒度的新建/状态变更/落地趋势
- `person_load` — 提出人/责任人 Top10
- `version_plan` — 各版本需求数、落地数、延期数、延期明细

---

## 常见问题解答

### Q1: 后端修改后前端仍显示旧数据？

**A**: 确保后端服务已重新加载：
- 开发模式使用 `--reload` 参数，保存文件后等待 1-2 秒
- 生产模式需手动重启服务
- 前端可尝试强制刷新浏览器

### Q2: 工单编号重复怎么办？

**A**: 系统使用事务内咨询锁防止并发重号。如遇问题：
1. 检查数据库连接是否正常
2. 确认当日序号未超过 999
3. 查看后端日志排查并发问题

### Q3: 数据库迁移执行失败？

**A**: 
1. 确认迁移脚本按顺序执行
2. 检查数据库用户权限
3. 查看错误日志定位具体问题
4. GaussDB 与 PostgreSQL 存在方言差异，需注意兼容性

### Q4: 前端深链刷新 404？

**A**: 
- 使用后端托管前端（推荐）
- 若使用独立前端服务，请使用 `serve_spa.py` 而非 `python -m http.server`

### Q5: 权限配置不生效？

**A**:
1. 检查权限级联约束（子项权限不得高于父项）
2. 确认用户角色（`role_code`）与权限组白名单配置正确
3. 清除浏览器缓存重新登录

### Q6: 工作台/补丁管理点「创建」提示无法连接后端或 `data load failed: 404`？

**A**:
- 若后端日志为 `GET /api/tickets/.../nodes/.../data` **404** 且 `detail` 为 **`ticket not found`**：属正常现象——创建弹窗使用的工单号在**首次提交前**尚未写入数据库；前端会将该响应视为空表单数据。若仍报错，请确认前端已更新到包含该处理的版本。
- 若确为网络/端口问题，请在本机启动 `uvicorn` 并与页面同主机访问（或用地址栏 `?api=http://127.0.0.1:8000` 指定 API 基址）。

### Q6: 人员字段显示格式不一致？

**A**: 系统统一使用「姓名 账号」格式，后端会自动规范化历史数据。如仍有问题，检查 `next_handler`、`collaborator`、`hcs_owner` 等字段的存储格式。

### Q7: 后端日志太多或磁盘被日志占满？

**A**:
1. 确认未开启 `LOG_ACCESS=1`（默认关闭 Uvicorn access log）。
2. 生产环境可将 `LOG_LEVEL=WARNING`，`audit` 关键事件仍会输出。
3. 重复错误由 `LOG_RATE_LIMIT_SECONDS` 限流；若仍异常膨胀，检查 SSO/外部依赖是否持续失败。
4. 使用 `LOG_DIR` 写本地文件时，通过 `LOG_MAX_BYTES` / `LOG_RETENTION_DAYS` 控制单文件大小与保留天数；容器 stdout 部署使用 `--log-opt max-size` / `--log-opt max-file`。

---

## 功能测试

项目在 `test/` 目录下提供完整的功能测试方案与自动化测试程序，覆盖全部12个功能模块共490+个测试用例，以及195个E2E端到端测试用例。

### 测试模块覆盖

| 模块 | 测试文件 | 用例数 | 覆盖内容 |
|------|----------|--------|----------|
| M01 健康检查 | `test_m01_health.py` | 6 | 服务可用性、HTTP方法限制、响应格式 |
| M02 工单流程 | `test_m02_ticket.py` | 60+ | Schema/创建/提交/流转/列表/详情/日志/全流程/回退/边界条件/字段规则 |
| M03 权限管理 | `test_m03_permission.py` | 12 | 策略CRUD/有效权限/权限结构/角色差异/权限执行 |
| M04 用户管理 | `test_m04_user.py` | 12 | 用户CRUD/upsert/角色变更/字段验证 |
| M05 值班管理 | `test_m05_duty.py` | 50 | 日历/轮值/局点/RL/假日配置/月历导入 |
| M06 请假管理 | `test_m06_leave.py` | 31 | 白名单/申请/审批全流程/申请详情/操作序列/删除 |
| M07 参数配置 | `test_m07_params.py` | 30+ | 责任田/基线/热补丁/拉群模板/字段树深度/版本验证 |
| M08 个人统计 | `test_m08_stats.py` | 10 | 工作量/SLA/直通率/统计结构/工单列表 |
| M09 前端SPA | `test_m09_spa.py` | 8 | 静态文件/深链/路径遍历/安全测试 |
| M10 质量改进 | `test_m10_requirement.py` | 35 | 质量改进CRUD/搜索筛选分页/分类·优先级·接纳状态枚举/日志/分析看板/导入导出模板 |
| M11 智能助手 | `test_m11_ai_assistant.py` | 50+ | 会话管理/消息/快捷模板/LLM配置/Schema刷新/上下文Token |
| M15 小鲁班消息推送 | `test_m15_xiaoluban_message.py` | 9 | 消息发送成功/状态异常/HTTP异常/JSON解析异常/Payload结构/配置项 |
| M16 局点档案 | `test_m15_site_profile.py` | 18 | 列表/分页/搜索/增改删/详情/空日期/批量导入/导出/白名单权限 |
| M18 Welink拉群 | `test_m18_welink_group.py` | 20 | 成员解析/title推导/端点逻辑(owner来源/失败处理/场景映射) |
| 重大问题(工单驱动) | `test_major_issue.py` | 11 | 惰性同步(仅命中阈值/幂等保留状态)/快照字段/状态三态/进展按天(同日覆盖+跨天倒序)/列表过滤/写权限校验 |

### E2E 端到端测试

项目使用 Playwright 进行 E2E 测试，模拟真实浏览器操作，捕获前端 JS 运行时错误。

| 测试文件 | 用例数 | 覆盖内容 |
|----------|--------|----------|
| `test/e2e/test_e2e_page_load.py` | 12 | 12个页面加载无JS错误 |
| `test/e2e/test_e2e_navigation.py` | 3 | 侧边栏导航点击、浏览器前进后退、深链接直接访问 |
| `test/e2e/test_e2e_module_import.py` | 2 | ES Module 加载完整性、核心DOM结构验证 |
| `test/e2e/test_e2e_admin_page.py` | 25 | 管理后台权限页面/用户页面/导航/筛选/编辑模式 |
| `test/e2e/test_e2e_ticket_workflow.py` | 12 | 工单创建弹窗/表单验证/7节点全流程/工作台交互 |
| `test/e2e/test_e2e_ticket_workflow_extended.py` | 38 | 工单回退/跨节点跳转/同节点停留/直接关闭/挂起/flow-bar状态/详情页功能/工作台高级交互/UI创建表单/回退+前进组合 |
| `test/e2e/test_e2e_requirement.py` | 17 | 需求管理页面/标签切换/创建弹窗/详情查看/状态流转/搜索 |
| `test/e2e/test_e2e_leave_workflow.py` | 13 | 请假管理页面/标签切换/申请弹窗/列表交互/审批操作 |
| `test/e2e/test_e2e_duty_workflow.py` | 10 | 值班表页面/日历交互/编辑模式/轮值标签切换/节假日配置 |
| `test/e2e/test_e2e_ai_workflow.py` | 6 | AI助手页面/新建对话/发送消息/快捷模板/删除对话/切换对话 |

```bash
# 安装 E2E 测试依赖
pip install playwright httpx
python -m playwright install chromium

# 运行 E2E 测试（自动启动后端服务）
python -m pytest test/e2e/ -v
```

### 运行测试

**一键全量（推荐）**：先跑非 `e2e` 再跑 `e2e`，避免同一 pytest 进程内 Playwright 与 `test_m13_frontend` 会话冲突（详见 [`docs/ISSUE_WORKSPACE_TABS.md`](docs/ISSUE_WORKSPACE_TABS.md) 测试体系小节）。

```bash
./scripts/ci/run-tests.sh
```

```bash
# 安装测试依赖
pip install pytest pytest-json-report httpx pytest-asyncio

# 启动后端服务（测试环境需跳过 SSO 认证）
# Windows:
set SKIP_SSO_AUTH=1 && python -m uvicorn app:app --host localhost --port 8000 --no-access-log --log-level warning
# Linux/Mac:
SKIP_SSO_AUTH=1 python -m uvicorn app:app --host localhost --port 8000 --no-access-log --log-level warning

# 执行全部测试
cd test
python run_tests.py

# 执行指定模块
python run_tests.py --module m02

# 生成测试报告
python run_tests.py --report
```

测试报告输出至 `test/reports/` 目录，包含 Markdown 和 JSON 两种格式。

> **注意**：运行 API 测试前必须启动后端服务并设置 `SKIP_SSO_AUTH=1` 环境变量，否则认证中间件会拦截请求返回 401。

详细测试方案见 [test/test_plan.md](test/test_plan.md)。

---

## CHANGELOG

### v0.2.0 (当前版本)

**参数配置**
- **责任田模块**：迁移 `0079_seed_duty_field_tree.sql` 写入正式三级树；`0080_duty_field_fifteen_roots.sql` 将一级根节点扩展为 15 个（存储引擎、SQL引擎、周边组件、内核、管控、网络、安全、慢SQL（SQL调优）、整体性能、升级、容灾、备份恢复、扩容、CM、OM），各含二/三级子模块。已部署库请按序执行。

**体验优化**
- 工作台列表单元格：文字未完整展示时（CSS 省略或列表截断）鼠标悬停显示全文；已完整展示则不出现提示（`table-cell-overflow-tooltip.js`）
- 工作台列表「每页条数」下拉新增 **200** 选项；`GET /api/tickets` 快照分页 `page_size` 上限同步调整为 200
- 工单详情页节点「提交」后不再全量拉取 legacy 列表（2 万+ 迁入单时曾卡顿数秒并显示「加载中…」）；改为 `GET /api/tickets?ticket_no=…` 仅刷新当前单，且本地已有工单上下文时后台 sync 不再遮挡详情页（`syncSingleTicketFromServer`、`ticketDetailLoading`）
- 工单详情页节点「提交」流转后合并重绘：跳过 saveNode 完成、`advanceWorkflow` 与下一节点表单预加载过程中的中间帧 `requestRender`，在 sync 当前单并预加载目标节点后再统一刷新，减轻页面连闪（`preloadWorkflowFormsAfterFlowSubmit`、`suppressRenderOnComplete`）
- 工作台顶栏新增 **重建列表快照** 按钮（权限策略 `workbench_snapshot_rebuild`），调用 `POST /api/tickets/snapshot/rebuild`，等同 `python scripts/backfill_ticket_list_snapshot.py`；回填过程在后端日志输出 start / progress / done 关键进度
- 工作台「迁入」「重建列表快照」从 `workbench_delete` 解耦为独立白名单项 `workbench_migrate`、`workbench_snapshot_rebuild`（迁移 `0081` 初始值继承原删除权限；`0085` 在 0081 已执行环境上按 `is_pl=false` 补齐 `user_account` 角色基线）
- RL 值班表编辑：添加记录时选择主/备值班人员后，自动从用户管理（`user_account.contact_phone`）带出手机号，仍可手动修改
- 权限策略「值班表」白名单新增 **仅展示RL值班表**：侧栏仍可进入值班表页，但页面与子菜单仅展示 RL 值班表区块；该范围下编辑/导入等能力自动关闭（`duty_roster_edit` 级联为不展示）
- 我的主页「值班信息」月历现汇总全部**值班表**（内核/管控/公有云/POC/在研版本/RL）中**本人**排班，不含轮值表；切换月份时同步拉取五类月历数据（`buildHomeDutyCalendarCell`、`navigateHomeDutyCalendarMonth`）
- 轮值表（含专项轮值子表）列表过长时在卡片内纵向滚动（约 6 行可见），表头固定不随内容滚走

**问题修复**
- 工作台列筛选后列表前几行仍显示不符合条件的工单：快照分页 merge 时会保留已打开详情页工单，此前展示路径未再应用列筛选；现 `applyWorkbenchListFilters` 统一做页签 + 列筛选，点击弹层外关闭亦触发服务端 resync
- 工作台点开问题单详情后再进「我的主页」，该单误出现在「待办工单」且「当前处理人」变为本人：`getAllTickets` 曾把详情页预加载写入的 `formsByTicket` 合成列表行并将 `currentHandler` 填为登录人；现仅合并 `workflowByOrderId` 本地建单草稿，切回已打开工单页签时补拉深链单（`getAllTickets`、`getTicketById`、`ensureDeepLinkTicketLoaded`）
- 我的主页与工作台侧栏/顶栏页签切换时页面连闪：导航 handler 内同步 `render()` 与列表同步回调各触发一次整页重绘；现统一经 `runNavigationTicketSyncAndRender`——**先立即 render 切页**，列表同步完成后**就地更新表格 DOM**（`patchNavListPanelsAfterSync`），个人统计与值班月历亦改为 patch，不再第二次整页重绘
- 大量已迁工单列表/详情问题描述显示为「Order YW…」且节点字段为空：迁入与重建流转此前仅按老库 parse 写 `issue_desc`，老库无 parse 或重建后字段被清空时 `ticket.title` 与节点数据均回落为占位文案；现从老库 `instance.description` + parse 合并落库，并提供 **补全占位描述**（`backfill_fields_from_legacy`）批量从老库回填空字段与占位 title，不删除流转日志。
- 重建流转后工单详情各节点字段全空、仅流转日志正确：重建会先删除 `ticket_node_data` 再仅按老库 parse 回填，老库无 parse 或迁入后在新平台填报的内容会被清空；现重建前快照各节点已落库字段并写回（`legacy_migration._snapshot_node_values_by_key`），迁入弹窗重建完成后亦清除前端节点表单缓存。
- 侧栏连续切换页面后偶发「页面无响应」（如运维效率 oncall:eva）：`refreshOncallEvaPage` 在 `oncallEvaNeedsRefresh` 完成前被中间 `requestRender` 反复触发，叠加 6 路并行 fetch 各触发 2 次全页重绘导致主线程阻塞；现加 in-flight 锁、刷新开始时清除 needsRefresh、批量拉取期间抑制中间重绘，并在离开运维效率页时释放 ECharts 实例；`requestRender` 同帧合并为一次 `requestAnimationFrame` 重绘。
- 我的主页「个人数据」透传率饼图此前统计全量工单且未按当前登录人过滤，质量问题筛选亦未识别「是（已知/新发现质量问题）」等白名单取值；现以本人**运维分析最后提交**工单为口径，并按 `is_quality_issue` 白名单值筛选（`GET /api/home/personal-stats`）。
- 工作台工单导出部分字段为空、详情页可见：导出此前仅读各节点最新提交的原始 JSON，未合并 `inherit_previous` 继承字段；现 `export-data` / `export-file` 与详情页 `GET .../nodes/{key}/data` 使用同一套合并逻辑（`utils/ticket_inherited_values.py`）。
- 工作台多页签/侧栏来回切换后偶发卡顿数秒并展示全量工单：离开工作台时曾触发 legacy 全量列表 sync，与回到工作台时的快照分页 sync 并发竞态，旧响应覆盖 `ticketListServerPaged` 并迫使主线程对全量数据做客户端过滤；现离开列表页不再拉取、列表 sync 增加序号丢弃过期响应、回到工作台加载期间沿用服务端分页路径（`planTicketListResync`、`syncTicketsFromServer`、浏览器后退到主页改走 `syncHomeWorkbenchTicketLists`）
- 从「我的主页」点进工作台仍偶发卡顿并短暂展示全量工单行：主页 `syncHomeWorkbenchTicketLists` 会把 legacy 全量 HCS 写入 `ticketList`，进入工作台后 loading 期间服务端分页路径会把内存中全部 HCS 当作当前页渲染；现于快照 sync 发起前按条件调用 `prepareWorkbenchSnapshotSync` 剥离全量缓存（保留 HOTPATCH 与已打开工单页签），并移除 `ticket-page.js` 侧栏导航重复点击处理
- 从统计/参数/工单详情等任意非列表页进入工作台同样卡顿：`prepareListPageEnter` 在侧栏、顶栏页签、`popstate` 与首屏 `/workbench` 深链的**首帧 render 之前**同步清理 legacy HCS；loading 期间表头筛选不再扫描 `ticketList` 全量（服务端分页未拉 facets 时用空数组）；`popstate` 不再于 prepare 前先 `requestRender` 刷一次全表
- 值班表编辑人员搜索：可选人员现与用户管理一致（全部启用账号），不再仅限「管理员 / 普通人员」角色；搜索支持姓名、账号与空格分词，有搜索词时返回全部匹配项（不再截断为 100 条）
- 工单「问题引入模块 / 问题归属模块」级联下拉：一级列表滚到底部后自动跳回顶部；原因为悬停展开子级时整列重绘未保留 `scrollTop`。现重绘前捕获各列滚动位置并写回，滚动过程中短暂抑制悬停展开（`dutyCascaderCaptureColumnScroll` / `dutyCascaderRestoreColumnScroll`）。
- 工单「问题引入模块 / 问题归属模块」级联下拉支持**关键字搜索**：面板顶部搜索框可按完整路径或分段匹配（支持空格分词），列出匹配路径后点击即可选中（`dutyCascaderCollectAllPaths` / `dutyCascaderPathMatchesKeyword` / `dutyCascaderSearchPanelHtml`）。
- 工作台/补丁管理列表表头全选：现按当前页签、列筛选、建单日期与搜索条件下的**全部可见工单**选中或取消，不再仅作用于当前页；HCS 快照服务端分页列表通过 `fetchWorkbenchFilteredTicketIds` 跨页拉取全部工单号后再勾选。
- 工单导出「已选中的工单」仅导出当前页 10 条 / 大批量导出占满浏览器内存：服务端分页下列表内存仅保留当前页；现工作台服务端分页或超过 500 条时改由 `POST /api/tickets/export-file` 服务端按批生成 Excel/CSV，浏览器只传 `selectedTicketIds` 或 `list_query` 筛选条件，不再 `fetchWorkbenchFilteredTickets` 拉全量入内存。
- 运维分析「根因分类」随「问题类型」联动无选项：运维分析节点使用扁平下拉，切换问题类型后仅隐藏初始空列表中的按钮而未重建选项；现按当前问题类型动态重建根因分类可选项（`rebuildWfFlatSelectChoiceButtons`、`syncRootCauseCategoryOptions`）。
- 侧栏「补丁管理」点击无反应：合并主页待办时误删 `getPatchListBaseTickets` 导入，进入 `patch:list` 时 `render()` 抛 `ReferenceError`；已恢复导入。工作台 ↔ 补丁管理切换现经 `planTicketListResync` 全量拉取对应 `template_code`（`HCS_INCIDENT` / `HOTPATCH`）。
- 我的主页「待办工单」合并补丁管理「待处理」：进入主页时同步拉取 `HCS_INCIDENT` 与 `HOTPATCH` 列表，待办页签在 HCS 待办基础上并入本人为当前处理人的热补丁单（`getHomePendingWorkbenchBaseTickets`、`syncHomeWorkbenchTicketLists`）。
- 我的主页首屏待办为空、须先去工作台点「待处理」才显示：主页 HCS 同步此前走 legacy 全量列表，`current_handler` 与快照不一致导致客户端待办过滤为 0；现 `syncHomeHcsTicketList` 优先分页拉取快照全量（`fetchAllHomeHcsSnapshotTickets`），bootstrap 亦先 `await ensureAdminData()` 再拉列表。
- 我的主页「曾处理」：在「待审批」右侧新增页签，展示本人曾在任意节点提交过的问题单与热补丁单（`operatorSubmitted` / `ticket_node_data.created_by` 口径；含已关闭工单）。
- 热补丁单详情 URL（如 `/tickets/HPM…`）刷新后误报「Order Not Found」：`syncTicketsFromServer` 此前在非 `patch:list` 时固定请求 `HCS_INCIDENT`，深链打开 HPM 单时本地列表不含该单；现对 `activeKey === ticket:HPM`+规范 11 位数字单号 同步请求 `HOTPATCH` 列表（`frontend/modules/pages/ticket-core.js` `templateCodeForTicketListSync`）。
- 工单节点提交：已移除所有 `whitelist` 类型字段的**选项值白名单校验**（如局点、根因分类、人员、责任田级联路径等），仅保留必填与「须为字符串」校验；下拉仍可提供建议项，但允许填写/提交不在列表中的取值，不再报「取值不在白名单中」。
- **下一步处理人**下拉仅显示一人：曾由 `handle_mode_next_handler_whitelist` 按处理方式收窄为种子数据中的单人；现 **HCS / 热补丁** 的 `next_handler`（及 `collaborator`）统一从 **`user_account`（用户管理）** 加载全量可选人；前端使用带搜索框的扁平下拉，支持按**姓名、账号或空格分词**筛选（`personOptionMatchesKeyword`、`WF_FLAT_SEARCHABLE_FIELD_KEYS`）。
- **开发分析 / 运维闭环 · 协同处理人**支持**多选**：节点字段 `ui_props.multiple=true`（迁移 `0053`、`0054`）；前端扁平下拉可勾选多人并以全角分号 `；` 拼接落库（每人仍为「姓名 账号」）；运维闭环从开发分析继承时按同一字符串展示，亦可在本节点继续多选编辑。
- 工作台/补丁管理「创建」弹窗：本地预分配工单号尚未落库时，`GET /api/tickets/{id}/nodes/{key}/data` 返回 404 `ticket not found`；前端建单草稿流现将其视为空数据并正常展示表单（不再误报为无法连接后端）。
- 热补丁「诉求填写」节点：`运维人员`、`开发责任人` 曾误配为白名单且仅含单一占位说明，无法填真实人员信息；已改为 **文本** 字段，可填写如「李潇雨 l30030745」。已部署库请执行 `db/migrations/0037_hotpatch_demand_fill_person_fields_text.sql`。
- 热补丁「诉求填写」创建弹窗缺少「处理方式」「下一步处理人」：初版迁移误将两字段挂在「开发填写」节点；现于 **诉求填写** 置顶展示，处理方式为 **提交开发人员** → 流转至开发填写。已部署库请执行 `db/migrations/0045_hotpatch_demand_fill_flow_fields.sql`。
- 热补丁流程其余人员类白名单占位说明由「工号+姓名」统一为「姓名+工号」：已部署库请执行 `db/migrations/0038_hotpatch_person_format_label_name_id.sql`。
- 热补丁四自检并行：四人全部「提交转测发起」后，`adjust_hotpatch_submit` 会清除 `flow_context.p2`；`sync_hotpatch_frontier_after_submit` 此前仍按空的 `done` 推断 frontier，误把「当前阶段」拉回四自检；现以 `next_node_key == hp_transfer_start` 为准将 `frontier` 固定为转测发起（`backend/hotpatch_flow.py`）。

**新增功能**
- **问题填写起单提交后展示问题审核人**：工作台「创建」从问题填写节点起单并提交成功后，弹出「问题审核人」对话框，展示派单结果的姓名与工号，右侧「复制」按钮一键复制「姓名 工号」；前端 `problem-fill-reviewer-modal.js`，单测 `test/frontend_tests/__tests__/problem-fill-reviewer-modal.test.js`
- **问题填写派单优先级调整**：在研版本试点（问题阶段）> POC 阶段 > 产品线公有云 > 问题组件；与 `docs/工单流转规则.md` 一致
- **在研版本值班表 / 在研版本轮值表**：值班表页新增「在研版本值班表」（月历排班，支持全天/晚班）与「在研版本轮值表」；后端 `GET/PUT /api/duty/calendar` 增加 `research_version` 种类，`GET/PUT /api/duty/rotation` 增加 `researchVersionRotation`。问题填写「问题阶段」=`在研版本试点` 时，提交后问题审核处理人按时段从在研版本轮值表或值班表自动带出（派单优先级最高，高于 POC 阶段、产品线公有云与问题组件）。已部署库请执行 `db/migrations/0078_duty_research_version_calendar.sql`；规则详见 `docs/工单流转规则.md`；单测 `test/test_ticket_research_version_dispatch.py`
- **月历值班表 Excel 批量导入**：内核/管控/公有云/POC/在研版本 五类月历支持「下载模板」「导入」，整月覆盖；与「编辑」共用权限项 `duty_roster_edit`；已部署库请执行 `db/migrations/0087_duty_roster_edit_merge_import_whitelist.sql` 清理旧 `duty_calendar_import` 白名单项
- **轮值表最近接单时间跨表同步**：工单派单命中任一轮值表时，同步更新该人员在全部轮值表中的「最近接单时间」；不涉及值班表（`duty_calendar_assignment`）。规则详见 `docs/工单流转规则.md`；单测 `test/test_duty_last_accept_sync.py`
- **问题审核「其他」转办**：处理方式为「提交其他运维审核」且问题类型初步判断为「其他」时，使用手动选择的「下一步处理人」，并将当前处理人在全部轮值表中的「最近接单时间」重置为 `2000-01-01 00:00:00`，下一步处理人在全部轮值表中的「最近接单时间」更新为提交时刻
- **POC 值班表 / POC 轮值表**：值班表页新增「POC值班表」（月历排班，支持全天/晚班）与「POC轮值表」（姓名、当值状态、最近接单时间）；后端 `GET/PUT /api/duty/calendar` 增加 `poc` 种类，`GET/PUT /api/duty/rotation` 增加 `pocRotation`。已部署库请执行 `db/migrations/0075_duty_poc_calendar.sql`
- **POC 阶段派单**：问题填写「问题阶段」=`POC阶段` 时，提交后问题审核处理人按时段从 POC 轮值表（工作日白班）或 POC 值班表（工作日晚班 / 周末节假日）自动带出；优先级次于「在研版本试点」，高于「产品线 = 公有云」与「问题组件」分单。规则详见 `docs/工单流转规则.md`；单测 `test/test_ticket_poc_dispatch.py`
- **小鲁班消息推送**：新增消息发送工具类与API接口
  - 工具类：`backend/utils/xiaoluban_message.py`（同步发送函数）
  - API接口：`POST /api/xiaoluban/send-message`
  - 配置项：`XIAOLUBAN_MESSAGE_URL`、`XIAOLUBAN_MESSAGE_SEND_TOKEN`
  - 生产环境需在 `backend/.env` 中配置实际的服务地址和Token
- **Welink 拉群**：工作台一键创建 Welink 群组并发送卡片消息
  - 工具类：`backend/utils/WelinkHelper.py`（群创建、join flag设置、卡片消息发送）
  - 路由：`POST /api/welink/create-group`（`backend/routers/welink.py`）
  - 四种场景：重大问题、紧急问题、ITR管理升级、一般问题
  - 群组成员解析：逗号分隔"工号 姓名"格式，自动提取工号列表
  - title 自动推导：重大/紧急/ITR→"WarRoom已拉起，请按规范刷新进展"；一般→"请按规范刷新进展"
  - 群主从 SSO `w3_account` 自动获取
  - 配置项：`WELINK_APP_ID`、`WELINK_APP_SECRET`、`WELINK_HIS_APP_ID`、`WELINK_HIS_STATIC_TOKEN`、`WELINK_DYNAMIC_TOKEN_URL`、`WELINK_CREATE_GROUP_URL`、`WELINK_CARD_MESSAGE_URL`
  - 前端弹窗"确定"按钮改为"一键拉群"，替换原剪贴板复制行为
- **局点档案（运维管理 → 局点档案）**：以表格列出全部局点，含 28 个业务字段（局点名称 / 类型 / 产品组件 / 驻场合同 / 所属行业 / 地区 / 所属代表处 / 阶段 / 标签 / 交付方式 / 汇报日期 / 回报性质 / 运维人员 / 内核交付 / 内核维护 / 服务支持 / 技术组长 / DA / SA / TD / 客户经理 / 项目经理 / 服务经理 / 软件收入 / 服务收入 / 确收时间 / 风险描述 / DTRB结论）；支持关键词搜索、分页、新增/编辑/删除、Excel（.xlsx）导入与导出（导入导出表头一致，可往返）；白名单 `site_profile_list` / `site_profile_create` / `site_profile_import` / `site_profile_export`，默认可见。后端 `db/migrations/0053_site_profile.sql` + `backend/routers/site_profile.py`，前端 `frontend/modules/pages/site-profile-page.js`
- **问题填写「局点」改为下拉选择 + 可新增**：「局点」字段由文本框改回下拉，选项实时取自「局点档案」的局点名称（`LOCATION_SET` 选项集走 `external_api`，后端 `_load_schema` 按 `site_profile.site_name` 填充）；下拉为可搜索的扁平选择，输入不在档案中的新局点名时可点「新增局点「xxx」」直接选用，工单提交后后端自动在 `site_profile` 建一条只含局点名称的记录（`backend/routers/tickets.py` `_ensure_site_profile_for_location`）。已部署库请执行 `db/migrations/0054_problem_fill_location_site_profile.sql`
- **版本模块 / 用户管理列表分页**：参数配置 → 版本模块「基线版本」「热补丁版本」子页，以及管理 → 用户管理列表，均支持客户端分页（每页 10/20/50/100、上一页/下一页、总条数摘要）；交互与工单工作台一致（`frontend/modules/utils/list-pagination.js`）
- **用户管理搜索框**：管理 → 用户管理页表格上方提供全局搜索，可按账号、姓名、角色、小组、邮箱、联系电话、产品线、领域、最小部门、备注等字段关键词过滤，与表头列筛选、分页可同时使用；输入防抖 800ms 后刷新列表，Enter 立即搜索
- **SSO 单点登录集成**：与企业 SSO 系统对接，实现统一认证
  - 后端 AuthMiddleware 中间件验证 SSO Cookie
  - 前端自动检测 Cookie 并调用 `/api/auth/me` 验证会话
  - 右上角用户头像组件（显示用户名首字符，支持下拉菜单：个人信息、注销）
  - 注销时清除 localStorage 和 SSO Cookie
  - 支持环境变量配置：`SSO_BASE_URL`、`SSO_COOKIE_DOMAIN`、`SKIP_SSO_AUTH`
  - 测试环境可通过 `SKIP_SSO_AUTH=1` 跳过认证
- 工作台按工单建单时间筛选列表：`GET /api/tickets` 支持 `created_from` / `created_to`（`Asia/Shanghai` 日历日），前端毛玻璃日历一次弹窗内连选起止两日并传参；我的主页个人统计、统计图表（人力投入 / Doer / 归属分析）、重大问题自定义、需求分析自定义等起止日期筛选复用同一交互
- 「运维效率」与「月度报告」整组（含问题报表 / 报告生成 / 报告归档）改由权限策略白名单驱动：新增 `monthly_report` 白名单项，`oncall_eva` 与 `monthly_report` 均默认 hidden，迁移 0041 为内置 admin / 管理员 角色种入可见态；其余角色需在「权限策略 → 白名单」显式放行
- 月度报告模块（数据报表 → 月度报告）：问题报表支持双 Excel 导入、按 DTS 单号合并、结果导出 xlsx
- 现网重大问题月度分析报告（数据报表 → 月度报告 → 报告生成）：暗红色标题横幅（产品名/拟制/审核行内编辑入口）、5 段分段保存（整体情况/问题透视/重大问题/改进诉求/问题详情&质量改进记录）、归档、导出 HTML、导出 Excel（单 sheet 堆叠，问题透视 2x2/改进诉求 1x3 网格分布，含暗红横幅+天蓝段头+表头底色+边框，依赖 xlsx-js-style）
- 完整的工单流程管理（7节点）
- RBAC 权限管理系统（权限策略页支持删除权限组，白名单项 `admin_permissions_delete`）
- 值班日历与轮值表管理
- 请假申请功能（列表支持分页：每页 10/20/50/100 条；**新建申请**弹窗中「申请人」默认当前登录账号，支持姓名/账号关键字搜索选择；**抄送人**复用工单协同处理人同款多选扁平下拉；**「所有申请」**范围由白名单 `leave_application_all` 控制（默认展示全部；配置为「仅展示申请人为本人的请假单」时，`scope=all` 列表仅返回本人申请）；**删除**由白名单 `leave_delete` 控制工具栏/详情删除按钮，后端 `DELETE /api/leave/applications/{id}` 同步校验；删除已同意申请时会尝试恢复申请人轮值/局点值班当值；审批「同意申请」后，申请人将在全部轮值表中自动置灰，工单自动派单时跳过该人员；全部时间段结束后自动恢复为当值；内核/管控/公有云/POC/在研版本 值班表、RL 值班表不受影响）
- 需求管理功能（全生命周期、状态流转、操作日志）
- 需求分析功能（8维度图表分析：KPI、状态分布、需求分类分布、需求价值分布、优先级分布、趋势、人员负载、版本计划）
- 智能助手功能（AI 多轮对话、ReAct 推理引擎、快捷问题模板、双级 LLM 配置、安全只读查询）
- 智能助手易用性优化：输入框和发送按钮始终可用，发送时自动创建会话，无需用户手动创建
- 多主题支持（5套主题 + 自定义背景）
- 工单列表多维度筛选与排序
- SLA 时间计算：列表以 `ticket.created_at` 为起点；未关闭工单用当前时间，已关闭工单以 `closedAt`（最后一次 close 流转）为终点，关闭后不再增长
- 数据导出功能
- 一键启动脚本（自动创建虚拟环境、安装依赖、检测数据库状态、执行迁移、启动服务）
- Doer统计页面新增非咨询问题效率统计面板：非咨询问题Doer效率KPI、非咨询问题各阶段滞留对比、非咨询问题效率趋势，数据来源为「是否咨询问题」字段值为"否"的工单
- Doer统计页面新增每日闭环平均处理时长面板：折线图展示每日已关闭工单的平均处理时长趋势（从开单到关闭的用时），独立占一行显示
- Doer统计页面新增每日Doer使用数量与占比面板：组合图表（柱状图显示每日使用Doer工单数量，折线图显示占比百分比），独立占一行显示
- Doer统计页面新增咨询问题走势面板：组合图表（柱状图显示每日咨询问题工单数量，折线图显示咨询问题占比），独立占一行显示
- Doer统计页面新增月度咨询问题走势面板：组合图表（柱状图显示月度咨询问题工单数量，折线图显示咨询问题占比），按自然月分组（YYYY-MM格式），独立占一行显示

**测试增强**
- 新增列表客户端分页工具单测（`test/frontend_tests/__tests__/list-pagination.test.js`）
- 新增 M13 SSO 认证测试模块（`test/test_m13_sso_auth.py`），14 个用例覆盖认证流程
- 新增热补丁并行 `flow_context.frontier` 维护与展示相关单测（`test/test_hotpatch_flow_frontier.py`，含四自检汇合后 frontier 纠偏用例）
- 新增白名单字段提交校验单测（`test/test_hotpatch_person_whitelist_validate.py`：仅必填/类型，不校验选项 membership）
- 新增 M14 富文本 MinIO 上传路由单测（`test/test_m14_richtext_minio.py`）
- 新增 M18 Welink 拉群测试模块（`test/test_m18_welink_group.py`），20 个用例覆盖成员解析、title 推导、端点逻辑
- 新增 M10 需求管理测试模块（66个用例）和 M11 智能助手测试模块（50+个用例）
- E2E 端到端测试从 17 个扩展至 195 个，覆盖工单流程、需求管理、请假管理、值班管理、AI助手等核心业务流程
- 新增工单流转全流程E2E测试（38个用例）：回退/跨节点跳转/同节点停留/直接关闭/挂起/flow-bar状态可视化/详情页功能/工作台高级交互/UI创建表单/回退+前进组合
- 所有 E2E 测试支持可重入执行：唯一标签隔离数据、API驱动数据准备、try/finally自动清理
- 增强深度测试：工单全流程/回退/边界条件、权限执行验证、字段规则校验、数据完整性检查
- 增强安全测试：SPA路径穿越防护、HTTP方法限制、越权操作拦截
- 新增测试用例以 `test_e_` 前缀标识，与原有 `test_tc_` 用例区分

**技术改进**
- 工单详情节点页签右上角：仅**曾作为来源提交过**的节点展示处理人与时间；从上一节点**首次抵达**的目标节点（尚无本节点提交记录）右上角留空，待本节点提交后再展示（`ticket-page.js`；单测 `test/frontend_tests/__tests__/flow-log-meta.test.js`）
- 工单详情顶栏进度条：点击已走过节点名称（HCS 七段 / HOTPATCH 顶栏）展开对应 `<details>` 节点卡片；当前处理人节点仍自动展开（`frontend/modules/pages/ticket-page.js`；单测 `test/frontend_tests/__tests__/flow-step-jump.test.js`）
- 工单详情：**非当前阶段**节点在可编辑时不再展示「处理方式」「下一步处理人」，且仅保留「保存」；后端对非当前节点提交走补录路径，不写入流转日志、不更新当前阶段与处理人（`ticket-page.js`、`backend/routers/tickets.py`；单测 `workflow-node-flow-fields.test.js`、`test_m02_ticket.py::test_e_m02_amend_passed_node_without_flow`）
- 补丁管理（HOTPATCH）详情顶栏流程图：淡紫系描边与圆角节点；节点间为**同色短横线**；并行处为 **SVG 三次贝塞尔分叉/汇合**（无箭头、与参考图类似的平滑分支）；`--hp-flow-stroke` / `--hp-flow-node-border` 随主题覆盖（`frontend/styles/ticket.css`、`themes/*.css`、`frontend/modules/constants/hotpatch-workflow.js`；单测 `test/frontend_tests/__tests__/hotpatch-flow-join.test.js`）
- 热补丁（HOTPATCH）并行阶段：`ticket.flow_context` 增加 `frontier`（当前并行待办 `node_key` 列表）与 `parallel_handlers`（计划制定提交时写入各分支处理人）；`GET /api/tickets` 在并行时合并「当前阶段」「当前处理人」文案；`POST .../submit` 仅允许从 `frontier` 所含节点提交；详情页按 frontier 多节点高亮并可分别匹配「开发人员」/「测试人员」编辑权限
- **SSO 配置集中管理**：新增 `backend/sso_config.py` 统一管理 SSO 相关配置，避免前后端硬编码
  - `SSO_BASE_URL`、`SSO_LOGIN_URL`、`SSO_PROFILE_URL` 统一定义
  - `AUTH_WHITELIST_PREFIXES`、`AUTH_STATIC_PREFIXES` 白名单路径集中管理
  - 前端通过 `/api/auth/config` API 获取配置，支持多环境部署
- 工单字段「是否咨询问题」：在运维分析与开发分析两阶段均可填报；开发分析节点对该键启用 `inherit_previous`，并与提交前合并逻辑一致，自动继承运维分析已提交的非空取值
- 工单字段「是否质量问题」：在**运维分析**节点填报；**开发分析**、**运维闭环**节点对该键启用 `inherit_previous`，自动继承运维分析已提交的非空取值。已部署库请执行 `db/migrations/0056_ops_analysis_is_quality_issue_inherit.sql`
- 运维分析：「是否质量问题」为「是（已知质量问题）」或「是（新发现质量问题）」时，「处理方式」下拉不可选「提交运维闭环」（其余选项不变）。已部署库请执行 `db/migrations/0057_ops_analysis_hide_ops_closure_when_quality_yes.sql`
- 工单字段「产品线」：在**问题填写**节点填报；**运维分析**节点启用 `inherit_previous` 继承问题填写取值；选项集 `OS_PRODUCT_LINE` 为「公有云」「混合云（HCS）」「混合云（轻量化）」；历史「混合云」→「混合云（HCS）」、「轻量化」→「混合云（轻量化）」。已部署库请执行 `db/migrations/0049_product_line_options_hcs.sql`
- **问题填写派单优先级**：在研版本试点（问题阶段）> POC 阶段（问题阶段）> 产品线公有云 > 问题组件（内核/管控）。规则详见 `docs/工单流转规则.md`
- **公有云问题派单**：问题填写「产品线」=`公有云` 时，提交后进入问题审核的处理人按时段从公有云轮值表（工作日白班 `[09:00,18:00]`）或公有云值班表（工作日晚班 / 周末节假日）自动带出；未命中在研版本试点、POC 阶段时生效。规则详见 `docs/工单流转规则.md`
- **POC 阶段派单**：问题填写「问题阶段」=`POC阶段` 时，提交后进入问题审核的处理人按时段从 POC 轮值表（工作日白班）或 POC 值班表（工作日晚班 / 周末节假日）自动带出；优先级次于「在研版本试点」，高于「产品线 = 公有云」与「问题组件」分单。规则详见 `docs/工单流转规则.md`
- **问题填写**节点已移除「HCS版本号」「HCS/轻量化」字段（历史已提交数据仍保留在库中）。已部署库请执行 `db/migrations/0043_remove_problem_fill_hcs_fields.sql`
- 工单字段显示名：**问题填写**「HCS负责人」→「提单人」；**运维分析**「高斯版本」→「内核版本」（`field_key` 不变）。已部署库请执行 `db/migrations/0044_rename_field_labels_hcs_owner_gauss_version.sql`
- **问题填写**「局点」由白名单下拉改为**文本框**（与「eCare单号」同为 `text` 类型，可自由填写）。已部署库请执行 `db/migrations/0046_problem_fill_location_text.sql`
- **运维分析**「管控版本」：当**问题填写**（或运维分析继承的）「问题组件」为「管控问题」时必填；「提交其他运维分析」时仍仅处理方式/下一步处理人必填。已部署库请执行 `db/migrations/0047_ops_analysis_control_version_required_if_component.sql`
- 工单字段「业务环境」更名为「**问题阶段**」（`field_key` 仍为 `biz_env`）；**问题填写**与**运维分析**节点下拉选项为：生产环境、已投产业务测试环境、POC阶段、交付阶段、在研版本试点；历史「生产环境（巡检/运维/影响业务）」已合并为「生产环境」。已部署库请执行 `db/migrations/0048_biz_env_rename_problem_stage.sql`；新增「在研版本试点」请执行 `db/migrations/0077_biz_env_research_version_pilot.sql`
- **运维分析**节点已移除「是否有coredump文件」字段（历史已提交数据仍保留在库中）。已部署库请执行 `db/migrations/0050_remove_ops_analysis_has_coredump_file.sql`
- **运维分析**「是否有core堆栈」下拉新增「不涉及」选项（专用选项集 `OS_HAS_CORE_STACK`，不影响其他「是/否」字段）。已部署库请执行 `db/migrations/0051_has_core_stack_option_not_applicable.sql`
- **运维分析**「是否有core堆栈」选「是」时，「Core堆栈（文字版）」必填。已部署库请执行 `db/migrations/0052_ops_analysis_core_stack_text_required_if_yes.sql`
- **参数配置 → 问题根因**：可增删改「问题类型」（同步 `OS_ISSUE_TYPE` 选项集）及各类型的「根因分类」；运维分析表单中「根因分类」随「问题类型」联动。侧栏与编辑均由白名单 **`params_issue_root_cause`**（是否展示问题根因页面）控制；已部署库请执行 `db/migrations/0058_param_issue_root_cause_map.sql`，白名单种子见 `0059`；若曾种入 `params_issue_root_cause_edit`，请再执行 `db/migrations/0060_remove_issue_root_cause_whitelist.sql`；子页策略回填见 `0061_param_subpage_whitelist_backfill.sql`
- **开发分析**、**运维闭环**节点已移除「磐石版本是否涉及」字段（`field_key`: `rock_version_involved`；历史已提交数据仍保留在库中）。已部署库请执行 `db/migrations/0055_remove_rock_version_involved.sql`
- **引入/修复版本**下拉选项除基线版本外，亦实时合并「参数配置 → 版本模块 → 热补丁版本」的 `hotfix_label`（`OS_RELEASE_VERSION`；内核版本、升级前基线版本仍仅取基线版本）。已部署库可选执行 `db/migrations/0086_release_version_option_set_hotfix.sql` 更新选项集说明
- **运维分析**「内核版本」「升级前基线版本」下拉均使用带搜索框的扁平下拉（`WF_FLAT_SEARCHABLE_FIELD_KEYS`，占位「搜索版本关键字」），与引入/修复版本一致
- **开发分析**节点新增「引入版本」「修复版本」字段（`field_key`: `intro_version` / `fix_version`），用于评估工单影响——记录问题在哪个版本引入、在哪个版本修复；均为可选下拉，选项实时取自「参数配置 → 版本模块」的基线版本与热补丁版本（共用 `external_api` 选项集 `OS_RELEASE_VERSION`），并启用 `inherit_previous`。已部署库请执行 `db/migrations/0065_dev_analysis_version_fields.sql`
- **开发分析 · 修复版本**支持**多选**：节点字段 `ui_props.multiple=true`（与协同处理人同机制，参考迁移 `0053`、`0054`）；前端扁平下拉可勾选多个版本并以全角分号 `；` 拼接落库；「引入版本」保持单选。已部署库请执行 `db/migrations/0064_dev_analysis_fix_version_multiple.sql`
- **运维分析**节点同步新增「引入版本」「修复版本」字段（复用 `OS_RELEASE_VERSION`，`fix_version` 同样 `ui_props.multiple=true`），并对**运维分析 / 开发分析**这两组版本字段加上**条件可见 + 条件必填**：仅当「是否质量问题」为「是（已知质量问题）」或「是（新发现质量问题）」时下拉才展示并必填，否则隐藏可跳过；处理方式为「提交其他运维分析 / 提交其他开发分析 / 返回运维分析」等回流模式时整组放宽为可选（沿用 `0024` 的 `visible_when_all` + `required_when_visible` 模式）。已部署库请按序执行 `db/migrations/0066_ops_analysis_version_fields.sql`、`db/migrations/0067_dev_analysis_version_fields_visible_when_quality.sql`
- 后端 `requirements.txt` 补充 `python-multipart`，满足 FastAPI 对表单与 multipart 上传的依赖（避免启动时报 `Form data requires python-multipart`）
- 一键启动脚本：要求 **Python 3.10+** 创建 `backend/.venv`；`start.sh` / `start.bat` 优先选用较新解释器；首次在 `backend/.env` 中自动补充 **MinIO 可选变量模板**（富文本图片）
- 工单富文本图片改为 **MinIO 对象存储**：`POST /api/richtext/upload-image` 上传后 HTML 仅存 URL；**粘贴图片**与工具栏选图走同一上传逻辑；历史数据中已存在的 base64 图片仍可展示
- 规则驱动开发体系
- 数据库迁移体系
- 前后端分离架构
- 主题面板适配：蓝紫/护眼/粉色主题下，工作量统计、工单详情、值班表、走单日历、请假表格、流程条、权限面板、智能助手等组件的颜色和透明效果随主题变化，支持背景图透出

**功能更新**
- **移除人力分析页**：侧栏「数据报表」下删除「人力分析」（`/upload-analysis`）入口、页面实现及 `/api/upload` 后端接口；深链 `/upload-analysis` 回落为「我的主页」
- **移除工单分析页**：侧栏「数据报表」下删除「工单分析」（`/stats/report`）入口与页面实现；深链 `/stats/report` 回落为「我的主页」
- **运维舱（NOC）暗色主题**：原「暗黑」主题升级为专业监控室风格；修复值班表按钮与用户管理表格文字在暗色背景下对比不足的问题（全站 `.action` 实心底色、管理页/值班表专用可读性规则）
- **运维闭环 · 上传问题报告**：新增 `file` 类型字段 `problem_report`（标签「上传问题报告」），选择本地文件后自动上传至 MinIO（与富文本图片共用 `MINIO_*` 配置），提交时以 JSON 落库。已部署库请执行 `db/migrations/0074_ops_closure_problem_report_file.sql`
- **运维闭环 · 是否有协同处理人**：新增必填下拉「是否有协同处理人」（是/否）；选「是」时展示并必填「协同处理人」（沿用多选人员下拉）。已部署库请执行 `db/migrations/0088_ops_closure_has_collaborator.sql`
- **请假申请 · 所有申请**：权限策略白名单新增 `leave_application_all`（`readonly` = 展示全部请假单，`editable` = 仅展示申请人为本人的请假单）；`GET /api/leave/applications?scope=all` 按角色策略过滤。已部署库请执行 `db/migrations/0071_leave_application_all_whitelist.sql`
- **用户管理**：`user_account` 表新增邮箱、联系电话、产品线、最小部门、备注字段；管理页列表与编辑已对齐；移除「是否 PL」列（`user_account.is_pl` 已删除；权限策略表 `role_permission_policy.is_pl` 仍用于策略维度，用户侧统一按非 PL 基线解析白名单）。已部署库请执行 `db/migrations/0069_user_account_profile_fields.sql`
- **用户管理 · 领域**：`user_account` 新增 `expert_domain`（领域）字段；管理页列表支持筛选；编辑模式下「产品线」「领域」「最小部门」为可输入下拉（`input` + `datalist`），建议项来自当前用户列表该列已有取值。已部署库请执行 `db/migrations/0072_user_account_expert_domain.sql`
- **统计图表**：人力投入 / 问题归属 / Doer 改为 `GET /api/stats/charts` 服务端聚合（`backend/stats_charts.py`），进入统计页不再 `GET /api/tickets` 全量拉列表；前端 `stats-charts-api.js` 按 Tab 按需请求
- **统计图表 · 日汇总预聚合**：新增 `ticket_stats_daily` / `ticket_stats_ticket`（迁移 `0082`），按 `stats_day` 预写 count；查询两年全量约读 ~730 行日汇总；工单 submit / 快照 refresh 增量更新（`backend/ticket_stats_daily.py`）；统计图表页（须 `workbench_snapshot_rebuild` 非 hidden）提供 **回填日汇总** 按钮，调用 `POST /api/stats/charts/backfill` 分批执行并同步进度（明细日志见浏览器控制台与后端日志）；亦可执行 `python scripts/backfill_ticket_stats_daily.py`；环境变量 `TICKET_STATS_DAILY_ENABLED=0` 可回退行级聚合
- **统计图表**：人力投入 Tab 时间筛选右侧新增「产品线」下拉（选项来自用户管理 `user_account.product_line`，默认「全部」）；选中后各人力投入图表仅统计当前处理人/创建人所属产品线的工单
- **统计图表**：人力投入 / 问题归属 / Doer 各 Tab 主图区改为随卡片宽度自适应（`aspect-ratio` + 100% 宽），不再固定 300px 正方形区域
- **统计图表**：问题归属 Tab 各图表改为工单真实字段聚合：旭日图/一级模块柱图/TOP 模块/高发模块表按 `issue_intro_module` / `issue_owner_module` 路径统计（支持引入/归属筛选与 DTS 去重）；SPC/C 版本柱图按 `gauss_version` 实际取值 TOP 排序，不再使用固定版本列表与比例估算
- **统计图表**：问题归属 Tab「现网问题数量趋势」展示 **全量问题**、**全部质量问题**、**已知质量问题**、**新发现质量问题** 四条折线（`trend.total` / `trend.quality_yes` / `trend.known` / `trend.new`）；不再统计非质量问题（「否」）趋势；日汇总路径同步写入 `trend_quality_yes`
- **统计图表**：问题归属 Tab「问题模块透视」旭日图随顶部「是否质量问题 / 问题组件」筛选联动；日汇总缺少 `yes_*` 等分段时自动回退行级聚合，前端在 API 无数据时用已加载工单列表兜底
- **统计图表**：问题归属 Tab 按版本/模块相关图表不再统计占位项：无 `gauss_version` 等版本字段的不计入「按版本透视」「版本问题类别走势」「全量问题 TOP 版本」；未填写 `issue_intro_module` / `issue_owner_module` 的不计入「问题模块透视」「全量问题 TOP 模块」「问题高发模块」
- **统计图表**：问题归属 Tab「是否质量问题」仅作用于按版本透视、问题模块透视、一级模块透视、现网问题来源趋势、版本问题类别走势、CORE 问题透视、R 版本透视、问题高发模块 8 个视图；其余图表（现网趋势、TOP 局点/版本/模块等）始终展示全量数据；接口主 payload 为全量，另返回 `quality_scoped`
- **统计图表**：问题归属 Tab 卡片点击右上角放大后，ECharts 图表与表格内容与人力投入一致重播入场动画（弹窗可见后再初始化图表、柱状图逐条延迟）
- **统计图表**：问题归属 / 人力投入 Tab 与 Excel 上传图表（ECharts 柱状/折线）支持在图表区域内 **滚轮横向缩放**（`dataZoom` inside），按住拖拽可平移可见区间；旭日图、饼图等无横轴类目图表不受影响
- **统计图表**：人力投入 Tab 各图表改为 ECharts 渲染（柱状/堆叠柱/饼图），交互与问题归属 Tab 一致（`dataZoom`、放大弹窗入场动画）；Doer 统计 Tab 仍使用 SVG 图表

**Bug修复**
- 统计图表版本类视图出现 `0.00`、`0.2` 等假版本：`_ticket_version` / `statsTicketVersion` 在 `gauss_version` 为空时曾回退 `hcsVersion` 或从问题描述正则抠小数，已改为**仅认内核版本字段**（`gauss_version` / `gaussVersion`），无值则「未知版本」且不计入图表；历史日汇总须 **回填日汇总** 后完全生效
- 统计图表「一级模块透视问题数量」在日汇总路径下无数据：默认「DTS 去重=是」时，日汇总仅写入带 `dts_no` 的工单，且二级模块名解析为「一级/二级」全路径；已修正无 DTS 工单计入去重统计、DTS 工单按单号全局去重，并与行级聚合二级模块名对齐；日汇总 dedup 字段缺失时回退 `module_intro_l2`，仍全空则用快照行级聚合补齐 `l1_bars`（`backend/ticket_stats_daily.py`、`backend/stats_charts.py`）；历史日汇总须 **回填日汇总** 后 dedup 字段才完整，或依赖行级补齐。另：问题归属 Tab 默认时间范围为 **近 1 周**（含今天共 7 个日历日），起始日期早于该窗口的工单不会计入，需将时间范围扩至 **近 1 月** 或手动选到起止日包含该工单
- 工单流转提交必填校验失败后保存按钮卡在「保存中」、提交按钮无法点击：流转提交为减少闪跳会跳过 `saveNode` 成功时的即时重绘，但校验失败时未补重绘导致 `saving` 状态残留；已在校验失败时强制 `requestRender` 恢复按钮，且流转进行中仅「提交」显示「提交中…」（`frontend/modules/pages/ticket-page.js`）。回归见 `test/frontend_tests/__tests__/flow-submit-render.test.js`
- 工单提交报 `ticket_list_snapshot does not exist`：已部署库未执行迁移 `0079` 时 submit 会写快照表失败；须执行 `db/migrations/0079_ticket_list_snapshot.sql`（及后续 `0080`–`0082` 若未应用）后 `python scripts/backfill_ticket_list_snapshot.py` 或工作台 **重建列表快照**；未迁移前 submit 现改为仅打日志不阻断流转（`backend/routers/tickets.py`）
- 工作台创建工单提交后列表出现两条、点「刷新」仍为两条、整页刷新后恢复一条：创建成功时本地 `unshift` 的占位行 `templateCode` 为空，与 `syncTicketsFromServer` 按 `HCS_INCIDENT` 替换的逻辑不一致，合并后本地占位与接口数据并存；已统一占位为 `HCS_INCIDENT`，合并时按 `orderId` 去重且将空 `templateCode` 视为 HCS（`frontend/modules/pages/ticket-page.js`、`ticket-core.js`）。回归见 `test/frontend_tests/__tests__/merge-ticket-list-after-sync.test.js`
- 我的主页 / 工作台 / **补丁管理**「Work order list」工单行整表不渲染：三处共用 `renderDynamicTableRowCells` → `getTicketColumnValue`；其中误用未定义变量 `key` 判断 `creatorName`，严格模式下抛 `ReferenceError` 中断行渲染；已改为 `fieldKey`（`frontend/modules/pages/table-columns.js`）。回归见 `test/frontend_tests/__tests__/table-columns-get-value.regression.mjs`（`node --test` 运行）。
- Doer统计页面卡片放大查看按钮点击无反应：CSS样式文件 `stats.css` 中缺少 `.stats-doer-zoom-mask.stats-chart-zoom-mask--open` 弹窗显示样式，导致弹窗无法正确显示
- 我的主页 / 工作台工单列表仅显示勾选框、分页仍有条数：**（1）** 本地「选择列」配置校验后为空时回退默认列并写回；**（2）** 单元格内容若含未转义的 `<`，`tr.innerHTML` 会丢列——对非「严重性」列 `escapeHtml`（`frontend/modules/pages/table-columns.js`）；**（3）** `buildTableColumns` 仍空则再回退默认列；**（4）** 列表接口处理人：`ticket_node_instance` COALESCE、快照 `next_handler` 倒序查找、`values_json` 字符串解析（`backend/routers/tickets.py`）；**（5）** 处理人仍空时用 `creator_id` 再兜底；**（6）** 工作台默认页签改为「全局」，避免 `currentHandler` 与登录人格式不一致时一进页即 0 条（`frontend/modules/state/state.js`）；**（7）** `operatorMatchesPersonField` 规范化空白并支持账号大小写包含匹配（`frontend/modules/utils/format.js`）

### v0.1.0

**初始版本**
- 基础工单创建与列表
- 静态前端 Demo
- 简单的流程流转

---

## 版权信息

本项目为内部运维工具，版权归属项目团队所有。

**技术支持**：请联系运维开发团队

**文档维护**：请参考 `docs/` 目录下的详细文档

---

> 本文档由 AI 辅助生成，基于项目代码与规则文件自动分析产出。如有疑问或需要补充，请联系项目维护人员。
