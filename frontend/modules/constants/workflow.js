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

export const WHITELIST_NO_PLACEHOLDER_KEYS = new Set(["handle_mode"]);

export const WORKFLOW_FLAT_CUSTOM_SELECT_NODE_KEYS = new Set([
  "problem_review",
  "ops_analysis",
  "dev_analysis",
  "dev_closure",
  "ops_closure",
  "audit_close",
]);

export const WF_FLAT_SEARCHABLE_FIELD_KEYS = new Set(["gauss_version", "next_handler", "collaborator"]);

/** 人员类白名单：从 user_account（/api/admin/users）注入选项 */
export const PERSON_WHITELIST_FIELD_KEYS = new Set(["next_handler", "collaborator"]);

/** 是否使用可搜索的扁平下拉（含搜索框） */
export function isWorkflowFlatSelectSearchable(field) {
  const key = String(field?.key || "");
  return WF_FLAT_SEARCHABLE_FIELD_KEYS.has(key);
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
  if (key === "gauss_version") return "搜索版本关键字";
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
    const next = { ...f, options: personOpts };
    if (f.constraints?.next_handler_by_handle_mode) {
      const c = { ...f.constraints };
      delete c.next_handler_by_handle_mode;
      next.constraints = c;
    }
    return next;
  });
}

export const TICKET_LIST_FILTER_KEYS = [
  "currentStage",
  "startDate",
  "start_date",
  "severity",
  "location",
  "bizEnv",
  "biz_env",
  "currentHandler",
  "creatorName",
  "next_handler",
  "description",
  "issue_desc",
  "handle_mode",
  "issue_type",
  "issue_type_judge",
  "component",
  "product_line",
  "hcs_version",
  "hcs_mode",
  "deploy_mode",
  "gauss_version",
];
