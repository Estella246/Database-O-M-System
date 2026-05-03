# Issue 草稿：顶栏「已打开页面」与路由/API 不一致

> 用途：复制到 Gitee/GitHub「新建 Issue」正文。远程仓库：**gitee.com/estella246/database-o-m-system**（若迁移平台请替换链接）。

## 标题（建议）

**Bug：顶栏「已打开页面」与侧栏/深链不同步；非 8000 端口下 API 默认指向错误**

## 类型 / 优先级

- **Bug**
- **P1**（用户可见导航状态错误；E2E/多端口部署下权限数据可能串库）

## 用户影响

1. 从侧栏进入「需求管理」等模块时，地址栏已是需求页，但顶栏「已打开页面」列表里**没有出现对应标签**，用户无法直观看到当前打开的标签集合。
2. 当前端页面与后端**不在同一端口**（例如集成测试后端 `8999`、本机 uvicorn 非 `8000`）且未手动配置 `localStorage('yunwei_api_base_url')` 或 `?api=` 时，前端仍请求错误的 API 地址，导致**菜单与权限表现与当前后端数据库不一致**。

## 复现步骤（Chrome）

### A. 顶栏不同步

1. 启动后端并托管前端（默认 SERVE_FRONTEND）：`python -m uvicorn app:app --host 127.0.0.1 --port <PORT>`。
2. 打开 `http://127.0.0.1:<PORT>/`，使用侧栏点击「需求管理」（需账号对白名单可见）。
3. **实际**：URL 为 `/requirements`，顶栏无 `[data-workspace-tab="req:manage"]`（若仅走 document 委托路径）。
4. **期望**：顶栏存在「需求管理」标签且为激活态，与 URL 一致。

### B. API 端口错位（E2E）

1. E2E 将后端起在 `8999`（见 `test/e2e/conftest.py`）。
2. 旧逻辑下 `API_BASE_URL` 仍为 `http://127.0.0.1:8000`。
3. **期望**：在同源非「纯前端 dev 端口」时，`API_BASE_URL` 与页面 origin 端口一致（另有 `yunwei_api_base_url` / `?api=` 覆盖）。

## 根因摘要

| 问题 | 位置 | 说明 |
|------|------|------|
| 委托点击未 `ensure*` | `frontend/modules/pages/ticket-page.js` `bindGlobalFallbackClicks` | `[data-nav-key]` 分支未对 `req:manage`、`settings:appearance` 调用与 `frontend/app.js` 一致的 `ensureRequirementTab` / `ensureSettingsTab`。 |
| API 写死 :8000 | `frontend/modules/services/api.js` `resolveApiBaseUrl` | 存在 `location.port` 时仍回落到 `:8000`，与「后端与 SPA 同端口」部署不符。 |

## 关联文档 / 测试

- 设计：[test/e2e/WORKSPACE_TABS_TEST_DESIGN.md](../test/e2e/WORKSPACE_TABS_TEST_DESIGN.md)
- E2E 报告：[docs/E2E_WORKSPACE_TABS_REPORT.md](./E2E_WORKSPACE_TABS_REPORT.md)

## 验收标准

- [ ] `cd test && python -m pytest . --ignore=e2e -v --tb=short` 通过（API + M13 等；后端需在 `TEST_API_BASE_URL` 可用）。
- [ ] `cd test && python -m pytest e2e/test_e2e_workspace_tabs.py -v --tb=short` 通过（含 TC-WS-08 设置页、TC-WS-09 API 基址契约）。
- [ ] `cd test && python -m pytest e2e/ -v --tb=short` 通过。
- [ ] Chrome 手工：侧栏依次打开工作台、需求管理、设置（若可见），顶栏标签与 URL、高亮一致。

## 测试体系缺陷（Related）

在同一 **pytest 进程**内先收集并执行 `test/e2e/`（自带 Playwright 会话）再执行依赖 `test/conftest.py` 里 `browser` fixture 的 `test_m13_frontend.py` 时，可能出现 **`Playwright Sync API inside the asyncio loop`**，导致 M13 全部 ERROR。  

**缓解**：CI/本地「一键全量」请使用 [scripts/ci/run-tests.sh](../scripts/ci/run-tests.sh)：**先** `pytest . --ignore=e2e`，**再** `pytest e2e`，分两进程运行。

## 非目标 / 已知

- TC-WS-05 **viewport_overflow**（窄视口下激活标签未必完全落在 `#workspace-tabs` 可视矩形内）为**记录型告警**，不阻塞本 Issue 关闭；若产品要求「激活项始终完整可见」，另开 UX Story。

---

**Fix 跟踪**：合并后在此评论回填 MR/PR 链接与 commit SHA。
