/** 运维分析：根因分类选项随「问题类型」联动（来自参数配置 / schema options_by_parent） */

export function getRootCauseCategoriesForIssueType(field, issueType) {
  const parent = field?.options_by_parent;
  if (!parent || typeof parent !== "object") {
    return Array.isArray(field?.options) ? field.options : [];
  }
  const map = parent.map && typeof parent.map === "object" ? parent.map : {};
  const key = String(issueType || "").trim();
  const list = map[key];
  return Array.isArray(list) ? list.filter((x) => String(x || "").trim()) : [];
}

export function issueRootCauseRowByType(items, issueType) {
  const list = Array.isArray(items) ? items : [];
  return list.find((r) => String(r.issue_type || "") === issueType) || null;
}

export function mergeIssueRootCauseItemsFromApi(data) {
  const issueTypes = Array.isArray(data?.issue_types) ? data.issue_types.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const byType = Object.fromEntries(
    (Array.isArray(data?.items) ? data.items : []).map((x) => [
      String(x.issue_type || "").trim(),
      Array.isArray(x.categories) ? x.categories.map((c) => String(c || "").trim()).filter(Boolean) : [],
    ])
  );
  return issueTypes.map((issue_type) => ({
    issue_type,
    categories: [...(byType[issue_type] || [])],
  }));
}

export function defaultIssueRootCauseList(issueTypes) {
  const types = Array.isArray(issueTypes) && issueTypes.length ? issueTypes : [];
  return types.map((issue_type) => ({ issue_type, categories: [] }));
}

export function validateIssueRootCauseDraft(items) {
  const list = Array.isArray(items) ? items : [];
  const seen = new Set();
  for (const row of list) {
    const t = String(row?.issue_type || "").trim();
    if (!t) return { ok: false, message: "问题类型不能为空" };
    if (seen.has(t)) return { ok: false, message: `问题类型重复：${t}` };
    seen.add(t);
  }
  return { ok: true };
}

export function resolveActiveIssueTypeIndex(items, activeType) {
  const list = Array.isArray(items) ? items : [];
  const key = String(activeType || "").trim();
  if (!list.length) return -1;
  const idx = list.findIndex((r) => String(r.issue_type || "").trim() === key);
  return idx >= 0 ? idx : 0;
}
