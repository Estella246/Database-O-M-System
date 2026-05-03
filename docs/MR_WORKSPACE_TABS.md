# Merge Request / Pull Request 说明草稿

> 用于 Gitee MR 或 GitHub PR 正文。关联 Issue：请粘贴「缺陷 Issue」链接或编号（创建自 [ISSUE_WORKSPACE_TABS.md](./ISSUE_WORKSPACE_TABS.md)）。

## 摘要

修复顶栏「已打开页面」与侧栏/路由不一致问题，并修正同源非 8000 端口下默认 API 基址；补充 E2E 契约与 CI 分进程测试脚本，避免 Playwright 整包冲突。

## 用户可见问题

1. 侧栏进入「需求管理」「设置」等后，URL 已变但顶栏缺少对应标签。
2. E2E 或多端口部署时，前端仍请求 `:8000`，权限数据与当前后端不一致。

## 根因

- `ticket-page.js` 中 `bindGlobalFallbackClicks` 对 `req:manage` / `settings:appearance` 未调用与 `app.js` 一致的 `ensure*`。
- `api.js` `resolveApiBaseUrl` 在存在页面端口时仍写死回落 `:8000`（已改为排除常见纯前端 dev 端口后使用当前 `hostname:port`）。
- `app.js` 侧栏点击增加 `stopPropagation()`，避免重复冒泡处理。

## 测试

| 命令 | 说明 |
|------|------|
| `cd test && python -m pytest e2e/test_e2e_workspace_tabs.py -v --tb=short` | TC-WS-01～09（含设置页、API_BASE_URL） |
| `cd test && python -m pytest . --ignore=e2e -v --tb=short` | API + M01～M13 等（需 `TEST_API_BASE_URL` 后端） |
| `cd test && python -m pytest e2e/ -v --tb=short` | 全部 E2E |
| `./scripts/ci/run-tests.sh` | 上述分两进程顺序执行 |

### 本地执行摘要（示例，合并前请再跑一次确认）

- `./scripts/ci/run-tests.sh`
  - **阶段 1**（`pytest . --ignore=e2e`）：491 passed，10 skipped，**2 failed**（`test_m05_duty` 日历无效年 `ReadError`；`test_m09_spa` 空字节注入返回 500 —— 与本 MR 前端改动无关，属既有环境/后端行为）。
  - **阶段 2**（`pytest e2e`）：54 passed，3 skipped，1 warning（TC-WS-05 viewport 记录）。
- `pytest e2e/test_e2e_workspace_tabs.py`：8 passed，1 skipped（TC-WS-07），1 warning。

## Review 自检

- [ ] `app.js` 与 `ticket-page.js` 对 `req:manage`、`settings:appearance` 的 `ensure*` 一致。
- [ ] `resolveApiBaseUrl` 对 5173/3000 等纯前端端口仍回落 8000。
- [ ] 无无关重构。

## 风险与回滚

- **分离部署**（静态页与 API 不同源）：须继续使用 `localStorage('yunwei_api_base_url')` 或 URL `?api=`。
- 回滚：还原上述三处前端文件并移除新增 E2E/脚本即可。

## 合并目标

- **目标分支**：`windows`（按团队流程亦可先合入默认分支再合并至 `windows`）。
