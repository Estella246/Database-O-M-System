export const PERMISSION_WHITELIST_NODE_KEY = "__whitelist__";

/** 内置权限组，不可删除 */
export const PROTECTED_PERMISSION_GROUP_CODES = new Set(["管理员"]);

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
  { key: "workbench_migrate", label: "工作台 / 迁入按钮" },
  { key: "workbench_snapshot_rebuild", label: "工作台 / 重建列表快照按钮" },
  { key: "leave_application", label: "请假申请" },
  { key: "leave_application_all", label: "请假申请 / 所有申请" },
  { key: "leave_whitelist", label: "请假申请 / 审批白名单按钮" },
  { key: "leave_apply", label: "请假申请 / 申请按钮" },
  { key: "leave_delete", label: "请假申请 / 删除按钮" },
  { key: "duty_roster", label: "值班表" },
  { key: "duty_roster_edit", label: "值班表 / 编辑按钮、下载模版、导入按钮" },
  { key: "admin_users", label: "用户管理" },
  { key: "admin_users_edit", label: "用户管理 / 编辑按钮" },
  { key: "admin_permissions", label: "权限策略" },
  { key: "admin_permissions_add", label: "权限策略 / 新增权限组按钮" },
  { key: "admin_permissions_delete", label: "权限策略 / 删除权限组按钮" },
  { key: "admin_permissions_whitelist", label: "权限策略 / 配置白名单按钮" },
  { key: "stats_dashboard", label: "统计图表" },
  { key: "major_problem_list", label: "重大问题" },
  { key: "site_profile_list", label: "局点档案" },
  { key: "site_profile_create", label: "局点档案 / 新增按钮" },
  { key: "site_profile_import", label: "局点档案 / 导入" },
  { key: "site_profile_export", label: "局点档案 / 导出按钮" },
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
  { key: "ai_export", label: "深度分析" },
  { key: "ai_export_template", label: "规则模板管理" },
  { key: "oncall_eva", label: "运维效率" },
  { key: "oncall_eva_review", label: "运维效率 / 加分项审批与红黑事件录入" },
  { key: "monthly_report", label: "月度报告" },
  { key: "requirement_list", label: "质量改进" },
  { key: "requirement_create", label: "质量改进 / 新建按钮" },
  { key: "requirement_import", label: "质量改进 / 下载模板与导入按钮" },
  { key: "requirement_export", label: "质量改进 / 导出按钮" },
  { key: "tool_plaza_list", label: "运维工具广场" },
  { key: "tool_plaza_publish", label: "运维工具广场 / 发布按钮" },
  { key: "tool_plaza_edit", label: "运维工具广场 / 编辑与删除" },
];

export const PERMISSION_LEVEL_OPTIONS = [
  ["hidden", "不展示"],
  ["readonly", "只读"],
  ["editable", "可编辑"],
];

export const PERMISSION_LEVEL_RANK = { hidden: 0, readonly: 1, editable: 2 };

/** editable 表示可见范围收窄（非更高编辑权）；父项为展示/不展示时不应按 rank 压级 */
export const PERMISSION_SCOPE_STRATEGY_KEYS = new Set([
  "ticket_list",
  "leave_application_all",
  "workbench_create_from_problem_fill",
  "duty_roster",
  "duty_roster_edit",
  "tool_plaza_edit",
]);

export const PERMISSION_DEFAULT_HIDDEN_KEYS = new Set([
  "ai_assistant",
  "ai_assistant_template_edit",
  "ai_assistant_config",
  "ai_export",
  "ai_export_template",
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
  workbench_migrate: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  workbench_snapshot_rebuild: [
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
  leave_application_all: [
    ["readonly", "展示全部请假单"],
    ["editable", "仅展示申请人为本人的请假单"],
  ],
  leave_whitelist: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  leave_apply: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  leave_delete: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  duty_roster: [
    ["readonly", "展示"],
    ["editable", "仅展示RL值班表"],
    ["hidden", "不展示"],
  ],
  duty_roster_edit: [
    ["readonly", "展示"],
    ["editable", "仅展示RL值班表相关编辑按钮"],
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
  admin_permissions_delete: [
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
  site_profile_list: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  site_profile_create: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  site_profile_import: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  site_profile_export: [
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
  ai_export: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  ai_export_template: [
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
  requirement_list: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  requirement_create: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  requirement_import: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  requirement_export: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  tool_plaza_list: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  tool_plaza_publish: [
    ["readonly", "展示"],
    ["hidden", "不展示"],
  ],
  tool_plaza_edit: [
    ["editable", "可编辑、删除所有内容"],
    ["readonly", "可编辑、删除本人发布的内容"],
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
  ["ticket_list", "workbench_migrate"],
  ["ticket_list", "workbench_snapshot_rebuild"],
  ["leave_application", "leave_application_all"],
  ["leave_application", "leave_whitelist"],
  ["leave_application", "leave_apply"],
  ["leave_application", "leave_delete"],
  ["duty_roster", "duty_roster_edit"],
  ["admin_users", "admin_users_edit"],
  ["admin_users", "admin_permissions"],
  ["admin_permissions", "admin_permissions_add"],
  ["admin_permissions", "admin_permissions_delete"],
  ["admin_permissions", "admin_permissions_whitelist"],
  ["params_config", "params_duty_field_edit"],
  ["params_config", "params_version_edit"],
  ["params_config", "params_group_template_edit"],
  ["params_config", "params_issue_root_cause"],
  ["params_config", "params_llm_config"],
  ["ai_assistant", "ai_assistant_template_edit"],
  ["ai_assistant", "ai_assistant_config"],
  ["ai_assistant", "ai_export"],
  ["ai_export", "ai_export_template"],
  ["patch_manage", "patch_manage_delete"],
  ["oncall_eva", "oncall_eva_review"],
  ["requirement_list", "requirement_create"],
  ["requirement_list", "requirement_import"],
  ["requirement_list", "requirement_export"],
  ["tool_plaza_list", "tool_plaza_publish"],
  ["tool_plaza_list", "tool_plaza_edit"],
  ["site_profile_list", "site_profile_create"],
  ["site_profile_list", "site_profile_import"],
  ["site_profile_list", "site_profile_export"],
];

export const PERMISSION_WHITELIST_PARENT_MAP = PERMISSION_WHITELIST_CASCADE_RELATIONS.reduce(
  (acc, [parent, child]) => {
    if (!acc[child]) acc[child] = [];
    acc[child].push(parent);
    return acc;
  },
  {}
);
