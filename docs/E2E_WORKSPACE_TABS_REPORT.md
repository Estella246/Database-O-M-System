# E2E：workspace-tabs（已打开页面清单）执行报告

## 运行命令

```bash
cd test && python -m pytest e2e/test_e2e_workspace_tabs.py -v --tb=short
```

## 最近一次结果（本地）

- **通过**：8（TC-WS-01～06、TC-WS-08～09 中可执行项；TC-WS-09 校验 `API_BASE_URL` 与 E2E 后端同源）
- **跳过**：1（TC-WS-07：当前 `DATABASE_URL` 库中无 `i00822653`）
- **Pytest 警告**：1 条 `UserWarning`（TC-WS-05 视口几何记录，见下「人工复核项」）

## Bug 清单（来自失败断言或明确对比；本次 pytest 无失败）

本次全绿前已定位并修复的问题（与 E2E 断言直接相关）：

1. **`bindGlobalFallbackClicks` 未同步顶栏 `openTabs`**  
   - **现象**：侧栏点「需求管理」后 URL 变为 `/requirements`，但 `[data-workspace-tab="req:manage"]` 不出现。  
   - **根因**：`frontend/modules/pages/ticket-page.js` 中 document 委托分支对 `req:manage` / `settings:appearance` 未调用 `ensureRequirementTab()` / `ensureSettingsTab()`，与 `frontend/app.js` 内联监听不一致。  
   - **修复**：在委托分支补齐上述 `ensure*`，并在 `app.js` 侧栏按钮监听上增加 `stopPropagation()`，避免重复冒泡处理。

2. **非 5173 等开发端口下 API 仍指向 `:8000`**  
   - **现象**：E2E 后端在 `8999` 时，前端仍请求 `127.0.0.1:8000` 的 admin 接口，权限数据与 E2E 库不一致。  
   - **根因**：`frontend/modules/services/api.js` 中 `resolveApiBaseUrl()` 在存在 `location.port` 时仍写死 `:8000`。  
   - **修复**：在排除常见「纯前端 dev server」端口后，使用当前页面的 `hostname:port` 作为默认 API 基址。

## 人工复核项（TC-WS-05，不自动判失败）

- **`viewport_overflow: true`**：`req:manage` 标签在 DOM 中且为激活态时，其 `getBoundingClientRect()` 未完全落在 `#workspace-tabs` 容器可视矩形内（窄视口 900×800 下复现）。  
- **几何示例**（摘自 pytest 警告）：`tab.right` 大于 `container.right`，横向滚动条区域内标签可能被裁切。  
- **建议**：若产品期望「激活标签始终完全可见」，需在 `frontend` 顶栏滚动策略上增强（例如激活时 `scrollIntoView`）；否则可关闭此项为设计接受范围。
