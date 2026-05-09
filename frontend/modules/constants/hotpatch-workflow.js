/** 热补丁 HOTPATCH 模板：与 backend/hotpatch_config.py 节点顺序一致 */

export const HOTPATCH_WORKFLOW_NODES = [
  "诉求填写",
  "开发填写",
  "热补丁CCB",
  "计划制定",
  "指定开发",
  "指定测试",
  "开发分析",
  "测试分析",
  "热补丁串讲",
  "PM自检",
  "DE自检",
  "TSE自检",
  "工程人员自检",
  "转测发起",
  "转测确认",
  "测试验证",
  "BU测试结论",
  "评审发布",
];

/** 详情页顶部进度条：泳道 + 顺序段，文案与 HOTPATCH_WORKFLOW_NODES 一致（并行四段展示顺序同流程图：DE / PM / TSE / 工程） */
export const HOTPATCH_FLOW_BAR_LAYOUT = [
  { type: "sequence", steps: ["诉求填写", "开发填写", "热补丁CCB", "计划制定"] },
  {
    type: "parallel2",
    lanes: [
      ["指定开发", "开发分析"],
      ["指定测试", "测试分析"],
    ],
  },
  { type: "sequence", steps: ["热补丁串讲"] },
  {
    type: "parallel4",
    lanes: ["DE自检", "PM自检", "TSE自检", "工程人员自检"],
  },
  { type: "sequence", steps: ["转测发起", "转测确认", "测试验证", "BU测试结论", "评审发布"] },
];

export const HOTPATCH_NODE_KEY_BY_STEP = {
  诉求填写: "hp_demand_fill",
  开发填写: "hp_dev_fill",
  热补丁CCB: "hp_ccb",
  计划制定: "hp_plan",
  指定开发: "hp_assign_dev",
  指定测试: "hp_assign_test",
  开发分析: "hp_dev_analysis",
  测试分析: "hp_test_analysis",
  热补丁串讲: "hp_walkthrough",
  PM自检: "hp_pm_check",
  DE自检: "hp_de_check",
  TSE自检: "hp_tse_check",
  工程人员自检: "hp_eng_check",
  转测发起: "hp_transfer_start",
  转测确认: "hp_transfer_confirm",
  测试验证: "hp_test_verify",
  BU测试结论: "hp_bu_conclusion",
  评审发布: "hp_review_publish",
};

export const HOTPATCH_STEP_BY_NODE_KEY = Object.fromEntries(
  Object.entries(HOTPATCH_NODE_KEY_BY_STEP).map(([step, key]) => [key, step])
);

export const HOTPATCH_HANDLE_MODE_ROUTE = {
  hp_demand_fill: {
    __default__: "hp_dev_fill",
  },
  hp_dev_fill: {
    提交热补丁CCB: "hp_ccb",
    转交开发填写: "hp_dev_fill",
    返回诉求填写: "hp_demand_fill",
  },
  hp_ccb: {
    提交计划制定: "hp_plan",
    转交热补丁CCB: "hp_ccb",
    返回开发填写: "hp_dev_fill",
    "裁决未通过（结束）": "hp_ccb",
  },
  hp_plan: {
    "提交指定开发/指定测试": "hp_assign_dev",
    转交计划制定: "hp_plan",
    返回热补丁CCB: "hp_ccb",
  },
  hp_assign_dev: {
    提交开发分析: "hp_dev_analysis",
    转交指定开发: "hp_assign_dev",
  },
  hp_assign_test: {
    提交测试分析: "hp_test_analysis",
    转交指定测试: "hp_assign_test",
  },
  hp_dev_analysis: {
    提交热补丁串讲: "hp_walkthrough",
    转交开发分析: "hp_dev_analysis",
    返回指定开发: "hp_assign_dev",
  },
  hp_test_analysis: {
    提交热补丁串讲: "hp_walkthrough",
    转交测试分析: "hp_test_analysis",
    返回指定测试: "hp_assign_test",
  },
  hp_walkthrough: {
    提交自检: "hp_pm_check",
    转交热补丁串讲: "hp_walkthrough",
  },
  hp_pm_check: {
    提交转测发起: "hp_transfer_start",
    转交PM自检: "hp_pm_check",
  },
  hp_de_check: {
    提交转测发起: "hp_transfer_start",
    转交DE自检: "hp_de_check",
  },
  hp_tse_check: {
    提交转测发起: "hp_transfer_start",
    转交TSE自检: "hp_tse_check",
  },
  hp_eng_check: {
    提交转测发起: "hp_transfer_start",
    转交工程人员自检: "hp_eng_check",
  },
  hp_transfer_start: {
    提交转测确认: "hp_transfer_confirm",
    转交转测发起: "hp_transfer_start",
  },
  hp_transfer_confirm: {
    提交测试验证: "hp_test_verify",
    转交转测确认: "hp_transfer_confirm",
    返回转测发起: "hp_transfer_start",
  },
  hp_test_verify: {
    提交BU测试结论: "hp_bu_conclusion",
    转交测试验证: "hp_test_verify",
    返回转测确认: "hp_transfer_confirm",
  },
  hp_bu_conclusion: {
    提交评审发布: "hp_review_publish",
    转交BU测试结论: "hp_bu_conclusion",
    返回测试验证: "hp_test_verify",
  },
  hp_review_publish: {
    完成: "hp_review_publish",
    转交评审发布: "hp_review_publish",
    返回BU测试结论: "hp_bu_conclusion",
  },
};
