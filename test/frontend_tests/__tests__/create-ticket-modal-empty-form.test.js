/**
 * 创建弹窗不应带入已有工单的节点数据或详情页表单缓存。
 * 逻辑须与 frontend/modules/pages/ticket-page.js ensureNodeFormData / bindNodeForms 一致（Jest CJS 内联）。
 */

function shouldReloadFormState(createDraft, formState) {
  if (createDraft) return true;
  return !(formState.loading || formState.loaded || formState.failed);
}

function resolveCreateDraftValues(createDraft, dataValues) {
  if (createDraft) return {};
  return dataValues || {};
}

function shouldBindNodeForm(formOrderId, bindOrderId) {
  return String(formOrderId || "").trim() === String(bindOrderId || "").trim();
}

describe("create ticket modal empty form", () => {
  test("createDraft 强制重新加载，忽略已 loaded 的缓存", () => {
    expect(shouldReloadFormState(true, { loaded: true, loading: false, failed: false })).toBe(true);
    expect(shouldReloadFormState(false, { loaded: true, loading: false, failed: false })).toBe(false);
    expect(shouldReloadFormState(false, { loaded: false, loading: true, failed: false })).toBe(false);
  });

  test("createDraft 不使用接口返回的 values", () => {
    const prev = { issue_desc: "旧单描述", location: "某局点" };
    expect(resolveCreateDraftValues(true, prev)).toEqual({});
    expect(resolveCreateDraftValues(false, prev)).toEqual(prev);
  });

  test("bindNodeForms 仅绑定与传入 orderId 一致的表单", () => {
    expect(shouldBindNodeForm("YW20260616001", "YW20260616001")).toBe(true);
    expect(shouldBindNodeForm("YW20260616001", "YW20260616002")).toBe(false);
    expect(shouldBindNodeForm("  YW20260616001 ", "YW20260616001")).toBe(true);
  });
});
