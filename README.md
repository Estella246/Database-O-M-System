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

- 内核/管控/公有云值班日历
- 内核/管控/公有云轮值表管理
- 专项轮值（慢SQL、性能、升级、扩容、备份、容灾）
- 请假申请与审批

### 6. 需求管理

- 需求全生命周期管理（待分析 → 待RAT决策 → 开发中 → 已经落地）
- 需求编号自动生成（RQ + 日期 + 序号）
- 需求分类（管控需求/内核需求/管控和内核需求/其他）
- 需求价值（质量加固/性能提升/竞争力提升/定位能力提升/恢复能力提升/感知能力提升）
- 关联问题追踪（工单号、DTS单号）
- 优先级管理（1-10，1最高）
- 操作日志与状态变更记录
- 支持我提出的/我负责的/全部需求筛选
- 导出功能：点击「导出」按钮导出全部需求数据为 Excel 文件，权限项 `requirement_export` 控制按钮显示
- 导入功能：点击「下载模板」获取Excel模板，填写后点击「导入」上传实现批量导入
  - 需求编号为空时自动生成新编号，填写已有编号时更新该需求
  - 权限项 `requirement_import` 控制按钮显示

### 7. 数据统计与导出

- 工单列表多维度筛选
- 工单搜索功能
  - 在工作台搜索框输入关键词，实时搜索工单
  - 搜索匹配全部文本字段（约87个字段，包含所有节点数据）
  - 支持搜索工单号、标题、处理人、描述、局点、问题阶段、DTS单号等
  - 搜索结果自动适配权限策略（仅显示用户可见的工单）
  - 中文输入支持（防抖400ms，Enter键立即搜索）
- SLA 时间计算
- 表格列选择功能
  - 点击「选择列」按钮可自定义表格展示列
  - 支持选择各流程阶段的文本字段（约87个可选）
  - 默认展示9列：流程ID、当前阶段、起始日期、问题严重性、局点、问题阶段、当前处理人、问题描述、SLA时间
  - 支持同字段名不同节点的列同时显示（如同时显示「运维分析-是否咨询问题」和「开发分析-是否咨询问题」）
  - 列配置保存到 localStorage，最多选择15列
  - 提供搜索功能快速定位列名
- 数据导出功能
  - 导出格式：Excel (.xlsx) 默认、CSV (.csv) 可选
  - 导出范围：已选中工单、全部工单（当前筛选条件下的全部可见工单）
  - 字段选择：支持选择各流程阶段的文本字段（约87个），默认全选，可按节点分组展开/折叠
  - 文件名：默认格式 `{账号}_{日期}`，可自定义前缀
  - 权限控制：`workbench_export` 权限项控制按钮显示

### 8. UI 主题

- 浅色/深色/护眼/粉色/蓝紫五套主题
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

### 10. 工单分析 Skill

- Skill 配置管理：支持新增、修改、删除分析 Skill，预置 Skill 也可修改和删除
- 大模型连接：通过 OpenAPI Key 和 URL 连接大模型，支持 OpenAI、DeepSeek 等多种模型
- 分析提示词模板：支持占位符语法，自动提取工单数据进行分析
- 工单智能分析：选择 Skill 对指定工单执行智能分析，输出专业分析报告
- 分析历史记录：完整记录每次分析的输入数据、输出结果、Token 消耗
- 连通性测试：创建/编辑 Skill 时可测试大模型 API 连通性

### 11. SSO 单点登录

- 企业 SSO 集成：与企业统一认证系统对接，实现单点登录
- 自动认证检测：前端自动检测 SSO Cookie，无 Cookie 时重定向到登录页
- 用户头像组件：右上角显示用户名首字符头像，悬停显示下拉菜单
- 个人信息查看：点击头像下拉菜单查看用户详细信息（用户名、域账户、邮箱、角色、用户组）
- 安全注销：清除 localStorage 和 SSO Cookie，重定向到 SSO 登录页
- 测试模式支持：通过环境变量 `SKIP_SSO_AUTH=1` 跳过认证（测试/开发环境）

### 12. 运维效率（原 oncall 评议）

- 综合得分：基于 SLA(35%)、独立闭环率(30%)、工单量(20)、加分项(≤15) 与红/黑事件加成自动计算
- 三项指标判定依据（占比与分数算法不变，仅归属与口径修正）：
  - **归属人**：SLA、独立闭环率、工单数量三项均归属到「运维分析阶段的最后一个人」（`from_node = ops_analysis` 的最近一次 `submit/jump_submit` 的处理人）；未经运维分析阶段的工单不计入运维效率
  - **工单数量**：流程中每个阶段的最后一个人都可在各自维度认领该工单，但运维效率只统计「运维分析阶段最后一个人」的工单数
  - **独立闭环率**：以运维分析阶段最后一个人为对象，若其之后流程不再进入「开发分析」阶段（`dev_analysis`）即算独立闭环
  - **SLA**：以运维分析阶段最后一个人为对象，取「问题审核 + 运维分析 + 开发分析 + 运维闭环」四个阶段停留时长之和
- 关键指标：页面顶部固定展示评议规则口径，便于成员对照打分逻辑
- 评议周期：支持月/季度自动切换，季度模式聚合 3 个月数据
- 组别筛选：评议周期旁的「组别」下拉框，选项来自 `user_account.group_name` 去重非空值（`GET /api/oncall-eva/groups`）；选中后 `GET /api/oncall-eva/scores?group_name=` 仅返回该组成员（含该组有单人员），「全部组别」不过滤
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
- 顶部横幅：暗红色标题块（`xxxx现网重大问题月度分析（YYYY年M月）` + `拟制 / 审核` 行），横幅右上角内置「编辑/保存/取消」按钮，无需滚到「整体情况」即可改写产品名与拟制/审核人（与 overview 段共用编辑态）
- 五段结构（均按段保存）：
  - 一、整体情况：4 个文本段（重大事故 / 问题分析 / 风险模块 / 质量改进反馈）
  - 二、问题透视：KPI 卡片 + 4 个 ECharts 图（影响分类 / Top 模块 / Top1 / Top2 拆解），数据通过 JSON 编辑
  - 三、重大问题：5 个分类（coredump / 数据正确性&一致性 / 满 / hang/慢 / 升级），10 列表格（局点 / 版本 / 问题编号 / 描述 / 根因 / 影响 / 领域 / 模块 / 责任 XM）
  - 四、改进诉求：合并标题行 +「编号 / 问题描述 / 改进目标 / 负责领域 / 责任人」5 列
  - 五、问题详情&质量改进记录：单一段落（textarea ↔ 只读），不再使用表格
- 段头样式：天蓝色横条
- 归档/取消归档：归档后所有段不可编辑、月报不可删除；可一键导出 HTML 或 Excel
- 导出 Excel：单 sheet 堆叠 5 段（与 HTML 排版一致），含暗红色横幅、天蓝段头、表头底色与边框；问题透视 4 个图表数据按 2x2 网格、改进诉求 3 个图表数据按 1x3 网格横向并列（贴合 HTML chart-grid 分布），依赖 xlsx-js-style
- 后端：`db/migrations/0036_monthly_report.sql` + `backend/routers/monthly_report.py`，5 段以 JSONB 存储，无字段级 schema 校验

### 15. 小鲁班消息推送

- 功能：通过第三方小鲁班消息服务发送通知消息
- 生产环境配置：需在 `backend/.env` 中设置 `XIAOLUBAN_MESSAGE_URL` 和 `XIAOLUBAN_MESSAGE_SEND_TOKEN`
- 响应格式：`{"success": true/false, "message": "结果说明"}`
- 工单流转通知：HCS工单流转到「问题审核」「运维分析」「开发分析」节点时，自动向该节点处理人推送小鲁班通知消息（包含工单号、当前节点、起始日期、严重性、局点、问题组件）；正向流转、回退、重分配均触发通知；通知失败仅打印error日志，不影响工单主流程
- 问题审核群通知：工单流转到「问题审核」节点时，额外向指定群推送通知消息（在个人通知基础上追加eCare单号、问题描述；问题描述超长时截取前100字符）；群号通过 `XIAOLUBAN_GROUP_CHAT_ID` 配置
- 问题审核催办通知：工单到达「问题审核」节点后开始计时，根据「问题严重性」按不同节奏向通知群发送催办消息：一般级别（15分钟后1次）、严重级别（15/30/45分钟各1次）、致命级别（每15分钟1次，上限10次）。模板：`@{处理人中文名} 你有一条{严重性}级别现网问题未处理，请及时确认！`。工单离开问题审核即停止催办。使用 APScheduler 后台调度，检查间隔通过 `REMINDER_CHECK_INTERVAL_SECONDS` 配置

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
- 关键词搜索：匹配局点名称、地区、代表处、运维人员、客户/项目/服务经理、风险描述等文本字段（防抖 400ms），支持分页（每页 10/20/50/100 条）
- 新增 / 编辑 / 删除：弹窗表单覆盖 28 个字段（局点名称必填，「汇报日期」「确收时间」为日期、「风险描述」「DTRB结论」为多行文本）；点击列表行打开详情弹窗，详情内可编辑或删除
- 导入：上传 Excel（.xlsx），表头按 28 个中文列名匹配，「局点名称」为空的行跳过，批量入库
- 导出：将当前筛选结果导出为 Excel（.xlsx），表头与导入列名一致，导出文件可直接再导入
- 权限控制：白名单项 `site_profile_list`（列表/入口）、`site_profile_create`（新增/编辑/删除）、`site_profile_import`（导入）、`site_profile_export`（导出），默认均为可见
- 工单联动：工单「问题填写」的「局点」字段为下拉选择，选项实时取自本表的「局点名称」；下拉支持搜索并可直接输入新局点名，工单提交时若该局点名不在档案中，后端自动建一条只含「局点名称」的档案记录
- 后端：`db/migrations/0053_site_profile.sql`（`site_profile` 表，`id` + 28 业务列 + 创建人/时间戳）+ `backend/routers/site_profile.py`

### 17.1 重大问题（工单驱动）

- 入口：左侧导航「运维管理 → 重大问题」（菜单键 `major:problem`，查看权限 `major_problem_list`）
- **工单自动流转**：工作台工单的「事件级别」（`ops_analysis.event_level`）命中重大阈值时，自动出现在本页面。阈值集合：`内部通报重大问题` / `管理升级预警` / `已管理升级` / `事故` / `P1-P3事件`（不含 `一般问题`、`P4事件`）
- **惰性同步**：列表接口每次拉取前先扫描命中阈值的工单并 upsert 到 `major_issue`；快照字段（局点 / 级别 / 描述 / 运维分析人 / 开发分析人 / 通报日期）随之刷新，整体状态与进展记录不受同步影响；已生成的问题行即使工单级别后续变化也不自动删除（可手动关闭）
- 从工单保留的核心字段：序号、通报日期（= 运维分析阶段最后提交时间）、运维单号（`ticket_no`）、局点名称（`problem_fill.location`）、事件级别、问题描述（`problem_fill.issue_desc`）、运维分析人（运维分析阶段最后处理人）、开发分析人（开发分析阶段最后处理人）
- **整体状态**：进行中 / 挂起 / 关闭（顶部状态 tab 可筛选），在详情中切换
- **进展跟踪（按天）**：每个重大问题**按天记录**进展（带时间、进展内容、风险消减措施、记录人）。**同一天（Asia/Shanghai）再次提交会覆盖当天的历史进展**，不追加新行；详情以「按天的 list 树状」展示——**最新一天默认展开，历史天数折叠**（「展开历史进展（N 天）」可切换）。列表页「进展&消减措施」列显示最新一天的进展+消减措施与天数计数
- 搜索：按运维单号、局点、问题描述、分析人模糊匹配（防抖 400ms），支持分页
- 权限控制：查看复用 `major_problem_list`；写操作（改状态 / 加进展）复用 `major_problem_create`（与工作台白名单同体系，未新增默认隐藏键）
- 后端：`db/migrations/0073_major_issue.sql`（`major_issue` + `major_issue_progress` 两表）+ `backend/routers/major_issue.py`（`/api/major-issues`，阶段最后处理人取数复用 `oncall_eva` 的口径）；前端 `frontend/modules/pages/major-issue-page.js`
- 兼容性：原手工录入的重大问题表 `major_problem`（迁移 `0036`/`0037`、路由 `major_problem.py`、页面 `major-problem-page.js`、脚本 `generate_major_problems.py`）**已废弃保留**，不再挂载到菜单；月报「三、重大问题」段为 JSONB 自由文本，**不读取** `major_problem` 表，故不受本次改造影响

### 18. 历史数据迁入（老平台 GaussDB → 新平台）

- 入口：工作台「删除」按钮旁的「迁入」按钮（仅工作台 HCS 列表，补丁列表不展示）；权限同删除，受白名单 `workbench_delete`（非 hidden 即可见/可迁）控制
- 用途：将老运维问题单平台（GaussDB）的历史工单迁移到新平台工单表，迁入后直接出现在工作台、可在工单详情查看完整流转
- 连接方式：后端**直连老库**，按 `t_work_flow_instance.id` 游标**分批读取 + 分批提交**，内存恒定、适合大数据量；老库连接串由 `LEGACY_DATABASE_URL` 配置（未配置时回退当前库 `DATABASE_URL`，便于本地用模拟老表验证）
- 幂等 / 增量：以 `ticket.legacy_instance_id`（迁移 `0070`，唯一索引）记录来源实例，重复迁入自动跳过已迁工单，中断可续跑；老库 `deleted<>'0'` 的逻辑删除单据跳过
- 重建粒度：依据 `t_work_flow_task` 流转记录**逐节点重建** `ticket_node_instance` / `ticket_node_data` / `ticket_flow_log`，字段值取自 `t_work_flow_task_parse`（`column1..column64`）并按新平台 `node_field_def` 的归属节点落位；当前节点/处理人/状态由 `t_work_flow_instance` 决定（`进行中→open`、`暂停→suspended`、`关闭/完成/非问题关闭→closed`）
- 工单号：按老库 `create_time` 自然日分配 `YW`+`YYYYMMDD`+`nnn`（当日最小未占用序号，与新建规则一致）
- 字段映射：`column1→start_date`、`column2→location`、`column8→issue_desc`、`column10→severity`、`column23→dts_no`、`column50→component`、`column53→ecare_ticket_no` 等共 50 个列（完整映射见 `backend/legacy_migration.py` 的 `PARSE_COLUMN_TO_FIELD`；新平台无对应字段的列忽略）
- 接口：`POST /api/tickets/migrate-legacy`，返回 `{ ok, migrated, skipped_existing, skipped_deleted, failed, errors, ticket_nos }`
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

ticket_analysis_skill (工单分析 Skill 配置)
    └── ticket_analysis_log (分析历史记录)
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

# 启动服务
python -m uvicorn app:app --host localhost --port 8000
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
| `MINIO_ENDPOINT` | MinIO 地址（不含协议），如 `localhost:9000` | （空则富文本图片上传接口返回 503） |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | MinIO 访问密钥 | 同上 |
| `MINIO_BUCKET` | 存储桶名称；不存在时上传接口会尝试创建 | 同上 |
| `MINIO_USE_SSL` | 是否 HTTPS 连接 MinIO，`true`/`1` 表示启用 | 默认否 |
| `MINIO_PUBLIC_BASE_URL` | 浏览器可访问的**对象 URL 前缀**（不含尾部 `/`），如经网关暴露为 `https://files.example.com/my-bucket`；设置后富文本中写入该前缀 + 对象键；**不设置**则返回 **7 天有效**的预签名 GET URL | （可选） |
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
- `nnn`：当日序号（000-999）

示例：`YW20260402001`（2026年4月2日第1号工单）

### 页面导航

| 页面 | 路径 | 说明 |
|------|------|------|
| 我的主页 | `/home` | 个人待办、SLA 统计、值班信息 |
| 需求管理 | `/requirements` | 需求全生命周期管理 |
| 工作台 | `/workbench` | 工单列表、创建、导出（HCS_INCIDENT，不含热补丁单） |
| 补丁管理 | `/hotpatch` | 热补丁（HOTPATCH）工单列表与创建；列表/筛选等交互与工作台一致；**「创建」弹窗固定从「诉求填写」节点（`hp_demand_fill`）起单**，与工作台 HCS 起单节点（问题填写/运维分析）无关；侧栏入口受 `patch_manage` 控制；**列表「删除」按钮**受 **`patch_manage_delete`** 白名单控制（展示/不展示），与工作台 **`workbench_delete`** 独立；**创建中仅本地的占位单带 `templateCode: HOTPATCH`，合并进 `getAllTickets` 时只进补丁列表，不混入工作台**；**默认流程号（`ticket_no`）格式 `HPM` + `YYYYMMDD`（本地创建日）+ 当日三位序号 `000`–`999`（与 `YW…` 分存储键），首落库时后端亦接受/分配同格式**；**列表默认展示列**（未改「选择列」时）为：流程 ID、当前阶段、当前处理人、起始日期、创建者，列配置独立存储键 `ticket_list_columns_patch`，与工作台 `ticket_list_columns_list` 互不覆盖 |
| 工单详情 | `/tickets/:id` | 工单流程详情与操作；顶栏进度条（问题填写→审核关闭）**点击节点文字**可展开下方对应节点卡片并滚动定位 |
| 值班表 | `/duty` | 值班日历、轮值表管理 |
| 请假申请 | `/leave` | 请假申请与审批；**「所有申请」页签**数据范围由白名单 **`leave_application_all`** 控制（`readonly` = 全部请假单，`editable` = 仅申请人为本人的请假单；后端 `GET /api/leave/applications?scope=all` 同步过滤）；**列表/详情「删除」按钮**受 **`leave_delete`** 控制，与 **`leave_apply`**、**`leave_whitelist`** 独立；`DELETE /api/leave/applications/{id}` 须该键非 hidden |
| 用户管理 | `/admin/users` | 用户账户管理 |
| 权限策略 | `/admin/permissions` | 角色权限配置 |
| 统计图表 | `/stats` | 数据统计分析 |
| 工单分析 | `/stats/report` | 工单分析报告 |
| 工单分析 Skill | `/stats/skills` | 大模型 Skill 配置与工单分析 |
| 参数配置 | `/params` | 各子页由白名单「是否展示 xx 页面」控制侧栏与路由：`params_duty_field_edit`（责任田）、`params_version_edit`（版本）、`params_group_template_edit`（拉群模板）、`params_issue_root_cause`（问题根因，运维分析问题类型→根因分类联动）、`params_llm_config`（大模型配置）；父项 `params_config` 仍控制「参数配置」入口 |
| 智能助手 | `/ai-assistant` | AI 对话、快捷问题、数据库查询 |
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
│   │   │   └── workflow.js       # 工单流程常量
│   │   ├── pages/                # 页面级模块
│   │   │   ├── admin.js          # 管理后台纯函数（权限白名单、用户筛选）
│   │   │   ├── duty.js           # 值班表页面纯函数
│   │   │   ├── home.js           # 首页/热力图纯函数与常量
│   │   │   ├── params.js         # 参数配置页面纯函数
│   │   │   ├── requirement.js    # 需求管理/工单字段规则纯函数
│   │   │   ├── stats.js          # 统计图表页面纯函数与常量
│   │   │   ├── ticket.js         # 工单流程纯函数（节点转换、表单渲染）
│   │   │   └── upload.js         # 上传分析纯函数与常量
│   │   ├── services/             # 服务层
│   │   │   └── api.js            # API 基础配置与工具函数
│   │   ├── state/                # 状态管理
│   │   │   └── index.js          # 全局状态定义
│   │   └── utils/                # 工具函数
│   │       ├── date.js           # 日期工具
│   │       ├── escape.js         # HTML 转义
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
```

**查询参数**：
- `operator_id`：当前操作人账号（白名单与「仅看自己创建」等）
- `q`：关键词，匹配列表展示及节点文本字段
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

**请求体 JSON**：`operator_id`、`ticket_nos`（单号数组）、`template_code`（与列表一致：`HCS_INCIDENT` 或 `HOTPATCH`）。`template_code = HOTPATCH` 时须角色白名单中 **`patch_manage_delete` 不为 hidden**；`HCS_INCIDENT` 时须 **`workbench_delete` 不为 hidden**（与前端按钮展示一致；权限策略「配置白名单」写入 `is_pl=false`，**PL 用户**未单独配置时**回落**到该基线，未配置键缺省为 `readonly` 即允许删除）。删除范围与 `GET /api/tickets` 相同模板下「仅看自己创建」口径一致。成功响应含 `deleted`（已从库删除的单号）、`absent`（请求单号在库中未命中 `ticket.ticket_no`）。前端**仅**根据 `deleted` 从本地列表与详情缓存中移除；`absent` 仅弹窗提示并随后 `syncTicketsFromServer` 对齐，避免「库未删却从列表消失」。

#### 历史数据迁入（老平台 GaussDB → 新平台）

```
POST /api/tickets/migrate-legacy
```

**请求体 JSON**：`operator_id`、可选 `batch_size`（默认 200，1–1000）、可选 `max_total`（限制本次最多处理实例数）。权限须 **`workbench_delete` 不为 hidden**。后端从 `LEGACY_DATABASE_URL`（未配置回退 `DATABASE_URL`）直连老库，按 `t_work_flow_instance.id` 游标分批读取老库工单（`t_work_flow_instance` / `t_work_flow_task` / `t_work_flow_task_parse`），按 `t_work_flow_task` 逐节点重建新平台 `ticket` 及其节点实例/数据/流转日志，并以 `ticket.legacy_instance_id` 幂等去重。

**成功响应**：
```json
{
  "ok": true,
  "migrated": 3,
  "skipped_existing": 0,
  "skipped_deleted": 1,
  "failed": 0,
  "errors": [],
  "ticket_nos": ["YW20251103000", "YW20251021000", "YW20251201000"]
}
```

- 找不到老表（`t_work_flow_instance` 等）：返回 **400**，提示检查 `LEGACY_DATABASE_URL`
- 单条实例迁移失败不阻断整体，计入 `failed` 并在 `errors`（最多 50 条）记录 `legacy_id` 与原因

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
| M05 值班管理 | `test_m05_duty.py` | 22 | 日历/轮值/局点/RL/假日配置 |
| M06 请假管理 | `test_m06_leave.py` | 31 | 白名单/申请/审批全流程/申请详情/操作序列/删除 |
| M07 参数配置 | `test_m07_params.py` | 30+ | 责任田/基线/热补丁/拉群模板/字段树深度/版本验证 |
| M08 个人统计 | `test_m08_stats.py` | 10 | 工作量/SLA/直通率/统计结构/工单列表 |
| M09 前端SPA | `test_m09_spa.py` | 8 | 静态文件/深链/路径遍历/安全测试 |
| M10 需求管理 | `test_m10_requirement.py` | 66 | 需求CRUD/状态流转/分类/价值/分析/过滤/日志/边界条件 |
| M11 智能助手 | `test_m11_ai_assistant.py` | 50+ | 会话管理/消息/快捷模板/LLM配置/Schema刷新/上下文Token |
| M12 工单分析 Skill | `test_m12_skill.py` | 30+ | Skill CRUD/连通性测试/分类验证/分析日志/权限控制 |
| M15 小鲁班消息推送 | `test_m15_xiaoluban_message.py` | 9 | 消息发送成功/状态异常/HTTP异常/JSON解析异常/Payload结构/配置项 |
| M16 局点档案 | `test_m15_site_profile.py` | 14 | 列表/分页/搜索/增改删/详情/空日期/批量导入/导出 |
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
| `test/e2e/test_e2e_skill_workflow.py` | 5 | Skill页面/列表展示/UI创建/详情点击/连通性测试 |
| `test/e2e/test_e2e_upload_workflow.py` | 6 | 上传分析页面/历史展示/详情点击/预览/配置变更/KPI卡片 |

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
set SKIP_SSO_AUTH=1 && python -m uvicorn app:app --host localhost --port 8000
# Linux/Mac:
SKIP_SSO_AUTH=1 python -m uvicorn app:app --host localhost --port 8000

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

**问题修复**
- 运维分析「根因分类」随「问题类型」联动无选项：运维分析节点使用扁平下拉，切换问题类型后仅隐藏初始空列表中的按钮而未重建选项；现按当前问题类型动态重建根因分类可选项（`rebuildWfFlatSelectChoiceButtons`、`syncRootCauseCategoryOptions`）。
- 侧栏「补丁管理」点击无反应：合并主页待办时误删 `getPatchListBaseTickets` 导入，进入 `patch:list` 时 `render()` 抛 `ReferenceError`；已恢复导入。工作台 ↔ 补丁管理切换现经 `planTicketListResync` 全量拉取对应 `template_code`（`HCS_INCIDENT` / `HOTPATCH`）。
- 我的主页「待办工单」合并补丁管理「待处理」：进入主页时同步拉取 `HCS_INCIDENT` 与 `HOTPATCH` 列表，待办页签在 HCS 待办基础上并入本人为当前处理人的热补丁单（`getHomePendingWorkbenchBaseTickets`、`syncHomeWorkbenchTicketLists`）。
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
- **SSO 单点登录集成**：与企业 SSO 系统对接，实现统一认证
  - 后端 AuthMiddleware 中间件验证 SSO Cookie
  - 前端自动检测 Cookie 并调用 `/api/auth/me` 验证会话
  - 右上角用户头像组件（显示用户名首字符，支持下拉菜单：个人信息、注销）
  - 注销时清除 localStorage 和 SSO Cookie
  - 支持环境变量配置：`SSO_BASE_URL`、`SSO_COOKIE_DOMAIN`、`SKIP_SSO_AUTH`
  - 测试环境可通过 `SKIP_SSO_AUTH=1` 跳过认证
- 工作台按工单建单时间筛选列表：`GET /api/tickets` 支持 `created_from` / `created_to`（`Asia/Shanghai` 日历日），前端毛玻璃日历仅负责选日期并传参
- 「运维效率」与「月度报告」整组（含问题报表 / 报告生成 / 报告归档）改由权限策略白名单驱动：新增 `monthly_report` 白名单项，`oncall_eva` 与 `monthly_report` 均默认 hidden，迁移 0041 为内置 admin / 管理员 角色种入可见态；其余角色需在「权限策略 → 白名单」显式放行
- 月度报告模块（数据报表 → 月度报告）：问题报表支持双 Excel 导入、按 DTS 单号合并、结果导出 xlsx
- 现网重大问题月度分析报告（数据报表 → 月度报告 → 报告生成）：暗红色标题横幅（产品名/拟制/审核行内编辑入口）、5 段分段保存（整体情况/问题透视/重大问题/改进诉求/问题详情&质量改进记录）、归档、导出 HTML、导出 Excel（单 sheet 堆叠，问题透视 2x2/改进诉求 1x3 网格分布，含暗红横幅+天蓝段头+表头底色+边框，依赖 xlsx-js-style）
- 完整的工单流程管理（7节点）
- RBAC 权限管理系统（权限策略页支持删除权限组，白名单项 `admin_permissions_delete`）
- 值班日历与轮值表管理
- 请假申请功能（列表支持分页：每页 10/20/50/100 条；**「所有申请」**范围由白名单 `leave_application_all` 控制（默认展示全部；配置为「仅展示申请人为本人的请假单」时，`scope=all` 列表仅返回本人申请）；**删除**由白名单 `leave_delete` 控制工具栏/详情删除按钮，后端 `DELETE /api/leave/applications/{id}` 同步校验；删除已同意申请时会尝试恢复申请人轮值/局点值班当值；审批「同意申请」后，申请人将在全部轮值表中自动置灰，工单自动派单时跳过该人员；全部时间段结束后自动恢复为当值；内核/管控/公有云值班表、RL 值班表不受影响）
- 需求管理功能（全生命周期、状态流转、操作日志）
- 需求分析功能（8维度图表分析：KPI、状态分布、需求分类分布、需求价值分布、优先级分布、趋势、人员负载、版本计划）
- 智能助手功能（AI 多轮对话、ReAct 推理引擎、快捷问题模板、双级 LLM 配置、安全只读查询）
- 智能助手易用性优化：输入框和发送按钮始终可用，发送时自动创建会话，无需用户手动创建
- 多主题支持（5套主题 + 自定义背景）
- 工单列表多维度筛选与排序
- SLA 时间计算
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
- E2E 端到端测试从 17 个扩展至 195 个，覆盖工单流程、需求管理、请假管理、值班管理、AI助手、Skill分析、上传分析等核心业务流程
- 新增工单流转全流程E2E测试（38个用例）：回退/跨节点跳转/同节点停留/直接关闭/挂起/flow-bar状态可视化/详情页功能/工作台高级交互/UI创建表单/回退+前进组合
- 所有 E2E 测试支持可重入执行：唯一标签隔离数据、API驱动数据准备、try/finally自动清理
- 增强深度测试：工单全流程/回退/边界条件、权限执行验证、字段规则校验、数据完整性检查
- 增强安全测试：SPA路径穿越防护、HTTP方法限制、越权操作拦截
- 新增测试用例以 `test_e_` 前缀标识，与原有 `test_tc_` 用例区分

**技术改进**
- 工单详情顶栏进度条：点击已走过节点名称（HCS 七段 / HOTPATCH 顶栏）展开对应 `<details>` 节点卡片；当前处理人节点仍自动展开（`frontend/modules/pages/ticket-page.js`；单测 `test/frontend_tests/__tests__/flow-step-jump.test.js`）
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
- **公有云问题派单**：问题填写「产品线」=`公有云` 时，提交后进入问题审核的处理人按时段从公有云轮值表（工作日白班 `[09:00,18:00]`）或公有云值班表（工作日晚班 / 周末节假日）自动带出；非公有云仍按「问题组件」走内核/管控轮值与值班表。规则详见 `docs/工单流转规则.md`
- **问题填写**节点已移除「HCS版本号」「HCS/轻量化」字段（历史已提交数据仍保留在库中）。已部署库请执行 `db/migrations/0043_remove_problem_fill_hcs_fields.sql`
- 工单字段显示名：**问题填写**「HCS负责人」→「提单人」；**运维分析**「高斯版本」→「内核版本」（`field_key` 不变）。已部署库请执行 `db/migrations/0044_rename_field_labels_hcs_owner_gauss_version.sql`
- **问题填写**「局点」由白名单下拉改为**文本框**（与「eCare单号」同为 `text` 类型，可自由填写）。已部署库请执行 `db/migrations/0046_problem_fill_location_text.sql`
- **运维分析**「管控版本」：当**问题填写**（或运维分析继承的）「问题组件」为「管控问题」时必填；「提交其他运维分析」时仍仅处理方式/下一步处理人必填。已部署库请执行 `db/migrations/0047_ops_analysis_control_version_required_if_component.sql`
- 工单字段「业务环境」更名为「**问题阶段**」（`field_key` 仍为 `biz_env`）；**问题填写**与**运维分析**节点下拉选项为：生产环境、已投产业务测试环境、POC阶段、交付阶段；历史「生产环境（巡检/运维/影响业务）」已合并为「生产环境」。已部署库请执行 `db/migrations/0048_biz_env_rename_problem_stage.sql`
- **运维分析**节点已移除「是否有coredump文件」字段（历史已提交数据仍保留在库中）。已部署库请执行 `db/migrations/0050_remove_ops_analysis_has_coredump_file.sql`
- **运维分析**「是否有core堆栈」下拉新增「不涉及」选项（专用选项集 `OS_HAS_CORE_STACK`，不影响其他「是/否」字段）。已部署库请执行 `db/migrations/0051_has_core_stack_option_not_applicable.sql`
- **运维分析**「是否有core堆栈」选「是」时，「Core堆栈（文字版）」必填。已部署库请执行 `db/migrations/0052_ops_analysis_core_stack_text_required_if_yes.sql`
- **参数配置 → 问题根因**：可增删改「问题类型」（同步 `OS_ISSUE_TYPE` 选项集）及各类型的「根因分类」；运维分析表单中「根因分类」随「问题类型」联动。侧栏与编辑均由白名单 **`params_issue_root_cause`**（是否展示问题根因页面）控制；已部署库请执行 `db/migrations/0058_param_issue_root_cause_map.sql`，白名单种子见 `0059`；若曾种入 `params_issue_root_cause_edit`，请再执行 `db/migrations/0060_remove_issue_root_cause_whitelist.sql`；子页策略回填见 `0061_param_subpage_whitelist_backfill.sql`
- **开发分析**、**运维闭环**节点已移除「磐石版本是否涉及」字段（`field_key`: `rock_version_involved`；历史已提交数据仍保留在库中）。已部署库请执行 `db/migrations/0055_remove_rock_version_involved.sql`
- **开发分析**节点新增「引入版本」「修复版本」字段（`field_key`: `intro_version` / `fix_version`），用于评估工单影响——记录问题在哪个版本引入、在哪个版本修复；均为可选下拉，选项实时取自「参数配置 → 版本模块」的基线版本（共用 `external_api` 选项集 `OS_RELEASE_VERSION`），并启用 `inherit_previous`。已部署库请执行 `db/migrations/0065_dev_analysis_version_fields.sql`
- **开发分析 · 修复版本**支持**多选**：节点字段 `ui_props.multiple=true`（与协同处理人同机制，参考迁移 `0053`、`0054`）；前端扁平下拉可勾选多个版本并以全角分号 `；` 拼接落库；「引入版本」保持单选。已部署库请执行 `db/migrations/0064_dev_analysis_fix_version_multiple.sql`
- **运维分析**节点同步新增「引入版本」「修复版本」字段（复用 `OS_RELEASE_VERSION`，`fix_version` 同样 `ui_props.multiple=true`），并对**运维分析 / 开发分析**这两组版本字段加上**条件可见 + 条件必填**：仅当「是否质量问题」为「是（已知质量问题）」或「是（新发现质量问题）」时下拉才展示并必填，否则隐藏可跳过；处理方式为「提交其他运维分析 / 提交其他开发分析 / 返回运维分析」等回流模式时整组放宽为可选（沿用 `0024` 的 `visible_when_all` + `required_when_visible` 模式）。已部署库请按序执行 `db/migrations/0066_ops_analysis_version_fields.sql`、`db/migrations/0067_dev_analysis_version_fields_visible_when_quality.sql`
- 后端 `requirements.txt` 补充 `python-multipart`，满足 FastAPI 对表单与 multipart 上传的依赖（避免启动时报 `Form data requires python-multipart`）
- 一键启动脚本：要求 **Python 3.10+** 创建 `backend/.venv`；`start.sh` / `start.bat` 优先选用较新解释器；首次在 `backend/.env` 中自动补充 **MinIO 可选变量模板**（富文本图片）
- 工单富文本图片改为 **MinIO 对象存储**：`POST /api/richtext/upload-image` 上传后 HTML 仅存 URL；**粘贴图片**与工具栏选图走同一上传逻辑；历史数据中已存在的 base64 图片仍可展示
- 规则驱动开发体系
- Skill 技能编排框架
- 数据库迁移体系
- 前后端分离架构
- 主题面板适配：蓝紫/护眼/粉色主题下，工作量统计、工单详情、值班表、走单日历、请假表格、流程条、权限面板、智能助手等组件的颜色和透明效果随主题变化，支持背景图透出

**功能更新**
- **请假申请 · 所有申请**：权限策略白名单新增 `leave_application_all`（`readonly` = 展示全部请假单，`editable` = 仅展示申请人为本人的请假单）；`GET /api/leave/applications?scope=all` 按角色策略过滤。已部署库请执行 `db/migrations/0071_leave_application_all_whitelist.sql`
- **用户管理**：`user_account` 表新增邮箱、联系电话、产品线、最小部门、备注字段；管理页列表与编辑已对齐；移除「是否 PL」列（`user_account.is_pl` 已删除；权限策略表 `role_permission_policy.is_pl` 仍用于策略维度，用户侧统一按非 PL 基线解析白名单）。已部署库请执行 `db/migrations/0069_user_account_profile_fields.sql`
- **用户管理 · 领域**：`user_account` 新增 `expert_domain`（领域）字段；管理页列表支持筛选，编辑模式下拉选项为「存储引擎 / SQL引擎 / 周边组件」（与统计图表领域口径一致）。已部署库请执行 `db/migrations/0072_user_account_expert_domain.sql`

**Bug修复**
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
