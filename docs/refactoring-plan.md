# 运维工单平台重构方案

## 一、项目现状分析

### 1.1 代码规模统计

| 模块 | 文件 | 行数 | 问题 |
|------|------|------|------|
| 前端 | app.js | 15,588 | 单文件过大，无模块化 |
| 前端 | styles.css | 7,639 | 单文件过大 |
| 后端 | routers/tickets.py | 1,163 | 单文件过大 |
| 后端 | routers/ai.py | 792 | 较大 |
| 后端 | routers/params.py | 610 | 较大 |
| 后端 | routers/upload.py | 579 | 较大 |
| 后端 | routers/requirement.py | 557 | 较大 |
| 后端 | routers/skill.py | 521 | 较大 |
| 后端 | routers/duty.py | 438 | 中等 |
| 后端 | routers/leave.py | 370 | 中等 |

### 1.2 主要问题

**前端问题：**
1. **单文件巨石** - 15,588 行代码全部在一个 app.js 中
2. **无模块化** - 无 ES6 模块、无组件化
3. **全局状态混乱** - 大量全局变量和函数
4. **无构建流程** - 无打包、压缩、代码分割
5. **样式耦合** - CSS 单文件 7,639 行

**后端问题：**
1. **路由文件过大** - tickets.py 1163 行，职责过多
2. **缺少服务层** - 业务逻辑直接写在路由中
3. **缺少 Repository 层** - SQL 散落在各处
4. **缺少依赖注入** - 数据库连接直接导入使用
5. **缺少统一错误处理** - 异常处理分散

**架构问题：**
1. 缺少清晰的分层架构
2. 缺少领域模型抽象
3. 缺少接口抽象和依赖反转
4. 测试覆盖不足

---

## 二、重构原则

1. **小步前进** - 每个步骤独立可测试，可随时停止
2. **向后兼容** - 不破坏现有 API 和功能
3. **测试先行** - 每步重构前确保测试通过
4. **渐进增强** - 逐步引入新架构，不一次性重写

---

## 三、重构步骤分解（共 35 个独立步骤）

### 阶段一：基础设施准备（步骤 1-5）

#### 步骤 1：建立测试基线
- 运行现有测试，确保全部通过
- 记录测试覆盖率
- 识别关键业务路径的测试缺口

#### 步骤 2：添加后端类型注解
- 为 `models/` 目录下所有 Pydantic 模型添加完整类型注解
- 为 `utils/` 目录下所有函数添加类型注解
- 添加 mypy 配置文件
- 运行 mypy 检查，逐步修复类型错误

#### 步骤 3：统一后端错误处理
- 创建 `backend/exceptions.py`，定义业务异常类
- 创建 `backend/middleware/error_handler.py`，统一异常处理中间件
- 在 `app.py` 中注册中间件
- 逐步替换各路由中的 HTTPException

#### 步骤 4：添加日志系统
- 创建 `backend/logger.py`，配置结构化日志
- 在关键业务节点添加日志记录
- 统一日志格式和级别

#### 步骤 5：创建后端配置管理
- 创建 `backend/settings.py`，使用 pydantic-settings 管理配置
- 将环境变量读取集中到 settings
- 添加配置验证

---

### 阶段二：后端分层重构（步骤 6-15）

#### 步骤 6：创建 Repository 层基类
- 创建 `backend/repositories/__init__.py`
- 创建 `backend/repositories/base.py`，定义基础 Repository 抽象类
- 定义数据库连接接口

#### 步骤 7：提取工单 Repository
- 创建 `backend/repositories/ticket_repository.py`
- 将 `routers/tickets.py` 中的 SQL 查询迁移到 Repository
- 保持路由不变，仅内部调用 Repository

#### 步骤 8：提取用户 Repository
- 创建 `backend/repositories/user_repository.py`
- 迁移用户相关 SQL

#### 步骤 9：提取值班 Repository
- 创建 `backend/repositories/duty_repository.py`
- 迁移值班相关 SQL

#### 步骤 10：提取权限 Repository
- 创建 `backend/repositories/permission_repository.py`
- 迁移权限相关 SQL

#### 步骤 11：提取需求 Repository
- 创建 `backend/repositories/requirement_repository.py`
- 迁移需求相关 SQL

#### 步骤 12：提取 AI Repository
- 创建 `backend/repositories/ai_repository.py`
- 迁移 AI 相关 SQL

#### 步骤 13：创建 Service 层
- 创建 `backend/services/__init__.py`
- 创建 `backend/services/ticket_service.py`
- 将业务逻辑从 Repository 和 Router 中提取到 Service

#### 步骤 14：拆分 tickets.py 路由
- 创建 `backend/routers/tickets_schema.py`，提取 schema 相关路由
- 创建 `backend/routers/tickets_flow.py`，提取流转相关路由
- 创建 `backend/routers/tickets_list.py`，提取列表相关路由
- 原 `tickets.py` 保留为入口，导入并注册子路由

#### 步骤 15：引入依赖注入
- 创建 `backend/dependencies.py`
- 定义 Repository 和 Service 的依赖注入函数
- 更新路由使用依赖注入

---

### 阶段三：前端模块化（步骤 16-25）

#### 步骤 16：创建前端构建配置
- 添加 `package.json`
- 配置 Vite 构建工具
- 配置开发服务器代理
- 保持原有开发方式可用（渐进迁移）

#### 步骤 17：提取前端常量模块
- 创建 `frontend/js/constants.js`
- 迁移所有常量定义（NODE_KEY_BY_STEP、HANDLE_MODE_ROUTE 等）
- app.js 导入使用

#### 步骤 18：提取前端工具函数模块
- 创建 `frontend/js/utils/`
- 创建 `frontend/js/utils/dom.js` - DOM 操作工具
- 创建 `frontend/js/utils/format.js` - 格式化工具
- 创建 `frontend/js/utils/api.js` - API 请求封装
- 创建 `frontend/js/utils/storage.js` - localStorage 封装

#### 步骤 19：提取前端状态管理模块
- 创建 `frontend/js/store/`
- 创建 `frontend/js/store/state.js` - 全局状态
- 创建 `frontend/js/store/actions.js` - 状态操作
- 创建 `frontend/js/store/subscribers.js` - 状态订阅

#### 步骤 20：提取前端路由模块
- 创建 `frontend/js/router/`
- 创建 `frontend/js/router/index.js` - 路由核心
- 创建 `frontend/js/router/routes.js` - 路由配置
- 创建 `frontend/js/router/guards.js` - 路由守卫

#### 步骤 21：提取前端组件 - 基础组件
- 创建 `frontend/js/components/base/`
- 创建 `frontend/js/components/base/Button.js`
- 创建 `frontend/js/components/base/Modal.js`
- 创建 `frontend/js/components/base/Table.js`
- 创建 `frontend/js/components/base/Form.js`
- 创建 `frontend/js/components/base/Tabs.js`

#### 步骤 22：提取前端组件 - 业务组件
- 创建 `frontend/js/components/ticket/`
- 创建 `frontend/js/components/ticket/TicketList.js`
- 创建 `frontend/js/components/ticket/TicketDetail.js`
- 创建 `frontend/js/components/ticket/TicketForm.js`
- 创建 `frontend/js/components/ticket/NodeFlow.js`

#### 步骤 23：提取前端组件 - 管理组件
- 创建 `frontend/js/components/admin/`
- 创建 `frontend/js/components/admin/UserManager.js`
- 创建 `frontend/js/components/admin/PermissionManager.js`
- 创建 `frontend/js/components/admin/DutyManager.js`

#### 步骤 24：提取前端页面模块
- 创建 `frontend/js/pages/`
- 创建 `frontend/js/pages/home.js`
- 创建 `frontend/js/pages/workbench.js`
- 创建 `frontend/js/pages/ticket-detail.js`
- 创建 `frontend/js/pages/admin-users.js`
- 创建 `frontend/js/pages/admin-permissions.js`
- 创建 `frontend/js/pages/duty.js`
- 创建 `frontend/js/pages/leave.js`
- 创建 `frontend/js/pages/requirements.js`
- 创建 `frontend/js/pages/ai-assistant.js`
- 创建 `frontend/js/pages/stats.js`

#### 步骤 25：拆分 CSS 样式文件
- 创建 `frontend/styles/` 目录
- 创建 `frontend/styles/base.css` - 基础样式
- 创建 `frontend/styles/components.css` - 组件样式
- 创建 `frontend/styles/pages.css` - 页面样式
- 创建 `frontend/styles/themes.css` - 主题样式
- 创建主入口 `frontend/styles/main.css` 导入所有样式

---

### 阶段四：架构优化（步骤 26-30）

#### 步骤 26：添加后端缓存层
- 创建 `backend/cache/__init__.py`
- 创建 `backend/cache/redis_cache.py` - Redis 缓存实现
- 创建 `backend/cache/memory_cache.py` - 内存缓存实现
- 为热点数据添加缓存（如 schema、选项集）

#### 步骤 27：优化数据库连接池
- 创建 `backend/database.py` 连接池配置
- 添加连接池监控
- 配置合理的连接池参数

#### 步骤 28：添加 API 文档
- 配置 FastAPI 自动文档
- 添加 API 响应模型
- 添加 API 示例

#### 步骤 29：添加前端类型检查
- 添加 JSDoc 类型注解
- 配置 TypeScript 检查（可选，渐进式）
- 添加类型声明文件

#### 步骤 30：性能优化
- 前端代码分割
- 路由懒加载
- 图片资源优化
- API 响应压缩

---

### 阶段五：测试与文档（步骤 31-35）

#### 步骤 31：补充后端单元测试
- 为每个 Repository 添加测试
- 为每个 Service 添加测试
- 使用 pytest fixtures 管理测试数据

#### 步骤 32：添加后端集成测试
- 添加 API 端到端测试
- 添加数据库事务测试
- 添加并发测试

#### 步骤 33：添加前端单元测试
- 配置 Vitest 测试框架
- 为工具函数添加测试
- 为组件添加测试

#### 步骤 34：更新项目文档
- 更新 README.md
- 添加架构设计文档
- 添加开发指南
- 添加部署指南

#### 步骤 35：清理与优化
- 删除废弃代码
- 统一代码风格
- 添加代码规范配置（ESLint、Prettier、Black、isort）
- 最终测试验证

---

## 四、重构优先级建议

| 优先级 | 步骤 | 理由 |
|--------|------|------|
| P0 | 1, 2, 3 | 建立测试基线、类型安全、错误处理是基础 |
| P1 | 6, 7, 13, 14 | 后端核心模块分层，降低 tickets.py 复杂度 |
| P1 | 16, 17, 18 | 前端模块化基础，为后续拆分做准备 |
| P2 | 8-12, 15 | 后端完整分层 |
| P2 | 19-25 | 前端完整模块化 |
| P3 | 26-30 | 性能优化 |
| P3 | 31-35 | 测试与文档 |

---

## 五、风险控制

1. **每个步骤独立提交** - 便于回滚
2. **保持 API 兼容** - 不修改接口签名
3. **增量测试** - 每步完成后运行测试
4. **渐进迁移** - 新旧代码可并存

---

## 六、预期收益

| 方面 | 当前 | 重构后 |
|------|------|--------|
| 前端单文件行数 | 15,588 | < 500/文件 |
| 后端单文件行数 | 1,163 | < 300/文件 |
| 代码复用性 | 低 | 高 |
| 可测试性 | 低 | 高 |
| 可维护性 | 低 | 高 |
| 新人上手难度 | 高 | 低 |

---

## 七、重构后目录结构预览

```
database-o-m-system/
├── backend/
│   ├── app.py                    # FastAPI 应用入口
│   ├── config.py                 # 配置常量
│   ├── settings.py               # 配置管理（新增）
│   ├── database.py               # 数据库连接
│   ├── exceptions.py             # 业务异常（新增）
│   ├── logger.py                 # 日志配置（新增）
│   ├── dependencies.py           # 依赖注入（新增）
│   ├── middleware/                # 中间件（新增）
│   │   └── error_handler.py
│   ├── models/                   # Pydantic 模型
│   ├── repositories/             # 数据访问层（新增）
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── ticket_repository.py
│   │   ├── user_repository.py
│   │   ├── duty_repository.py
│   │   ├── permission_repository.py
│   │   ├── requirement_repository.py
│   │   └── ai_repository.py
│   ├── services/                  # 业务逻辑层（新增）
│   │   ├── __init__.py
│   │   └── ticket_service.py
│   ├── routers/                   # 路由层
│   │   ├── tickets.py            # 工单路由入口
│   │   ├── tickets_schema.py     # schema 路由（新增）
│   │   ├── tickets_flow.py       # 流转路由（新增）
│   │   ├── tickets_list.py       # 列表路由（新增）
│   │   └── ...
│   ├── cache/                     # 缓存层（新增）
│   │   ├── __init__.py
│   │   ├── redis_cache.py
│   │   └── memory_cache.py
│   └── utils/                     # 工具函数
├── frontend/
│   ├── index.html
│   ├── js/                        # JS 模块（新增目录结构）
│   │   ├── app.js                # 应用入口
│   │   ├── constants.js          # 常量
│   │   ├── utils/                # 工具函数
│   │   │   ├── dom.js
│   │   │   ├── format.js
│   │   │   ├── api.js
│   │   │   └── storage.js
│   │   ├── store/                # 状态管理
│   │   │   ├── state.js
│   │   │   ├── actions.js
│   │   │   └── subscribers.js
│   │   ├── router/               # 路由
│   │   │   ├── index.js
│   │   │   ├── routes.js
│   │   │   └── guards.js
│   │   ├── components/           # 组件
│   │   │   ├── base/
│   │   │   ├── ticket/
│   │   │   └── admin/
│   │   └── pages/                # 页面
│   │       ├── home.js
│   │       ├── workbench.js
│   │       └── ...
│   ├── styles/                    # 样式模块（新增）
│   │   ├── main.css
│   │   ├── base.css
│   │   ├── components.css
│   │   ├── pages.css
│   │   └── themes.css
│   └── assets/
├── test/
├── docs/
│   ├── refactoring-plan.md       # 本文档
│   ├── architecture.md           # 架构设计（待创建）
│   └── development-guide.md      # 开发指南（待创建）
└── README.md
```

---

## 八、执行记录

| 步骤 | 状态 | 完成日期 | 备注 |
|------|------|----------|------|
| 1 | 待开始 | - | - |
| 2 | 待开始 | - | - |
| ... | ... | ... | ... |

---

*文档创建日期：2026-04-30*