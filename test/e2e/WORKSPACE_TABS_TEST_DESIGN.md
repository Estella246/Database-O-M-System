# 已打开页面清单（workspace-tabs）测试设计

本文档与自动化用例 [`test_e2e_workspace_tabs.py`](test_e2e_workspace_tabs.py) 对齐，实现依据以仓库源码为准。

## 代码依据

| 项 | 路径 |
|----|------|
| 顶栏渲染、`openTabs` + `isActiveKeyVisible` 过滤 | `frontend/app.js`（`#workspace-tabs`、`data-workspace-tab`） |
| `isActiveKeyVisible` | `frontend/modules/core/auth.js` |
| `getWhitelistKeyByActiveKey`（`req:manage` → `requirement_list`） | `frontend/modules/utils/normalize.js` |
| `ensureRequirementTab` 等 | `frontend/modules/pages/settings-page.js`、`ticket-core.js` 等 |
| 深链 `/requirements` | `frontend/modules/pages/ticket-core.js` `syncActiveKeyFromPath` |
| 横向滚动容器 | `frontend/styles.css` `.workspace-tabs { overflow-x: auto; }` |

## 数据前提（可验证）

- 默认操作员：`frontend/modules/constants/theme.js` 中 `DEFAULT_OPERATOR_ACCOUNT`（当前为 `demo_001`）。
- 种子用户/角色：`db/postgres/postgres_seed_data.sql` 中 `user_account`（如 `l30030745` / 管理员，`i00822653` / TAC提单）；白名单表 `role_permission_policy` 中未必存在 `requirement_list` 字段行，缺失时前端 `getWhitelistLevel` 对未知键默认 `readonly`（见 `frontend/modules/utils/normalize.js`）。
- E2E 后端：`test/e2e/conftest.py` 使用环境变量 `DATABASE_URL`（继承自 pytest 进程）；断言须对「菜单不可见」做分支跳过，避免假失败。
- E2E 中 `test_e2e_workspace_tabs.py` 对 `SEEDED_ADMIN_ACCOUNT`（默认 `l30030745`）在测试前调用 `GET /api/admin/users` 与 `GET /api/admin/permissions`，解析 `node_key=__whitelist__`、`field_key=requirement_list` 的 `permission_level`；若为 `hidden`，则跳过依赖顶栏 `req:manage` 的用例（TC-WS-02 需求段、TC-WS-04/05），且 TC-WS-03 以 API 结果优先于侧栏 DOM 可见性。
- 前端须保证侧栏 `data-nav-key` 与 `openTabs` 一致：`app.js` 内联监听与 `ticket-page.js` 的 `bindGlobalFallbackClicks` 委托应对 `req:manage`、`settings:appearance` 等调用相同的 `ensure*`（见仓库修复记录）；`modules/services/api.js` 默认 API 基址应与当前页端口一致，否则 E2E 会连错库。

## 用例编号与期望

### TC-WS-01 初始态标签集合

- **步骤**：进入 `/`，等待 `#root` 与 admin 接口完成。
- **期望**：存在 `[data-workspace-tab="home"]`；该标签内无 `.workspace-tab-close`；URL 为根路径或等价 SPA 状态。

### TC-WS-02 侧栏 `data-nav-key` 与 URL、激活标签一致

- **步骤**：对可见的 `[data-nav-key]` 依次点击至少 `list`、`duty:roster`；若 `req:manage` 可见则点击。
- **期望**：每次存在对应 `[data-workspace-tab="<key>"]`；URL 与 `getUrlByKey` 一致（`list`→`/workbench`，`duty:roster`→`/duty-roster`，`req:manage`→`/requirements`）；`.workspace-tab.active` 的 `data-workspace-tab` 与当前路由一致。

### TC-WS-08 侧栏「设置」与顶栏一致

- **步骤**：若 `[data-nav-key="settings:appearance"]` 可见则点击。
- **期望**：存在 `[data-workspace-tab="settings:appearance"]`；URL `/settings/appearance`；`.active` 为设置标签。（覆盖 `bindGlobalFallbackClicks` 与 `app.js` 均须调用 `ensureSettingsTab`。）

### TC-WS-09 `API_BASE_URL` 与 E2E 后端同源

- **步骤**：进入 `/` 且 admin 加载完成后，`import('/modules/services/api.js')` 读取 `API_BASE_URL`。
- **期望**：与当前页 origin（即 `backend_server`）的 scheme/host/port 一致，防止再次默认连错 `:8000`。

### TC-WS-03 深链 `/requirements`

- **步骤**：`goto("/requirements")`，等待加载。
- **期望（分支）**：若侧栏 `[data-nav-key="req:manage"]` 可见，则必须存在 `[data-workspace-tab="req:manage"]`；否则不得断言该标签存在，且最终 URL/主区应符合 `getDefaultVisibleActiveKey` 重定向行为（非 `/requirements` 或主区非需求列表）。

### TC-WS-04 多标签后需求管理标签在 DOM 中

- **前置**：`req:manage` 入口可见（否则 skip）。
- **步骤**：按顺序打开 `list` → `duty:roster` → `stats:charts` → `stats:report` → `stats:skills` → `upload:analysis` → `req:manage`。
- **期望**：`[data-workspace-tab="req:manage"]` 恰好 1 个。

### TC-WS-05 视口与标签几何（记录型）

- **步骤**：窄视口下完成 TC-WS-04 布局；`evaluate` 比较 `#workspace-tabs` 与 `req:manage` 标签的 `getBoundingClientRect`。
- **强断言**：激活态时 `.active` 的 `data-workspace-tab` 为 `req:manage`。
- **弱记录**：若标签不完全落在容器可视矩形内，发出 `UserWarning`（不导致用例失败），供报告 [`docs/E2E_WORKSPACE_TABS_REPORT.md`](../docs/E2E_WORKSPACE_TABS_REPORT.md) 收录为「人工复核项」。

### TC-WS-06 关闭标签

- **步骤**：点击第一个 `.workspace-tab-close`。
- **期望**：对应 `data-close-tab` 的标签从 DOM 消失；URL 更新；无（非网络类）JS 错误。

### TC-WS-07 白名单与顶栏一致性（可选）

- **前置**：`localStorage` 设为种子用户 `i00822653`（TAC提单，`stats_dashboard` 在种子中为 `hidden`）。
- **步骤**：`goto("/stats/charts")`。
- **期望**：最终 URL 不应长期保持 `/stats/charts` 且顶栏不应持久展示 `stats:charts` 为激活（与 `render` 中 `isActiveKeyVisible` 重定向一致）。若该账号不在当前库则 `skip`。
