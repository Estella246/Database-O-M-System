// 质量改进列表（/qi）筛选状态 URL 持久化：纯函数，零 import（qi-page.js 与 ticket-core.js 双方安全引入）
// URL 参数名 = state 字段键名原样；到后端参数的映射（is_overdue→overdue、qiTab→scope）保持在 fetchQiList 现有代码。

// qiListFilters 支持的筛选键（date_range 由 start_date + end_date 两键组成）
export const QI_URL_FILTER_KEYS = [
  "stage", "category", "priority", "domain", "module_feature",
  "proposer", "related_ticket_no", "is_overdue", "start_date", "end_date",
];

// 本模块管辖的全部 URL 键（syncQiListUrl 只删这些，保留 ?api= 等无关参数）
export const QI_LIST_URL_KEYS = ["tab", "q", "page", "page_size", ...QI_URL_FILTER_KEYS];

// 逐键最大长度（字符），防 URL 被恶意/超长值撑爆
const KEY_MAX_LEN = {
  stage: 32, category: 32, priority: 8, domain: 200, module_feature: 200,
  proposer: 100, related_ticket_no: 64,
};

const QI_TAB_VALUES = ["all", "mine", "handled", "analytics"];
const QI_PAGE_SIZE_VALUES = [10, 20, 50, 100];
// 枚举筛选的合法值（本地副本：本模块约定零 import，由 qi-url-state.regression.mjs 与 constants/qi.js 锁定一致；
// 非法值（如改名后书签里的废弃分类）直接丢弃，避免恢复出"图标亮着但查 0 行"的死筛选）
const QI_FILTER_ENUM_VALUES = {
  category: ["定位定界", "易用性提升", "特性加固", "快速恢复", "产品规格", "升级", "资料"],
  priority: ["高", "中", "低"],
  stage: ["propose", "review", "analysis", "closure", "acceptance"],
};
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const Q_MAX_LEN = 200;

function _clip(v, max) {
  const s = String(v == null ? "" : v).trim();
  return s ? s.slice(0, max) : "";
}

// {qiTab,qiListSearch,qiListFilters,qiListPage,qiListPageSize} → URLSearchParams
// 默认值/空值不写键，保证 toString() 稳定（供「同 URL 跳过」判断）与干净 URL
export function buildQiListQuery(view) {
  const v = view || {};
  const params = new URLSearchParams();
  const tab = String(v.qiTab || "all");
  if (tab !== "all") params.set("tab", tab);
  const q = _clip(v.qiListSearch, Q_MAX_LEN);
  if (q) params.set("q", q);
  const filters = v.qiListFilters || {};
  for (const key of QI_URL_FILTER_KEYS) {
    if (key === "is_overdue") {
      if (filters.is_overdue === "true" || filters.is_overdue === "false") {
        params.set("is_overdue", filters.is_overdue);
      }
      continue;
    }
    if (key === "start_date" || key === "end_date") {
      const d = String(filters[key] || "").trim();
      if (YMD_RE.test(d)) params.set(key, d);
      continue;
    }
    const val = _clip(filters[key], KEY_MAX_LEN[key] || 100);
    if (val) params.set(key, val);
  }
  const page = Number(v.qiListPage);
  if (Number.isInteger(page) && page > 1) params.set("page", String(page));
  const pageSize = Number(v.qiListPageSize);
  if (QI_PAGE_SIZE_VALUES.includes(pageSize) && pageSize !== 10) params.set("page_size", String(pageSize));
  return params;
}

// URLSearchParams | string → {qiTab,qiListSearch,qiListFilters,qiListPage,qiListPageSize}
// 未知键忽略；非法值回落默认（后端 scope 非法会 400，净化保证恢复后参数必合法）
export function sanitizeQiListView(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search || ""));
  const tab = String(params.get("tab") || "all");
  const out = {
    qiTab: QI_TAB_VALUES.includes(tab) ? tab : "all",
    qiListSearch: _clip(params.get("q"), Q_MAX_LEN),
    qiListFilters: {},
    qiListPage: 1,
    qiListPageSize: 10,
  };
  for (const key of QI_URL_FILTER_KEYS) {
    if (key === "is_overdue") {
      const ov = String(params.get("is_overdue") || "");
      if (ov === "true" || ov === "false") out.qiListFilters.is_overdue = ov;
      continue;
    }
    if (key === "start_date" || key === "end_date") {
      const d = String(params.get(key) || "").trim();
      if (YMD_RE.test(d)) out.qiListFilters[key] = d;
      continue;
    }
    const val = _clip(params.get(key), KEY_MAX_LEN[key] || 100);
    // 枚举键须为合法值，非法（含改名后废弃的旧分类）丢弃回落默认
    if (QI_FILTER_ENUM_VALUES[key] && !QI_FILTER_ENUM_VALUES[key].includes(val)) continue;
    if (val) out.qiListFilters[key] = val;
  }
  const page = Number(params.get("page"));
  if (Number.isInteger(page) && page >= 1) out.qiListPage = Math.min(page, 10000);
  const pageSize = Number(params.get("page_size"));
  if (QI_PAGE_SIZE_VALUES.includes(pageSize)) out.qiListPageSize = pageSize;
  return out;
}
