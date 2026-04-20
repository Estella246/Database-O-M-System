---
name: workflow-node-visibility
description: Enforces workflow detail UI visibility rules. Use when implementing or updating flow tree/card rendering in ticket detail pages, especially around current node highlighting and conditional form field display.
---

# Workflow Node Visibility

## Rules
运行环境是 Python 3.9，写后端时注意
节点流转提交之后默认刷新一次页面
后端驱动前端，遇到问题先从后端分析
所有修改项，在修改代码后，生成一个测试方案验证并提交验证结果
推送到远程仓库要加代理：
https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 git pull --rebase origin main
https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 git push -u origin master:main
网址&端口是：http://127.0.0.1:5173
起后端：
cd /Users/estella/Desktop/yunweixitong/backend
export DATABASE_URL="postgresql://estella@localhost:5432/yunwei_ticket"
python3 -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
问题详情页，点开各节点卡片，显示详细内容

Apply the following rules in ticket detail workflow UI:

1. **Current node must glow**
   - The current node in the top flow tree must use the highlighted/current visual style.
   - Non-current nodes must not use current-node glow styling.

2. **Hide flow-only fields on non-current nodes**
   - For non-current node cards, do not show:
     - `处理方式*`
     - `下一步处理人*`
   - These two fields are only shown on the current editable node card.

3. **Auto expand/edit for current handler**
   - If `当前处理人 == 当前登录人`, the current node card must auto-expand.
   - In this case, the current node card must be editable.

## Implementation Notes

- Determine current node from persisted workflow state first; use frontend fallback only when backend state is absent.
- Keep historical node cards readable, but suppress flow action fields for non-current cards.
- If current handler is not the logged-in user, keep the card visible but readonly; still do not expose flow action fields on non-current cards.

## Verification Checklist

- [ ] In the flow tree, exactly one node is styled as current/glowing.
- [ ] Any non-current node card does not render `处理方式*`.
- [ ] Any non-current node card does not render `下一步处理人*`.
- [ ] Current node card keeps these fields visible when editable.
- [ ] When `当前处理人 == 当前登录人`, current card auto-expands and is editable.
