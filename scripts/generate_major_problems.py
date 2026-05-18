#!/usr/bin/env python3
"""
生成重大问题模块测试数据

用法：
    python scripts/generate_major_problems.py --count 100
    python scripts/generate_major_problems.py --reset --count 100
"""

from __future__ import annotations

import argparse
import json
import os
import random
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

SITE_NAMES = [
    "北京数据中心", "上海数据中心", "深圳数据中心", "广州数据中心",
    "成都数据中心", "武汉数据中心", "西安数据中心", "杭州数据中心",
    "南京数据中心", "重庆数据中心", "天津数据中心", "苏州数据中心",
    "青岛数据中心", "厦门数据中心", "福州数据中心", "长沙数据中心",
    "郑州数据中心", "昆明数据中心", "贵阳数据中心", "南宁数据中心",
]

PROBLEM_TYPES = [
    "性能问题", "可用性问题", "安全问题", "存储问题",
    "网络问题", "兼容性问题", "备份问题", "监控问题",
]

ROOT_CAUSE_CATEGORIES = [
    "数据库优化", "配置错误", "代码缺陷", "存储管理",
    "网络配置", "版本管理", "权限管理", "监控配置",
    "资源配置", "其他",
]

FEATURE_CATEGORIES = [
    "查询性能", "高可用", "安全防护", "日志管理",
    "数据同步", "兼容性", "数据备份", "告警机制",
    "数据导入", "集群管理", "其他",
]

IMPACT_CATEGORIES = [
    "性能影响", "业务中断", "安全风险", "数据丢失风险",
    "同步延迟", "功能受限", "备份失败", "响应延迟",
    "资源占用", "服务中断", "其他",
]

KERNEL_VERSIONS = [
    "V5.0.0", "V5.1.0", "V5.1.3", "V5.2.0",
    "V5.2.1", "V5.2.2", "V5.2.3", "V5.3.0",
]

STATUSES = ["待处理", "处理中", "已解决", "已关闭"]
STATUS_WEIGHTS = [0.15, 0.25, 0.35, 0.25]  # 待处理15%, 处理中25%, 已解决35%, 已关闭25%

# 问题描述模板
DESCRIPTION_TEMPLATES = [
    "数据库查询响应时间超过{seconds}秒，严重影响业务处理效率，需紧急优化。",
    "主备节点切换失败，导致服务中断{minutes}分钟，影响业务连续性。",
    "发现潜在SQL注入漏洞，存在数据泄露风险，需立即修复。",
    "磁盘空间使用率达到{percent}%，存在磁盘满风险，需扩容处理。",
    "网络延迟异常，跨机房同步延迟超过{delay}秒，影响数据一致性。",
    "新版本内核与旧版本存储不兼容，导致部分功能不可用。",
    "备份任务执行失败，近{days}天数据未备份，存在数据丢失风险。",
    "监控告警延迟{delay}分钟，未能及时发现异常，影响响应效率。",
    "批量数据导入时CPU占用率超过{percent}%，影响其他业务运行。",
    "集群节点宕机，服务短暂不可用，需排查根因。",
    "内存使用率持续增长，疑似内存泄露，当前达到{percent}%。",
    "数据库连接池耗尽，新连接无法建立，影响业务访问。",
    "日志文件过大占用磁盘空间{size}GB，需清理历史日志。",
    "安全审计发现异常访问行为，需进一步分析处理。",
    "数据同步组件异常，主备数据不一致，需紧急修复。",
]

ROOT_CAUSE_TEMPLATES = [
    "索引缺失导致全表扫描，查询性能下降",
    "心跳检测超时配置不合理，导致切换判断异常",
    "输入参数未进行严格校验，存在注入风险",
    "日志文件未定期清理，累积占用过多空间",
    "网络带宽配置不足，无法满足同步需求",
    "版本升级未做兼容性测试，导致功能异常",
    "备份脚本执行权限不足，无法正常运行",
    "告警阈值设置过高，未能及时触发",
    "导入脚本未使用批量优化，逐条处理效率低",
    "节点内存不足导致OOM，触发异常退出",
    "连接池参数配置过小，无法满足并发需求",
    "历史日志未设置自动清理策略",
    "访问控制策略配置不完善",
    "同步组件配置参数不匹配",
    "缓存策略配置不当，导致数据不一致",
]

SOLUTION_TEMPLATES = [
    "创建复合索引，优化查询计划",
    "调整心跳超时时间至合理范围",
    "增加参数校验和白名单过滤机制",
    "增加日志自动清理策略，定期归档",
    "增加网络带宽，优化同步配置",
    "回滚版本并制定升级测试流程",
    "调整脚本执行权限，确保备份正常",
    "调整告警阈值至合理范围",
    "优化导入脚本使用批量提交",
    "增加节点内存并优化内存使用",
    "增大连接池参数配置",
    "设置日志自动清理和归档策略",
    "完善访问控制策略配置",
    "调整同步组件参数配置",
    "优化缓存策略配置",
]


# ============== 工具函数 ==============

def random_choice_weighted(items: list[str], weights: list[float]) -> str:
    return random.choices(items, weights=weights, k=1)[0]


def random_person() -> tuple[str, str]:
    return random.choice(PERSONS)


def random_person_display() -> str:
    person = random_person()
    return f"{person[1]} {person[0]}"


def random_date_in_range(start: datetime, end: datetime) -> datetime:
    delta = end - start
    random_days = random.randint(0, delta.days)
    random_seconds = random.randint(0, 24 * 3600 - 1)
    return start + timedelta(days=random_days, seconds=random_seconds)


def allocate_problem_no(conn: psycopg.Connection, date: datetime, used_nos: set) -> str:
    """分配当日问题编号，避免重复"""
    ymd = date.strftime("%Y%m%d")
    prefix = f"MP{ymd}"
    
    # 查询数据库中已有的编号
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT problem_no FROM major_problem
            WHERE problem_no LIKE %s AND LENGTH(problem_no) = 11
            """,
            (prefix + "%",),
        )
        existing = {row["problem_no"] for row in cur.fetchall()}
    
    # 合合已使用的编号
    all_used = existing | used_nos
    
    # 找到下一个可用编号
    for n in range(1, 1000):
        candidate = f"{prefix}{n:03d}"
        if candidate not in all_used:
            used_nos.add(candidate)
            return candidate
    
    raise ValueError(f"当日问题编号已满: {ymd}")


def generate_ops_order_no(date: datetime, seq: int) -> str:
    return f"OPS{date.strftime('%Y%m%d')}{seq:03d}"


def generate_dts_bug_no() -> str:
    prefix = random.choice(["DTS", "BUG"])
    return f"{prefix}{random.randint(100000, 999999)}"


def fill_template(template: str) -> str:
    """填充模板中的占位符"""
    replacements = {
        "{seconds}": str(random.randint(30, 180)),
        "{minutes}": str(random.randint(5, 30)),
        "{percent}": str(random.randint(70, 95)),
        "{delay}": str(random.randint(5, 60)),
        "{days}": str(random.randint(1, 7)),
        "{size}": str(random.randint(10, 100)),
    }
    for k, v in replacements.items():
        template = template.replace(k, v)
    return template


def clear_major_problems(conn: psycopg.Connection) -> int:
    """清空已有重大问题数据"""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM major_problem")
        deleted = cur.rowcount
    return deleted


def generate_one_major_problem(
    conn: psycopg.Connection,
    report_date: datetime,
    seq: int,
    used_nos: set,
) -> dict[str, Any]:
    """生成一条重大问题记录"""
    
    # 随机选择属性
    site_name = random.choice(SITE_NAMES)
    problem_type = random.choice(PROBLEM_TYPES)
    status = random_choice_weighted(STATUSES, STATUS_WEIGHTS)
    
    root_cause_category = random.choice(ROOT_CAUSE_CATEGORIES)
    feature_category = random.choice(FEATURE_CATEGORIES)
    impact_category = random.choice(IMPACT_CATEGORIES)
    kernel_version = random.choice(KERNEL_VERSIONS)
    
    # 生成描述、根因、解决方案
    desc_idx = random.randint(0, len(DESCRIPTION_TEMPLATES) - 1)
    description = fill_template(DESCRIPTION_TEMPLATES[desc_idx])
    root_cause = ROOT_CAUSE_TEMPLATES[desc_idx]
    solution = SOLUTION_TEMPLATES[desc_idx]
    
    # 创建人
    creator = random_person()
    creator_id = creator[0]
    creator_name = creator[1]
    
    # 分配编号
    problem_no = allocate_problem_no(conn, report_date, used_nos)
    ops_order_no = generate_ops_order_no(report_date, seq)
    dts_bug_no = generate_dts_bug_no() if random.random() > 0.3 else ""
    
    # 插入数据
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO major_problem (
                report_date, ops_order_no, problem_no, site_name,
                problem_type, description, root_cause, solution,
                root_cause_category, feature_category, impact_category,
                kernel_version, dts_bug_no, status, creator_id, creator_name
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                report_date.date(),
                ops_order_no,
                problem_no,
                site_name,
                problem_type,
                description,
                root_cause,
                solution,
                root_cause_category,
                feature_category,
                impact_category,
                kernel_version,
                dts_bug_no,
                status,
                creator_id,
                creator_name,
            ),
        )
        row = cur.fetchone()
        problem_id = row["id"]
    
    return {
        "id": problem_id,
        "problem_no": problem_no,
        "report_date": report_date.strftime("%Y-%m-%d"),
        "site_name": site_name,
        "problem_type": problem_type,
        "status": status,
        "creator": f"{creator_name} {creator_id}",
    }


def main():
    parser = argparse.ArgumentParser(description="生成重大问题模块测试数据")
    parser.add_argument("--count", type=int, default=100, help="生成的问题数量")
    parser.add_argument("--reset", action="store_true", help="清空已有数据后重新生成")
    args = parser.parse_args()
    
    # 日期范围：2026-05-01 ~ 2026-05-15
    start_date = datetime(2026, 5, 1, 8, 0, 0, tzinfo=timezone.utc)
    end_date = datetime(2026, 5, 15, 18, 0, 0, tzinfo=timezone.utc)
    
    # 连接数据库
    db_dsn = os.getenv("DATABASE_URL", "postgresql://songkang@localhost:5432/yunwei_ticket")
    
    print("=" * 50)
    print("  重大问题模块测试数据生成")
    print("=" * 50)
    print(f"生成数量: {args.count}")
    print(f"日期范围: 2026-05-01 ~ 2026-05-15")
    print(f"数据库: {db_dsn.split('@')[-1] if '@' in db_dsn else db_dsn}")
    print()
    
    try:
        with psycopg.connect(db_dsn, row_factory=dict_row) as conn:
            # 清空已有数据
            if args.reset:
                deleted = clear_major_problems(conn)
                conn.commit()  # 确保删除提交
                print(f"已清空 {deleted} 条旧数据")
                print()
            
            # 生成数据
            print("开始生成重大问题数据...")
            generated = []
            used_nos: set = set()  # 跟踪已使用的编号
            
            for i in range(args.count):
                report_date = random_date_in_range(start_date, end_date)
                problem_info = generate_one_major_problem(conn, report_date, i + 1, used_nos)
                generated.append(problem_info)
                
                if (i + 1) % 20 == 0 or i == args.count - 1:
                    print(f"  已生成: {i + 1}/{args.count}")
            
            conn.commit()
            print()
            print(f"=== 完成！共生成 {len(generated)} 条重大问题 ===")
            print()
            
            # 统计
            print("统计：")
            
            # 按状态统计
            status_counts = {}
            for p in generated:
                status_counts[p["status"]] = status_counts.get(p["status"], 0) + 1
            for status, count in sorted(status_counts.items()):
                print(f"  {status}: {count}")
            
            print()
            
            # 按问题类型统计
            type_counts = {}
            for p in generated:
                type_counts[p["problem_type"]] = type_counts.get(p["problem_type"], 0) + 1
            print("按问题类型：")
            for ptype, count in sorted(type_counts.items()):
                print(f"  {ptype}: {count}")
            
            print()
            
            # 按局点统计
            site_counts = {}
            for p in generated:
                site_counts[p["site_name"]] = site_counts.get(p["site_name"], 0) + 1
            print("按局点（Top 5）：")
            for site, count in sorted(site_counts.items(), key=lambda x: -x[1])[:5]:
                print(f"  {site}: {count}")
            
            print()
            print("提示: 访问 http://localhost:8000/#/major-problem 查看重大问题页面")
            
    except Exception as e:
        print(f"错误: {e}")
        raise


if __name__ == "__main__":
    main()