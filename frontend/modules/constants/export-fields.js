/**
 * 导出字段定义常量
 * 各节点的可导出文本字段（排除图片字段）
 */

// 系统字段（不在节点数据中，从 ticket 对象直接获取）
export const EXPORT_SYSTEM_FIELDS = [
  { key: "processId", label: "流程ID", type: "system" },
  { key: "currentStage", label: "当前阶段", type: "system" },
  { key: "currentHandler", label: "当前处理人", type: "system" },
  { key: "slaTime", label: "SLA时间", type: "system" },
  { key: "creatorName", label: "创建者", type: "system" },
];

// 各节点的可导出字段定义
// field_type: text | date | whitelist | richtext | system
// richtext 字段导出时会去除图片标签，保留文字内容
export const EXPORT_FIELDS_BY_NODE = {
  system: EXPORT_SYSTEM_FIELDS,
  problem_fill: [
    { key: "start_date", label: "起始日期", type: "date" },
    { key: "location", label: "局点", type: "text" },
    { key: "biz_env", label: "问题阶段", type: "whitelist" },
    { key: "severity", label: "问题严重性", type: "whitelist" },
    { key: "component", label: "问题组件", type: "whitelist" },
    { key: "product_line", label: "产品线", type: "whitelist" },
    { key: "ecare_ticket_no", label: "eCare单号", type: "text" },
    { key: "hcs_owner", label: "提单人", type: "text" },
    { key: "issue_desc", label: "问题描述", type: "richtext", stripImages: true },
  ],
  problem_review: [
    { key: "handle_mode", label: "处理方式", type: "whitelist" },
    { key: "issue_type_judge", label: "问题类型初步判断", type: "whitelist" },
    { key: "next_handler", label: "下一步处理人", type: "whitelist" },
    { key: "close_reason", label: "关闭原因", type: "text" },
  ],
  ops_analysis: [
    { key: "handle_mode", label: "处理方式", type: "whitelist" },
    { key: "next_handler", label: "下一步处理人", type: "whitelist" },
    { key: "start_date", label: "起始日期", type: "date" },
    { key: "issue_intro_module", label: "问题引入模块", type: "whitelist" },
    { key: "issue_owner_module", label: "问题归属模块", type: "whitelist" },
    { key: "severity", label: "问题严重性", type: "whitelist" },
    { key: "location", label: "局点", type: "whitelist" },
    { key: "issue_type", label: "问题类型", type: "whitelist" },
    { key: "product_line", label: "产品线", type: "whitelist" },
    { key: "root_cause_category", label: "根因分类", type: "whitelist" },
    { key: "biz_env", label: "问题阶段", type: "whitelist" },
    { key: "event_level", label: "事件级别", type: "whitelist" },
    { key: "component", label: "问题组件", type: "whitelist" },
    { key: "customer_voice", label: "客户声音", type: "whitelist" },
    { key: "gauss_version", label: "内核版本", type: "whitelist" },
    { key: "deploy_mode", label: "部署形态", type: "whitelist" },
    { key: "kernel_upgrade_involved", label: "是否涉及内核升级", type: "whitelist" },
    { key: "kernel_upgrade_time", label: "内核升级时间", type: "date" },
    { key: "upgrade_baseline_version", label: "升级前基线版本", type: "whitelist" },
    { key: "control_version", label: "管控版本", type: "text" },
    { key: "upgrade_status", label: "升级状态", type: "whitelist" },
    { key: "issue_desc", label: "问题描述", type: "richtext", stripImages: true },
    { key: "error_text", label: "报错信息", type: "text" },
    { key: "issue_track", label: "问题进展跟踪", type: "richtext", stripImages: true },
    { key: "has_core_stack", label: "是否有core堆栈", type: "whitelist" },
    { key: "core_stack_text", label: "Core堆栈（文字版）", type: "text" },
    { key: "is_consult_issue", label: "是否咨询问题", type: "whitelist" },
    { key: "is_quality_issue", label: "是否质量问题", type: "whitelist" },
    { key: "use_doer_assist", label: "是否使用Doer辅助", type: "whitelist" },
    { key: "doer_no_help_reason", label: "使用Doer无帮助原因", type: "text" },
    { key: "intro_version", label: "引入版本", type: "whitelist" },
    { key: "fix_version", label: "修复版本", type: "whitelist" },
  ],
  dev_analysis: [
    { key: "handle_mode", label: "处理方式", type: "whitelist" },
    { key: "next_handler", label: "下一步处理人", type: "whitelist" },
    { key: "issue_intro_module", label: "问题引入模块", type: "whitelist" },
    { key: "issue_owner_module", label: "问题归属模块", type: "whitelist" },
    { key: "front_pass_through", label: "是否前端透传", type: "whitelist" },
    { key: "version_pass_through", label: "是否透传至版本", type: "whitelist" },
    { key: "is_quality_issue", label: "是否质量问题", type: "whitelist" },
    { key: "dts_no", label: "DTS单号", type: "text" },
    { key: "version_pass_reason", label: "版本透传原因分析", type: "text" },
    { key: "is_consult_issue", label: "是否咨询问题", type: "whitelist" },
    { key: "collaborator", label: "协同处理人", type: "whitelist" },
    { key: "workaround", label: "规避措施/恢复方法", type: "richtext", stripImages: true },
    { key: "root_cause", label: "问题根因", type: "richtext", stripImages: true },
    { key: "issue_track", label: "问题进展跟踪", type: "richtext", stripImages: true },
    { key: "dfx_gap", label: "DFX能力GAP", type: "richtext", stripImages: true },
    { key: "error_archive_text", label: "报错信息归档", type: "text" },
    { key: "use_doer_assist", label: "是否使用Doer辅助", type: "whitelist" },
    { key: "doer_no_help_reason", label: "使用Doer无帮助原因", type: "text" },
    { key: "intro_version", label: "引入版本", type: "whitelist" },
    { key: "fix_version", label: "修复版本", type: "whitelist" },
  ],
  dev_closure: [
    { key: "handle_mode", label: "处理方式", type: "whitelist" },
    { key: "next_handler", label: "下一步处理人", type: "whitelist" },
    { key: "warning_needed", label: "是否需要预警", type: "whitelist" },
    { key: "impact_level", label: "业务影响程度", type: "whitelist" },
    { key: "sla_analysis", label: "SLA分析", type: "richtext", stripImages: true },
    { key: "dfx_gap", label: "DFX能力GAP", type: "richtext", stripImages: true },
  ],
  ops_closure: [
    { key: "handle_mode", label: "处理方式", type: "whitelist" },
    { key: "next_handler", label: "下一步处理人", type: "whitelist" },
    { key: "fault_recovery_involved", label: "是否涉及故障恢复", type: "whitelist" },
    { key: "fault_to_recovery_duration", label: "故障到恢复用时", type: "text" },
    { key: "is_quality_issue", label: "是否质量问题", type: "whitelist" },
    { key: "dts_no", label: "DTS单号", type: "text" },
    { key: "has_collaborator", label: "是否有协同处理人", type: "whitelist" },
    { key: "collaborator", label: "协同处理人", type: "whitelist" },
    { key: "workaround", label: "规避措施/恢复方法", type: "richtext", stripImages: true },
    { key: "root_cause", label: "问题根因", type: "richtext", stripImages: true },
    { key: "issue_track", label: "问题进展跟踪", type: "richtext", stripImages: true },
    { key: "dfx_gap", label: "DFX能力GAP", type: "richtext", stripImages: true },
    { key: "error_archive_text", label: "报错信息归档", type: "text" },
    { key: "problem_report", label: "上传问题报告", type: "file" },
  ],
  audit_close: [
    { key: "handle_mode", label: "处理方式", type: "whitelist" },
    { key: "next_handler", label: "下一步处理人", type: "whitelist" },
    { key: "warning_needed", label: "是否需要预警", type: "whitelist" },
    { key: "impact_level", label: "业务影响程度", type: "whitelist" },
    { key: "dfx_gap", label: "DFX能力GAP", type: "richtext", stripImages: true },
  ],
};

// 节点名称映射（中文）
export const NODE_LABELS = {
  system: "系统字段",
  problem_fill: "问题填写",
  problem_review: "问题审核",
  ops_analysis: "运维分析",
  dev_analysis: "开发分析",
  dev_closure: "开发闭环",
  ops_closure: "运维闭环",
  audit_close: "审核关闭",
};

// 节点排序顺序（系统字段在最前，然后是各流程节点）
export const NODE_ORDER = [
  "system",
  "problem_fill",
  "problem_review",
  "ops_analysis",
  "dev_analysis",
  "dev_closure",
  "ops_closure",
  "audit_close",
];

/**
 * 计算各节点字段总数
 */
export function getTotalFieldsByNode() {
  const totals = {};
  Object.keys(EXPORT_FIELDS_BY_NODE).forEach((nodeKey) => {
    totals[nodeKey] = EXPORT_FIELDS_BY_NODE[nodeKey].length;
  });
  return totals;
}

/**
 * 计算全部字段总数
 */
export function getTotalFieldsCount() {
  return Object.values(EXPORT_FIELDS_BY_NODE).reduce(
    (sum, fields) => sum + fields.length,
    0
  );
}

/**
 * 获取默认选中的字段（全部选中）
 * @returns {Object} { nodeKey: [fieldKeys] }
 */
export function getDefaultSelectedFields() {
  const selected = {};
  Object.keys(EXPORT_FIELDS_BY_NODE).forEach((nodeKey) => {
    selected[nodeKey] = EXPORT_FIELDS_BY_NODE[nodeKey].map((f) => f.key);
  });
  return selected;
}

/**
 * 计算选中字段总数
 * @param {Object} selectedFields { nodeKey: [fieldKeys] }
 * @returns {number}
 */
export function countSelectedFields(selectedFields) {
  return Object.values(selectedFields).reduce(
    (sum, keys) => sum + (keys?.length || 0),
    0
  );
}

/**
 * 去除 HTML 中的图片标签
 * @param {string} html HTML 内容
 * @returns {string} 去除图片后的纯文本
 */
export function stripImagesFromHtml(html) {
  if (!html) return "";
  // 移除 img 标签
  let text = html.replace(/<img[^>]*>/gi, "");
  // 移除其他可能内嵌图片的标签（如 figure）
  text = text.replace(/<figure[^>]*>.*?<\/figure>/gi, "");
  // 将连续空白压缩为单个空格
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/**
 * 构建导出列标题（分节点显示）
 * @param {Object} selectedFields { nodeKey: [fieldKeys] }
 * @returns {Array<{nodeKey, fieldKey, label, fullLabel}>}
 */
export function buildExportColumns(selectedFields) {
  const columns = [];
  NODE_ORDER.forEach((nodeKey) => {
    const nodeLabel = NODE_LABELS[nodeKey];
    const fields = EXPORT_FIELDS_BY_NODE[nodeKey] || [];
    const selectedKeys = selectedFields[nodeKey] || [];
    selectedKeys.forEach((fieldKey) => {
      const fieldDef = fields.find((f) => f.key === fieldKey);
      if (fieldDef) {
        columns.push({
          nodeKey,
          fieldKey,
          label: fieldDef.label,
          fullLabel: `${nodeLabel}-${fieldDef.label}`,
          type: fieldDef.type,
          stripImages: fieldDef.stripImages,
        });
      }
    });
  });
  return columns;
}