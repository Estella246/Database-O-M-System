"""质量改进（Quality Improvement）5 阶段工作流配置。

阶段单链：提出 → 评审 → 改进项分析 → 闭环 → 验收
- 评审不通过 → 打回提出；分析不接纳 → 打回评审；验收不通过 → 打回闭环
- 责任人：评审填写 → 分析/闭环继承
- 验收人 = 提出人，不可转单
- 仅主诉求单有编号 QI-YYYY-NNN；闭环单号 = 分析阶段 closure_ticket_no 加 PC/RC 前缀
"""

from __future__ import annotations

# ---- 阶段键与中文展示名 ----
QI_STAGE_KEYS: tuple[str, ...] = ("propose", "review", "analysis", "closure", "acceptance")
QI_STAGE_NAMES_CN: dict[str, str] = {
    "propose": "提出",
    "review": "评审",
    "analysis": "确认",
    "closure": "实施",
    "acceptance": "验收",
}
QI_STAGE_ORDER: dict[str, int] = {k: i for i, k in enumerate(QI_STAGE_KEYS)}

# ---- 阶段流转路由（handle_mode -> 下一阶段） ----
# 接纳/通过的动作为正向流转；不通过/不接纳为打回
QI_HANDLE_MODE_ROUTE: dict[str, dict[str, str]] = {
    "propose": {"提交评审": "review"},
    "review": {"评审通过": "analysis", "评审不通过": "__closed__"},
    "analysis": {"分析接纳": "closure", "分析不接纳": "review"},
    "closure": {"提交验收": "acceptance"},
    "acceptance": {"验收通过": "__closed__", "验收不通过": "closure"},
}
# 终态动作（验收通过 → current_status=closed）
QI_CLOSE_HANDLE_MODES: frozenset[str] = frozenset({"验收通过", "评审不通过"})
# 打回动作（current_stage 回退到前序阶段）
QI_REJECT_HANDLE_MODES: frozenset[str] = frozenset({"分析不接纳", "验收不通过"})

# 哪些阶段支持进展子项
QI_PROGRESS_STAGES: frozenset[str] = frozenset()

# 各阶段 SLA 阈值（小时）：超过即视为超时。用于看板超时统计
QI_STAGE_SLA_HOURS: dict[str, float] = {
    "propose": 24,        # 提出：1 天内提交评审
    "review": 48,         # 评审：2 天
    "analysis": 72,       # 改进项分析：3 天
    "closure": 168,       # 闭环：7 天
    "acceptance": 48,     # 验收：2 天
}

# 闭环方法 → 闭环单号前缀
QI_CLOSURE_METHOD_PREFIX: dict[str, str] = {
    "问题单闭环": "PC",
    "需求闭环": "RC",
}

# ---- 枚举集合 ----
QI_CATEGORIES: tuple[str, ...] = ("定位定界", "测试加固", "快速恢复", "需求", "升级checklist", "质量加固和改进")
QI_PRIORITIES: tuple[str, ...] = ("高", "中", "低")
QI_REVIEW_RESULTS: tuple[str, ...] = ("通过", "不通过关单")
QI_ACCEPT_RESULTS: tuple[str, ...] = ("是", "否")
QI_CLOSURE_METHODS: tuple[str, ...] = ("问题单闭环", "需求闭环")
QI_ACCEPTANCE_RESULTS: tuple[str, str] = ("通过", "不通过")

# 优先级排序权重（列表按 高→中→低）
QI_PRIORITY_ORDER: dict[str, int] = {"高": 1, "中": 2, "低": 3}

# 评审人固定名单（由系统配置；此处为默认，运行时可扩展为从 user_account / 配置读取）
# 留空表示由前端从人员接口拉取；此处仅占位，实际名单在 qi.py 的 schema 接口动态提供
QI_REVIEWER_FALLBACK: tuple[str, ...] = ()

# ---- 各阶段字段定义（前端表单 + 后端校验共用） ----
# 每个字段: {key, label, type, required, options?, required_when?(条件必填)}
# type: text / textarea / richtext / date / select / person / number
QI_STAGE_FIELDS: dict[str, list[dict]] = {
    "propose": [
        {"key": "title", "label": "改进标题", "type": "text", "required": True},
        {"key": "category", "label": "分类", "type": "select", "required": True, "options": list(QI_CATEGORIES)},
        {"key": "priority", "label": "优先级", "type": "select", "required": False, "options": list(QI_PRIORITIES)},
        {"key": "domain", "label": "领域", "type": "domain_select", "required": False},
        {"key": "module_feature", "label": "模块&特性", "type": "module_select", "required": False},
        {"key": "related_ticket_no", "label": "关联运维系统单号", "type": "text", "required": True},
        {"key": "description", "label": "详细描述", "type": "richtext", "required": True},
        {"key": "reviewer", "label": "下一步处理人", "type": "person", "required": True},
    ],
    "review": [
        {"key": "review_result", "label": "评审结果", "type": "select", "required": True, "options": list(QI_REVIEW_RESULTS)},
        {"key": "responsible", "label": "下一步处理人", "type": "person",
         "required": False, "required_when": {"review_result": "通过"}},
        {"key": "reject_reason", "label": "评审意见", "type": "richtext",
         "required": True},
    ],
    "analysis": [
        {"key": "accept", "label": "是否接纳", "type": "select", "required": True, "options": list(QI_ACCEPT_RESULTS)},
        {"key": "responsible", "label": "下一步处理人", "type": "person",
         "required": False, "required_when": {"accept": "是"}},
        {"key": "review_comment", "label": "评审意见", "type": "richtext", "required": True},
        {"key": "closure_method", "label": "闭环方法", "type": "select",
         "required": False, "required_when": {"accept": "是"}, "options": list(QI_CLOSURE_METHODS)},
    ],
    "closure": [
        {"key": "closure_ticket_no", "label": "问题单号/需求单号", "type": "text", "required": True},
        {"key": "progress_stage", "label": "当前进展", "type": "select", "required": False, "options": []},
        {"key": "closure_self_test", "label": "闭环效果自测", "type": "richtext", "required": True},
        {"key": "accept_version", "label": "解决版本", "type": "text", "required": True},
        {"key": "sla_time", "label": "SLA时间", "type": "date", "required": True},
    ],
    "acceptance": [
        {"key": "acceptance_pass", "label": "验收是否通过", "type": "select",
         "required": True, "options": list(QI_ACCEPTANCE_RESULTS)},
        {"key": "acceptance_conclusion", "label": "验收结论", "type": "richtext", "required": True},
    ],
}

# 提出阶段落在 qi_request 主表的字段（不进 qi_stage_data，便于列表查询）
QI_PROPOSE_REQUEST_FIELDS: tuple[str, ...] = (
    "category", "title", "related_ticket_no", "description", "expected_goal",
    "priority", "reviewer",
)

# 列表默认展示列（key -> 中文 label）
QI_LIST_COLUMNS: list[dict[str, str]] = [
    {"key": "qi_no", "label": "诉求编号"},
    {"key": "category", "label": "分类"},
    {"key": "title", "label": "改进标题"},
    {"key": "proposer", "label": "提出人"},
    {"key": "priority", "label": "优先级"},
    {"key": "current_stage", "label": "当前阶段"},
    {"key": "current_status", "label": "当前状态"},
    {"key": "responsible", "label": "下一步处理人"},
    {"key": "created_at", "label": "提出时间"},
]
