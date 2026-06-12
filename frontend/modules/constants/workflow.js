export const WORKFLOW_NODES = ["问题填写", "问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭"];

export const NODE_KEY_BY_STEP = {
  "问题填写": "problem_fill",
  "问题审核": "problem_review",
  "运维分析": "ops_analysis",
  "开发分析": "dev_analysis",
  "开发闭环": "dev_closure",
  "运维闭环": "ops_closure",
  "审核关闭": "audit_close",
};

export const STEP_BY_NODE_KEY = Object.fromEntries(
  Object.entries(NODE_KEY_BY_STEP).map(([step, key]) => [key, step])
);

export const HANDLE_MODE_ROUTE = {
  problem_review: {
    "确认问题": "ops_analysis",
    "提交其他运维审核": "problem_review",
    "非问题关闭": "problem_review",
  },
  ops_analysis: {
    "提交开发分析": "dev_analysis",
    "提交开发闭环": "dev_closure",
    "提交运维闭环": "ops_closure",
    "提交其他运维分析": "ops_analysis",
  },
  dev_analysis: {
    "提交开发闭环": "dev_closure",
    "提交其他开发分析": "dev_analysis",
    "返回运维分析": "ops_analysis",
  },
  dev_closure: {
    "提交运维闭环": "ops_closure",
    "提交其他开发闭环": "dev_closure",
    "返回开发分析": "dev_analysis",
    "返回运维分析": "ops_analysis",
  },
  ops_closure: {
    "提交运维审核关闭": "audit_close",
    "提交其他运维闭环": "ops_closure",
    "返回开发闭环": "dev_closure",
    "返回运维分析": "ops_analysis",
  },
  audit_close: {
    "问题解决关闭": "audit_close",
    "提交其他审核关闭": "audit_close",
    "返回运维闭环": "ops_closure",
    "暂时挂起": "audit_close",
  },
};

/** 运维分析：选「是」类质量问题时，处理方式不可选「提交运维闭环」 */
export const OPS_ANALYSIS_QUALITY_YES_VALUES = new Set([
  "是（已知质量问题）",
  "是（新发现质量问题）",
]);

export const OPS_ANALYSIS_EXCLUDED_HANDLE_MODE_WHEN_QUALITY_YES = "提交运维闭环";

export function opsAnalysisExcludesOpsClosure(isQualityIssue) {
  return OPS_ANALYSIS_QUALITY_YES_VALUES.has(String(isQualityIssue || "").trim());
}

export function filterOpsAnalysisHandleModeOptions(options, isQualityIssue) {
  const list = Array.isArray(options) ? options : [];
  if (!opsAnalysisExcludesOpsClosure(isQualityIssue)) return list;
  return list.filter((item) => item !== OPS_ANALYSIS_EXCLUDED_HANDLE_MODE_WHEN_QUALITY_YES);
}

export const WHITELIST_NO_PLACEHOLDER_KEYS = new Set(["handle_mode"]);

/** 与「问题描述」富文本同宽、同高的多行纯文本字段；表单内固定排在最后，顺序如下 */
export const WIDE_TEXT_FIELD_ORDER = ["error_text", "core_stack_text", "error_archive_text"];
export const WIDE_TEXT_FIELD_KEYS = new Set(WIDE_TEXT_FIELD_ORDER);

export function isWideTextField(field) {
  return field?.type === "text" && WIDE_TEXT_FIELD_KEYS.has(String(field?.key || ""));
}

/** 节点表单排序：普通字段 → 富文本 → 报错信息 → Core堆栈（文字版） → 报错信息归档 */
export function getProblemFillFieldSortTier(field) {
  const key = String(field?.key || "");
  const wideIdx = WIDE_TEXT_FIELD_ORDER.indexOf(key);
  if (wideIdx >= 0) return 2 + wideIdx;
  if (field?.type === "richtext") return 1;
  return 0;
}

export const WORKFLOW_FLAT_CUSTOM_SELECT_NODE_KEYS = new Set([
  "problem_fill",
  "problem_review",
  "ops_analysis",
  "dev_analysis",
  "dev_closure",
  "ops_closure",
  "audit_close",
  "hp_demand_fill",
]);

export const WF_FLAT_SEARCHABLE_FIELD_KEYS = new Set(["gauss_version", "next_handler", "collaborator", "location", "intro_version", "fix_version"]);

/** 可直接输入新值的扁平下拉字段：搜索无匹配项时允许新增该值 */
export const WF_FLAT_CREATABLE_FIELD_KEYS = new Set(["location"]);

/** 人员类白名单：从 user_account（/api/admin/users）注入选项 */
export const PERSON_WHITELIST_FIELD_KEYS = new Set(["next_handler", "collaborator"]);

/** 多人协同处理人存库分隔符（与后端 MULTI_PERSON_DELIMITER 一致） */
export const MULTI_PERSON_DELIMITER = "；";

export function parseMultiPersonValue(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  if (s.includes(MULTI_PERSON_DELIMITER)) {
    return s
      .split(MULTI_PERSON_DELIMITER)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [s];
}

export function joinMultiPersonValue(items) {
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    const t = String(it || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join(MULTI_PERSON_DELIMITER);
}

/** 协同处理人多选节点（不依赖库内 ui_props 是否已迁移） */
export const MULTI_COLLABORATOR_NODE_KEYS = new Set(["dev_analysis", "ops_closure"]);

/** @deprecated 使用 MULTI_COLLABORATOR_NODE_KEYS */
export const DEV_ANALYSIS_MULTI_COLLABORATOR = {
  nodeKey: "dev_analysis",
  fieldKey: "collaborator",
};

/** 节点字段 ui_props.multiple 为 true，或开发分析/运维闭环-协同处理人时启用多人扁平下拉 */
export function isMultiPersonWhitelistField(field, nodeKey = "") {
  if (field?.type !== "whitelist") return false;
  if (field.key === "collaborator" && MULTI_COLLABORATOR_NODE_KEYS.has(String(nodeKey))) {
    return true;
  }
  return !!(field?.ui_props && field.ui_props.multiple);
}

/** 是否使用可搜索的扁平下拉（含搜索框） */
export function isWorkflowFlatSelectSearchable(field) {
  const key = String(field?.key || "");
  return WF_FLAT_SEARCHABLE_FIELD_KEYS.has(key);
}

/** 是否允许直接输入新值（搜索无匹配时可新增） */
export function isWorkflowFlatSelectCreatable(field) {
  const key = String(field?.key || "");
  return WF_FLAT_CREATABLE_FIELD_KEYS.has(key);
}

/** 是否使用扁平白名单下拉（替代原生 select） */
export function shouldUseWorkflowFlatSelect(nodeKey, field) {
  if (field?.type !== "whitelist" || Array.isArray(field.cascade_options)) return false;
  return WORKFLOW_FLAT_CUSTOM_SELECT_NODE_KEYS.has(nodeKey) || isWorkflowFlatSelectSearchable(field);
}

/** 人员选项关键字匹配：支持姓名、账号、空格分词 */
export function personOptionMatchesKeyword(optionText, keyword) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return true;
  const txt = String(optionText || "").trim().toLowerCase();
  if (!txt) return false;
  if (txt.includes(kw)) return true;
  const tokens = kw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return txt.includes(kw);
  return tokens.every((t) => txt.includes(t));
}

export function workflowFlatSelectSearchPlaceholder(field) {
  const key = String(field?.key || "");
  if (key === "next_handler" || key === "collaborator") return "搜索姓名或账号";
  if (key === "gauss_version" || key === "intro_version" || key === "fix_version") return "搜索版本关键字";
  if (key === "location") return "搜索或输入新局点";
  return "搜索关键字";
}

export function buildPersonOptionsFromAdminUsers(adminUsers) {
  if (!Array.isArray(adminUsers)) return [];
  return adminUsers
    .map((u) => {
      const acc = String(u.account || "").trim();
      const nm = String(u.user_name || u.userName || "").trim();
      if (!acc && !nm) return "";
      return nm && acc ? `${nm} ${acc}` : acc || nm;
    })
    .filter(Boolean);
}

export function personWhitelistOptionsArePlaceholder(raw) {
  const options = Array.isArray(raw) ? raw : [];
  if (options.length === 0) return true;
  if (options.length === 1 && options[0] === "temp") return true;
  return options.some((x) => {
    const s = String(x);
    return s.includes("工号+姓名") || s.includes("姓名+工号");
  });
}

export function injectPersonOptionsIntoSchemaFields(fields, adminUsers) {
  const personOpts = buildPersonOptionsFromAdminUsers(adminUsers);
  if (!personOpts.length) return fields;
  return fields.map((f) => {
    if (f.type !== "whitelist") return f;
    const isPerson =
      PERSON_WHITELIST_FIELD_KEYS.has(f.key) || personWhitelistOptionsArePlaceholder(f.options);
    if (!isPerson) return f;
    const next = {
      ...f,
      options: personOpts,
      ui_props: f.ui_props && typeof f.ui_props === "object" ? f.ui_props : {},
    };
    if (f.constraints?.next_handler_by_handle_mode) {
      const c = { ...f.constraints };
      delete c.next_handler_by_handle_mode;
      next.constraints = c;
    }
    return next;
  });
}

import { collectWhitelistFieldKeys } from "./column-fields.js";

/** 工作台列筛选已知 key（含默认列与列选择中的 whitelist 字段） */
export const TICKET_LIST_FILTER_KEYS = [
  "currentStage",
  "severity",
  "location",
  "bizEnv",
  "biz_env",
  "currentHandler",
  "creatorName",
  ...Array.from(collectWhitelistFieldKeys()),
];
