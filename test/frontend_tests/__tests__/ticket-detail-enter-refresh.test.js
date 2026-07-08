/**
 * 工单详情进入刷新策略：首次从列表进入强制拉服务端；已开页签且有本地会话则保留编辑态。
 */

const fs = require("fs");
const path = require("path");

const pageSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js"),
  "utf8",
);
const coreSrc = fs.readFileSync(
  path.resolve(__dirname, "../../../frontend/modules/pages/ticket-core.js"),
  "utf8",
);

function isTicketTabOpen(orderId, openTabs = []) {
  const id = String(orderId || "").trim();
  if (!id) return false;
  return openTabs.some((tab) => tab.key === `ticket:${id}`);
}

function hasTicketDetailSession(orderId, formsByTicket = {}) {
  const id = String(orderId || "").trim();
  if (!id) return false;
  const prefix = `${id}:`;
  return Object.keys(formsByTicket).some((k) => String(k).startsWith(prefix));
}

function shouldForceRefreshTicketDetailOnEnter(orderId, { openTabs = [], formsByTicket = {} } = {}) {
  if (isTicketTabOpen(orderId, openTabs) && hasTicketDetailSession(orderId, formsByTicket)) return false;
  return true;
}

describe("shouldForceRefreshTicketDetailOnEnter", () => {
  const orderId = "YW20260101001";

  test("首次从列表点进（页签未开）须强制刷新", () => {
    expect(shouldForceRefreshTicketDetailOnEnter(orderId, { openTabs: [], formsByTicket: {} })).toBe(true);
  });

  test("页签已开且有表单会话时不强制刷新", () => {
    expect(
      shouldForceRefreshTicketDetailOnEnter(orderId, {
        openTabs: [{ key: `ticket:${orderId}`, label: orderId }],
        formsByTicket: { [`${orderId}:problem_fill`]: { loaded: true, values: { issue_desc: "草稿" } } },
      })
    ).toBe(false);
  });

  test("页签已开但无表单会话时仍强制刷新", () => {
    expect(
      shouldForceRefreshTicketDetailOnEnter(orderId, {
        openTabs: [{ key: `ticket:${orderId}`, label: orderId }],
        formsByTicket: {},
      })
    ).toBe(true);
  });

  test("有表单会话但页签已关闭时仍强制刷新", () => {
    expect(
      shouldForceRefreshTicketDetailOnEnter(orderId, {
        openTabs: [],
        formsByTicket: { [`${orderId}:ops_analysis`]: { loaded: true } },
      })
    ).toBe(true);
  });
});

describe("ticket detail enter refresh (source)", () => {
  test("导出页签与会话判定及条件刷新", () => {
    expect(pageSrc).toMatch(/export function isTicketTabOpen/);
    expect(pageSrc).toMatch(/export function hasTicketDetailSession/);
    expect(pageSrc).toMatch(/export function shouldForceRefreshTicketDetailOnEnter/);
    expect(pageSrc).toMatch(/shouldForceRefreshTicketDetailOnEnter\(id\)/);
    expect(pageSrc).toMatch(/options\.forceRefresh/);
  });

  test("invalidateTicketDetailSession 清理表单、日志与 workflow 本地态", () => {
    const block = pageSrc.slice(
      pageSrc.indexOf("export function invalidateTicketDetailSession"),
      pageSrc.indexOf("export function prepareTicketDetailEnter"),
    );
    expect(block).toMatch(/clearTicketFormCache\(id\)/);
    expect(block).toMatch(/delete state\.logSyncStateByOrderId\[id\]/);
    expect(block).toMatch(/delete operationLogsByOrderId\[id\]/);
    expect(block).toMatch(/logs: \[\]/);
    expect(block).toMatch(/isCreateDraftTicketId\(id\)/);
  });

  test("preloadTicketDetailContent 先同步操作日志再拉节点表单", () => {
    const block = pageSrc.slice(
      pageSrc.indexOf("export async function preloadTicketDetailContent"),
      pageSrc.indexOf("export function isTicketDetailShowLoading"),
    );
    const logIdx = block.indexOf("syncOperationLogsFromServer");
    const formIdx = block.indexOf("ensureNodeFormData");
    expect(logIdx).toBeGreaterThanOrEqual(0);
    expect(formIdx).toBeGreaterThan(logIdx);
    expect(block).toMatch(/force:\s*true/);
  });

  test("导航进入工单详情时仅 hydrating 时 sync 并预加载", () => {
    const block = coreSrc.slice(
      coreSrc.indexOf('if (typeof nextKey === "string" && nextKey.startsWith("ticket:"))'),
      coreSrc.indexOf("let _ticketListSyncSeq"),
    );
    expect(block).toMatch(/if\s*\(state\.ticketDetailHydratingOrderId\s*===\s*orderId\)/);
    expect(block).toMatch(/syncSingleTicketFromServer\(orderId\)/);
    expect(block).toMatch(/preloadTicketDetailContent\(orderId\)/);
    expect(block).toMatch(/renderFn\(\)/);
    expect(block).not.toMatch(/ensureDeepLinkTicketLoaded/);
  });
});
