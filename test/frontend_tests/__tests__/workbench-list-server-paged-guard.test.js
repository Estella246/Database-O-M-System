/**
 * 列表同步职责划分：须与 frontend/modules/pages/ticket-core.js 中
 * syncHomeWorkbenchTicketLists / syncTicketsFromServer 语义一致。
 */

function shouldClearWorkbenchServerPagedOnLegacyMerge(activeKey, templateCode, ticketNo = "") {
  return activeKey === "list" && templateCode === "HCS_INCIDENT" && !String(ticketNo || "").trim();
}

function shouldSyncHomeHotpatchAfterHcs(activeKey, homeWorkbenchTab) {
  return activeKey === "home" && homeWorkbenchTab === "pending";
}

function templateCodeForListPageEnter(activeKey) {
  if (activeKey === "patch:list") return "HOTPATCH";
  if (activeKey === "list") return "HCS_INCIDENT";
  return "HCS_INCIDENT";
}

describe("shouldClearWorkbenchServerPagedOnLegacyMerge", () => {
  test("工作台 HCS 全量回落 legacy 时清除快照分页标志", () => {
    expect(shouldClearWorkbenchServerPagedOnLegacyMerge("list", "HCS_INCIDENT")).toBe(true);
  });

  test("工作台 HOTPATCH 合并时保留快照分页标志", () => {
    expect(shouldClearWorkbenchServerPagedOnLegacyMerge("list", "HOTPATCH")).toBe(false);
  });

  test("单条工单预载不清除快照分页", () => {
    expect(
      shouldClearWorkbenchServerPagedOnLegacyMerge("list", "HCS_INCIDENT", "YW20260101001")
    ).toBe(false);
  });
});

describe("shouldSyncHomeHotpatchAfterHcs", () => {
  test("主页待办页签才继续拉 HOTPATCH", () => {
    expect(shouldSyncHomeHotpatchAfterHcs("home", "pending")).toBe(true);
  });

  test("主页其它页签不拉 HOTPATCH", () => {
    expect(shouldSyncHomeHotpatchAfterHcs("home", "pending_close")).toBe(false);
    expect(shouldSyncHomeHotpatchAfterHcs("home", "audit_close")).toBe(false);
  });

  test("已切到工作台/补丁管理不再拉 HOTPATCH", () => {
    expect(shouldSyncHomeHotpatchAfterHcs("list", "pending")).toBe(false);
    expect(shouldSyncHomeHotpatchAfterHcs("patch:list", "pending")).toBe(false);
  });
});

describe("templateCodeForListPageEnter", () => {
  test("进入工作台只拉 HCS", () => {
    expect(templateCodeForListPageEnter("list")).toBe("HCS_INCIDENT");
  });

  test("进入补丁管理只拉 HOTPATCH", () => {
    expect(templateCodeForListPageEnter("patch:list")).toBe("HOTPATCH");
  });
});
