// 质量改进（QI）工作流常量 —— 与 backend/qi_config.py 保持一致

// 阶段键与中文展示名（单链顺序）
export const QI_STAGE_KEYS = ["propose", "review", "analysis", "closure", "acceptance"];
export const QI_STAGE_NAMES_CN = {
  propose: "提出",
  review: "评审",
  analysis: "确认",
  closure: "实施",
  acceptance: "验收",
};

// 阶段流转路由（handle_mode -> 下一阶段，"__closed__" 表示终态）
export const QI_HANDLE_MODE_ROUTE = {
  propose: { "提交评审": "review" },
  review: { "评审通过": "analysis", "评审不通过": "__closed__" },
  analysis: { "分析接纳": "closure", "分析不接纳": "review" },
  closure: { "提交验收": "acceptance" },
  acceptance: { "验收通过": "__closed__", "验收不通过": "closure" },
};
export const QI_CLOSE_HANDLE_MODES = new Set(["验收通过"]);

// 枚举
export const QI_CATEGORIES = ["定位定界", "测试加固", "快速恢复", "需求", "升级checklist", "质量加固和改进", "资料"];
export const QI_PRIORITIES = ["高", "中", "低"];
export const QI_REVIEW_RESULTS = ["通过", "不通过关单"];
export const QI_ACCEPT_RESULTS = ["是", "否"];
export const QI_CLOSURE_METHODS = ["问题单闭环", "需求闭环"];
export const QI_ACCEPTANCE_RESULTS = ["通过", "不通过"];

// 当前状态中文
export const QI_STATUS_CN = {
  draft: "草稿",
  in_progress: "进行中",
  rejected: "已打回",
  closed: "已关闭",
};

// 闭环方法 → 单号前缀
export const QI_CLOSURE_PREFIX = { "问题单闭环": "PC", "需求闭环": "RC" };

// 各阶段字段定义（前端表单渲染 + 校验，与后端 QI_STAGE_FIELDS 一致）
// type: text/textarea/richtext/date/select/person
// required: 基础必填；required_when: {字段: 值} 条件必填
export const QI_STAGE_FIELDS = {
  propose: [
    { key: "title", label: "改进标题", type: "text", required: true, full: true },
    { key: "category", label: "分类", type: "select", required: true, options: QI_CATEGORIES },
    { key: "priority", label: "优先级", type: "select", required: false, options: QI_PRIORITIES },
    { key: "domain", label: "领域", type: "select", required: false, options: ["加载中…"] },
    { key: "module_feature", label: "模块&特性", type: "cascader", required: false },
    { key: "related_ticket_no", label: "关联运维系统单号", type: "text", required: true },
    { key: "description", label: "详细描述", type: "richtext", required: true },
    { key: "reviewer", label: "下一步处理人", type: "person", required: true },
  ],
  review: [
    { key: "review_result", label: "评审结果", type: "select", required: true, options: QI_REVIEW_RESULTS },
    { key: "responsible", label: "下一步处理人", type: "person", required: false, required_when: { review_result: "通过" } },
    { key: "reject_reason", label: "评审意见", type: "richtext", required: true },
  ],
  analysis: [
    { key: "accept", label: "是否接纳", type: "select", required: true, options: QI_ACCEPT_RESULTS },
    { key: "responsible", label: "下一步处理人", type: "person", required: false, required_when: { accept: "是" } },
    { key: "review_comment", label: "评审意见", type: "richtext", required: true },
    { key: "closure_method", label: "闭环方法", type: "select", required: false, required_when: { accept: "是" }, options: QI_CLOSURE_METHODS },
  ],
  closure: [
    { key: "closure_ticket_no", label: "问题单号/需求单号", type: "text", required: true },
    { key: "progress_stage", label: "当前进展", type: "select", required: false, options: [] },
    { key: "closure_self_test", label: "闭环效果自测", type: "richtext", required: true },
    { key: "accept_version", label: "解决版本", type: "text", required: true },
    { key: "sla_time", label: "SLA时间", type: "date", required: true },
  ],
  acceptance: [
    { key: "acceptance_pass", label: "验收是否通过", type: "select", required: true, options: QI_ACCEPTANCE_RESULTS },
    { key: "acceptance_conclusion", label: "验收结论", type: "richtext", required: true },
  ],
};

// 支持进展子项的阶段
export const QI_PROGRESS_STAGES = new Set([]);

// 列表默认展示列
export const QI_LIST_COLUMNS = [
  { key: "qi_no", label: "改进编号" },
  { key: "title", label: "改进标题" },
  { key: "category", label: "分类", tag: "cat" },
  { key: "domain", label: "领域" },
  { key: "module_feature", label: "模块" },
  { key: "description", label: "详细描述", stripHtml: true },
  { key: "priority", label: "优先级", tag: "p" },
  { key: "proposer", label: "提出人" },
  { key: "created_at", label: "提出时间" },
  { key: "current_stage", label: "当前阶段", tag: "stage" },
  { key: "related_ticket_no", label: "关联运维系统单号" },
  { key: "is_overdue", label: "是否超期", tag: "overdue" },
];

// 分析看板预设
export const QI_ANALYTICS_PRESETS = [
  { key: "1w", label: "近1周", days: 7 },
  { key: "1m", label: "近1月", days: 30 },
  { key: "3m", label: "近3月", days: 90 },
  { key: "custom", label: "自定义", days: 0 },
];

// 字段是否当前必填（基础 required + required_when 条件满足）
export function qiFieldRequired(field, values) {
  if (field.required) return true;
  const cond = field.required_when;
  if (!cond) return false;
  return Object.entries(cond).every(([k, v]) => String(values[k]) === String(v));
}
