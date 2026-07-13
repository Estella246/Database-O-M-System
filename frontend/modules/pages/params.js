import { GROUP_TEMPLATE_KINDS, GROUP_TEMPLATE_NAME_DEFAULTS } from "../constants/theme.js";

export function filterVersionBaselineRows(rows, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return rows || [];
  return (rows || []).filter((r) => {
    const a = String(r.version_label || "").toLowerCase();
    const b = String(r.commit_hash || "").toLowerCase();
    return a.includes(s) || b.includes(s);
  });
}

export function filterVersionHotfixRows(rows, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return rows || [];
  return (rows || []).filter((r) => {
    const h = String(r.hotfix_label || "").toLowerCase();
    const bv = String(r.baseline_version_label || "").toLowerCase();
    const bc = String(r.baseline_commit_hash || "").toLowerCase();
    return h.includes(s) || bv.includes(s) || bc.includes(s);
  });
}

export function formatBaselinePickLabel(row) {
  const v = String(row?.version_label || "").trim();
  const c = String(row?.commit_hash || "").trim();
  return c ? `${v}（${c}）` : v || "—";
}

export function defaultGroupTemplateList() {
  return GROUP_TEMPLATE_KINDS.map(({ kind }) => ({
    problem_kind: kind,
    group_name_tpl: GROUP_TEMPLATE_NAME_DEFAULTS[kind] || "",
    group_notice_tpl: "",
    group_members_tpl: "",
    first_report_tpl: "",
  }));
}

export function mergeGroupTemplateItemsFromApi(items) {
  const byKind = Object.fromEntries(
    (Array.isArray(items) ? items : []).map((x) => [String(x.problem_kind || "").trim(), x])
  );
  return GROUP_TEMPLATE_KINDS.map(({ kind }) => {
    const row = byKind[kind];
    if (!row) {
      return {
        problem_kind: kind,
        group_name_tpl: GROUP_TEMPLATE_NAME_DEFAULTS[kind] || "",
        group_notice_tpl: "",
        group_members_tpl: "",
        first_report_tpl: "",
      };
    }
    return {
      problem_kind: kind,
      group_name_tpl: String(row.group_name_tpl ?? ""),
      group_notice_tpl: String(row.group_notice_tpl ?? ""),
      group_members_tpl: String(row.group_members_tpl ?? ""),
      first_report_tpl: String(row.first_report_tpl ?? ""),
    };
  });
}

export function groupTemplateRowByKind(items, kind) {
  const list = Array.isArray(items) ? items : [];
  return list.find((r) => String(r.problem_kind || "") === kind) || null;
}

export function getParamsPageHeadline(activeKey) {
  if (activeKey === "params:duty-field") return "责任田模块";
  if (activeKey === "params:version") return "版本模块";
  if (activeKey === "params:group-template") return "拉群模版";
  if (activeKey === "params:issue-root-cause") return "问题根因";
  if (activeKey === "params:llm-config") return "大模型配置";
  if (activeKey === "params:qi-config") return "质量改进配置";
  return "参数配置";
}
