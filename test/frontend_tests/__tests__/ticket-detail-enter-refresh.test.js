/**
 * 从主页/工作台进入工单详情时须丢弃本地详情缓存并拉服务端最新态。
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

describe("ticket detail enter refresh", () => {
  test("prepareTicketDetailEnter 进入时清理缓存并标记 hydrating", () => {
    expect(pageSrc).toMatch(/export function invalidateTicketDetailSession/);
    expect(pageSrc).toMatch(/invalidateTicketDetailSession\(id\)/);
    expect(pageSrc).toMatch(/state\.ticketDetailHydratingOrderId = id/);
    expect(pageSrc).not.toMatch(/detailFormsReady\(id\) \? "" : id/);
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

  test("导航进入工单详情时 sync 当前单并预加载后 render", () => {
    const block = coreSrc.slice(
      coreSrc.indexOf("if (typeof nextKey === \"string\" && nextKey.startsWith(\"ticket:\"))"),
      coreSrc.indexOf("let _ticketListSyncSeq"),
    );
    expect(block).toMatch(/syncSingleTicketFromServer\(orderId\)/);
    expect(block).toMatch(/preloadTicketDetailContent\(orderId\)/);
    expect(block).toMatch(/renderFn\(\)/);
    expect(block).not.toMatch(/ensureDeepLinkTicketLoaded/);
  });
});
