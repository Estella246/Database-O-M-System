---
name: list-search-input
description: 列表页工具栏搜索框须与工作台一致：input 立即写 state、中文输入法 composition、Enter 立即搜索、防抖拉数、重绘后恢复焦点。在实现或修复工作台、局点档案、用户管理、请假等列表搜索框时使用。
---

# 列表页搜索框

## 标准行为（以工作台为准）

参考 `frontend/modules/ui/list-search-input.js` 与工作台 `#ticket-list-search-input`：

1. **输入时立即同步 state**（`onValue` / `input` 第一行就写 `state.*Search`）
2. **中文输入法**：`input` 中 `if (ev.isComposing) return`；另绑 `compositionend`
3. **防抖后刷新**：停止输入一段时间后再拉数 / 重绘
4. **Enter 立即搜索**：清掉 pending 定时器，同步 state，立刻执行刷新（不等防抖）
5. **搜索时重置到第 1 页**
6. **拉数前不要整页 `render()`**：搜索触发时用 `markSkipListLoadingRender` / `consumeSkipListLoadingRender` 跳过 fetch 开头的 loading 重绘；可用就地改「刷新中…」
7. **拉数/重绘后恢复焦点**：`armListSearchFocusRestore` + `render()` 末尾 `restoreListSearchFocus()`
8. **输入期间挂起整页 render（方案 A）**：`render()` 开头若 `shouldDeferListSearchRender()`（搜索框聚焦且未停手、正在拼音、或防抖/拉数未完成）则 `markListSearchRenderDeferred()` 并 return；**勿在搜索结果未到前 quiet flush 旧列表**；停手 / blur / Enter / 拉数结束后再 `flushDeferredListSearchRender()`
9. **成功重绘只算一次**：`render()` 实际执行时须 `clearListSearchRenderDeferred()`，避免「先 render 再 flush」把同一批结果画两遍；`flushDeferredListSearchRender` 冲刷前也走同一 clear


## 最常见 Bug（必避）

本仓库列表经 `requestRender()` → `render()` 用 `innerHTML` 整体重绘，搜索框 `value` 来自 **state**：

```html
<input … value="${escapeAttr(state.xxxSearch)}" />
```

**错误**：只在 `setTimeout` 防抖回调里才 `state.xxxSearch = input.value`。用户输入后若先触发 `fetch*List()` / `requestRender()`，重绘会把输入框还原成旧关键词，表现为「打字被清空 / 搜不动」。

**正确**：`input` / `compositionend` / `keydown(Enter)` 都**先**写 state，再调度防抖或立即拉数；重绘后恢复 focus。

## 推荐用法

优先复用公共工具，勿再手写一套防抖：

```javascript
import {
  bindListSearchInput,
  consumeSkipListLoadingRender,
} from "../ui/list-search-input.js";

// fetch 开头：
if (!consumeSkipListLoadingRender()) requestRender();

// bind*Page 内：
bindListSearchInput(document.getElementById("xxx-search-input"), {
  // debounceMs 默认 LIST_SEARCH_DEBOUNCE_MS（500）；局点/用户管理等可显式传 800
  // 纯前端过滤传 skipLoadingRender: false
  onValue: (v) => {
    state.xxxSearch = v;
  },
  onSearch: () => {
    state.xxxListPage = 1;
    fetchXxxList(); // 或 requestRender()
  },
});
```

`app.js` 的 `render()` 末尾须调用 `restoreListSearchFocus()`（已接入）。

### 纯前端过滤（不请求接口）

与用户管理 / 版本参数 / 列选择类似：`skipLoadingRender: false`，`onSearch` 里 `requestRender()`；**仍须立即写 state**，并依赖公共焦点恢复。

工作台服务端搜索：拉数前用就地 UI（`setListRefreshingUi`）设 `listRefreshing`，**禁止**为显示「刷新中」先整页 `render()`；拉数前 `armListSearchFocusRestore`。

## 防抖时长

| 场景 | 常量 / 时长 | 参考 |
|------|-------------|------|
| 工作台（防抖 = 停手重绘） | **500ms** | `LIST_SEARCH_DEBOUNCE_MS`（`list-search-input.js` / `app.js`） |
| 用户管理、局点档案 | **800ms** | `admin-page.js`、`site-profile-page.js` |
| 需求池、重大问题、局点问题、工具广场、列选择、版本参数、迁入弹窗 | **400ms** | 各业务页 |
| 列筛选弹层内选项过滤 | **400ms** | `column-filter-pop.js` |
| 请假列表 | **300ms** | `leave-page.js` |

**新增主列表页搜索**默认跟工作台用 **`LIST_SEARCH_DEBOUNCE_MS`（500ms）**；局点档案/用户管理等已有页可保留 800ms。交互原则（立即写 state / composition / Enter / 焦点恢复 / 挂起）必须统一。

## 列筛选弹层搜索

表头 ⏷ 弹层内的选项搜索**不要**每键 `requestRender()` 整页。复用：

`frontend/modules/ui/column-filter-pop.js` → `bindColumnFilterSearchInput(el, onValue, onApply)`

该工具已包含：立即 `onValue`、composition、防抖 `onApply`、Enter `flushColumnFilterSearchApply`，以及 apply 前 `armListSearchFocusRestore`。

## 渲染约定

- `type="search"`
- `value` 绑定 state（`escapeAttr`）
- placeholder 写清可搜字段，勿在页面上堆长段说明（见 `.cursor/rules/frontend-ui-no-inline-prose.mdc`）
- 工作台主列表用 class `search`（`frontend/styles/ticket.css`）；各业务页可用模块前缀 class，行为一致即可

## 测试

改动列表搜索时建议补 **前端静态契约**（`test/frontend_tests/__tests__/`）：

- 页面使用 `bindListSearchInput`（或工具广场等价的 arm + composition）
- 服务端列表 `consumeSkipListLoadingRender`
- `app.js` 含 `restoreListSearchFocus()`

示例：`list-search-input-pages.test.js`、`site-profile-page.test.js`、`workbench-ticket-search.test.js`

## 自检清单

- [ ] `input` 第一行同步 state，**不是**只在防抖里同步
- [ ] `compositionend` 已处理中文输入法
- [ ] Enter 清定时器并立即搜索
- [ ] 搜索重置 `*ListPage = 1`
- [ ] 搜索触发的拉数跳过 loading 整页 render（服务端列表）
- [ ] 输入/拼音期间不整页 `render`（`shouldDeferListSearchRender`）
- [ ] 成功重绘时 `clearListSearchRenderDeferred`，避免 flush 再绘一次
- [ ] 重绘后输入框 `value` 与焦点/光标与用户输入一致
- [ ] README 对应功能节防抖 / 交互说明已更新（若用户可见行为变化）
- [ ] 新增或更新的前端自检用例通过

## 参考实现

| 页面 | 文件 | 备注 |
|------|------|------|
| 公共工具 | `frontend/modules/ui/list-search-input.js` | **canonical API** |
| 工作台 | `frontend/app.js` | 防抖 500ms（与 quiet 同常量）；就地刷新按钮 + arm 焦点 |
| 局点档案 | `site-profile-page.js` | `bindListSearchInput` + skip loading |
| 用户管理 | `admin-page.js` | 纯 `requestRender` |
| 请假 | `leave-page.js` | 300ms |
| 列筛选 | `column-filter-pop.js` | 弹层专用 |
