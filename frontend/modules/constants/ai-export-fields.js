/**
 * AI Export 导出字段定义 — 将工单字段键映射为中文名。
 */
export const AI_EXPORT_COLUMNS = {
  ticket_no: "工单号",
  severity: "严重性",
  "问题描述": "问题描述",
  "问题组件": "问题组件",
  "局点": "局点",
  created_at: "创建时间",
  closed_at: "关闭时间",
  "问题阶段": "问题阶段",
  "产品线": "产品线",
  ecare_ticket_no: "eCare单号",
  dts_no: "DTS单号",
  component: "问题组件",
  location: "局点",
  start_date: "起始日期",
  issue_desc: "问题描述",
  event_level: "事件级别",
  currentStage: "当前阶段",
  currentHandler: "当前处理人",
  creatorName: "创建人",
  processId: "流程ID",
};

/** 导出字段可选列（按节点分组，供 Step 1 勾选） */
export const AI_EXPORT_FIELD_GROUPS = [
  {
    group: "工单基础",
    fields: [
      { key: "ticket_no", label: "工单号" },
      { key: "severity", label: "严重性" },
      { key: "created_at", label: "创建时间" },
      { key: "closed_at", label: "关闭时间" },
    ],
  },
  {
    group: "问题填写",
    fields: [
      { key: "location", label: "局点" },
      { key: "issue_desc", label: "问题描述" },
      { key: "component", label: "问题组件" },
      { key: "start_date", label: "起始日期" },
    ],
  },
  {
    group: "运维分析",
    fields: [
      { key: "event_level", label: "事件级别" },
    ],
  },
];