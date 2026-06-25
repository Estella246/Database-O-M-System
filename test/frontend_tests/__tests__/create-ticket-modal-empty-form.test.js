/**
 * 创建弹窗不应带入已有工单的节点数据或详情页表单缓存。
 * 逻辑须与 frontend/modules/pages/ticket-page.js / ticket-core.js 一致（Jest CJS 内联）。
 */

const fs = require("fs");
const path = require("path");

const TICKET_PAGE = path.resolve(__dirname, "../../../frontend/modules/pages/ticket-page.js");
const ticketPageSrc = fs.readFileSync(TICKET_PAGE, "utf8");

function resolveCreateDraftValues(createDraft, dataValues) {
  if (createDraft) return {};
  return dataValues || {};
}

function shouldBindNodeForm(formOrderId, bindOrderId) {
  return String(formOrderId || "").trim() === String(bindOrderId || "").trim();
}

function shouldSkipEnsureNodeFormReload(formState) {
  return formState.loading || formState.loaded || formState.failed;
}

function clearTicketFormCache(orderId, formsByTicket) {
  const id = String(orderId || "").trim();
  if (!id) return;
  Object.keys(formsByTicket).forEach((k) => {
    if (k.startsWith(`${id}:`)) delete formsByTicket[k];
  });
}

function shouldCloseCreateModalOnNav(activeKey, createModalOpen) {
  return createModalOpen && activeKey !== "list" && activeKey !== "patch:list";
}

describe("create ticket modal empty form", () => {
  test("createDraft 不使用接口返回的 values", () => {
    const prev = { issue_desc: "旧单描述", location: "某局点" };
    expect(resolveCreateDraftValues(true, prev)).toEqual({});
    expect(resolveCreateDraftValues(false, prev)).toEqual(prev);
  });

  test("ensureNodeFormData 在已 loaded 时不重复加载（避免 render 循环）", () => {
    expect(shouldSkipEnsureNodeFormReload({ loading: false, loaded: true, failed: false })).toBe(true);
    expect(shouldSkipEnsureNodeFormReload({ loading: true, loaded: false, failed: false })).toBe(true);
    expect(shouldSkipEnsureNodeFormReload({ loading: false, loaded: false, failed: false })).toBe(false);
  });

  test("bindNodeForms 仅绑定与传入 orderId 一致的表单", () => {
    expect(shouldBindNodeForm("YW20260616001", "YW20260616001")).toBe(true);
    expect(shouldBindNodeForm("YW20260616001", "YW20260616002")).toBe(false);
    expect(shouldBindNodeForm("  YW20260616001 ", "YW20260616001")).toBe(true);
  });

  test("clearTicketFormCache 清除该工单全部节点缓存", () => {
    const cache = {
      "YW20260616001:problem_fill": { values: { a: 1 } },
      "YW20260616001:ops_analysis": { values: { b: 2 } },
      "YW20260616002:problem_fill": { values: { c: 3 } },
    };
    clearTicketFormCache("YW20260616001", cache);
    expect(cache).toEqual({ "YW20260616002:problem_fill": { values: { c: 3 } } });
  });

  test("离开工作台/补丁列表时应关闭创建弹窗", () => {
    expect(shouldCloseCreateModalOnNav("list", true)).toBe(false);
    expect(shouldCloseCreateModalOnNav("patch:list", true)).toBe(false);
    expect(shouldCloseCreateModalOnNav("ticket:YW20260616001", true)).toBe(true);
    expect(shouldCloseCreateModalOnNav("home", true)).toBe(true);
    expect(shouldCloseCreateModalOnNav("home", false)).toBe(false);
  });

  test("创建弹窗提交成功后延后清除 saving，防止重复建单", () => {
    expect(ticketPageSrc).toMatch(/isCreateModalSubmit/);
    expect(ticketPageSrc).toMatch(/deferSavingClear:\s*isCreateModalSubmit/);
    expect(ticketPageSrc).toMatch(/if\s*\(isCreateModalSubmit\)\s*\{[\s\S]*finally[\s\S]*formState\.saving\s*=\s*false/);
  });

  test("打开创建弹窗不预取服务端流程号", () => {
    const coreSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../frontend/modules/pages/ticket-core.js"),
      "utf8"
    );
    expect(coreSrc).toMatch(/makeCreateDraftTicketId\(\)/);
    expect(coreSrc).not.toMatch(/fetchAllocatedTicketNo/);
  });
});
