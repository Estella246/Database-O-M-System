# 运维工单平台 — 功能测试方案

---

## 1. 测试范围界定

### 1.1 功能模块总览

| 模块编号 | 模块名称 | 子模块 | 关键功能点 |
|----------|----------|--------|------------|
| M01 | 健康检查 | — | 服务可用性检测 |
| M02 | 工单流程管理 | M02.1 节点Schema | 7个节点Schema获取、字段定义、选项集加载 |
| | | M02.2 工单创建 | 工单号分配（YW+日期+序号）、并发防重号 |
| | | M02.3 节点数据提交 | 字段校验、必填/可选逻辑、可见性规则、默认值填充、人员字段规范化 |
| | | M02.4 流转动作 | 提交下一节点、跳转提交、回退、挂起/恢复、关闭 |
| | | M02.5 工单列表 | 列表查询、多维度筛选（待处理/全局/我创建）、权限过滤 |
| | | M02.6 工单详情 | 节点数据读取、字段继承、权限控制 |
| | | M02.7 流转日志 | 操作日志记录与查询 |
| | | M02.8 调试状态 | 工单当前状态查询 |
| M03 | 权限管理（RBAC） | M03.1 权限策略查询 | 获取全部权限策略 |
| | | M03.2 权限策略更新 | 批量upsert、级联约束、白名单配置 |
| | | M03.3 权限策略删除 | 按主键删除 |
| | | M03.4 有效权限查询 | 根据用户获取生效权限标志 |
| M04 | 用户管理 | M04.1 用户列表 | 获取全部用户 |
| | | M04.2 用户批量更新 | upsert用户、字段校验 |
| | | M04.3 用户删除 | 按账号删除 |
| M05 | 值班管理 | M05.1 值班日历 | 按月读取内核/管控日历、替换排班 |
| | | M05.2 轮值表 | 读取/替换全部轮值表（8种kind） |
| | | M05.3 局点值班 | 读取/替换局点值班表 |
| | | M05.4 RL值班 | 读取/替换RL值班表 |
| M06 | 请假管理 | M06.1 审批白名单 | 读取/配置审批人白名单 |
| | | M06.2 请假申请创建 | 申请编号分配、时间段校验、审批人白名单校验 |
| | | M06.3 请假申请列表 | 按scope筛选（all/todo/pending_approval）、关键字搜索 |
| | | M06.4 请假申请详情 | 获取申请详情含时间段、日志、抄送人 |
| | | M06.5 请假审批操作 | 同意/拒绝/取消、状态流转、权限校验 |
| M07 | 参数配置 | M07.1 责任田模块 | 责任田多级分类树读取/整树替换 |
| | | M07.2 基线版本 | CRUD基线版本、搜索 |
| | | M07.3 热补丁版本 | CRUD热补丁版本、基线引用校验 |
| | | M07.4 拉群模板 | 读取/替换四种问题类型模板 |
| M08 | 个人统计 | M08.1 工作量统计 | 按日期范围统计提交次数 |
| | | M08.2 SLA统计 | 各阶段平均处理时长 |
| | | M08.3 直通率统计 | 独立闭环/突击队计数、质量范围筛选 |
| M09 | 前端SPA | M09.1 静态文件托管 | index.html、assets资源 |
| | | M09.2 SPA路由回退 | 深链刷新不404 |

### 1.2 不在测试范围内

- 性能测试（并发、压力、响应时间）
- 安全性测试（SQL注入、XSS、CSRF、认证绕过）
- 前端UI视觉测试
- 浏览器兼容性测试
- 数据库底层故障恢复测试

---

## 2. 测试环境要求

### 2.1 硬件配置

| 项目 | 最低要求 |
|------|----------|
| CPU | 2核 |
| 内存 | 4GB |
| 磁盘 | 10GB可用空间 |

### 2.2 软件环境

| 软件 | 版本要求 | 用途 |
|------|----------|------|
| Python | 3.8+ | 后端运行时 |
| PostgreSQL | 12+ | 数据库 |
| pip | 最新版 | 依赖安装 |
| Chromium内核浏览器 | Chrome/Edge最新版 | 前端验证（可选） |

### 2.3 依赖项

```
fastapi
uvicorn
psycopg[binary]
python-dotenv
pytest
httpx
```

### 2.4 环境变量

| 变量名 | 说明 | 测试环境推荐值 |
|--------|------|----------------|
| `DATABASE_URL` | 数据库连接串 | `postgresql://postgres:123@localhost:5432/yunwei_ticket_test` |
| `SERVE_FRONTEND` | 是否托管前端 | `1` |

### 2.5 数据库准备

1. 创建测试专用数据库：`yunwei_ticket_test`
2. 按顺序执行迁移脚本初始化表结构
3. 执行种子数据脚本填充基础数据
4. 测试完成后可清理测试数据库

---

## 3. 测试用例设计

### 3.1 M01 健康检查

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M01-001 | 验证健康检查接口正常返回 | 无 | GET /health | HTTP 200, `{"status": "ok"}` |
| TC-M01-002 | 验证数据库不可用时健康检查失败 | 断开数据库 | GET /health | HTTP 500 或连接错误 |

### 3.2 M02 工单流程管理

#### M02.1 节点Schema

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-001 | 获取问题填写节点Schema | node_key=problem_fill | GET /api/nodes/problem_fill/schema | 200, fields非空，包含start_date等字段 |
| TC-M02-002 | 获取问题审核节点Schema | node_key=problem_review | GET /api/nodes/problem_review/schema | 200, fields包含handle_mode等 |
| TC-M02-003 | 获取运维分析节点Schema | node_key=ops_analysis | GET /api/nodes/ops_analysis/schema | 200, fields非空 |
| TC-M02-004 | 获取开发分析节点Schema | node_key=dev_analysis | GET /api/nodes/dev_analysis/schema | 200, fields非空 |
| TC-M02-005 | 获取开发闭环节点Schema | node_key=dev_closure | GET /api/nodes/dev_closure/schema | 200, fields非空 |
| TC-M02-006 | 获取运维闭环节点Schema | node_key=ops_closure | GET /api/nodes/ops_closure/schema | 200, fields非空 |
| TC-M02-007 | 获取审核关闭节点Schema | node_key=audit_close | GET /api/nodes/audit_close/schema | 200, fields非空 |
| TC-M02-008 | 获取不存在的节点Schema | node_key=nonexistent | GET /api/nodes/nonexistent/schema | 404, Schema not found |
| TC-M02-009 | 验证Schema字段包含选项集 | node_key=problem_fill | GET /api/nodes/problem_fill/schema | whitelist类型字段含options数组 |
| TC-M02-010 | 验证next_handler白名单映射 | node_key=problem_review | GET /api/nodes/problem_review/schema | next_handler字段constraints含next_handler_by_handle_mode |

#### M02.2 工单创建与编号

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-011 | 自动分配工单编号 | ticket_id为空或非YW格式 | POST /api/tickets/{ticket_id}/nodes/problem_fill/submit | 返回的ticket_id符合YW+YYYYMMDD+nnn格式 |
| TC-M02-012 | 使用指定工单编号 | ticket_id=YW20260427001 | POST提交 | 返回ticket_id为YW20260427001 |
| TC-M02-013 | 工单编号格式校验 | ticket_id=YW20260427001 | 验证返回的ticket_no | 匹配正则 ^YW[0-9]{11}$ |
| TC-M02-014 | 当日序号递增 | 连续创建2个工单 | 两次POST提交 | 第二个序号大于第一个 |

#### M02.3 节点数据提交

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-015 | 问题填写节点正常提交 | 完整必填字段values | POST submit | 200, ok=true |
| TC-M02-016 | 必填字段缺失 | 缺少start_date | POST submit | 400, Validation failed |
| TC-M02-017 | 日期格式校验 | start_date=invalid | POST submit | 400, must be YYYY-MM-DD |
| TC-M02-018 | 白名单字段值校验 | location=不存在的值 | POST submit | 400, must be one of |
| TC-M02-019 | 人员字段规范化（账号 姓名→姓名 账号） | next_handler="zhangsan 张三" | POST submit | 存储为"张三 zhangsan" |
| TC-M02-020 | 默认值填充（today类型） | 不传start_date但字段default_type=today | POST submit | 自动填充当天日期 |
| TC-M02-021 | 字段可见性规则 | handle_mode=问题解决关闭 | POST submit | next_handler字段不可见，不校验 |
| TC-M02-022 | optional_when_all规则 | 满足optional条件 | POST submit | 原必填字段变为可选 |
| TC-M02-023 | required_if规则 | 满足required_if条件 | POST submit | 原可选字段变为必填 |
| TC-M02-024 | 未知字段拒绝 | values含schema外字段 | POST submit | 400, unknown fields |
| TC-M02-025 | 问题审核节点提交-确认问题 | handle_mode=确认问题 | POST submit | 流转至ops_analysis |
| TC-M02-026 | 问题审核节点提交-非问题关闭 | handle_mode=非问题关闭 | POST submit | 工单状态不变 |
| TC-M02-027 | 运维分析提交开发分析 | handle_mode=提交开发分析 | POST submit | 流转至dev_analysis |
| TC-M02-028 | 运维分析提交运维闭环 | handle_mode=提交运维闭环 | POST submit | 流转至ops_closure |
| TC-M02-029 | 开发分析返回运维分析 | handle_mode=返回运维分析 | POST submit | 流转至ops_analysis |
| TC-M02-030 | 审核关闭-问题解决关闭 | handle_mode=问题解决关闭 | POST submit | 工单status变为closed |

#### M02.5 工单列表

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-031 | 获取工单列表 | 无筛选 | GET /api/tickets | 200, items为数组 |
| TC-M02-032 | 按处理人筛选 | handler_id=demo_001 | GET /api/tickets?operator_id=demo_001 | 返回含当前处理人字段 |
| TC-M02-033 | 权限过滤-仅看自己创建 | 权限标志ticket_list_only_self_created=true | GET /api/tickets | 仅返回creator_id=当前用户的工单 |
| TC-M02-034 | 基础工单列表 | 无 | GET /api/tickets/basic | 200, items含order_id等字段 |
| TC-M02-035 | 列表字段快照正确性 | 有多条节点数据的工单 | GET /api/tickets | 字段取最后出现的节点值 |

#### M02.6 工单详情

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-036 | 获取节点数据 | 已提交的工单 | GET /api/tickets/{no}/nodes/problem_fill/data | 200, values含已提交字段 |
| TC-M02-037 | 字段继承-从上游节点继承 | 上游节点有值，当前节点无值 | GET data | 继承上游节点的inherit_previous字段值 |
| TC-M02-038 | 字段继承-已有值不覆写 | 当前节点已有值 | GET data | 保留当前节点值，不继承 |
| TC-M02-039 | 权限控制-仅看问题填写 | 权限标志ticket_detail_only_problem_fill=true | GET 非problem_fill节点数据 | 403 |
| TC-M02-040 | 人员字段读取规范化 | 存储为"账号 姓名" | GET data | 返回"姓名 账号"格式 |

#### M02.7 流转日志

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-041 | 获取工单流转日志 | 有提交记录的工单 | GET /api/tickets/{no}/logs | 200, items含at/actor/action/from/to |
| TC-M02-042 | 无流转日志的工单 | 新创建无提交的工单 | GET /api/tickets/{no}/logs | 200, items为空数组 |

#### M02.8 调试状态

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M02-043 | 获取工单调试状态 | 存在的工单号 | GET /api/tickets/{no}/debug-status | 200, 含current_node_key/status等 |
| TC-M02-044 | 不存在的工单 | 不存在的工单号 | GET /api/tickets/{no}/debug-status | 404 |

### 3.3 M03 权限管理

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M03-001 | 获取权限策略列表 | 无 | GET /api/admin/permissions | 200, items数组 |
| TC-M03-002 | 批量更新权限策略 | 有效策略项 | POST /api/admin/permissions/bulk | 200, ok=true |
| TC-M03-003 | 无效permission_level | permission_level=invalid | POST bulk | 400, invalid permission_level |
| TC-M03-004 | 删除权限策略 | 有效主键 | DELETE /api/admin/permissions | 200, ok=true |
| TC-M03-005 | 获取有效权限 | operator_id=demo_001 | GET /api/permissions/effective | 200, 含flags对象 |

### 3.4 M04 用户管理

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M04-001 | 获取用户列表 | 无 | GET /api/admin/users | 200, items数组 |
| TC-M04-002 | 批量更新用户 | 有效用户项 | POST /api/admin/users/bulk | 200, ok=true |
| TC-M04-003 | 用户upsert-已存在账号 | 同account不同user_name | POST bulk | 更新user_name |
| TC-M04-004 | 删除用户 | account=test_user | DELETE /api/admin/users?account=test_user | 200, ok=true |

### 3.5 M05 值班管理

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M05-001 | 获取值班日历 | year=2026, month=4 | GET /api/duty/calendar?year=2026&month=4 | 200, 含kernel/control |
| TC-M05-002 | 替换值班日历-内核 | kind=kernel, 有效days | PUT /api/duty/calendar | 200, ok=true |
| TC-M05-003 | 替换值班日历-无效kind | kind=invalid | PUT /api/duty/calendar | 400, kind须为kernel或control |
| TC-M05-004 | 非管理员替换日历 | operator_id=非管理员 | PUT /api/duty/calendar | 403 |
| TC-M05-005 | 日期键不属于当月 | days含非当月日期 | PUT /api/duty/calendar | 400, 日期键须属于当月 |
| TC-M05-006 | 获取轮值表 | 无 | GET /api/duty/rotation | 200, 含8种kind |
| TC-M05-007 | 替换轮值表 | 有效lists | PUT /api/duty/rotation | 200, ok=true |
| TC-M05-008 | 轮值表-未知kind | lists含未知kind | PUT /api/duty/rotation | 400, 未知roster_kind |
| TC-M05-009 | 轮值表-空account | items含空account | PUT /api/duty/rotation | 400, 空的account |
| TC-M05-010 | 获取局点值班表 | 无 | GET /api/duty/site-oncall | 200, rows数组 |
| TC-M05-011 | 替换局点值班表 | 有效rows | PUT /api/duty/site-oncall | 200, ok=true |
| TC-M05-012 | 局点值班-缺少site_name | rows缺site_name | PUT /api/duty/site-oncall | 400 |
| TC-M05-013 | 获取RL值班表 | 无 | GET /api/duty/rl-oncall | 200, rows数组 |
| TC-M05-014 | 替换RL值班表 | 有效rows | PUT /api/duty/rl-oncall | 200, ok=true |
| TC-M05-015 | RL值班-重复日期 | 两条同日数据 | PUT /api/duty/rl-oncall | 400, 重复日期 |
| TC-M05-016 | RL值班-主值班缺phone | primary缺phone | PUT /api/duty/rl-oncall | 400 |

### 3.6 M06 请假管理

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M06-001 | 获取审批白名单 | 无 | GET /api/leave/approver-whitelist | 200, items数组 |
| TC-M06-002 | 替换审批白名单 | 有效accounts | PUT /api/leave/approver-whitelist | 200, ok=true |
| TC-M06-003 | 白名单-账号不在用户表 | accounts含不存在账号 | PUT /api/leave/approver-whitelist | 400, 账号不在用户表 |
| TC-M06-004 | 创建请假申请 | 有效segments+审批人 | POST /api/leave/applications | 200, ok=true, 含application_no |
| TC-M06-005 | 申请编号格式 | 创建成功后 | 检查application_no | QJ+YYYYMMDD+nnn格式 |
| TC-M06-006 | 审批人不在白名单 | approver不在白名单 | POST /api/leave/applications | 400, 审批人须在白名单内 |
| TC-M06-007 | 申请类型无效 | application_type=无效 | POST /api/leave/applications | 400, 申请类型无效 |
| TC-M06-008 | 时间段为空 | segments=[] | POST /api/leave/applications | 400, 至少填写一条时间段 |
| TC-M06-009 | 结束时间早于开始时间 | end_at < start_at | POST /api/leave/applications | 400, 结束时间须晚于开始时间 |
| TC-M06-010 | 获取请假申请列表-全部 | scope=all | GET /api/leave/applications?scope=all | 200, items数组 |
| TC-M06-011 | 获取请假申请列表-待办 | scope=todo | GET /api/leave/applications?scope=todo | 仅返回当前处理人为自己的审批中申请 |
| TC-M06-012 | 获取请假申请列表-待审批 | scope=pending_approval | GET /api/leave/applications?scope=pending_approval | 返回待我审批或本人发起未结案的申请 |
| TC-M06-013 | 列表关键字搜索 | q=关键字 | GET /api/leave/applications?q=关键字 | 匹配结果 |
| TC-M06-014 | 获取请假申请详情 | 有效app_id | GET /api/leave/applications/{id} | 200, 含application/segments/logs |
| TC-M06-015 | 详情-不存在的申请 | app_id=999999 | GET /api/leave/applications/999999 | 404 |
| TC-M06-016 | 审批-同意 | action=agree | POST /api/leave/applications/{id}/action | 200, status=同意申请 |
| TC-M06-017 | 审批-拒绝 | action=reject, comment=原因 | POST action | 200, status=拒绝申请 |
| TC-M06-018 | 审批-拒绝无意见 | action=reject, comment="" | POST action | 400, 拒绝时须填写审批意见 |
| TC-M06-019 | 审批-取消 | action=cancel | POST action | 200, status=已取消 |
| TC-M06-020 | 审批-无效action | action=invalid | POST action | 400, action须为agree/reject/cancel |
| TC-M06-021 | 审批-非当前处理人 | operator_id=非处理人 | POST action | 403 |
| TC-M06-022 | 审批-非审批中状态 | status=已同意的申请 | POST action | 400, 仅审批中的申请可操作 |

### 3.7 M07 参数配置

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M07-001 | 获取责任田树 | 无 | GET /api/params/duty-field/tree | 200, nodes数组 |
| TC-M07-002 | 替换责任田树 | 有效nodes | PUT /api/params/duty-field/tree | 200, ok=true |
| TC-M07-003 | 责任田树-空标签 | nodes含空label | PUT | 400, 存在未填写名称的节点 |
| TC-M07-004 | 责任田树-层级过深 | 深度>32 | PUT | 400, 层级过深 |
| TC-M07-005 | 获取基线版本列表 | 无 | GET /api/params/baseline-versions | 200, items数组 |
| TC-M07-006 | 创建基线版本 | version_label=V1.0 | POST /api/params/baseline-versions | 200, item含id |
| TC-M07-007 | 创建基线-版本为空 | version_label="" | POST | 400, 版本不能为空 |
| TC-M07-008 | 修改基线版本 | 修改version_label | PATCH /api/params/baseline-versions/{id} | 200, item更新 |
| TC-M07-009 | 删除基线版本 | 无关联热补丁 | DELETE /api/params/baseline-versions/{id} | 200, ok=true |
| TC-M07-010 | 删除基线-有关联热补丁 | 有热补丁引用 | DELETE | 409, 该基线仍被热补丁引用 |
| TC-M07-011 | 基线版本搜索 | q=V1 | GET /api/params/baseline-versions?q=V1 | 匹配结果 |
| TC-M07-012 | 获取热补丁版本列表 | 无 | GET /api/params/hotfix-versions | 200, items数组 |
| TC-M07-013 | 创建热补丁版本 | baseline_id+hotfix_label | POST /api/params/hotfix-versions | 200, item含id |
| TC-M07-014 | 创建热补丁-基线不存在 | baseline_id=999999 | POST | 400, 基线版本不存在 |
| TC-M07-015 | 修改热补丁版本 | 修改hotfix_label | PATCH | 200, item更新 |
| TC-M07-016 | 删除热补丁版本 | 存在的id | DELETE | 200, ok=true |
| TC-M07-017 | 获取拉群模板 | 无 | GET /api/params/group-templates | 200, items含4种kind |
| TC-M07-018 | 替换拉群模板 | 4种kind完整提交 | PUT /api/params/group-templates | 200, ok=true |
| TC-M07-019 | 拉群模板-kind不完整 | 缺少某种kind | PUT | 400, 须一次性提交四种问题类型 |

### 3.8 M08 个人统计

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M08-001 | 获取个人统计 | operator_id, start_date, end_date | GET /api/home/personal-stats | 200, 含workload/sla/passthrough |
| TC-M08-002 | 日期范围校验 | start_date格式无效 | GET | 400, 格式无效 |
| TC-M08-003 | quality_scope校验 | quality_scope=invalid | GET | 400, quality_scope须为all/quality/non_quality |
| TC-M08-004 | 开始日期晚于结束日期 | start_date > end_date | GET | 自动交换，正常返回 |

### 3.9 M09 前端SPA

| 用例ID | 测试目的 | 输入数据 | 操作步骤 | 预期结果 |
|--------|----------|----------|----------|----------|
| TC-M09-001 | 首页可访问 | 无 | GET / | 200, 返回HTML |
| TC-M09-002 | SPA深链回退 | /tickets/test | GET /tickets/test | 200, 返回index.html |
| TC-M09-003 | 静态资源访问 | /assets/skin-presets/preset-01.png | GET | 200, 返回文件 |
| TC-M09-004 | 路径遍历防护 | /../backend/app.py | GET | 404 |

---

## 4. 测试执行流程

### 4.1 测试前准备

1. **环境搭建**
   - 创建测试专用数据库 `yunwei_ticket_test`
   - 执行全部迁移脚本初始化表结构
   - 执行种子数据脚本
   - 设置环境变量 `DATABASE_URL`

2. **依赖安装**
   ```bash
   cd backend
   pip install -r requirements.txt
   pip install pytest httpx
   ```

3. **启动后端服务**
   ```bash
   python -m uvicorn app:app --host 0.0.0.0 --port 8000
   ```

4. **验证环境就绪**
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
```

### 4.3 测试数据管理

- 测试数据存放在 `test/test_data/` 目录
- 每个测试模块使用独立的数据集，避免相互干扰
- 测试程序在执行前自动准备所需数据，执行后自动清理
- 工单编号使用 `YW99990101` 前缀避免与正式数据冲突
- 用户账号使用 `test_` 前缀标识测试数据

### 4.4 测试执行命令

```bash
# 执行全部测试
cd test
python run_tests.py

# 执行指定模块测试
python run_tests.py --module m02

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
└── test_m09_spa.py           # M09前端SPA测试
```

### 5.2 命名规范

- 测试文件：`test_m{模块编号}_{模块名}.py`
- 测试函数：`test_{用例ID小写}_{简述}`，如 `test_tc_m02_015_problem_fill_submit`
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
    assert response.json()["ok"] is True
```

### 5.4 通用要求

- 每个测试用例独立运行，不依赖其他用例的执行结果
- 使用 pytest fixture 管理测试前后置操作
- API 测试使用 httpx.AsyncClient 或同步 Client
- 断言使用标准 assert 语句，配合 pytest 的详细错误输出
- 测试数据通过 fixture 或 JSON 文件加载，不在代码中硬编码

---

## 6. 测试报告生成标准

### 6.1 报告内容结构

```
1. 测试概述
   1.1 测试目的
   1.2 测试范围
   1.3 测试时间
   1.4 测试环境

2. 测试结果统计
   2.1 总体统计表
   2.2 按模块统计表

3. 详细测试结果
   3.1 逐项测试结果列表

4. 失败分析
   4.1 失败项详情

5. 测试结论与建议
```

### 6.2 统计指标

| 指标 | 说明 |
|------|------|
| 总测试项数 | 执行的测试用例总数 |
| 通过数 | 断言全部通过的用例数 |
| 失败数 | 断言失败或异常的用例数 |
| 错误数 | 测试程序自身出错的用例数 |
| 通过率 | 通过数 / 总测试项数 × 100% |

### 6.3 详细测试结果格式

| 用例ID | 模块 | 测试项 | 预期结果 | 实际结果 | 状态 |
|--------|------|--------|----------|----------|------|
| TC-M01-001 | M01 | 健康检查正常返回 | 200, status=ok | 200, status=ok | PASS |
| TC-M02-016 | M02 | 必填字段缺失 | 400, Validation failed | 400, Validation failed | PASS |

### 6.4 失败分析格式

| 用例ID | 失败现象 | 错误信息 | 可能原因 | 建议措施 |
|--------|----------|----------|----------|----------|
| TC-XX-XXX | 实际返回200 | Expected 400, got 200 | 服务端未校验必填字段 | 检查_validate_one逻辑 |

### 6.5 报告输出

- 格式：Markdown + JSON
- 路径：`test/reports/report_{timestamp}.md` / `.json`
- 自动生成：由 `run_tests.py --report` 命令触发
