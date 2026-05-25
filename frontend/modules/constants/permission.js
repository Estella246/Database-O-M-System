export const PERMISSION_WHITELIST_NODE_KEY = "__whitelist__";

export const PERMISSION_WHITELIST_ITEMS = [
  { key: "home", label: "我的主页" },
  { key: "home_duty_roster", label: "我的主页 / 值班信息" },
  { key: "ticket_detail", label: "工单详情" },
  { key: "ticket_detail_passed_nodes", label: "工单详情 / 展开走过的节点" },
  { key: "ticket_detail_current_stage", label: "工单详情 / 当前阶段" },
  { key: "ticket_detail_log", label: "工单详情 / log" },
  { key: "ticket_list", label: "工作台" },
  { key: "workbench_group", label: "工作台 / 拉群按钮" },
  { key: "workbench_create", label: "工作台 / 创建按钮" },
  { key: "workbench_create_from_problem_fill", label: "工作台 / 创建问题是否从问题填写节点开始" },
  { key: "workbench_export", label: "工作台 / 导出按钮" },
  { key: "workbench_delete", label: "工作台 / 删除按钮" },
  { key: "leave_application", label: "请假申请" },
  { key: "leave_whitelist", label: "请假申请 / 审批白名单按钮" },
  { key: "leave_apply", label: "请假申请 / 申请按钮" },
  { key: "duty_roster", label: "值班表" },
  { key: "duty_roster_edit", label: "值班表 / 编辑按钮" },
  { key: "admin_users", label: "用户管理" },
  { key: "admin_users_edit", label: "用户管理 / 编辑按钮" },
  { key: "admin_permissions", label: "权限策略" },
  { key: "admin_permissions_add", label: "权限策略 / 新增权限组按钮" },
  { key: "admin_permissions_whitelist", label: "权限策略 / 配置白名单按钮" },
  { key: "stats_dashboard", label: "统计图表" },
  { key: "major_problem_list", label: "重大问题" },
  { key: "patch_manage", label: "补丁管理" },
  { key: "patch_manage_delete", label: "补丁管理 / 删除按钮" },
  { key: "params_config", label: "参数配置" },
  { key: "params_duty_field_edit", label: "参数配置 / 是否展示责任田页面" },
  { key: "params_version_edit", label: "参数配置 / 是否展示版本页面" },
  { key: "params_group_template_edit", label: "参数配置 / 是否展示拉群模板页面" },
  { key: "params_issue_root_cause", label: "参数配置 / 是否展示问题根因页面" },
  { key: "params_llm_config", label: "参数配置 / 是否展示大模型配置页面" },
  { key: "ai_assistant", label: "智能助手" },
  { key: "ai_assistant_template_edit", label: "智能助手 / 快捷模板编辑" },
  { key: "ai_assistant_config", label: "智能助手 / 系统大模型配置" },
  { key: "oncall_eva", label: "运维效率" },
  { key: "oncall_eva_review", label: "运维效率 / 加分项审批与红黑事件录入" },
  { key: "monthly_report", label: "月度报告" },
  { key: "requirement_export", label: "需求管理 / 导出按钮" },
];

export const PERMISSION_LEVEL_OPTIONS = [
  ["hidden", "不展示"],
  ["readonly", "只读"],
  ["editable", "可编辑"],
];

export const PERMISSION_LEVEL_RANK = { hidden: 0, readonly: 1, editable: 2 };

export const PERMISSION_DEFAULT_HIDDEN_KEYS = new Set([
  "ai_assistant",
  "ai_assistant_template_edit",
  "ai_assistant_config",
  "oncall_eva",
  "oncall_eva_review",
  "monthly_report",
  "requirement_export",
]);

export const PERMISSION_STRATEGY_OPTIONS_BY_KEY = {
  home_duty_roster: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  ticket_detail_passed_nodes: [
    ["editable", "可查看、编辑所有工单的所有阶段"],
    ["readonly", "可查看所有节点，仅可编辑自己处理过的节点"],
    ["hidden", "仅可查看问题填写节点"],
  ],
  ticket_detail_current_stage: [
    ["editable", "可编辑所有工单的当前阶段"],
    ["readonly", "当前处理人为本人的阶段"],
  ],
  ticket_detail_log: [
    ["hidden", "不可查看"],
    ["readonly", "可查看"],
  ],
  workbench_group: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  workbench_create: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  workbench_create_from_problem_fill: [
    ["editable", "是"],
    ["readonly", "否"],
  ],
  workbench_export: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  workbench_delete: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  ticket_list: [
    ["readonly", "展示所有工单"],
    ["editable", "仅展示本人创建工单"],
  ],
  leave_application: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  leave_whitelist: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  leave_apply: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  duty_roster: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  duty_roster_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_permissions: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_permissions_add: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_permissions_whitelist: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_users: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  admin_users_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  stats_dashboard: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  major_problem_list: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  patch_manage: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  patch_manage_delete: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_config: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_duty_field_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_version_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_group_template_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_issue_root_cause: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  params_llm_config: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  ai_assistant: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  ai_assistant_template_edit: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  ai_assistant_config: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  oncall_eva: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  oncall_eva_review: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  monthly_report: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  requirement_export: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
};

export const PERMISSION_WHITELIST_CASCADE_RELATIONS = [
  ["home", "home_duty_roster"],
  ["ticket_detail", "home"],
  ["ticket_detail", "ticket_detail_passed_nodes"],
  ["ticket_detail", "ticket_detail_current_stage"],
  ["ticket_detail", "ticket_detail_log"],
  ["ticket_list", "workbench_group"],
  ["ticket_list", "workbench_create"],
  ["ticket_list", "workbench_export"],
  ["ticket_list", "workbench_delete"],
  ["leave_application", "leave_whitelist"],
  ["leave_application", "leave_apply"],
  ["duty_roster", "duty_roster_edit"],
  ["admin_users", "admin_users_edit"],
  ["admin_users", "admin_permissions"],
  ["admin_permissions", "admin_permissions_add"],
  ["admin_permissions", "admin_permissions_whitelist"],
  ["params_config", "params_duty_field_edit"],
  ["params_config", "params_version_edit"],
  ["params_config", "params_group_template_edit"],
  ["params_config", "params_issue_root_cause"],
  ["params_config", "params_llm_config"],
  ["ai_assistant", "ai_assistant_template_edit"],
  ["ai_assistant", "ai_assistant_config"],
  ["patch_manage", "patch_manage_delete"],
  ["oncall_eva", "oncall_eva_review"],
];

export const PERMISSION_WHITELIST_PARENT_MAP = PERMISSION_WHITELIST_CASCADE_RELATIONS.reduce(
  (acc, [parent, child]) => {
    if (!acc[child]) acc[child] = [];
    acc[child].push(parent);
    return acc;
  },
  {}
);
