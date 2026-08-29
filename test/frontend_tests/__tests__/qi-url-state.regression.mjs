/**
 * 质量改进列表（/qi）筛选状态 URL 持久化 —— 纯函数行为回归。
 * 覆盖：默认值、build/sanitize 往返、枚举校验、日期校验、截长、未知键忽略、重复键取首。
 * 运行：node --test test/frontend_tests/__tests__/qi-url-state.regression.mjs
 * （jest 无 ESM 配置不能 import ES Module，故走 node:test 真导入，同 get-whitelist-key-by-active-key.regression.mjs 模式）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(
  join(__dirname, "../../../frontend/modules/utils/qi-url-state.js")
).href;

async function loadModule() {
  return await import(moduleUrl);
}

test("sanitizeQiListView：空/无 query → 全默认值", async () => {
  const { sanitizeQiListView } = await loadModule();
  for (const input of ["", "?", "?action=create-ticket&api=http://x"]) {
    const v = sanitizeQiListView(input);
    assert.equal(v.qiTab, "all");
    assert.equal(v.qiListSearch, "");
    assert.deepEqual(v.qiListFilters, {});
    assert.equal(v.qiListPage, 1);
    assert.equal(v.qiListPageSize, 10);
  }
});

test("buildQiListQuery：全默认值 → 空 query（URL 干净）", async () => {
  const { buildQiListQuery } = await loadModule();
  const qs = buildQiListQuery({
    qiTab: "all", qiListSearch: "", qiListFilters: {},
    qiListPage: 1, qiListPageSize: 10,
  });
  assert.equal(qs.toString(), "");
});

test("build → sanitize 往返恒等（含 CJK、全部键）", async () => {
  const { buildQiListQuery, sanitizeQiListView } = await loadModule();
  const view = {
    qiTab: "mine",
    qiListSearch: "慢SQL 恢复",
    qiListFilters: {
      stage: "review", category: "质量加固和改进", priority: "高",
      domain: "SQL引擎", module_feature: "驱动/JDBC",
      proposer: "测试管理员 test_admin", related_ticket_no: "YW20260828001",
      is_overdue: "true", start_date: "2026-08-01", end_date: "2026-08-28",
    },
    qiListPage: 3,
    qiListPageSize: 50,
  };
  const qs = buildQiListQuery(view).toString();
  const back = sanitizeQiListView(qs);
  assert.equal(back.qiTab, view.qiTab);
  assert.equal(back.qiListSearch, view.qiListSearch);
  assert.deepEqual(back.qiListFilters, view.qiListFilters);
  assert.equal(back.qiListPage, view.qiListPage);
  assert.equal(back.qiListPageSize, view.qiListPageSize);
  // 再往复一次仍稳定（toString 确定性）
  assert.equal(buildQiListQuery(back).toString(), qs);
});

test("sanitizeQiListView：tab 枚举校验，非法 → all", async () => {
  const { sanitizeQiListView } = await loadModule();
  assert.equal(sanitizeQiListView("?tab=mine").qiTab, "mine");
  assert.equal(sanitizeQiListView("?tab=handled").qiTab, "handled");
  assert.equal(sanitizeQiListView("?tab=analytics").qiTab, "analytics");
  assert.equal(sanitizeQiListView("?tab=evil").qiTab, "all");
  assert.equal(sanitizeQiListView("?tab=").qiTab, "all");
});

test("sanitizeQiListView：is_overdue 仅收 true/false，其余丢弃", async () => {
  const { sanitizeQiListView } = await loadModule();
  assert.equal(sanitizeQiListView("?is_overdue=true").qiListFilters.is_overdue, "true");
  assert.equal(sanitizeQiListView("?is_overdue=false").qiListFilters.is_overdue, "false");
  assert.equal(sanitizeQiListView("?is_overdue=1").qiListFilters.is_overdue, undefined);
  assert.equal(sanitizeQiListView("?is_overdue=yes").qiListFilters.is_overdue, undefined);
});

test("sanitizeQiListView：日期仅收 YYYY-MM-DD", async () => {
  const { sanitizeQiListView } = await loadModule();
  const ok = sanitizeQiListView("?start_date=2026-08-01&end_date=2026-08-28").qiListFilters;
  assert.equal(ok.start_date, "2026-08-01");
  assert.equal(ok.end_date, "2026-08-28");
  const bad = sanitizeQiListView("?start_date=2026/08/01&end_date=abc").qiListFilters;
  assert.equal(bad.start_date, undefined);
  assert.equal(bad.end_date, undefined);
});

test("sanitizeQiListView：page/page_size 校验与回落", async () => {
  const { sanitizeQiListView } = await loadModule();
  assert.equal(sanitizeQiListView("?page=7").qiListPage, 7);
  assert.equal(sanitizeQiListView("?page=0").qiListPage, 1);
  assert.equal(sanitizeQiListView("?page=-3").qiListPage, 1);
  assert.equal(sanitizeQiListView("?page=abc").qiListPage, 1);
  assert.equal(sanitizeQiListView("?page=99999").qiListPage, 10000); // 上限
  assert.equal(sanitizeQiListView("?page_size=100").qiListPageSize, 100);
  assert.equal(sanitizeQiListView("?page_size=30").qiListPageSize, 10); // 非法值回落
  assert.equal(sanitizeQiListView("?page_size=abc").qiListPageSize, 10);
});

test("sanitizeQiListView：未知键忽略、重复键取首、超长截断", async () => {
  const { sanitizeQiListView, buildQiListQuery, QI_URL_FILTER_KEYS, QI_LIST_URL_KEYS } = await loadModule();
  // 未知键忽略（action/api 是其它机制的键，不得进筛选）
  const v = sanitizeQiListView("?action=create-ticket&api=http://x&foo=bar&priority=%E9%AB%98");
  assert.equal(v.qiListFilters.priority, "高");
  assert.equal(v.qiListFilters.foo, undefined);
  assert.equal(v.qiListFilters.action, undefined);
  assert.equal(v.qiListFilters.api, undefined);
  // 重复键取首（URLSearchParams.get 语义）
  assert.equal(sanitizeQiListView("?priority=%E9%AB%98&priority=%E4%B8%AD").qiListFilters.priority, "高");
  // 超长截断
  const long = "A".repeat(500);
  const clipped = sanitizeQiListView("?related_ticket_no=" + long).qiListFilters.related_ticket_no;
  assert.equal(clipped.length, 64);
  const longQ = "B".repeat(500);
  assert.equal(sanitizeQiListView("?q=" + longQ).qiListSearch.length, 200);
  // 空白 trim 后为空的筛选值不产出键
  assert.equal(buildQiListQuery({ qiListFilters: { priority: "  " } }).toString(), "");
  // 常量完整性：URL 键 = tab/q/page/page_size + 全部筛选键
  assert.deepEqual(
    [...QI_LIST_URL_KEYS],
    ["tab", "q", "page", "page_size", ...QI_URL_FILTER_KEYS]
  );
});

test("buildQiListQuery：防御式读取（null/undefined 视图不抛错）", async () => {
  const { buildQiListQuery } = await loadModule();
  assert.equal(buildQiListQuery(null).toString(), "");
  assert.equal(buildQiListQuery(undefined).toString(), "");
  assert.equal(buildQiListQuery({}).toString(), "");
});
