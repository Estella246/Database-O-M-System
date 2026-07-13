# 质量改进（QI）模块开发日志

## 概述

基于旧 `requirement` 单表 CRUD，重构为 5 阶段单链流程引擎，独立部署于 `47.95.244.175:18080`，并与 YW 工单系统集成。

---

## 一、QI 核心模块（5 阶段工作流）

### 1.1 数据模型
- **`db/migrations/0100_qi_workflow.sql`** — 6 张新表：
  - `qi_request` — 主诉求单（QI-YYYY-NNN 编号）
  - `qi_stage` — 阶段实例（打回 sequence 递增，保留审计）
  - `qi_stage_data` — 阶段字段值（JSONB）
  - `qi_progress_item` — 进展子项（分析/闭环阶段，逐条可独立提交）
  - `qi_flow_log` — 流转日志
  - `qi_no_seq` — 编号序列（每年独立）

### 1.2 后端（`backend/`）
| 文件 | 说明 |
|------|------|
| `qi_config.py` | 5 阶段字段定义、枚举（分类/优先级/状态）、流转路由、SLA 阈值 |
| `qi_flow.py` | 流转逻辑：submit/reject、必填校验、责任人继承、闭环单号校验 |
| `routers/qi.py` | 15 个端点：CRUD + submit/save + progress + analytics + export/import + migrate |
| `models/qi.py` | 7 个 Pydantic payload |
| `utils/qi_no.py` | QI-YYYY-NNN 编号分配（advisory lock，每年独立） |
| `test/test_m20_qi_workflow.py` | 25 个测试用例，全部通过 |

**流程**：①提出(QI-YYYY-NNN) → ②评审 → ③改进项分析 → ④闭环 → ⑤验收
- 评审不通过 → 打回提出
- 分析不接纳 → 打回评审
- 验收不通过 → 打回闭环
- 责任人继承链：评审填写 → 分析继承 → 闭环继承
- 验收人 = 提出人，不可转单

### 1.3 前端（`frontend/`）
| 文件 | 说明 |
|------|------|
| `modules/constants/qi.js` | 阶段/字段/枚举/流转路由常量 |
| `modules/pages/qi-page.js` | 列表 + 流程视图（流程线 5 节点 + 阶段表单切换 + 看板） |
| `modules/pages/qi.js` | 看板 KPI 卡片渲染 |
| `modules/ui/image-resizer.js` | 富文本图片缩放控件（虚线框 + 8 个拖拽手柄） |
| `styles/qi.css` | QI 流程视图样式（流程线/节点/表单/进度/看板） |

**交互**：
- 列表页 `/qi` → 点行/新建进入流程视图 `/qi/:id`
- 流程线 5 节点可视化（done/current/rejected/future 状态）
- 已完成节点只读展示，当前节点可编辑提交
- 未进入节点灰色不可点击
- 分析/闭环阶段支持进展子项
- 富文本编辑器（B/I/U/列表/粘贴图片）
- 人员选择器（账号联想 + 下拉列表）
- 打回后表单值回显

---

## 二、工单系统集成（YW → QI）

### 2.1 后端
- `routers/qi.py` `list_qi` 加 `related_ticket_no` 参数（精确筛选）
- `routers/qi.py` 接口响应返回值补 `description` + `category`

### 2.2 前端（`frontend/modules/pages/ticket-page.js`）
- **底部 QI 区块**：`.flow-logs` 后挂「新建改进诉求」按钮 + 8 列表格
  - 改进单号 / 改进标题 / 详细描述 / 改进类型 / 提出人 / 当前阶段 / 当前处理人 / SLA时间
- **`openQiCreateModal()`**：内联 QI 提出表单弹窗（分类/标题/关联单号/描述/评审人）
- **`fetchRenderRelatedQiList()`**：按工单号拉取关联 QI，渲染表格
- **`bindTicketQiIntegration()`**：绑定按钮 + 创建底部区块
- 表格行可点击跳转 QI 详情 `/qi/:id`
- 详细描述列自动剥离 HTML 标签

### 2.3 工单字段调整
- `dev_analysis.dfx_gap`（DFX能力GAP）→ `is_active=false` + `required=false`（全局停用）

### 2.4 提出阶段字段（对齐 Excel 规格）
- 分类（下拉 5 类）/ 诉求标题 / 关联运维系统单号 / 诉求描述（富文本） / 评审人（人员选择器）

---

## 三、部署

| 项目 | 详情 |
|------|------|
| 服务器 | `47.95.244.175:18080`（Ubuntu 26.04, 2核 1.6G） |
| 代码路径 | `/opt/yunwei-ticket` |
| Python | 3.14.4 + `backend/.venv` |
| 数据库 | PostgreSQL 17（apt），库 `yunwei_ticket`，peer 认证 |
| MinIO | Docker 容器 `yunwei-minio`（端口 9000，bucket `yunwei-images` 公开读） |
| 服务 | nohup uvicorn（`0.0.0.0:18080`），日志 `/opt/yunwei-ticket/server.log` |
| 本地服务 | 已停止 |
| 默认用户 | `admin`（SKIP_SSO_AUTH=1，DEV_USER_ACCOUNT=admin） |

---

## 四、优化

| 优化 | 文件 | 说明 |
|------|------|------|
| GZip 压缩 | `app.py` | `GZipMiddleware` — app.js 88KB→17KB（5x） |
| 启动并行化 | `bootstrap.js` | QI 页跳过 `syncBootstrapTickets`；其他页 admin+工单并行 |
| fetch 30s 缓存 | `qi-page.js` | `FETCH_CACHE_MS=30000` — 列表/看板不重复拉取 |
| 404 不重复 fetch | `qi-page.js` | `qiDetailLoaded` 标志防死循环 |
| 富文本图片缩放 | `image-resizer.js` | 点击图片→虚线框 + 8 手柄拖拽 |

**回退标记**：`[OPT-BOOTSTRAP]`（bootstrap.js）、`[OPT-LOAD]`（qi-page.js）

---

## 五、规则与技能

- **新增规则**：`.cursor/rules/quality-improvement-flow.mdc` — QI 5 阶段流程语义约束
- **更新技能**：`.cursor/skills/ticket-save-vs-submit/SKILL.md` — 追加 QI 保存/提交章节

---

## 六、关键文件清单（修改过的）

### 新建
`db/migrations/0100_qi_workflow.sql`
`db/migrations/0102_qi_analyst_candidates.sql`
`backend/qi_config.py`
`backend/qi_flow.py`
`backend/routers/qi.py`
`backend/models/qi.py`
`backend/utils/qi_no.py`
`test/test_m20_qi_workflow.py`
`frontend/modules/constants/qi.js`
`frontend/modules/pages/qi-page.js`
`frontend/modules/pages/qi.js`
`frontend/modules/ui/image-resizer.js`
`frontend/styles/qi.css`
`.cursor/rules/quality-improvement-flow.mdc`
`docs/qi-dev-log.md`

### 修改
`backend/app.py` — GZipMiddleware + qi_router 注册
`backend/config.py` — `_QI_SCHEMA_HINT`
`backend/routers/__init__.py` — qi_router 导出
`backend/models/__init__.py` — QiPayload 导出
`backend/.env` — SKIP_SSO + DEV_USER_ACCOUNT + MinIO 配置
`frontend/modules/state/state.js` — qi* 状态变量
`frontend/app.js` — QI 侧栏 + 内容 + 绑定 + bindTicketQiIntegration
`frontend/modules/navigation/tabs.js` — QI 路由 /qi 和 /qi/:id
`frontend/modules/utils/normalize.js` — qi:manage → requirement_list
`frontend/modules/pages/ticket-core.js` — QI 路由 getUrlByKey + syncActiveKeyFromPath + params:qi-candidates
`frontend/modules/pages/settings-page.js` — ensureQiTab
`frontend/modules/pages/ticket-page.js` — QI 集成（底部区块+弹窗+表格+dfx_gap 停用）
`frontend/modules/pages/bootstrap.js` — 启动并行化
`frontend/modules/pages/params-page.js` — QI 白名单管理页（render + bind + fetch）
`frontend/modules/pages/params.js` — QI白名单标题
`frontend/modules/core/auth.js` — getCurrentOperator 优先用 currentUser
`frontend/modules/ui/sidebar-flyouts.js` — 质量管理子菜单弹出
`frontend/styles.css` — @import qi.css
`frontend/styles/sidebar.css` — 质量管理子菜单布局
`frontend/modules/constants/permission.js` — params_qi_candidates 权限键
`frontend/split_css.py` — 回退（样式不在 split_css 管理）
`.cursor/skills/ticket-save-vs-submit/SKILL.md` — QI 章节 + stage_key DOM 规则

### 远程 DB 变更
- `node_field_def.dfx_gap` → `is_active=false`, `required=false`
- 迁移 `0079_ticket_list_snapshot.sql` 补跑
- user_account 插入 `admin` 账号

---

## 七、QI 白名单管理（评审人 / 分析人）

### 7.1 DB
- **`db/migrations/0102_qi_analyst_candidates.sql`** — `qi_analyst_candidates` 表（与 `qi_reviewer_candidates` 同结构）

### 7.2 后端
- **`routers/qi.py`**：
  - 新增 `GET/POST /api/qi/candidates/reviewer` — 评审人白名单 CRUD
  - 新增 `GET/POST /api/qi/candidates/analyst` — 分析人白名单 CRUD
  - `create_qi` / `submit_qi` 加 person 字段白名单校验（`_PERSON_WHITELIST_TABLE` 映射：`reviewer`→`qi_reviewer_candidates`，`responsible`→`qi_analyst_candidates`）
- **路由设计**：`/candidates/{reviewer|analyst}` 两段路径，避免与 `/{req_id:int}` 参数化路由冲突

### 7.3 前端
- **参数配置子页** `params:qi-candidates`：
  - 侧栏「参数配置 → QI白名单」
  - 两个 Tab：评审人候选 / 分析人候选
  - 查看模式（名单列表）+ 编辑模式（多选 checkbox + 搜索 + 保存）
  - 数据源：`state.adminUsers`，保存调 POST 接口
  - 权限键：`params_qi_candidates`（依赖 `params_config`）
- **人员选择器**（`qi-page.js`）：`reviewer` 字段拉 `candidates/reviewer`，`responsible` 字段拉 `candidates/analyst`，各自独立

### 7.4 涉及文件
- 新建：`db/migrations/0102_qi_analyst_candidates.sql`
- 修改：`routers/qi.py`、`constants/permission.js`、`state/state.js`、`params.js`、`params-page.js`、`tabs.js`、`ticket-core.js`、`app.js`、`normalize.js`、`qi-page.js`、`qi.css`、`sidebar-flyouts.js`、`sidebar.css`

---

## 八、侧栏重构：质量管理子菜单

将"质量改进"和"质量改进(旧)"整合为侧栏「运维管理」下的**质量管理**父菜单（hover 弹出子菜单，模式同月度报告/参数配置）：
- `app.js` — `menu-item-wrap--quality` + 子菜单项
- `sidebar-flyouts.js` — 选择器加 `.menu-item-wrap--quality`
- `sidebar.css` — 布局选择器加 `.menu-item-wrap--quality`

---

## 九、Bug 修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 刷新 QI 白名单页显示"Order Not Found" | `ticket-core.js` 有独立的 `syncActiveKeyFromPath`，缺少 `params:qi-candidates` 路由 | 在 `ticket-core.js` 补加路由处理 + `getUrlByKey` |
| 保存分析人报 `Method Not Allowed` | 旧后端进程未重启（端口 18080 残留） | 杀掉旧进程重启 |
| 分析阶段提交报 `当前阶段为 analysis，与提交阶段 review 不符` | `state.qiFlowStage` 提交后未更新，始终为 `"review"` | 改为从按钮 DOM 父级 `[data-flow-step]` 读阶段名；提交后同步 `qiFlowStage` |
| 删除按钮权限过宽 | 创建人即可删，且 analysis 之前均可删 | 前端仅 `propose` 阶段显示删除按钮；后端收紧为仅 `propose` 可删 |
| `operator_id` 硬编码 `"admin"` | QI 白名单保存/加载用了固定值 | 改为 `getCurrentOperator().account` |

---

## 十、本次迭代（2026-07-08 ~ 07-09）

### 10.1 流程重构
- **阶段重命名**：改进项分析→确认，闭环→实施
- **评审不通过直接关单**：不再打回提出，`review: {"评审通过": "analysis", "评审不通过": "__closed__"}`
- **评审结果选项**："通过" / "不通过关单"
- **评审意见**：必填 richtext（评审通过和不通过都要填）
- **分析阶段精简**：是否接纳 + 评审意见(richtext) + 闭环方法；不接纳理由/问题单号/接纳版本移至实施
- **实施阶段字段**：问题单号/需求单号 → SLA时间 → 当前进展 → 闭环自测 → 接纳版本
- **验收阶段**：验收是否通过在前，验收结论在后
- **进展子项完全移除**：`QI_PROGRESS_STAGES = frozenset()`

### 10.2 编号格式
- `QI-YYYY-NNN` → `QI-YYYYMMDD-NNN`（日期+序号，每天独立，突破年度 999 上限）

### 10.3 草稿 + 批量提交
- 工单页面暂存草稿：无 QI 编号（DRAFT-占位）、无评审人
- 草稿列表默认不可见（`current_status != 'draft'`）
- 运维闭环提交时自动批量提交关联草稿（`batchSubmitQiDraftsSilent`）
- `batch=true` 绕过草稿拦截，单独提交草稿返回 400
- 关闭后不可操作（submit/save 均 400）

### 10.4 领域/模块&特性
- propose 阶段新增分级下拉：领域 → 模块&特性联动
- 配置 API：`GET/POST /api/qi/config/domain`
- 参数配置页：`params:qi-domain-config`

### 10.5 闭环进展配置
- 当前进展字段（`progress_stage`）：根据分析阶段闭环方式动态切换选项
- 默认值：需求闭环[需求已提出/待上RAT/RAT接纳/RAT拒绝]，问题单闭环[问题单已提出/问题定位中/修改待合入]
- 配置 API：`GET/POST /api/qi/config/closure-progress`
- 参数配置页：`params:qi-closure-progress`

### 10.6 字段重命名
- 诉求标题→改进标题，诉求描述→详细描述（覆盖列表、表单、弹窗）
- 评审人/责任人→下一步处理人（提出/评审/分析三阶段统一）

### 10.7 列表重构
- 列：改进编号 → 改进标题 → 分类 → 领域 → 模块 → 详细描述 → 优先级 → 提出人 → 提出时间 → 当前阶段 → 关联运维系统单号
- 新增"我处理的"Tab（`scope=handled`）
- 搜索改为按钮触发（不再输入即搜）

### 10.8 QI 流程正交测试（45 用例覆盖）
- 8 条正交路径：happy path / 验收打回 / 分析打回 / 评审关单 / 分析+验收打回 / 验收多次打回 / 全阶段打回 / 打回保留值
- 验证每个步骤的 `current_stage`、`current_status`、流程节点状态

### 10.9 Bug 修复
| 问题 | 修复 |
|------|------|
| 正向流转 seq=1 导致打回后节点状态错误 | INSERT 改为 `MAX(sequence)+1` |
| 工单 tab 切换后显示"Order Not Found" | `runNavigationTicketSyncAndRender` ticket 分支始终调 `renderFn()` |
| 非存在 QI 页面无限渲染 | `fetchQiDetail` 加 `!qiDetailLoaded` 防重入 |
| 动态标签清除星号 | `textContent` 改仅更新首文本节点 |
| 闭环进展下拉首次加载为空 | 去 `dataset.loaded` 锁 |
| 保存/提交按钮点不动 | `addEventListener` → inline `onclick` |

### 10.10 涉及文件
- **新建**：`db/migrations/0102_qi_analyst_candidates.sql`
- **修改**：`routers/qi.py`, `qi_config.py`, `qi_flow.py`, `models/qi.py`, `utils/qi_no.py`（后端）
- **修改**：`qi-page.js`, `ticket-page.js`, `qi.js`, `params-page.js`, `params.js`, `tabs.js`, `ticket-core.js`, `app.js`, `settings-page.js`, `state.js`, `normalize.js`, `permission.js`, `sidebar-flyouts.js`, `requirement.css`, `sidebar.css`（前端）
- **规则**：`.cursor/rules/quality-improvement-flow.mdc`
- **技能**：`.cursor/skills/ticket-save-vs-submit/SKILL.md`


## 十一、测试

- **后端**：`test/test_m20_qi_workflow.py` — 46 个用例全部通过
- **正交覆盖**：评审通过/关单 × 确认接纳/不接纳 × 验收通过/不通过，含多次打回场景
- **E2E**：Playwright 验证核心路径正常
