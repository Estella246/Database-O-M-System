---
name: leave-applicant-field
description: 请假申请弹窗「申请人」字段的默认值、关键字搜索选择与前后端提交约定。在实现或修改请假新建弹窗、申请人选择、POST /api/leave/applications 时使用。
---

# 请假申请 · 申请人字段

## 产品规则

1. **默认当前登录人**
   - 点击「申请」打开弹窗时，`resetLeaveCreateForm()` 须将申请人默认设为当前登录账号。
   - 展示格式与值班/白名单人员搜索一致：`dutyModalUserLabel` → `姓名 (账号)`。

2. **关键字搜索选择（与添加审批人一致）**
   - 不使用只读输入框，也不列出全量用户勾选。
   - 使用 `duty-modal-user-combo` + 下拉建议列表；输入姓名或账号关键字后才展示匹配项（空关键字不展开列表）。
   - 人员池：`getDutySelectableUsers()`（与用户管理可选人员一致）。
   - 选中后写入隐藏域 `#leave-create-applicant-account`；展示文案写入 `#leave-create-applicant-input`。

3. **提交校验**
   - 优先取隐藏域账号；若无，再按关键字精确匹配或 `resolveLeaveApplicantAccount()` 解析。
   - 无法解析有效账号时提示：**请先搜索并选择申请人**。
   - 请求体字段：`applicant_account`（可与 `operator_id` 不同，表示代他人申请）。

## 状态字段

| 字段 | 说明 |
|------|------|
| `state.leaveCreateApplicant` | 输入框展示文案 |
| `state.leaveCreateApplicantAccount` | 已选申请人账号 |

打开弹窗前调用 `resetLeaveCreateForm()` 重置上述字段及时间段等。

## 后端约定

- `POST /api/leave/applications` 接受可选 `applicant_account`；缺省则等于 `operator_id`。
- `applicant_account` 须在 `user_account` 中存在。
- 落库：`leave_application.applicant_*` 存**请假人**；提交日志 `operator_*` 存**当前登录提交人**。

## 实现位置

- 前端：`frontend/modules/pages/leave-page.js`（渲染、绑定、辅助函数）
- 表单重置：`frontend/modules/pages/home-page.js` → `resetLeaveCreateForm()`
- 后端：`backend/models/leave.py`、`backend/routers/leave.py`

## 辅助函数

- `leaveApplicantDefaultDisplay()` — 当前登录人默认展示文案
- `filterLeaveApplicantUsersForSuggest(pool, filterText)` — 关键字过滤（空串返回 `[]`）
- `resolveLeaveApplicantAccount(raw, users)` — 从展示文案/账号/姓名解析唯一账号

## 常见错误

- **勿重复声明 `applicant_account`**：提交 handler 内只能声明一次（`let`），否则模块语法错误会导致整站白屏。
- **勿与 `home-page.js` 形成无解循环依赖**：`resetLeaveCreateForm` 在 home-page，申请人 UI 在 leave-page；新增 cross-import 时避免在模块顶层立即调用对方导出。

## 验证清单

- [ ] 点「申请」后申请人默认为当前登录人。
- [ ] 输入关键字可搜索并选择其他有效用户。
- [ ] 未选择有效申请人时无法提交。
- [ ] 代他人申请时列表「发起人」为所选申请人，日志提交人为当前登录人。
- [ ] 前端 `leave-whitelist-helpers.test.js` 与后端 `test_m06_leave.py` 相关用例通过。
