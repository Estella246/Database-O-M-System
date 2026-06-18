---
name: list-search-input
description: 列表页工具栏搜索框须与工作台一致：input 立即写 state、中文输入法 composition、Enter 立即搜索、防抖拉数。在实现或修复工作台、局点档案、用户管理、请假等列表搜索框时使用。
---

# 列表页搜索框

## 标准行为（以工作台为准）

参考 `frontend/app.js` 中 `#ticket-list-search-input`：

1. **输入时立即同步 state**（`input` 回调第一行就写 `state.*Search = input.value || ""`）
2. **中文输入法**：`input` 中 `if (ev.isComposing) return`；另绑 `compositionend` 再同步并调度搜索
3. **防抖后刷新**：停止输入一段时间后再拉数 / 重绘
4. **Enter 立即搜索**：清掉 pending 定时器，同步 state，立刻执行刷新（不等防抖）
5. **搜索时重置到第 1 页**

## 最常见 Bug（必避）

本仓库列表经 `requestRender()` → `render()` 用 `innerHTML` 整体重绘，搜索框 `value` 来自 **state**：

```html
<input … value="${escapeAttr(state.xxxSearch)}" />
```

**错误**：只在 `setTimeout` 防抖回调里才 `state.xxxSearch = input.value`。用户输入后若先触发 `fetch*List()` / `requestRender()`，重绘会把输入框还原成旧关键词，表现为「打字被清空 / 搜不动」。

**正确**：`input` / `compositionend` / `keydown(Enter)` 都**先**写 state，再调度防抖或立即拉数。

## 绑定模板

列表页 `bind*Page()` 内搜索框推荐结构（服务端分页列表）：

```javascript
const SEARCH_DEBOUNCE_MS = 800; // 主列表页与工作台一致
let _searchDebounceTimer = null;

const scheduleListSearch = () => {
  clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(() => {
    _searchDebounceTimer = null;
    state.xxxListPage = 1;
    fetchXxxList(); // 或 requestRender()（纯前端过滤时）
  }, SEARCH_DEBOUNCE_MS);
};

searchInput.addEventListener("input", (ev) => {
  state.xxxSearch = searchInput.value || "";
  if (ev.isComposing) return;
  scheduleListSearch();
});
searchInput.addEventListener("compositionend", () => {
  state.xxxSearch = searchInput.value || "";
  scheduleListSearch();
});
searchInput.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  if (_searchDebounceTimer) {
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = null;
  }
  state.xxxSearch = searchInput.value || "";
  state.xxxListPage = 1;
  fetchXxxList();
});
```

### 纯前端过滤（不请求接口）

与用户管理列表类似：防抖回调里 `requestRender()` 即可；**仍须在 `input` 时立即写 state**。

工作台服务端搜索额外要点：`schedule*` 内可设 `state.listRefreshing = true` 并在 `finally` 里清掉，避免长时间无反馈。

## 防抖时长

| 场景 | 常量 / 时长 | 参考 |
|------|-------------|------|
| 工作台、用户管理、局点档案 | **800ms** | `app.js`、`admin-page.js`、`site-profile-page.js` |
| 需求池、重大问题、局点问题等次级列表 | 400ms | `requirement-page.js`、`major-issue-page.js` 等 |
| 列筛选弹层内选项过滤 | 400ms | `column-filter-pop.js` |
| 请假列表 | 300ms | `leave-page.js` |

**新增主列表页搜索**默认跟工作台用 **800ms**；改已有页时优先与**同页最接近的参考页**对齐，不要混用旧写法。

## 列筛选弹层搜索

表头 ⏷ 弹层内的选项搜索**不要**每键 `requestRender()` 整页。复用：

`frontend/modules/ui/column-filter-pop.js` → `bindColumnFilterSearchInput(el, onValue, onApply)`

该工具已包含：立即 `onValue`、composition、防抖 `onApply`、Enter `flushColumnFilterSearchApply`。

## 渲染约定

- `type="search"`
- `value` 绑定 state（`escapeAttr`）
- placeholder 写清可搜字段，勿在页面上堆长段说明（见 `.cursor/rules/frontend-ui-no-inline-prose.mdc`）
- 工作台主列表用 class `search`（`frontend/styles/ticket.css`）；各业务页可用模块前缀 class，行为一致即可

## 测试

改动列表搜索时建议补 **前端静态契约**（`test/frontend_tests/__tests__/`）：

- `input` 时立即写 `state.*Search`（正则或 `toContain`）
- 含 `ev.isComposing`、`compositionend`、Enter 分支
- 拉数 / 导出仍读 `state.*Search.trim()`

示例：`test/frontend_tests/__tests__/site-profile-page.test.js`

有后端 `q` 参数时，同步确认 API 测试仍通过。

## 自检清单

- [ ] `input` 第一行同步 state，**不是**只在防抖里同步
- [ ] `compositionend` 已处理中文输入法
- [ ] Enter 清定时器并立即搜索
- [ ] 搜索重置 `*ListPage = 1`
- [ ] 重绘后输入框 `value` 与用户输入一致
- [ ] README 对应功能节防抖 / 交互说明已更新（若用户可见行为变化）
- [ ] 新增或更新的前端自检用例通过

## 参考实现

| 页面 | 文件 | 备注 |
|------|------|------|
| 工作台 | `frontend/app.js` | **canonical**；服务端 `syncTicketsFromServer` |
| 局点档案 | `frontend/modules/pages/site-profile-page.js` | 服务端 `fetchSiteProfileList` |
| 用户管理 | `frontend/modules/pages/admin-page.js` | 纯 `requestRender` 过滤 |
| 请假 | `frontend/modules/pages/leave-page.js` | 含 composition + Enter |
| 列筛选 | `frontend/modules/ui/column-filter-pop.js` | 弹层专用工具函数 |

## 遗留页对齐

以下页面若出现「搜索清空 / 中文输入异常」，按本 skill 补齐 **立即写 state + composition + Enter**（不要求一次性改防抖毫秒数）：

- `frontend/modules/pages/requirement-page.js`
- `frontend/modules/pages/major-issue-page.js`
- `frontend/modules/pages/major-problem-page.js`
