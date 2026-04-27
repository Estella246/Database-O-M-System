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

- 内核/管控值班日历
- 轮值表管理
- 专项轮值（慢SQL、性能、升级、扩容、备份、容灾）
- 请假申请与审批

### 6. 数据统计与导出

- 工单列表多维度筛选
- SLA 时间计算
- 数据导出功能

### 7. UI 主题

- 浅色/深色/护眼/粉色/蓝紫五套主题
- 支持自定义背景图
- 预设背景皮肤

---

## 技术架构

### 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端 | 原生 JavaScript (ES6+)、CSS3、ECharts |
| 后端 | Python 3.x、FastAPI |
| 数据库 | PostgreSQL / GaussDB |
| 驱动 | psycopg[binary] |

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
```

---

## 安装部署指南

### 环境要求

- Python 3.8+
- PostgreSQL 12+ 或 GaussDB
- 现代浏览器（仅支持 Chromium 内核：Chrome/Edge）

### 数据库初始化

**方式一：使用迁移脚本（推荐）**

```bash
# 按顺序执行迁移脚本
psql -d yunwei_ticket -f db/migrations/0001_init_workflow_schema.sql
psql -d yunwei_ticket -f db/migrations/0002_seed_all_node_fields_from_xlsx.sql
# ... 继续执行后续迁移脚本
```

**方式二：使用完整初始化脚本**

```bash
# PostgreSQL
psql -d yunwei_ticket -f db/postgres/postgres_full_init.sql

# GaussDB
psql -d yunwei_ticket -f db/gaussdb/gaussdb_full_init.sql
```

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
python -m uvicorn app:app --host 0.0.0.0 --port 8000
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

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DATABASE_URL` | 数据库连接串 | `postgresql://estella@localhost:5432/yunwei_ticket` |
| `SERVE_FRONTEND` | 是否托管前端 | `1`（托管） |

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
| 工作台 | `/workbench` | 工单列表、创建、导出 |
| 工单详情 | `/tickets/:id` | 工单流程详情与操作 |
| 值班表 | `/duty` | 值班日历、轮值表管理 |
| 请假申请 | `/leave` | 请假申请与审批 |
| 用户管理 | `/admin/users` | 用户账户管理 |
| 权限策略 | `/admin/permissions` | 角色权限配置 |
| 统计图表 | `/stats` | 数据统计分析 |
| 参数配置 | `/params` | 责任田、版本、拉群模板配置 |

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
│   │   ├── db-postgres-sql-sync.mdc      # SQL 迁移规则
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
│   ├── app.py                    # FastAPI 应用主文件
│   ├── requirements.txt          # Python 依赖
│   └── README.md                 # 后端说明
├── db/                           # 数据库脚本
│   ├── gaussdb/                  # GaussDB 专用
│   │   └── gaussdb_full_init.sql
│   ├── migrations/               # 迁移脚本（按序执行）
│   │   ├── 0001_init_workflow_schema.sql
│   │   ├── 0002_seed_all_node_fields_from_xlsx.sql
│   │   ├── 0010_add_rbac_tables.sql
│   │   └── ...                   # 更多迁移脚本
│   └── postgres/                 # PostgreSQL 专用
│       ├── postgres_full_init.sql
│       ├── postgres_seed_data.sql
│       └── postgres_sync_changelog.sql
├── docs/                         # 项目文档
│   ├── AI驱动全栈项目开发复盘-规则与技能体系.md
│   └── 运维工单系统-实现与后续.md
├── frontend/                     # 前端代码
│   ├── app.js                    # 应用主逻辑
│   ├── index.html                # 入口页面
│   ├── styles.css                # 样式文件
│   ├── devserver.py              # 开发服务器
│   ├── serve_spa.py              # SPA 服务器
│   └── assets/                   # 静态资源
│       └── skin-presets/         # 皮肤预设
├── README.md                     # 本文档
├── test/                         # 功能测试
│   ├── test_plan.md              # 测试方案文档
│   ├── conftest.py               # pytest全局配置
│   ├── run_tests.py              # 测试执行入口与报告生成
│   ├── test_data/                # 测试数据
│   ├── reports/                  # 测试报告输出
│   ├── test_m01_health.py        # 健康检查测试
│   ├── test_m02_ticket.py        # 工单流程测试
│   ├── test_m03_permission.py    # 权限管理测试
│   ├── test_m04_user.py          # 用户管理测试
│   ├── test_m05_duty.py          # 值班管理测试
│   ├── test_m06_leave.py         # 请假管理测试
│   ├── test_m07_params.py        # 参数配置测试
│   ├── test_m08_stats.py         # 个人统计测试
│   └── test_m09_spa.py           # 前端SPA测试
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
| `db-postgres-sql-sync.mdc` | 数据库 | SQL 迁移追加规则 |
| `frontend-theme-readability.mdc` | 前端 | 主题可读性约束 |

### 技能体系（Skills）

复杂任务通过 Skill 编排执行链路：

- `workflow-node-visibility`：工单详情页节点可见性控制

### 数据库迁移规范

1. 新增 SQL 必须写入 `db/migrations/`
2. 文件命名：`NNNN_description.sql`
3. 采用 append-only，不修改已执行的历史迁移
4. 执行后须验证通过

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

#### 获取工单列表

```
GET /api/tickets
```

**查询参数**：
- `status`: 工单状态（open/closed）
- `handler_id`: 处理人ID
- `creator_id`: 创建人ID

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
2. 确认用户角色与 is_pl 标识正确
3. 清除浏览器缓存重新登录

### Q6: 人员字段显示格式不一致？

**A**: 系统统一使用「姓名 账号」格式，后端会自动规范化历史数据。如仍有问题，检查 `next_handler`、`collaborator`、`hcs_owner` 等字段的存储格式。

---

## 功能测试

项目在 `test/` 目录下提供完整的功能测试方案与自动化测试程序，覆盖全部9个功能模块共106个测试用例。

### 测试模块覆盖

| 模块 | 测试文件 | 用例数 | 覆盖内容 |
|------|----------|--------|----------|
| M01 健康检查 | `test_m01_health.py` | 2 | 服务可用性 |
| M02 工单流程 | `test_m02_ticket.py` | 30 | Schema/创建/提交/流转/列表/详情/日志 |
| M03 权限管理 | `test_m03_permission.py` | 5 | 策略CRUD/有效权限 |
| M04 用户管理 | `test_m04_user.py` | 4 | 用户CRUD/upsert |
| M05 值班管理 | `test_m05_duty.py` | 16 | 日历/轮值/局点/RL |
| M06 请假管理 | `test_m06_leave.py` | 22 | 白名单/申请/审批全流程 |
| M07 参数配置 | `test_m07_params.py` | 19 | 责任田/基线/热补丁/拉群模板 |
| M08 个人统计 | `test_m08_stats.py` | 4 | 工作量/SLA/直通率 |
| M09 前端SPA | `test_m09_spa.py` | 4 | 静态文件/深链/路径遍历 |

### 运行测试

```bash
# 安装测试依赖
pip install pytest pytest-json-report httpx

# 确保后端服务已启动
python -m uvicorn app:app --host 0.0.0.0 --port 8000

# 执行全部测试
cd test
python run_tests.py

# 执行指定模块
python run_tests.py --module m02

# 生成测试报告
python run_tests.py --report
```

测试报告输出至 `test/reports/` 目录，包含 Markdown 和 JSON 两种格式。

详细测试方案见 [test/test_plan.md](test/test_plan.md)。

---

## CHANGELOG

### v0.2.0 (当前版本)

**新增功能**
- 完整的工单流程管理（7节点）
- RBAC 权限管理系统
- 值班日历与轮值表管理
- 请假申请功能
- 多主题支持（5套主题 + 自定义背景）
- 工单列表多维度筛选与排序
- SLA 时间计算
- 数据导出功能

**技术改进**
- 规则驱动开发体系
- Skill 技能编排框架
- 数据库迁移体系
- 前后端分离架构

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
