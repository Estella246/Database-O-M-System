#!/usr/bin/env python3
"""
生成大量工单测试数据 — 2026年1月1日起至当前
工作日每天10-30条，休息日每天10条以下
用法：
    python scripts/generate_bulk_tickets.py
    python scripts/generate_bulk_tickets.py --reset
"""

import os
import sys
import random
from datetime import datetime, timedelta, timezone

# 复用已有脚本的生成逻辑
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from generate_test_tickets import (
    PERSONS, LOCATIONS, BIZ_ENVS, SEVERITIES, SEVERITY_WEIGHTS,
    COMPONENTS, COMPONENT_WEIGHTS, ISSUE_TYPES_KERNEL, ISSUE_TYPES_CONTROL,
    PRODUCT_LINES, DEPLOY_MODES, EVENT_LEVELS, CUSTOMER_VOICES,
    GAUSS_VERSIONS, DOER_ASSIST_OPTIONS, NODE_KEYS, NODE_NAMES,
    STAGE_DISTRIBUTION,
    random_choice_weighted, random_person, random_person_display,
    random_date_in_range, generate_ticket_no, random_ecare_no,
    generate_issue_desc, select_issue_type,
    generate_problem_fill_values, generate_problem_review_values,
    generate_ops_analysis_values, generate_dev_analysis_values,
    generate_dev_closure_values, generate_ops_closure_values,
    generate_audit_close_values, generate_flow_log_comment,
    get_template_and_node_ids, get_duty_field_paths, get_baseline_versions,
    allocate_ticket_no, clear_test_tickets, generate_one_ticket,
)

import psycopg
from psycopg.rows import dict_row


def is_weekday(d: datetime) -> bool:
    """周一~周五为工作日"""
    return d.weekday() < 5  # 0=Mon, 4=Fri


def count_per_day(d: datetime) -> int:
    """工作日10-30条，休息日5-9条"""
    if is_weekday(d):
        return random.randint(10, 30)
    else:
        return random.randint(5, 9)


def main():
    start_date = datetime(2026, 1, 1, 8, 0, 0, tzinfo=timezone.utc)
    # 截止到2026年6月11日
    end_date = datetime(2026, 6, 11, 18, 0, 0, tzinfo=timezone.utc)

    db_dsn = os.getenv("DATABASE_URL", "postgresql://estella@localhost:5432/yunwei_ticket")

    # 计算总天数和预估总工单数
    total_days = (end_date - start_date).days + 1
    est_min = sum(10 if is_weekday(start_date + timedelta(days=d)) else 5 for d in range(total_days))
    est_max = sum(30 if is_weekday(start_date + timedelta(days=d)) else 9 for d in range(total_days))

    print(f"=== GaussDB 工单批量生成 ===")
    print(f"日期范围: {start_date.strftime('%Y-%m-%d')} ~ {end_date.strftime('%Y-%m-%d')}")
    print(f"总天数: {total_days} (工作日约{sum(1 for d in range(total_days) if is_weekday(start_date + timedelta(days=d)))}天)")
    print(f"预估工单数: {est_min} ~ {est_max}")
    print(f"数据库: {db_dsn.split('@')[-1] if '@' in db_dsn else db_dsn}")
    print()

    try:
        with psycopg.connect(db_dsn, row_factory=dict_row) as conn:
            template_info = get_template_and_node_ids(conn)
            duty_paths = get_duty_field_paths(conn)
            baseline_versions = get_baseline_versions(conn)
            print(f"模板ID: {template_info['template_id']}")
            print(f"责任田路径: {len(duty_paths)}, 基线版本: {len(baseline_versions)}")
            print()

            # 清空旧数据
            cleared = clear_test_tickets(conn)
            conn.commit()
            print(f"已清空 {cleared} 条旧测试数据")
            print()

            total_generated = 0
            day_count = 0

            for day_offset in range(total_days):
                current_day = start_date + timedelta(days=day_offset)
                day_str = current_day.strftime("%Y-%m-%d")
                weekday_label = "工作日" if is_weekday(current_day) else "休息日"

                n_tickets = count_per_day(current_day)

                for i in range(n_tickets):
                    # 每天的时间分布在 8:00-18:00
                    hour = random.randint(8, 17)
                    minute = random.randint(0, 59)
                    second = random.randint(0, 59)
                    ticket_time = current_day.replace(hour=hour, minute=minute, second=second)

                    # 按权重选择目标阶段
                    stage_weights = [s[1] for s in STAGE_DISTRIBUTION]
                    stage_keys = [s[0] for s in STAGE_DISTRIBUTION]
                    selected = random.choices(stage_keys, weights=stage_weights, k=1)[0]
                    is_closed = selected == "closed"
                    target_stage = "audit_close" if is_closed else selected

                    try:
                        ticket_info = generate_one_ticket(
                            conn, template_info, ticket_time, target_stage, is_closed, i + 1,
                            duty_paths, baseline_versions
                        )
                        total_generated += 1
                    except Exception as e:
                        # 序号冲突时重试一次
                        if "duplicate" in str(e).lower() or "already exists" in str(e).lower():
                            try:
                                ticket_info = generate_one_ticket(
                                    conn, template_info, ticket_time, target_stage, is_closed, i + 1 + 100,
                                    duty_paths, baseline_versions
                                )
                                total_generated += 1
                            except Exception:
                                print(f"  ⚠ 跳过 {day_str} #{i+1}: 序号冲突无法解决")
                                continue
                        else:
                            print(f"  ⚠ 跳过 {day_str} #{i+1}: {e}")
                            continue

                # 每天提交一次
                conn.commit()
                day_count += 1

                if day_count % 7 == 0 or day_offset == total_days - 1:
                    print(f"  [{day_count}/{total_days}] {day_str} ({weekday_label}): {n_tickets}条 — 累计 {total_generated}条")

            print()
            print(f"=== 完成！共生成 {total_generated} 条工单 ===")

    except Exception as e:
        print(f"错误: {e}")
        raise


if __name__ == "__main__":
    main()