先看README.md了解下项目的情况
提交代码之前记得更新README.md
新增功能需要添加对应的测试用例并确保新增的测试用例还有已有的测试用例通过
要看看.cursor目录下和子目录下的文件了解相关规则

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Playwright E2E Testing (每次开发必做)

**每次前端/全栈改动完成后，必须用 Playwright 端到端验证，确认功能在真实浏览器中正常工作后才能说"搞定了"。**

- 后端需先启动：`nohup .venv/bin/uvicorn app:app --host 127.0.0.1 --port 18080 --no-access-log --app-dir backend > /tmp/backend.log 2>&1 &`
- 前端页面验证：`page.goto()` → `page.wait_for_timeout()` → `page.evaluate()` 检查 DOM 状态
- API 直接验证：`requests.post/get()` 检查 HTTP 状态码和响应体
- 关键断言：
  - 页面渲染正确（h1、tab、表单字段）
  - 交互流程正常（点击、填写、提交）
  - DOM 结构符合预期（元素父子关系、CSS class）
  - 数据持久化（刷新后状态保持）
- 测试脚本放 `test/` 目录或用 Python heredoc 内联执行
- **禁止**只改代码不测试就说"搞定了"；必须贴出测试通过的输出

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
