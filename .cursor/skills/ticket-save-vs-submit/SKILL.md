---
name: ticket-save-vs-submit
description: 工单节点「保存」与「提交」须严格区分：保存不校验必填、不推进流程；提交才校验并流转。在实现或修改工作台/补丁工单详情表单、ticket-page.js saveNode、POST .../submit、SubmitPayload 时使用。
---

# 工单保存 vs 提交

## 产品语义（不可混淆）

| 按钮 | 用户预期 | 必填校验 | 推进流程 |
|------|----------|----------|----------|
| **保存** | 暂存当前填写内容 | **否** | **否** |
| **提交** | 完成本节点并流转 | **是** | **是** |

适用于**工作台/补丁工单详情**各流程节点（含当前节点与已走过节点的补录），任何阶段点「保存」均遵守上表。

## 前端约定（`ticket-page.js`）

### 1. 按钮区分

- **保存**：`type="submit"`，**无** `data-action-submit`
- **提交**：`type="submit"`，带 `data-action-submit`

`bindNodeForms` 内：

```javascript
const isFlowSubmit =
  isCurrentNode && (!!submitter?.hasAttribute("data-action-submit") || flowSubmitPending);
```

### 2. 请求体

`saveNode` 组装 `submitBody` 时**必须**：

```javascript
save_only: !isFlowSubmit,
next_node_key: isFlowSubmit ? resolveNextNodeKey(...) : null,  // 或等价的仅提交时计算
```

- **保存**：`save_only: true`，**不要**在成功后调用 `completeFlowSubmit` / `advanceWorkflow`
- **提交**：`save_only: false`，`create_intent` 仅在创建弹窗首次流转时为 `true`

### 3. 禁止的回退写法

- ❌ 保存与提交共用同一套必填校验（仅前端 `alert` 拦不住后端仍会 400）
- ❌ 保存时根据 `handle_mode` 计算 `next_node_key` 并推进流程
- ❌ 保存成功后执行 `syncSingleTicketFromServer` + `advanceWorkflow` 当作已提交

## 后端约定

### 1. `SubmitPayload`

`backend/models/ticket.py`：

```python
save_only: bool = False  # 工作台「保存」为 True
```

### 2. `submit_node_data` 分支

`backend/routers/tickets.py` 核心逻辑：

```python
persist_without_flow = payload.save_only or not allow_flow_submit
```

| 场景 | `allow_flow_submit` | `save_only` | 行为 |
|------|---------------------|-------------|------|
| 当前节点保存 | True | True | 落库草稿，`draft: true`，不流转 |
| 当前节点提交 | True | False | 完整校验 + 流转 |
| 已走过节点补录 | False | True/False | 落库补录，`amended: true`，剔除流转字段，不流转 |

**`persist_without_flow` 为 True 时：**

1. 与历史值合并（`_query_latest_node_values` + `payload.values`）
2. **跳过必填**：`req = False`（仍可做格式校验）
3. **跳过** `ops_analysis` 等业务流转校验
4. **不**写 `ticket_flow_log`、**不**更新 `ticket.current_node_id`
5. 已走过节点补录：从 `values` 剔除 `AMEND_EXCLUDED_FLOW_KEYS`（`handle_mode`、`next_handler` 等）

**`save_only` 且工单尚未建库**（如 `draft-*` 本地号）：返回 **404**，避免误分配正式单号。

### 3. 草稿行标记

当前节点保存写入 `schema_snapshot.draft = true`（非 `amended`）。

解析当前处理人、列表 `next_handler` 时须**忽略**草稿与补录行（`_node_data_row_is_non_flow_submit`），避免保存草稿改写待办人。

## 测试（改动后必跑）

### 后端

`test/test_m02_ticket.py` — `TestFlowTransitionEdgeCases`：

- `test_e_m02_current_node_save_only_skips_required_and_no_flow`
- `test_e_m02_save_only_on_problem_fill_without_required`（未建单 404）
- `test_e_m02_amend_save_only_skips_required`
- `test_e_m02_amend_passed_node_without_flow`（回归）

```bash
python3 -m pytest test/test_m02_ticket.py::TestFlowTransitionEdgeCases -q
```

### 前端静态契约

`test/frontend_tests/__tests__/flow-submit-render.test.js`：

- `save_only: !isFlowSubmit` 出现在 `saveNode`
- 流转提交仍走 `suppressRenderOnComplete: isFlowSubmit`

```bash
cd test/frontend_tests && node ./node_modules/jest/bin/jest.js --testPathPattern=flow-submit-render
```

## 自检清单

- [ ] 保存请求带 `save_only: true`
- [ ] 提交请求 `save_only: false`（或省略，默认 false）
- [ ] 保存不触发 `completeFlowSubmit` / `advanceWorkflow`
- [ ] 后端 `persist_without_flow` 分支不更新 `current_node_id`
- [ ] 草稿行不参与 `next_handler` 解析
- [ ] README `POST .../submit` 文档与行为一致
- [ ] 上述测试通过

## 参考实现

- 前端：`frontend/modules/pages/ticket-page.js` — `bindNodeForms` → `saveNode`、表单 `renderNodeForm` 双按钮
- 后端：`backend/routers/tickets.py` — `submit_node_data`、`SubmitPayload`
- API 文档：`README.md` — 「提交节点数据」`save_only` 说明
