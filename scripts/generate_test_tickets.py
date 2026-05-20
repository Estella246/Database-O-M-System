#!/usr/bin/env python3
"""
生成 GaussDB 运维工单测试数据

用法：
    python scripts/generate_test_tickets.py --count 25
    python scripts/generate_test_tickets.py --reset --count 20
    python scripts/generate_test_tickets.py  # 默认生成25条

参数：
    --count N    生成的工单数量（默认25）
    --reset      清空已有测试工单后重新生成
    --dry-run    仅打印将生成的数据，不实际写入数据库
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg
from psycopg.rows import dict_row


# ============== 配置数据 ==============

PERSONS = [
    ("shen_yu", "申宇"),
    ("li_xiaoyu", "李潇雨"),
    ("li_changjun", "李长军"),
    ("dong_haijun", "董海俊"),
    ("liu_zongchao", "刘宗超"),
    ("xu_qigang", "徐齐刚"),
    ("song_kang", "宋康"),
    ("li_bowen", "李博闻"),
    ("li_yang", "李洋"),
    ("hu_baosheng", "胡宝生"),
    ("zhou_chenlei", "周晨雷"),
    ("liu_kaiyu", "刘开宇"),
]

LOCATIONS = ["temp"]  # 局点统一使用 temp
BIZ_ENVS = ["生产环境", "已投产业务测试环境", "POC阶段", "交付阶段"]
SEVERITIES = ["一般", "严重", "致命"]
SEVERITY_WEIGHTS = [0.5, 0.3, 0.2]  # 一般50%, 严重30%, 致命20%
COMPONENTS = ["内核问题", "管控问题"]
COMPONENT_WEIGHTS = [0.6, 0.4]  # 内核60%, 管控40%

ISSUE_TYPES_KERNEL = [
    "慢SQL（SQL调优）",
    "整体性能",
    "集群状态异常",
    "数据不一致",
    "SQL引擎-其他问题",
    "存储引擎-其他问题",
    "coredump",
]
ISSUE_TYPES_CONTROL = [
    "升级",
    "扩容",
    "备份恢复",
    "容灾",
    "管控问题",
]

PRODUCT_LINES = ["公有云", "混合云（HCS）", "混合云（轻量化）"]
DEPLOY_MODES = ["集中式", "分布式", "小型化"]
EVENT_LEVELS = ["一般问题", "内部通报重大问题", "管理升级预警", "已管理升级"]
CUSTOMER_VOICES = ["客户/一线不感知", "客户/一线感知声音可控", "客户/一线感知存在风险"]
GAUSS_VERSIONS = ["505.2.1.SPC0800", "505.2.0.SPC0700", "505.1.3.SPC0500", "505.1.2.SPC0300"]

# Doer辅助使用情况选项（来自 OS_DOER_ASSIST_USAGE）
DOER_ASSIST_OPTIONS = [
    "使用Doer，问题定位/解决",
    "使用Doer，仅提供思路/辅助提效",
    "使用Doer，无帮助",
    "未使用Doer",
    "紧急疑难工单",
]

NODE_KEYS = ["problem_fill", "problem_review", "ops_analysis", "dev_analysis", "dev_closure", "ops_closure", "audit_close"]
NODE_NAMES = ["问题填写", "问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭"]

# 流程阶段分布：问题审核15%, 运维分析20%, 开发分析15%, 开发闭环10%, 运维闭环10%, 审核关闭10%, 已关闭20%
STAGE_DISTRIBUTION = [
    ("problem_review", 0.15),
    ("ops_analysis", 0.20),
    ("dev_analysis", 0.15),
    ("dev_closure", 0.10),
    ("ops_closure", 0.10),
    ("audit_close", 0.10),
    ("closed", 0.20),  # 已关闭状态
]

# 问题描述模板
ISSUE_DESC_TEMPLATES_KERNEL = [
    "CN节点CPU占用率达到{percent}%，影响查询性能，需紧急处理。",
    "慢SQL导致数据库响应超时，查询耗时超过{seconds}秒，影响业务正常运行。",
    "集群状态异常，部分CN节点不可用，影响数据同步和查询。",
    "数据同步延迟超过阈值，当前延迟{delay}分钟，影响业务数据一致性。",
    "内存使用率持续增长，当前达到{percent}%，疑似内存泄露，需排查。",
    "DN节点磁盘使用率达到{percent}%，存在磁盘满风险，需扩容处理。",
    "数据库连接数达到{conn}个，接近上限，影响新连接建立。",
    "执行计划异常，SQL查询性能下降{percent}%，需调优处理。",
]

ISSUE_DESC_TEMPLATES_CONTROL = [
    "管控面API响应异常，状态查询失败，错误码：{code}。",
    "备份任务执行失败，失败原因：磁盘空间不足，需清理或扩容。",
    "升级流程中断，{count}个节点状态不一致，需人工介入。",
    "扩容操作报错，资源分配异常，错误信息：{msg}。",
    "容灾切换演练发现同步延迟{delay}秒，超过阈值。",
    "监控告警配置异常，部分指标无法正常采集。",
    "日志收集组件异常，{percent}%节点日志丢失。",
    "参数配置下发失败，{count}个实例未生效。",
]


# ============== 工具函数 ==============

def random_choice_weighted(items: list[str], weights: list[float]) -> str:
    """按权重随机选择"""
    return random.choices(items, weights=weights, k=1)[0]


def random_person() -> tuple[str, str]:
    """随机选择一个人员"""
    return random.choice(PERSONS)


def random_person_display() -> str:
    """返回格式化的人员显示：姓名 账号"""
    person = random_person()
    return f"{person[1]} {person[0]}"


def random_date_in_range(start: datetime, end: datetime) -> datetime:
    """在日期范围内随机选择一个日期"""
    delta = end - start
    random_days = random.randint(0, delta.days)
    random_seconds = random.randint(0, 24 * 3600 - 1)
    return start + timedelta(days=random_days, seconds=random_seconds)


def generate_ticket_no(date: datetime, seq: int) -> str:
    """生成工单编号：YW + YYYYMMDD + 三位序号"""
    date_str = date.strftime("%Y%m%d")
    seq_str = str(seq).zfill(3)
    return f"YW{date_str}{seq_str}"


def random_ecare_no() -> str:
    """生成随机 eCare 单号"""
    return f"EC{random.randint(100000, 999999)}"


def generate_issue_desc(component: str) -> str:
    """生成问题描述"""
    if component == "内核问题":
        template = random.choice(ISSUE_DESC_TEMPLATES_KERNEL)
    else:
        template = random.choice(ISSUE_DESC_TEMPLATES_CONTROL)

    # 替换占位符
    replacements = {
        "{percent}": str(random.randint(70, 95)),
        "{seconds}": str(random.randint(30, 120)),
        "{delay}": str(random.randint(5, 60)),
        "{conn}": str(random.randint(800, 1500)),
        "{code}": f"E{random.randint(1000, 9999)}",
        "{count}": str(random.randint(1, 5)),
        "{msg}": f"资源分配失败-{random.choice(['内存不足', '网络超时', '权限异常'])}",
    }
    for k, v in replacements.items():
        template = template.replace(k, v)
    return template


def select_issue_type(component: str) -> str:
    """根据组件选择问题类型"""
    if component == "内核问题":
        return random.choice(ISSUE_TYPES_KERNEL)
    else:
        return random.choice(ISSUE_TYPES_CONTROL)


# ============== 数据生成函数 ==============

def generate_problem_fill_values(date: datetime, component: str, severity: str, location: str, biz_env: str) -> dict[str, Any]:
    """生成问题填写节点数据"""
    creator = random_person()
    return {
        "start_date": date.strftime("%Y-%m-%d"),
        "location": location,
        "biz_env": biz_env,
        "severity": severity,
        "component": component,
        "product_line": random.choice(PRODUCT_LINES),
        "ecare_ticket_no": random_ecare_no(),
        "hcs_owner": f"{creator[1]} {creator[0]}",
        "issue_desc": generate_issue_desc(component),
    }


def generate_problem_review_values(issue_type: str, next_handler: str) -> dict[str, Any]:
    """生成问题审核节点数据"""
    return {
        "handle_mode": "确认问题",
        "issue_type_judge": issue_type,
        "next_handler": next_handler,
    }


def generate_ops_analysis_values(
    problem_fill: dict,
    issue_type: str,
    next_handler: str,
    duty_paths: list[str],
    baseline_versions: list[str],
) -> dict[str, Any]:
    """生成运维分析节点数据"""
    # 选择责任田路径（从合法路径中随机选择）
    issue_intro_module = random.choice(duty_paths) if duty_paths else "内核/SQL引擎"
    issue_owner_module = random.choice(duty_paths) if duty_paths else "内核/SQL引擎"

    # 选择Doer辅助使用情况
    use_doer_assist = random.choice(DOER_ASSIST_OPTIONS)

    # 如果选择了"使用Doer，无帮助"，需要填写原因
    doer_no_help_reason = ""
    if use_doer_assist == "使用Doer，无帮助":
        doer_no_help_reason = random.choice([
            "Doer提供的信息与实际问题不匹配",
            "Doer分析结果不准确，未能定位根因",
            "Doer响应时间过长，不适合紧急场景",
            "问题类型超出Doer当前能力范围",
        ])

    return {
        "handle_mode": random.choice(["提交开发分析", "提交开发闭环", "提交运维闭环"]),
        "next_handler": next_handler,
        "start_date": problem_fill["start_date"],
        "issue_intro_module": issue_intro_module,
        "issue_owner_module": issue_owner_module,
        "severity": problem_fill["severity"],
        "location": problem_fill["location"],
        "issue_type": issue_type,
        "product_line": problem_fill.get("product_line") or random.choice(PRODUCT_LINES),
        "root_cause_category": random.choice(["代码缺陷", "配置错误", "环境问题", "设计缺陷"]),
        "biz_env": problem_fill["biz_env"],
        "event_level": random.choice(EVENT_LEVELS),
        "component": problem_fill["component"],
        "customer_voice": random.choice(CUSTOMER_VOICES),
        "gauss_version": random.choice(baseline_versions) if baseline_versions else random.choice(GAUSS_VERSIONS),
        "deploy_mode": random.choice(DEPLOY_MODES),
        "kernel_upgrade_involved": random.choice(["是", "否"]),
        "issue_desc": problem_fill["issue_desc"],
        "error_text": f"ERROR: {random.choice(['connection timeout', 'memory allocation failed', 'disk full', 'query timeout'])}",
        "issue_track": "问题已初步定位，正在进一步分析。",
        "has_coredump_file": "否",
        "has_core_stack": "否",
        "is_consult_issue": random.choice(["是", "否"]),
        "use_doer_assist": use_doer_assist,
        "doer_no_help_reason": doer_no_help_reason,
    }


def generate_dev_analysis_values(ops_values: dict, next_handler: str, baseline_versions: list[str]) -> dict[str, Any]:
    """生成开发分析节点数据"""
    is_quality = random.choice(["是（已知质量问题）", "是（新发现质量问题）", "否"])

    # 从运维分析继承Doer相关字段
    use_doer_assist = ops_values.get("use_doer_assist", random.choice(DOER_ASSIST_OPTIONS))
    doer_no_help_reason = ops_values.get("doer_no_help_reason", "")
    # 如果继承的值是"使用Doer，无帮助"但没有原因，生成一个
    if use_doer_assist == "使用Doer，无帮助" and not doer_no_help_reason:
        doer_no_help_reason = random.choice([
            "Doer提供的信息与实际问题不匹配",
            "Doer分析结果不准确，未能定位根因",
            "Doer响应时间过长，不适合紧急场景",
            "问题类型超出Doer当前能力范围",
        ])

    return {
        "handle_mode": "提交开发闭环",
        "next_handler": next_handler,
        "issue_intro_module": ops_values.get("issue_intro_module", ""),
        "issue_owner_module": ops_values.get("issue_owner_module", ""),
        "front_pass_through": "否",
        "version_pass_through": random.choice(["是", "否"]),
        "is_quality_issue": is_quality,
        "dts_no": f"DTS-{random.randint(100000, 999999)}" if is_quality != "否" else "",
        "version_pass_reason": "版本兼容性问题，需透传处理" if random.random() > 0.5 else "",
        "is_consult_issue": ops_values.get("is_consult_issue", "否"),
        "rock_version_involved": random.choice([
            f"{random.choice(baseline_versions) if baseline_versions else '505.2.1.SPC0800'}磐石版本无该问题",
            f"{random.choice(baseline_versions) if baseline_versions else '505.2.1.SPC0800'}磐石版本涉及-历史版本引入",
        ]),
        "collaborator": "",
        "workaround": "1. 重启受影响节点\n2. 调整相关参数\n3. 应用临时补丁",
        "root_cause": "经分析，问题根因为代码逻辑缺陷，在特定条件下触发异常。",
        "issue_track": ops_values.get("issue_track", "") + "\n开发侧已定位根因，正在制定修复方案。",
        "dfx_gap": "当前监控能力不足，无法及时发现此类问题，需增强感知能力。",
        "error_archive_text": ops_values.get("error_text", ""),
        "use_doer_assist": use_doer_assist,
        "doer_no_help_reason": doer_no_help_reason,
    }


def generate_dev_closure_values(dev_values: dict, next_handler: str) -> dict[str, Any]:
    """生成开发闭环节点数据"""
    warning_needed = random.choice(["是", "否"])
    return {
        "handle_mode": "提交运维闭环",
        "next_handler": next_handler,
        "warning_needed": warning_needed,
        "impact_level": random.choice(["结果/数据错误", "core/hang/报错", "性能下降", "其他"]) if warning_needed == "是" else "",
        "sla_analysis": "SLA满足要求，处理时间在预期范围内。",
        "dfx_gap": dev_values.get("dfx_gap", ""),
    }


def generate_ops_closure_values(dev_closure: dict, next_handler: str) -> dict[str, Any]:
    """生成运维闭环节点数据"""
    return {
        "handle_mode": "提交运维审核关闭",
        "next_handler": next_handler,
        "is_quality_issue": dev_closure.get("is_quality_issue", "否"),
        "dts_no": dev_closure.get("dts_no", ""),
        "rock_version_involved": dev_closure.get("rock_version_involved", ""),
        "collaborator": "",
        "workaround": "运维侧已执行规避措施，问题已恢复。",
        "root_cause": "根因已确认，开发侧已修复。",
    }


def generate_audit_close_values(next_handler: str) -> dict[str, Any]:
    """生成审核关闭节点数据"""
    return {
        "handle_mode": "问题解决关闭",
        "next_handler": next_handler,
    }


def generate_flow_log_comment(action: str, from_node: str, to_node: str) -> str:
    """生成流转日志备注"""
    comments = {
        "submit": f"从{from_node}流转至{to_node}，问题处理正常推进。",
        "rollback": f"从{from_node}回退至{to_node}，需要重新分析。",
        "close": "问题已解决，工单关闭。",
    }
    return comments.get(action, f"执行{action}操作")


# ============== 主生成逻辑 ==============

def allocate_ticket_no(conn: psycopg.Connection, date: datetime) -> str:
    """分配当日工单编号（使用咨询锁防止并发）"""
    date_str = date.strftime("%Y%m%d")
    lock_key1 = hash(date_str) % 2147483647
    lock_key2 = 20260501

    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s, %s)", (lock_key1, lock_key2))
        try:
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM ticket WHERE ticket_no LIKE %s",
                (f"YW{date_str}%",)
            )
            cnt = cur.fetchone()["cnt"]
            seq = cnt + 1
            if seq > 999:
                raise ValueError(f"当日工单序号已超过999: {date_str}")
            return generate_ticket_no(date, seq)
        finally:
            cur.execute("SELECT pg_advisory_unlock(%s, %s)", (lock_key1, lock_key2))


def get_template_and_node_ids(conn: psycopg.Connection) -> dict[str, Any]:
    """获取模板和节点ID映射"""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM workflow_template WHERE template_code = 'HCS_INCIDENT'"
        )
        template_row = cur.fetchone()
        if not template_row:
            raise ValueError("模板 HCS_INCIDENT 不存在")
        template_id = template_row["id"]

        cur.execute(
            "SELECT id, node_key, node_name FROM workflow_node WHERE template_id = %s ORDER BY node_order",
            (template_id,)
        )
        nodes = {row["node_key"]: {"id": row["id"], "name": row["node_name"]} for row in cur.fetchall()}

    return {"template_id": template_id, "nodes": nodes}


def get_duty_field_paths(conn: psycopg.Connection) -> list[str]:
    """从数据库查询责任田模块的合法路径"""
    paths: list[str] = []
    try:
        with conn.cursor() as cur:
            # 查询责任田模块树结构
            cur.execute(
                """
                SELECT id, parent_id, label
                FROM duty_field_node
                ORDER BY parent_id NULLS FIRST, sort_order, id
                """
            )
            rows = cur.fetchall()

            # 构建邻接表
            by_parent: dict[Any, list[Any]] = {}
            id_to_label: dict[Any, str] = {}
            for r in rows:
                pid = r["parent_id"]
                rid = r["id"]
                lab = str(r["label"] or "").strip()
                id_to_label[rid] = lab
                if pid is not None:
                    by_parent.setdefault(pid, []).append(rid)

            # 递归构建路径
            def build_paths(parent_id: Any, current_path: str) -> None:
                children = by_parent.get(parent_id, [])
                for child_id in children:
                    label = id_to_label[child_id]
                    new_path = f"{current_path}/{label}" if current_path else label
                    # 只有叶子节点才加入路径列表（或者所有节点都加入）
                    # 这里加入所有节点，因为字段允许任意层级
                    paths.append(new_path)
                    build_paths(child_id, new_path)

            # 从根节点开始
            root_ids = [r["id"] for r in rows if r["parent_id"] is None]
            for rid in root_ids:
                label = id_to_label[rid]
                paths.append(label)
                build_paths(rid, label)

    except Exception as e:
        print(f"警告: 无法查询责任田模块数据，使用默认值: {e}")
        # 使用默认的示例路径
        paths = ["SQL引擎", "SQL引擎/CBB", "SQL引擎/驱动", "SQL引擎/慢SQL",
                 "SQL引擎/驱动/JDBC", "SQL引擎/驱动/ODBC",
                 "SQL引擎/慢SQL/等待时间", "SQL引擎/慢SQL/代价模型不足"]

    return paths if paths else ["内核/SQL引擎", "内核/存储引擎"]


def get_baseline_versions(conn: psycopg.Connection) -> list[str]:
    """从数据库查询基线版本的合法值"""
    versions: list[str] = []
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT version_label
                FROM param_baseline_version
                ORDER BY sort_order, id
                """
            )
            rows = cur.fetchall()
            versions = [str(r["version_label"] or "").strip() for r in rows if str(r["version_label"] or "").strip()]
    except Exception as e:
        print(f"警告: 无法查询基线版本数据，使用默认值: {e}")

    return versions if versions else GAUSS_VERSIONS


def get_next_handler_whitelist(conn: psycopg.Connection, node_key: str, handle_mode: str) -> list[str]:
    """从数据库查询指定节点和处理模式下的下一处理人白名单"""
    handlers: list[str] = []
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT handler_value
                FROM handle_mode_next_handler_whitelist
                WHERE node_key = %s AND handle_mode = %s AND is_active = TRUE
                ORDER BY sort_order, id
                """,
                (node_key, handle_mode)
            )
            rows = cur.fetchall()
            handlers = [str(r["handler_value"] or "").strip() for r in rows if str(r["handler_value"] or "").strip()]
    except Exception as e:
        print(f"警告: 无法查询处理人白名单: {e}")

    # 如果没有查到，使用默认人员列表（格式化为 "账号 姓名"）
    if not handlers:
        handlers = [f"{p[0]} {p[1]}" for p in PERSONS]

    return handlers


def clear_test_tickets(conn: psycopg.Connection) -> int:
    """清空已有测试工单数据"""
    person_ids = [p[0] for p in PERSONS]

    with conn.cursor() as cur:
        # psycopg 3 使用 ANY 语法处理 IN 子句
        cur.execute(
            "SELECT id, ticket_no FROM ticket WHERE creator_id = ANY(%s)",
            (person_ids,)
        )
        tickets = cur.fetchall()

        if not tickets:
            return 0

        ticket_ids = [t["id"] for t in tickets]

        # 删除关联数据
        cur.execute("DELETE FROM ticket_flow_log WHERE ticket_id = ANY(%s)", (ticket_ids,))
        cur.execute("DELETE FROM ticket_node_data WHERE ticket_id = ANY(%s)", (ticket_ids,))
        cur.execute("DELETE FROM ticket_node_instance WHERE ticket_id = ANY(%s)", (ticket_ids,))
        cur.execute("DELETE FROM ticket WHERE id = ANY(%s)", (ticket_ids,))

        return len(tickets)


def generate_one_ticket(
    conn: psycopg.Connection,
    template_info: dict,
    ticket_date: datetime,
    target_stage: str,
    is_closed: bool,
    seq: int,
    duty_paths: list[str],
    baseline_versions: list[str],
) -> dict[str, Any]:
    """生成一条工单及其完整流程数据"""

    # 基础属性
    location = random.choice(LOCATIONS)  # 使用 temp
    biz_env = random.choice(BIZ_ENVS)
    severity = random_choice_weighted(SEVERITIES, SEVERITY_WEIGHTS)
    component = random_choice_weighted(COMPONENTS, COMPONENT_WEIGHTS)
    issue_type = select_issue_type(component)

    # 分配工单编号
    ticket_no = allocate_ticket_no(conn, ticket_date)

    # 选择创建人
    creator = random_person()
    creator_id = creator[0]
    creator_name = creator[1]

    # 确定流程进度
    nodes = template_info["nodes"]
    if is_closed:
        completed_node_keys = NODE_KEYS  # 全部节点已完成
    else:
        # 根据目标阶段确定已完成节点
        stage_idx = NODE_KEYS.index(target_stage)
        completed_node_keys = NODE_KEYS[:stage_idx]  # 目标节点之前的节点已完成
        # 目标节点正在处理中

    # 插入 ticket 主表
    current_node_key = target_stage if not is_closed else "audit_close"
    current_node_id = nodes[current_node_key]["id"] if not is_closed else nodes["audit_close"]["id"]
    status = "closed" if is_closed else "open"

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ticket (ticket_no, template_id, title, current_node_id, status, creator_id, creator_name, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                ticket_no,
                template_info["template_id"],
                f"工单-{ticket_no}",
                current_node_id,
                status,
                creator_id,
                creator_name,
                ticket_date,
            )
        )
        ticket_row = cur.fetchone()
        ticket_id = ticket_row["id"]

    # 生成各节点数据
    problem_fill_values = generate_problem_fill_values(ticket_date, component, severity, location, biz_env)

    # 时间线：每个节点间隔 1-4 小时
    node_times = []
    base_time = ticket_date
    for i in range(len(NODE_KEYS)):
        node_times.append(base_time)
        base_time = base_time + timedelta(hours=random.randint(1, 4))

    # 插入节点实例和数据
    handlers = []
    current_handler = random_person_display()

    for i, node_key in enumerate(completed_node_keys):
        node_id = nodes[node_key]["id"]
        node_time = node_times[i]

        # 选择处理人
        handler = random_person_display()
        handlers.append(handler)

        # 生成节点数据
        if node_key == "problem_fill":
            values = problem_fill_values
        elif node_key == "problem_review":
            next_handler = random_person_display()
            values = generate_problem_review_values(issue_type, next_handler)
            current_handler = next_handler
        elif node_key == "ops_analysis":
            next_handler = random_person_display()
            values = generate_ops_analysis_values(problem_fill_values, issue_type, next_handler, duty_paths, baseline_versions)
            current_handler = next_handler
        elif node_key == "dev_analysis":
            next_handler = random_person_display()
            values = generate_dev_analysis_values(values if 'values' in dir() else {}, next_handler, baseline_versions)
            current_handler = next_handler
        elif node_key == "dev_closure":
            next_handler = random_person_display()
            values = generate_dev_closure_values(values if 'values' in dir() else {}, next_handler)
            current_handler = next_handler
        elif node_key == "ops_closure":
            next_handler = random_person_display()
            values = generate_ops_closure_values(values if 'values' in dir() else {}, next_handler)
            current_handler = next_handler
        elif node_key == "audit_close":
            values = generate_audit_close_values("")

        # 插入节点实例
        action_status = "completed"
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ticket_node_instance (ticket_id, node_id, handler_id, handler_name, action_status, started_at, ended_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (ticket_id, node_id, handler.split()[-1] if handler else "", handler, action_status, node_time, node_time + timedelta(hours=random.randint(1, 3)))
            )
            instance_row = cur.fetchone()
            instance_id = instance_row["id"]

            # 插入节点数据
            cur.execute(
                """
                INSERT INTO ticket_node_data (ticket_id, ticket_node_instance_id, values_json, created_by, created_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (ticket_id, instance_id, json.dumps(values, ensure_ascii=False), handler.split()[-1] if handler else "", node_time)
            )

        # 生成流转日志（除了第一个节点）
        if i > 0:
            prev_node_key = completed_node_keys[i - 1]
            prev_node_name = nodes[prev_node_key]["name"]
            curr_node_name = nodes[node_key]["name"]

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ticket_flow_log (ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        ticket_id,
                        nodes[prev_node_key]["id"],
                        node_id,
                        "submit",
                        handler.split()[-1] if handler else "",
                        handler,
                        generate_flow_log_comment("submit", prev_node_name, curr_node_name),
                        node_time,
                    )
                )

    # 如果工单已关闭，添加关闭日志
    if is_closed:
        last_handler = handlers[-1] if handlers else random_person_display()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ticket_flow_log (ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    ticket_id,
                    nodes["audit_close"]["id"],
                    nodes["audit_close"]["id"],
                    "close",
                    last_handler.split()[-1],
                    last_handler,
                    "问题已解决，工单关闭。",
                    node_times[-1] + timedelta(hours=1),
                )
            )

    # 对于未关闭的工单，插入当前处理节点实例（pending状态）
    if not is_closed and target_stage != "problem_fill":
        node_id = nodes[target_stage]["id"]
        node_time = node_times[len(completed_node_keys)]

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ticket_node_instance (ticket_id, node_id, handler_id, handler_name, action_status, started_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (ticket_id, node_id, current_handler.split()[-1], current_handler, "pending", node_time)
            )

    return {
        "ticket_no": ticket_no,
        "ticket_id": ticket_id,
        "creator": f"{creator_name} {creator_id}",
        "created_at": ticket_date.isoformat(),
        "current_stage": "已关闭" if is_closed else nodes[target_stage]["name"],
        "current_handler": "" if is_closed else current_handler,
        "severity": severity,
        "location": location,
        "component": component,
    }


def main():
    parser = argparse.ArgumentParser(description="生成 GaussDB 运维工单测试数据")
    parser.add_argument("--count", type=int, default=25, help="生成的工单数量")
    parser.add_argument("--reset", action="store_true", help="清空已有测试数据后重新生成")
    parser.add_argument("--dry-run", action="store_true", help="仅打印将生成的数据，不写入数据库")
    args = parser.parse_args()

    # 日期范围：2026-05-01 ~ 2026-05-30
    start_date = datetime(2026, 5, 1, 8, 0, 0, tzinfo=timezone.utc)
    end_date = datetime(2026, 5, 30, 18, 0, 0, tzinfo=timezone.utc)

    # 连接数据库
    db_dsn = os.getenv("DATABASE_URL", "postgresql://estella@localhost:5432/yunwei_ticket")

    print(f"=== GaussDB 运维工单测试数据生成 ===")
    print(f"工单数量: {args.count}")
    print(f"日期范围: 2026-05-01 ~ 2026-05-30")
    print(f"数据库: {db_dsn.split('@')[-1] if '@' in db_dsn else db_dsn}")
    print(f"模式: {'dry-run (仅打印)' if args.dry_run else '写入数据库'}")
    print()

    if args.dry_run:
        # 仅打印生成计划
        print("将生成的工单概览：")
        for i in range(args.count):
            # 随机选择阶段
            stage_weights = [s[1] for s in STAGE_DISTRIBUTION]
            stage_keys = [s[0] for s in STAGE_DISTRIBUTION]
            selected = random.choices(stage_keys, weights=stage_weights, k=1)[0]
            is_closed = selected == "closed"
            target_stage = "audit_close" if is_closed else selected

            ticket_date = random_date_in_range(start_date, end_date)
            severity = random_choice_weighted(SEVERITIES, SEVERITY_WEIGHTS)
            location = random.choice(LOCATIONS)
            component = random_choice_weighted(COMPONENTS, COMPONENT_WEIGHTS)

            print(f"  [{i+1}] YW{ticket_date.strftime('%Y%m%d')}xxx | {severity} | {location} | {component} | {'已关闭' if is_closed else NODE_NAMES[NODE_KEYS.index(target_stage)]}")
        print()
        print("提示: 使用 --dry-run 仅打印计划，去掉此参数实际写入数据库")
        return

    try:
        with psycopg.connect(db_dsn, row_factory=dict_row) as conn:
            # 获取模板和节点信息
            template_info = get_template_and_node_ids(conn)
            print(f"模板ID: {template_info['template_id']}")
            print(f"节点数量: {len(template_info['nodes'])}")

            # 查询责任田模块合法路径
            duty_paths = get_duty_field_paths(conn)
            print(f"责任田模块路径数量: {len(duty_paths)}")

            # 查询基线版本合法值
            baseline_versions = get_baseline_versions(conn)
            print(f"基线版本数量: {len(baseline_versions)}")
            print()

            # 清空已有数据
            if args.reset:
                cleared = clear_test_tickets(conn)
                print(f"已清空 {cleared} 条旧测试数据")
                print()

            # 生成工单
            print("开始生成工单...")
            generated = []

            for i in range(args.count):
                # 按权重选择目标阶段
                stage_weights = [s[1] for s in STAGE_DISTRIBUTION]
                stage_keys = [s[0] for s in STAGE_DISTRIBUTION]
                selected = random.choices(stage_keys, weights=stage_weights, k=1)[0]
                is_closed = selected == "closed"
                target_stage = "audit_close" if is_closed else selected

                ticket_date = random_date_in_range(start_date, end_date)

                ticket_info = generate_one_ticket(
                    conn, template_info, ticket_date, target_stage, is_closed, i + 1,
                    duty_paths, baseline_versions
                )
                generated.append(ticket_info)
                print(f"  [{i+1}/{args.count}] {ticket_info['ticket_no']} | {ticket_info['severity']} | {ticket_info['location']} | {ticket_info['component']} | {ticket_info['current_stage']}")

            conn.commit()
            print()
            print(f"=== 完成！共生成 {len(generated)} 条工单 ===")
            print()
            print("统计：")

            # 统计各阶段数量
            stage_counts = {}
            for t in generated:
                stage = t["current_stage"]
                stage_counts[stage] = stage_counts.get(stage, 0) + 1

            for stage, count in sorted(stage_counts.items()):
                print(f"  {stage}: {count}")

            print()
            print("提示: 可使用 python scripts/generate_test_tickets.py --reset 重新生成")

    except Exception as e:
        print(f"错误: {e}")
        raise


if __name__ == "__main__":
    main()