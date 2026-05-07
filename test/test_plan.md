# 运维工单平台 — 测试方案

## 1. 测试概述

### 1.1 测试范围

本测试方案覆盖运维工单平台的核心功能模块，包括：

| 模块编号 | 模块名称 | 测试范围 |
|----------|----------|----------|
| M01 | 健康检查 | 服务健康状态验证 |
| M02 | 工单流程 | 节点Schema、工单创建、节点提交、审核通过、流转日志 |
| M03 | 权限管理 | 用户角色权限验证 |
| M04 | 用户管理 | 用户CRUD操作 |
| M05 | 值班管理 | 值班表管理 |
| M06 | 请假管理 | 请假申请与审批 |
| M07 | 参数配置 | 系统参数管理 |
| M08 | 个人统计 | 统计图表展示 |
| M09 | 前端SPA | 静态资源与路由 |
| M10 | 需求管理 | 需求跟踪 |
| M11 | AI助手 | AI功能集成 |
| M12 | 文件上传 | 上传功能 |
| M13 | 前端功能测试 | 工具函数单元测试、UI渲染测试、用户交互测试 |
| M14 | 富文本图片存储 | MinIO 上传接口 `POST /api/richtext/upload-image`（单测，mock 客户端）；前端剪贴板图片解析见 `test/frontend_tests/__tests__/richtext-paste-image.test.js` |

### 1.2 测试目标

1. **功能完整性**：验证所有功能模块按需求规范实现
2. **接口正确性**：确保前后端API交互正常
3. **数据一致性**：工单状态、权限控制等核心数据准确
4. **用户体验**：页面渲染、交互流畅，无明显bug
5. **前端代码质量**：通过单元测试确保核心工具函数正确性

### 1.3 测试策略

- **后端API测试**：pytest + requests，验证RESTful接口
- **前端单元测试**：Jest，验证核心工具函数
- **端到端测试**：Playwright，验证UI渲染和用户交互

---

## 2. 测试环境

### 2.1 硬件要求

| 配置项 | 最低配置 | 推荐配置 |
|--------|----------|----------|
| CPU | 2核 | 4核+ |
| 内存 | 4GB | 8GB+ |
| 磁盘 | 20GB | 50GB+ |

### 2.2 软件环境

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| Python | 3.10+ | 运行环境 |
| PostgreSQL | 13+ | 数据库 |
| Node.js | 18+ | 前端构建 |
| npm | 9+ | 包管理 |
| Chromium | 最新版 | Playwright浏览器 |

### 2.3 Python依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| pytest | ^7.4.0 | 测试框架 |
| pytest-asyncio | ^0.21.0 | 异步支持 |
| playwright | ^1.40.0 | 端到端测试 |
| requests | ^2.31.0 | HTTP客户端 |
| pytest-json-report | ^1.5.0 | JSON报告 |

### 2.4 前端依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| jest | ^29.7.0 | 单元测试框架 |

### 2.5 环境变量

| 变量名 | 说明 | 测试环境推荐值 |
|--------|------|----------------|
| `DATABASE_URL` | 数据库连接串 | `postgresql://postgres:123@localhost:5432/yunwei_ticket_test` |
| `SERVE_FRONTEND` | 是否托管前端 | `1` |
| `TEST_API_BASE_URL` | 测试API地址 | `http://127.0.0.1:8000` |

### 2.6 数据库准备

1. 创建测试专用数据库：`yunwei_ticket_test`
2. 按顺序执行迁移脚本初始化表结构
3. 执行种子数据脚本填充基础数据
4. 测试完成后可清理测试数据库

---

## 3. 测试用例

### 3.1 M01 健康检查

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M01-001 | 健康检查接口 | 无 | GET /health | 返回 `{"status": "ok"}` |
| TC-M01-002 | 指标接口 | 无 | GET /metrics | 返回包含Python指标 |

### 3.2 M02 工单流程

#### M02.1 节点Schema

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-001 | 获取节点Schema | 无 | GET /api/tickets/schema | 返回JSON，包含nodes数组 |
| TC-M02-002 | Schema节点数量 | 无 | 检查nodes数组 | 包含7个节点 |
| TC-M02-003 | 节点字段完整性 | 无 | 检查节点fields | 包含label、key、type字段 |

#### M02.2 工单创建

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-004 | 创建工单-完整数据 | 完整工单数据 | POST /api/tickets/create | 返回工单号 |
| TC-M02-005 | 创建工单-必填字段 | 仅必填字段 | POST /api/tickets/create | 返回工单号 |
| TC-M02-006 | 创建工单-缺少severity | 无severity | POST /api/tickets/create | 返回400错误 |

#### M02.3 节点数据提交

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-007 | 问题填写-正常提交 | 问题描述数据 | POST /api/tickets/{id}/nodes/problem_fill/submit | 返回200 |
| TC-M02-008 | 问题填写-缺少描述 | 无description | POST /api/tickets/{id}/nodes/problem_fill/submit | 返回400 |
| TC-M02-009 | 问题审核-通过 | 审核通过 | POST /api/tickets/{id}/nodes/problem_audit/submit | 返回200 |
| TC-M02-010 | 问题审核-退回 | 审核退回 | POST /api/tickets/{id}/nodes/problem_audit/submit | 返回200 |
| TC-M02-011 | 运维分析-提交 | 分析数据 | POST /api/tickets/{id}/nodes/ops_analysis/submit | 返回200 |
| TC-M02-012 | 开发分析-提交 | 分析数据 | POST /api/tickets/{id}/nodes/dev_analysis/submit | 返回200 |
| TC-M02-013 | 开发闭环-提交 | 闭环数据 | POST /api/tickets/{id}/nodes/dev_closed/submit | 返回200 |
| TC-M02-014 | 运维闭环-提交 | 闭环数据 | POST /api/tickets/{id}/nodes/ops_closed/submit | 返回200 |

#### M02.4 审核通过

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-015 | 审核通过-终态 | 审核通过 | POST /api/tickets/{id}/audit_pass | 状态变为closed |

#### M02.5 工单列表

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-016 | 工单列表-返回数组 | 无 | GET /api/tickets | 返回数组 |
| TC-M02-017 | 工单列表-分页 | 无 | GET /api/tickets?page=1&size=10 | 返回分页数据 |
| TC-M02-018 | 工单列表-按状态筛选 | status=open | GET /api/tickets?status=open | 只返回open工单 |

#### M02.6 工单详情

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-019 | 工单详情-正常 | 存在的工单号 | GET /api/tickets/{id} | 返回工单详情 |
| TC-M02-020 | 工单详情-不存在 | 不存在的工单号 | GET /api/tickets/999999 | 返回404 |

#### M02.7 流转日志

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-021 | 流转日志-正常 | 存在的工单号 | GET /api/tickets/{id}/logs | 返回日志数组 |
| TC-M02-022 | 流转日志-包含操作类型 | 无 | 检查日志内容 | 包含submit、pass操作 |

#### M02.8 调试状态

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-023 | 调试状态-正常 | 存在的工单号 | GET /api/tickets/{id}/debug | 返回调试信息 |
| TC-M02-024 | 调试状态-无权限 | 无效工单号 | GET /api/tickets/999999/debug | 返回403 |

### 3.3 M03 权限管理

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M03-001 | 获取权限列表 | 无 | GET /api/permissions | 返回权限数组 |
| TC-M03-002 | 获取角色列表 | 无 | GET /api/roles | 返回角色数组 |
| TC-M03-003 | 分配权限-正常 | 角色ID、权限ID | POST /api/roles/{id}/permissions | 返回200 |
| TC-M03-004 | 分配权限-无效角色 | 无效角色ID | POST /api/roles/999/permissions | 返回404 |

### 3.4 M04 用户管理

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M04-001 | 获取用户列表 | 无 | GET /api/users | 返回用户数组 |
| TC-M04-002 | 创建用户-正常 | 用户数据 | POST /api/users | 返回用户ID |
| TC-M04-003 | 创建用户-重复 | 已存在用户名 | POST /api/users | 返回400 |
| TC-M04-004 | 更新用户 | 用户ID、新数据 | PUT /api/users/{id} | 返回200 |
| TC-M04-005 | 删除用户 | 用户ID | DELETE /api/users/{id} | 返回200 |

### 3.5 M05 值班管理

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M05-001 | 获取值班表 | 年份、月份 | GET /api/duty/rotation/{year}/{month} | 返回值班表 |
| TC-M05-002 | 创建值班记录 | 值班数据 | POST /api/duty/rotation | 返回200 |
| TC-M05-003 | 更新值班记录 | 记录ID、新数据 | PUT /api/duty/rotation/{id} | 返回200 |
| TC-M05-004 | 删除值班记录 | 记录ID | DELETE /api/duty/rotation/{id} | 返回200 |
| TC-M05-005 | 值班表-按角色筛选 | role=内核 | GET /api/duty/rotation?role=内核 | 返回筛选后数据 |

### 3.6 M06 请假管理

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M06-001 | 获取请假列表 | 无 | GET /api/leave | 返回请假数组 |
| TC-M06-002 | 创建请假申请 | 请假数据 | POST /api/leave | 返回申请ID |
| TC-M06-003 | 请假申请-缺少时间 | 无时间范围 | POST /api/leave | 返回400 |
| TC-M06-004 | 审批请假 | 申请ID、审批结果 | POST /api/leave/{id}/approve | 返回200 |
| TC-M06-005 | 查询请假余额 | 用户ID | GET /api/leave/balance/{userId} | 返回余额信息 |

### 3.7 M07 参数配置

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M07-001 | 获取参数列表 | 无 | GET /api/params | 返回参数数组 |
| TC-M07-002 | 创建参数 | 参数数据 | POST /api/params | 返回参数ID |
| TC-M07-003 | 更新参数 | 参数ID、新值 | PUT /api/params/{id} | 返回200 |
| TC-M07-004 | 删除参数 | 参数ID | DELETE /api/params/{id} | 返回200 |
| TC-M07-005 | 参数分类筛选 | category=severity | GET /api/params?category=severity | 返回筛选后数据 |

### 3.8 M08 个人统计

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M08-001 | 获取统计数据 | 用户ID | GET /api/stats/user/{userId} | 返回统计数据 |
| TC-M08-002 | 统计-按月筛选 | 年月 | GET /api/stats/user/{userId}?month=2026-04 | 返回月统计数据 |
| TC-M08-003 | 统计图表数据 | 用户ID | GET /api/stats/charts/{userId} | 返回图表数据 |
| TC-M08-004 | 统计-人力投入 | 用户ID | GET /api/stats/manpower/{userId} | 返回人力投入数据 |

### 3.9 M09 前端SPA

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M09-001 | 首页可访问 | 无 | GET / | 200, 返回HTML |
| TC-M09-002 | SPA深链回退 | /tickets/test | GET /tickets/test | 200, 返回index.html |
| TC-M09-003 | 静态资源访问 | /assets/skin-presets/preset-01.png | GET | 200, 返回文件 |
| TC-M09-004 | 路径遍历防护 | /../backend/app.py | GET | 404 |

### 3.13 M13 前端功能测试

#### M13.1 工具函数单元测试

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M13-001 | 问题严重性规范化-中文输入 | severity="一般" | 调用normalizeIssueSeverity | 返回"一般" |
| TC-M13-002 | 问题严重性规范化-英文输入urgent | severity="urgent" | 调用normalizeIssueSeverity | 返回"致命" |
| TC-M13-003 | 问题严重性规范化-high | severity="high" | 调用normalizeIssueSeverity | 返回"严重" |
| TC-M13-004 | 问题严重性规范化-low | severity="low" | 调用normalizeIssueSeverity | 返回"一般" |
| TC-M13-005 | 问题严重性规范化-空值 | severity="" | 调用normalizeIssueSeverity | 返回"一般" |
| TC-M13-006 | 列表预览文本-正常截断 | raw="这是一段很长的文本需要截断显示" | 调用listPreviewText | 返回截断后文本+省略号 |
| TC-M13-007 | 列表预览文本-HTML标签过滤 | raw="<div>test</div>" | 调用listPreviewText | 返回"test" |
| TC-M13-008 | SLA时间格式化-正常计算 | ticket.createdAt="2026-04-01T12:00:00Z" | 调用formatTicketSlaDhM | 返回正确的天时分格式 |
| TC-M13-009 | SLA时间格式化-空值处理 | ticket.createdAt=null | 调用formatTicketSlaDhM | 返回"--" |
| TC-M13-010 | 工单编号生成-格式正确性 | 无 | 调用makeNewTicketId | 返回YW+日期+3位序号格式 |
| TC-M13-011 | 工单列表排序-按创建时间降序 | 多个工单数据 | 调用sortTicketsByCreatedAtDesc | 返回按时间降序排列的列表 |
| TC-M13-012 | 工单过滤-按阶段筛选 | tickets, filters.selected.currentStage=["开发闭环"] | 调用filterTicketsByListColumnFilters | 返回仅包含开发闭环的工单 |
| TC-M13-016 | 严重性样式类-致命 | label="致命" | 调用severityPillClass | 返回"urgent" |
| TC-M13-017 | 严重性样式类-严重 | label="严重" | 调用severityPillClass | 返回"high" |
| TC-M13-018 | 严重性样式类-一般 | label="一般" | 调用severityPillClass | 返回"low" |
| TC-M13-019 | 严重性样式类-未知值 | label="未知" | 调用severityPillClass | 返回"medium" |
| TC-M13-020 | 列表预览文本-空值处理 | raw="" | 调用listPreviewText | 返回"--" |
| TC-M13-021 | 列表预览文本-不截断情况 | raw="短文本" | 调用listPreviewText | 返回"短文本" |
| TC-M13-022 | 工单时间戳-createdAt字段 | ticket.createdAt | 调用ticketCreatedAtMs | 返回正确的毫秒时间戳 |
| TC-M13-023 | 工单时间戳-created_at字段 | ticket.created_at | 调用ticketCreatedAtMs | 返回正确的毫秒时间戳 |
| TC-M13-024 | 工单时间戳-startDate字段 | ticket.startDate | 调用ticketCreatedAtMs | 返回日期中午的时间戳 |
| TC-M13-025 | 工单时间戳-空值 | ticket={} | 调用ticketCreatedAtMs | 返回0 |
| TC-M13-026 | SLA时间格式化-多天计算 | ticket.createdAt为2天前 | 调用formatTicketSlaDhM | 返回包含2天的格式 |
| TC-M13-027 | 工单编号生成-序列号递增 | localStorage.last=5 | 调用makeNewTicketId | 返回序号006 |
| TC-M13-028 | 工单列表排序-相同时间按编号降序 | 相同时间的工单 | 调用sortTicketsByCreatedAtDesc | 返回按编号降序排列 |
| TC-M13-029 | 筛选显示值-currentStage | ticket.currentStage | 调用ticketListFilterDisplayValue | 返回currentStage值 |
| TC-M13-030 | 筛选显示值-severity | ticket.severity="urgent" | 调用ticketListFilterDisplayValue | 返回"致命" |
| TC-M13-031 | 筛选显示值-location | ticket.location | 调用ticketListFilterDisplayValue | 返回location值 |
| TC-M13-032 | 筛选显示值-空字段 | ticket.currentStage="" | 调用ticketListFilterDisplayValue | 返回"（空）" |
| TC-M13-033 | 筛选值去重-正常 | 多个工单 | 调用uniqueTicketListFilterValues | 返回去重排序后的数组 |
| TC-M13-034 | 筛选值去重-包含空值 | 包含空值的工单 | 调用uniqueTicketListFilterValues | 包含"（空）" |
| TC-M13-035 | 工单过滤-多条件筛选 | 多个筛选条件 | 调用filterTicketsByListColumnFilters | 返回满足所有条件的工单 |
| TC-M13-036 | 工单过滤-无筛选条件 | filters={} | 调用filterTicketsByListColumnFilters | 返回全部工单 |
| TC-M13-037 | 工单过滤-空筛选条件 | filters=null | 调用filterTicketsByListColumnFilters | 返回全部工单 |

#### M13.2 UI元素渲染测试

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M13-038 | 首页渲染-顶部导航栏 | 无 | 访问首页 | 导航栏包含"我的主页"、"工作台"等标签 |
| TC-M13-039 | 首页渲染-工单列表表格 | 无 | 访问首页 | 表格包含"流程ID"、"当前阶段"等列 |
| TC-M13-040 | 首页渲染-创建工单按钮 | 无 | 访问首页 | 页面包含"创建工单"按钮 |
| TC-M13-041 | 首页渲染-筛选按钮 | 无 | 访问首页 | 各列包含筛选按钮 |
| TC-M13-042 | 工单详情-节点标签页 | 存在的工单号 | 访问工单详情 | 显示问题填写、问题审核等节点标签 |
| TC-M13-043 | 工单详情-提交按钮 | 存在的工单号 | 访问工单详情 | 当前节点显示"提交下一节点"按钮 |
| TC-M13-044 | 侧边栏-功能菜单 | 无 | 访问任意页面 | 侧边栏包含值班表、请假申请等菜单 |
| TC-M13-045 | 值班表页面-内核值班区块 | 无 | 访问值班表 | 显示内核值班表区块 |
| TC-M13-046 | 值班表页面-编辑按钮 | 管理员权限 | 访问值班表 | 显示"编辑"按钮 |
| TC-M13-047 | 请假申请-申请表单 | 无 | 访问请假申请 | 显示申请类型、时间段等字段 |
| TC-M13-048 | 参数配置-责任田树 | 无 | 访问参数配置 | 显示责任田树形结构 |
| TC-M13-049 | 权限管理-策略列表 | 无 | 访问权限管理 | 显示权限策略表格 |
| TC-M13-050 | 统计图表-人力投入 | 无 | 访问统计图表 | 显示人力投入图表区域 |

#### M13.3 用户交互测试

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M13-051 | 标签页切换-工作台 | 无 | 点击工作台标签 | 页面切换到工作台视图 |
| TC-M13-052 | 标签页切换-值班表 | 无 | 点击值班表标签 | 页面切换到值班表视图 |
| TC-M13-053 | 创建工单弹窗-打开 | 无 | 点击创建工单按钮 | 弹出创建工单对话框 |
| TC-M13-054 | 工单列表筛选-阶段筛选 | 选择"开发闭环" | 点击筛选按钮选择阶段 | 列表只显示开发闭环工单 |
| TC-M13-055 | 工单列表筛选-重置 | 已有筛选条件 | 点击重置按钮 | 筛选条件清空，显示全部工单 |
| TC-M13-056 | 工单详情-节点切换 | 存在的工单号 | 点击不同节点标签 | 显示对应节点的表单内容 |
| TC-M13-057 | 侧边栏折叠-收起 | 无 | 点击折叠按钮 | 侧边栏收起，只显示图标 |
| TC-M13-058 | 侧边栏折叠-展开 | 已收起状态 | 点击展开按钮 | 侧边栏展开，显示完整菜单 |
| TC-M13-059 | 主题切换-深色模式 | 无 | 切换到dark主题 | 页面应用深色主题样式 |
| TC-M13-060 | 主题切换-护眼模式 | 无 | 切换到eye-care主题 | 页面应用护眼主题样式 |
| TC-M13-061 | 请假申请-提交表单 | 有效申请数据 | 填写表单并提交 | 提交成功，显示成功提示 |
| TC-M13-062 | 值班表编辑-保存 | 修改值班人员 | 编辑后点击保存 | 保存成功，数据更新 |
| TC-M13-063 | 工单搜索-关键字搜索 | 搜索词"迁移" | 输入搜索词 | 列表显示匹配的工单 |
| TC-M13-064 | 工单多选-批量操作 | 选择多个工单 | 勾选复选框 | 显示批量操作按钮 |

---

## 4. 测试执行流程

### 4.1 测试前准备

1. **环境搭建**
   - 创建测试专用数据库 `yunwei_ticket_test`
   - 执行全部迁移脚本初始化表结构
   - 安装Python依赖：`pip install -r requirements.txt`
   - 安装前端依赖：`cd frontend && npm install`
   - 安装Playwright浏览器：`playwright install chromium`
   - 安装前端测试依赖：`cd test/frontend_tests && npm install`

2. **启动服务**
   - 启动后端服务：
   ```bash
   python -m uvicorn app:app --host 0.0.0.0 --port 8000
   ```

3. **验证环境就绪**
   - 访问 GET /health 确认返回 `{"status": "ok"}`

### 4.2 测试执行顺序

按模块依赖关系和风险等级排序：

```
Phase 1: 基础设施验证
  M01 健康检查 → M09 前端SPA

Phase 2: 基础数据管理
  M04 用户管理 → M03 权限管理

Phase 3: 核心业务流程
  M02.1 节点Schema → M02.2 工单创建 → M02.3 节点数据提交 →
  M02.5 工单列表 → M02.6 工单详情 → M02.7 流转日志 → M02.8 调试状态

Phase 4: 辅助业务模块
  M05 值班管理 → M06 请假管理 → M07 参数配置

Phase 5: 统计分析
  M08 个人统计

Phase 6: 前端功能测试
  M13.1 工具函数单元测试 → M13.2 UI元素渲染测试 → M13.3 用户交互测试
```

### 4.3 测试数据管理

- 测试数据存放在 `test/test_data/` 目录
- 每个测试模块使用独立的数据集，避免相互干扰
- 测试程序在执行前自动准备所需数据，执行后自动清理
- 工单编号使用 `YW99990101` 前缀避免与正式数据冲突
- 用户账号使用 `test_` 前缀标识测试数据

### 4.4 测试执行命令

```bash
# 执行全部测试（包括前端）
cd test
python run_tests.py --all

# 执行指定模块测试
python run_tests.py --module m02

# 执行前端单元测试（Jest）
python run_tests.py --frontend

# 执行指定用例
python run_tests.py --case TC-M02-015

# 生成测试报告
python run_tests.py --report
```

---

## 5. 测试程序开发规范

### 5.1 目录结构

```
test/
├── test_plan.md              # 本文档：测试方案
├── conftest.py               # pytest全局配置与fixtures
├── run_tests.py              # 测试执行入口与报告生成
├── test_data/                # 测试数据
│   ├── users.json            # 用户测试数据
│   ├── tickets.json          # 工单测试数据
│   └── duty.json             # 值班测试数据
├── reports/                  # 测试报告输出目录
├── test_m01_health.py        # M01健康检查测试
├── test_m02_ticket.py        # M02工单流程测试
├── test_m03_permission.py    # M03权限管理测试
├── test_m04_user.py          # M04用户管理测试
├── test_m05_duty.py          # M05值班管理测试
├── test_m06_leave.py         # M06请假管理测试
├── test_m07_params.py        # M07参数配置测试
├── test_m08_stats.py         # M08个人统计测试
├── test_m09_spa.py           # M09前端SPA测试
├── test_m13_frontend.py      # M13前端功能测试（Playwright端到端）
└── frontend_tests/           # 前端单元测试目录
    ├── __tests__/            # Jest测试文件目录
    │   └── utils.test.js    # 工具函数单元测试
    ├── jest.config.js       # Jest配置文件
    └── package.json          # 前端测试依赖配置
```

### 5.2 命名规范

- 测试文件（Python）：`test_m{模块编号}_{模块名}.py`
- 测试文件（JavaScript）：`{模块名}.test.js` 或 `{功能名}.test.js`
- 测试函数（Python）：`test_{用例ID小写}_{简述}`，如 `test_tc_m02_015_problem_fill_submit`
- 测试函数（JavaScript）：`test('{测试描述}', () => {...})`
- Fixture：`fixture_{用途}`，如 `fixture_admin_token`
- 测试数据文件：`{模块名}.json`

### 5.3 代码结构规范

```python
# 每个测试函数遵循以下结构：
def test_tc_m02_015_problem_fill_submit(api_client, test_ticket_data):
    # 1. Arrange - 准备测试数据
    payload = {...}

    # 2. Act - 执行测试操作
    response = api_client.post("/api/tickets/.../submit", json=payload)

    # 3. Assert - 验证结果
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
```

### 5.4 断言规范

- 使用 pytest 标准断言
- 关键字段必须验证：`assert "orderId" in response_data`
- 列表返回必须验证长度：`assert len(results) > 0`
- 错误响应必须验证状态码和错误信息

### 5.5 异常处理

- 网络错误：使用 `pytest.raises` 捕获预期异常
- 超时错误：设置合理的 `timeout` 参数
- 并发问题：使用 pytest fixture 确保测试顺序

---

## 6. 测试报告

### 6.1 报告格式

测试完成后自动生成 Markdown 格式报告，包含：
- 测试概述：测试范围、时间、环境
- 测试结果统计：总通过数、失败数、通过率
- 按模块统计：每个模块的测试结果
- 详细测试结果：每个用例的执行状态
- 失败分析：失败用例的原因分析

### 6.2 报告存储

- 报告存储在 `test/reports/` 目录
- 文件名格式：`report_{时间戳}.md`
- JSON原始数据：`report_{时间戳}.json`

### 6.3 持续集成

建议配置 CI 流程：
1. 每次代码提交触发测试
2. 测试失败阻止合并
3. 测试通过生成报告
4. 报告发送到相关人员