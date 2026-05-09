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

/**
 * 详情顶栏流程图：相邻段之间的连接线样式（与 `HOTPATCH_FLOW_BAR_LAYOUT` 段类型衔接一致）。
 * 若调整 fork/merge 的 SVG path，请同步 `test/frontend_tests/__tests__/hotpatch-flow-join.test.js` 内联镜像；fork-2/merge-2 与 `.hp-flow-parallel--2` 行高、fork-4/merge-4 与 `.hp-flow-parallel--4` 行高须一致。
 * @param {string} prevType `sequence` | `parallel2` | `parallel4`
 * @param {string} nextType
 * @returns {"line" | "fork-2" | "merge-2" | "fork-4" | "merge-4"}
 */
export function resolveHotpatchFlowJoinKind(prevType, nextType) {
  if (prevType === "sequence" && nextType === "parallel2") return "fork-2";
  if (prevType === "parallel2" && nextType === "sequence") return "merge-2";
  if (prevType === "sequence" && nextType === "parallel4") return "fork-4";
  if (prevType === "parallel4" && nextType === "sequence") return "merge-4";
  return "line";
}

const HP_JOIN_SVG_ATTRS =
  ' class="hp-flow-join-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

/** 顶栏段间分叉/汇合/直线（纯展示；分叉为贝塞尔曲线，贴近参考图） */
export function renderHotpatchFlowJoinHtml(kind) {
  const k = String(kind || "line");
  if (k === "fork-2") {
    /* viewBox 高 120 = 双泳道 gap10 下两行等分：行高 55，中心 27.5 / 92.5（与 .hp-flow-parallel--2 行盒一致） */
    return `<div class="hp-flow-join hp-flow-join--fork-2" aria-hidden="true"><svg${HP_JOIN_SVG_ATTRS} viewBox="0 0 48 120" width="40" height="100%"><path d="M0,60 L12,60 C12,60 26,42 46,27.5 M12,60 C12,60 26,78 46,92.5"/></svg></div>`;
  }
  if (k === "merge-2") {
    return `<div class="hp-flow-join hp-flow-join--merge-2" aria-hidden="true"><svg${HP_JOIN_SVG_ATTRS} viewBox="0 0 48 120" width="40" height="100%"><path d="M0,27.5 C10,27.5 18,48 26,60 L46,60 M0,92.5 C10,92.5 18,72 26,60"/></svg></div>`;
  }
  if (k === "fork-4") {
    /* viewBox 高 200 = 四泳道 gap8 下四行等分：行带 44，中心 22 / 74 / 126 / 178（与 .hp-flow-parallel--4 几何一致） */
    return `<div class="hp-flow-join hp-flow-join--fork-4" aria-hidden="true"><svg${HP_JOIN_SVG_ATTRS} viewBox="0 0 48 200" width="40" height="100%"><path d="M0,100 L12,100 C12,100 26,58 46,22 M12,100 C12,100 26,82 46,74 M12,100 C12,100 26,102 46,126 M12,100 C12,100 26,138 46,178"/></svg></div>`;
  }
  if (k === "merge-4") {
    return `<div class="hp-flow-join hp-flow-join--merge-4" aria-hidden="true"><svg${HP_JOIN_SVG_ATTRS} viewBox="0 0 48 200" width="40" height="100%"><path d="M0,22 C10,22 18,56 26,100 M0,74 C10,74 18,84 26,100 M0,126 C10,126 18,98 26,100 M0,178 C10,178 18,116 26,100 M26,100 L46,100"/></svg></div>`;
  }
  return `<div class="hp-flow-join hp-flow-join--line" aria-hidden="true"><span class="hp-flow-join-line"></span></div>`;
}

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
