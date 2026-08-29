/**
 * 质量改进列表（/qi）筛选状态 URL 持久化 —— 接线断言（源码模式，同 ecare-ticket-no-format.test.js）。
 * 行为由 qi-url-state.regression.mjs 兜住，这里锁「改动点在位」：
 * fetchQiList 咽喉点同步、pathname 守卫、tab 切换同步、getUrlByKey 拼 query、/qi 分支恢复。
 */
const fs = require("fs");
const path = require("path");

const QI_PAGE = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/qi-page.js"),
  "utf8"
);
const TICKET_CORE = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/ticket-core.js"),
  "utf8"
);

describe("qi 列表筛选 URL 持久化接线", () => {
  test("qi-page.js 引入 buildQiListQuery / QI_LIST_URL_KEYS", () => {
    expect(QI_PAGE).toMatch(/import \{ buildQiListQuery, QI_LIST_URL_KEYS \} from "\.\.\/utils\/qi-url-state\.js"/);
  });

  test("syncQiListUrl 带 /qi pathname 守卫，且只删自己管辖的键", () => {
    expect(QI_PAGE).toMatch(/function syncQiListUrl\(\)/);
    expect(QI_PAGE).toMatch(/\/\^\\\/qi\\\/\?\$\/\.test\(window\.location\.pathname\)/);
    expect(QI_PAGE).toMatch(/for \(const key of QI_LIST_URL_KEYS\) u\.searchParams\.delete\(key\)/);
    expect(QI_PAGE).toMatch(/replaceState/);
  });

  test("fetchQiList 咽喉点调用 syncQiListUrl（覆盖全部筛选/翻页/数据变更路径）", () => {
    const fnStart = QI_PAGE.indexOf("export async function fetchQiList");
    expect(fnStart).toBeGreaterThan(-1);
    const body = QI_PAGE.slice(fnStart, fnStart + 400);
    expect(body).toMatch(/syncQiListUrl\(\)/);
  });

  test("页签切换 handler 同步 URL（analytics 分支不经过 fetchQiList）", () => {
    const handler = QI_PAGE.slice(
      QI_PAGE.indexOf('btn.getAttribute("data-qi-tab")'),
      QI_PAGE.indexOf('btn.getAttribute("data-qi-tab")') + 500
    );
    expect(handler).toMatch(/state\.qiTab = t; state\.qiListPage = 1;\s*\n\s*syncQiListUrl\(\)/);
  });

  test("ticket-core.js getUrlByKey('qi:manage') 拼接当前筛选 query", () => {
    const seg = TICKET_CORE.slice(
      TICKET_CORE.indexOf('key === "qi:manage"'),
      TICKET_CORE.indexOf('key === "qi:manage"') + 300
    );
    expect(seg).toMatch(/buildQiListQuery\(state\)\.toString\(\)/);
    expect(seg).toMatch(/"\?"/);
  });

  test("syncActiveKeyFromPath /qi 分支从 location.search 恢复筛选状态", () => {
    const seg = TICKET_CORE.slice(
      TICKET_CORE.indexOf('pathname === "/qi"'),
      TICKET_CORE.indexOf('pathname === "/qi"') + 400
    );
    expect(seg).toMatch(/Object\.assign\(state, sanitizeQiListView\(window\.location\.search\)\)/);
    expect(seg).toMatch(/qiNeedsRefresh = true/);
  });

  test("ticket-core.js 引入纯函数模块", () => {
    expect(TICKET_CORE).toMatch(/import \{ buildQiListQuery, sanitizeQiListView \} from "\.\.\/utils\/qi-url-state\.js"/);
  });
});
