---
name: workflow-node-visibility
description: Enforces workflow detail UI visibility rules. Use when implementing or updating flow tree/card rendering in ticket detail pages, especially around current node highlighting and conditional form field display.
---

# Workflow Node Visibility

## Rules

Apply the following rules in ticket detail workflow UI:

1. **Current node must glow**
   - The current node in the top flow tree must use the highlighted/current visual style.
   - Non-current nodes must not use current-node glow styling.
   - **热补丁（HOTPATCH）并行阶段**：`ticket.hotpatchFrontierKeys` 含多个 `node_key` 时，**每个在 frontier 中的泳道节点**均视为「当前」并允许高亮；非 frontier 节点不得使用 current-node glow。

2. **Hide flow-only fields on non-current nodes**
   - For non-current node cards, do not show:
     - `处理方式*`
     - `下一步处理人*`
   - These two fields are only shown on the current editable node card.

3. **Auto expand/edit for current handler**
   - If `当前处理人 == 当前登录人`, the current node card must auto-expand.
   - In this case, the current node card must be editable.
   - **HOTPATCH 并行**：各并行「当前」节点卡片按**该节点**对应处理人（`parallel_handlers` 或计划制定节点「开发人员」/「测试人员」）与登录人匹配决定是否自动展开、可编辑；不得仅用列表合并后的单一 `assignee` 判定所有并行卡片。

## Implementation Notes

- Determine current node from persisted workflow state first; use frontend fallback only when backend state is absent.
- Keep historical node cards readable, but suppress flow action fields for non-current cards.
- If current handler is not the logged-in user, keep the card visible but readonly; still do not expose flow action fields on non-current cards.

## Verification Checklist

- [ ] In the flow tree, exactly one node is styled as current/glowing（HOTPATCH 并行多节点时除外：frontier 内多节点可同时 current）。
- [ ] Any non-current node card does not render `处理方式*`.
- [ ] Any non-current node card does not render `下一步处理人*`.
- [ ] Current node card keeps these fields visible when editable.
- [ ] When `当前处理人 == 当前登录人`, current card auto-expands and is editable.
