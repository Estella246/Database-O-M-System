# 需求导出 Excel 功能设计

**日期**: 2026-05-25
**状态**: 待审核

---

## 1. 功能概述

在需求管理页面新增「导出」按钮，点击后导出全部需求数据为 Excel 文件，支持权限控制。

---

## 2. 权限控制

新增权限项 `requirement_export`：
- 白名单控制导出按钮显示
- 后端接口检查权限，未授权返回 403
- 默认配置：`admin`、`管理员`角色可见（参考 `workbench_export` 模式）

**数据库迁移**: 新增权限策略种子数据，为内置角色配置 `requirement_export` 权限。

---

## 3. 导出字段（固定17列）

| 序号 | 字段名 | 数据库字段 | 说明 |
|------|--------|-----------|------|
| 1 | 需求编号 | requirement_no | RQ+日期+序号 |
| 2 | 需求标题 | title | |
| 3 | 详细描述 | description | |
| 4 | 需求提出人 | proposer | 姓名+账号格式 |
| 5 | 当前责任人 | assignee | 姓名+账号格式 |
| 6 | 关联问题 | related_issues | JSON数组转为逗号分隔文本 |
| 7 | 需求单号 | external_req_no | 外部需求单号 |
| 8 | 计划落地版本 | planned_version | |
| 9 | 计划落地日期 | planned_date | YYYY-MM-DD格式 |
| 10 | 优先级 | priority | 1-10数字 |
| 11 | 需求分类 | category | 管控需求/内核需求/管控和内核需求/其他 |
| 12 | 需求价值 | value | 质量加固/性能提升等 |
| 13 | 状态 | status | 待分析/待RAT决策/开发中/已经落地 |
| 14 | 备注 | remark | |
| 15 | 创建人 | creator_name | 姓名+账号格式 |
| 16 | 创建时间 | created_at | YYYY-MM-DD HH:mm:ss格式 |
| 17 | 更新时间 | updated_at | YYYY-MM-DD HH:mm:ss格式 |

---

## 4. 后端接口设计

### 新增接口

```
POST /api/requirements/export
```

### 请求参数（JSON body）

```json
{
  "operator_id": "zhangsan"
}
```

### 响应

- **成功**: 返回 Excel 文件流
  - Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - Content-Disposition: `attachment; filename="需求导出_{账号}_{日期}.xlsx"`
- **文件名**: `需求导出_{账号}_{日期}.xlsx`（如 `需求导出_zhangsan_2026-05-25.xlsx`）
- **失败**:
  - 403: 未授权
  - 503: 表未就绪

### 实现要点

- 使用 `openpyxl` 生成 Excel（项目已有依赖）
- 查询全部需求，按优先级升序、创建时间降序排列（与列表一致）
- StreamingResponse 返回文件流，避免内存堆积
- 后端权限检查：调用 `_get_user_role` 获取用户权限，检查 `requirement_export` 白名单

---

## 5. 前端设计

### 按钮位置

- 在需求管理页面工具栏右侧，与「新建」按钮并列
- 按钮文案：`导出`
- 白名单 `requirement_export` 控制显示

### 交互流程

1. 用户点击「导出」按钮
2. 前端检查权限（按钮已控制，实际点击时无需再查）
3. 调用 `/api/requirements/export` POST 请求
4. 接收文件流，触发浏览器下载
5. 导出过程中按钮显示 loading 状态

### 状态管理

- 新增 `state.reqExportLoading` 控制按钮状态

---

## 6. 错误处理

| 场景 | 处理 |
|------|------|
| 无权限 | 后端返回 403，前端提示「无导出权限」 |
| 数据库表不存在 | 后端返回 503，前端提示「需求管理表未就绪」 |
| 导出失败 | 前端提示「导出失败：{错误信息}」 |
| 无需求数据 | 导出空 Excel（仅表头），前端提示「当前无需求」 |

---

## 7. 测试要点

- 权限控制测试：无权限用户看不到按钮、调用接口返回 403
- 导出功能测试：导出文件包含全部字段、数据格式正确
- 边界测试：无需求时导出空文件、大数据量导出性能