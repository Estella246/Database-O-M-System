"""热补丁（HOTPATCH）模板：节点流转与并行汇合规则。"""

from __future__ import annotations

HOTPATCH_TEMPLATE_CODE = "HOTPATCH"
HOTPATCH_INITIAL_NODE_KEY = "hp_demand_fill"

# 处理方式 -> 下一 node_key（与库内 node_field_def 中白名单一致）
HOTPATCH_HANDLE_MODE_ROUTE: dict[str, dict[str, str]] = {
    "hp_demand_fill": {
        "__default__": "hp_dev_fill",
    },
    "hp_dev_fill": {
        "提交热补丁CCB": "hp_ccb",
        "转交开发填写": "hp_dev_fill",
        "返回诉求填写": "hp_demand_fill",
    },
    "hp_ccb": {
        "提交计划制定": "hp_plan",
        "转交热补丁CCB": "hp_ccb",
        "返回开发填写": "hp_dev_fill",
        "裁决未通过（结束）": "hp_ccb",
    },
    "hp_plan": {
        "提交指定开发/指定测试": "hp_assign_dev",
        "转交计划制定": "hp_plan",
        "返回热补丁CCB": "hp_ccb",
    },
    "hp_assign_dev": {
        "提交开发分析": "hp_dev_analysis",
        "转交指定开发": "hp_assign_dev",
    },
    "hp_assign_test": {
        "提交测试分析": "hp_test_analysis",
        "转交指定测试": "hp_assign_test",
    },
    "hp_dev_analysis": {
        "提交热补丁串讲": "hp_walkthrough",
        "转交开发分析": "hp_dev_analysis",
        "返回指定开发": "hp_assign_dev",
    },
    "hp_test_analysis": {
        "提交热补丁串讲": "hp_walkthrough",
        "转交测试分析": "hp_test_analysis",
        "返回指定测试": "hp_assign_test",
    },
    "hp_walkthrough": {
        "提交自检": "hp_pm_check",
        "转交热补丁串讲": "hp_walkthrough",
    },
    "hp_pm_check": {
        "提交转测发起": "hp_transfer_start",
        "转交PM自检": "hp_pm_check",
    },
    "hp_de_check": {
        "提交转测发起": "hp_transfer_start",
        "转交DE自检": "hp_de_check",
    },
    "hp_tse_check": {
        "提交转测发起": "hp_transfer_start",
        "转交TSE自检": "hp_tse_check",
    },
    "hp_eng_check": {
        "提交转测发起": "hp_transfer_start",
        "转交工程人员自检": "hp_eng_check",
    },
    "hp_transfer_start": {
        "提交转测确认": "hp_transfer_confirm",
        "转交转测发起": "hp_transfer_start",
    },
    "hp_transfer_confirm": {
        "提交测试验证": "hp_test_verify",
        "转交转测确认": "hp_transfer_confirm",
        "返回转测发起": "hp_transfer_start",
    },
    "hp_test_verify": {
        "提交BU测试结论": "hp_bu_conclusion",
        "转交测试验证": "hp_test_verify",
        "返回转测确认": "hp_transfer_confirm",
    },
    "hp_bu_conclusion": {
        "提交评审发布": "hp_review_publish",
        "转交BU测试结论": "hp_bu_conclusion",
        "返回测试验证": "hp_test_verify",
    },
    "hp_review_publish": {
        "完成": "hp_review_publish",
        "转交评审发布": "hp_review_publish",
        "返回BU测试结论": "hp_bu_conclusion",
    },
}

HOTPATCH_CLOSE_HANDLE_MODES = frozenset({"裁决未通过（结束）", "完成"})

# 并行段一：计划制定之后，开发分析与测试分析均提交「提交热补丁串讲」后才进入热补丁串讲
HOTPATCH_PARALLEL_ANALYSIS_GATES = frozenset({"hp_dev_analysis", "hp_test_analysis"})
HOTPATCH_PARALLEL_ANALYSIS_MERGE = "hp_walkthrough"

# 并行段二：串讲提交自检后，四自检均「提交转测发起」后才进入转测发起节点
HOTPATCH_PARALLEL_SELF_KEYS = ("hp_pm_check", "hp_de_check", "hp_tse_check", "hp_eng_check")
HOTPATCH_PARALLEL_SELF_MERGE = "hp_transfer_start"
