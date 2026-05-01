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

export const WF_FLAT_SEARCHABLE_FIELD_KEYS = new Set(["gauss_version"]);

export const TICKET_LIST_FILTER_KEYS = [
  "currentStage",
  "startDate",
  "severity",
  "location",
  "bizEnv",
  "currentHandler",
  "description",
];
