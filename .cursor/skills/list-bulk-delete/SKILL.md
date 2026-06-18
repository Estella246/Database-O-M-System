---
name: list-bulk-delete
description: 列表页头「删除」按钮与工作台批量删除行为一致：勾选行、二次确认条数、bulk-delete 接口、清空选中并刷新。在实现或修改工作台、补丁管理、局点档案等列表删除按钮时使用。
---

# 列表批量删除（页头删除按钮）

## 目标行为

页头 **「删除」** 按钮须与 **工作台**（`activeKey === "list"`）一致：

1. 用户先在列表 **勾选** 一行或多行（含本页全选）
2. 未选中时：`window.alert("请先选中要删除的…")`，**不**发请求
3. 已选中时：`window.confirm("此操作将删除N条…，是否继续？")`
4. 确认后调用 **`POST …/bulk-delete`**
5. 成功后：**清空选中**、**刷新列表**；若当前打开的详情属于已删记录则关闭详情
6. 部分失败时：提示 `deleted` 与 `absent`/`skipped` 差异（库中无记录、无权等）

详情弹窗内的 **单条删除** 可保留；与页头批量删除 **共用同一写权限**。

## 前端约定

### 1. 页头按钮（统一位置与样式）

在 `frontend/app.js` 的 `.head .actions` 渲染：

```html
<button class="action danger" id="delete-ticket-btn">删除</button>
```

- **复用** `id="delete-ticket-btn"`（工作台 / 补丁管理页头）
- 展示条件：工作台 `canViewWorkbenchDelete`；补丁 `canViewPatchManageDelete`
- **局点档案例外**：删除按钮放在页面工具栏 `#sp-delete-btn`（「新增」右侧），不走页头

### 2. 点击分发（`bindGlobalFallbackClicks`）

`frontend/modules/pages/ticket-page.js` 内对 `#delete-ticket-btn` 做 **事件委托**：

- `state.activeKey === "list" | "patch:list"` → 现有工单 `bulk-delete` 逻辑（页头 `#delete-ticket-btn`）
- **局点档案**：工具栏 `#sp-delete-btn`，在 `bindSiteProfilePage()` 内绑定，**勿**走页头 `#delete-ticket-btn`

### 3. 列表勾选

| 页面 | 选中 state | 行勾选属性 | 全选 id |
|------|------------|------------|---------|
| 工作台 / 补丁 | `state.selectedTicketIds` | `data-ticket-select` / `data-home-ticket-select` | `select-all-tickets` |
| 局点档案 | `state.siteProfileSelectedIds` | `data-sp-select` | `sp-select-all` |

实现要点：

- 勾选列宽 `36px`；无删除权限时不渲染勾选列
- 行 `click` 打开详情时，**忽略** checkbox 点击（`stopPropagation` / 判断 `input[type=checkbox]`）
- 全选默认只作用于 **当前页** 数据（局点档案、非服务端分页场景）；工作台服务端分页全选走 `fetchWorkbenchFilteredTicketIds`
- 翻页后 **保留** 跨页选中（用 Set 合并 id）

### 4. 页面模块职责

在 `frontend/modules/pages/<page>.js`：

1. `render*Page()`：渲染勾选列 + 全选
2. `bind*Page()`：绑定全选 / 行勾选
3. **导出** `handle*BulkDelete()`：校验选中 → confirm → fetch → 更新 state → `requestRender()`

确认文案模板：

- 工单：`此操作将删除${n}条工单，是否继续？`
- 局点档案：`此操作将删除${n}条局点档案，是否继续？`

### 5. 权限

删除按钮与 bulk-delete 写权限 **对齐**：

| 页面 | 白名单键 |
|------|----------|
| 工作台 | `workbench_delete` |
| 补丁管理 | `patch_manage_delete` |
| 局点档案 | `site_profile_create`（与新增/编辑/详情删除一致） |

前端 `whitelistAllows` 控制按钮与勾选列；后端路由内 `_require_*_access` 二次校验。

## 后端约定

为支持批量删除，提供：

```
POST /api/<resource>/bulk-delete
Body: { "operator_id": "...", "<id_field>s": [...] }
Response: { "ok": true, "deleted": [...], "absent": [...] }
```

实现参考：

- `backend/routers/tickets.py` — `ticket_nos` + 模板码 + 仅自建 scope
- `backend/routers/site_profile.py` — `profile_ids` + `site_profile_create` 权限

规则：

- 去重、忽略非法 id；`profile_ids` / `ticket_nos` 为空 → `400`
- `absent`：请求中有但库中不存在（或无权删除）的 id
- 单条 `DELETE /{id}` 可保留给详情弹窗；批量与单条共用写权限

## 测试

新增或改动删除能力时须补：

1. **API**：`test/test_m15_site_profile.py`（`bulk-delete` 成功 / 空 ids / absent）或对应模块测试
2. **前端静态契约**（`test/frontend_tests/__tests__/`）：
   - 页头展示条件（`app.js`）
   - `#delete-ticket-btn` 分支（`ticket-page.js`）
   - 勾选列、`bulk-delete` URL、确认文案（页面 js）

运行示例：

```bash
python3 -m pytest test/test_m15_site_profile.py::TestSiteProfileCrud::test_tc_m15_016_bulk_delete -q
```

## 自检清单

- [ ] 页头仅一个 `id="delete-ticket-btn"`，样式 `action danger`
- [ ] 未选中有 alert，确认框展示 **条数**
- [ ] 成功后 `selected*Ids` 清空并刷新列表
- [ ] 勾选不触发行点击（开详情）
- [ ] 后端 bulk-delete 校验权限并返回 `deleted` / `absent`
- [ ] README 对应功能节已更新
- [ ] 新增测试通过

## 参考实现

- 工作台批量删除：`frontend/modules/pages/ticket-page.js`（`bindGlobalFallbackClicks` 内工单分支）
- 局点档案：`frontend/modules/pages/site-profile-page.js`（`#sp-delete-btn`、`handleSiteProfileBulkDelete`）
- 页头渲染（工作台/补丁）：`frontend/app.js`
