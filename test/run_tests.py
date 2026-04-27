import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
REPORTS_DIR = BASE_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

MODULE_MAP = {
    "m01": "test_m01_health.py",
    "m02": "test_m02_ticket.py",
    "m03": "test_m03_permission.py",
    "m04": "test_m04_user.py",
    "m05": "test_m05_duty.py",
    "m06": "test_m06_leave.py",
    "m07": "test_m07_params.py",
    "m08": "test_m08_stats.py",
    "m09": "test_m09_spa.py",
}


def run_pytest(targets: list[str], report_json: Path) -> int:
    cmd = [
        sys.executable, "-m", "pytest",
        *targets,
        "-v",
        "--tb=short",
        f"--json-report",
        f"--json-report-file={report_json}",
        "--json-report-indent=2",
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BASE_DIR)
    result = subprocess.run(cmd, cwd=str(BASE_DIR), env=env)
    return result.returncode


def run_pytest_simple(targets: list[str]) -> int:
    cmd = [
        sys.executable, "-m", "pytest",
        *targets,
        "-v",
        "--tb=short",
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BASE_DIR)
    result = subprocess.run(cmd, cwd=str(BASE_DIR), env=env)
    return result.returncode


def generate_report(json_path: Path) -> str:
    if not json_path.exists():
        return f"测试结果文件不存在: {json_path}"

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    md_path = REPORTS_DIR / f"report_{ts}.md"

    summary = data.get("summary", {})
    total = summary.get("total", 0)
    passed = summary.get("passed", 0)
    failed = summary.get("failed", 0)
    errors = summary.get("error", 0) + summary.get("errors", 0)
    skipped = summary.get("skipped", 0)
    pass_rate = f"{(passed / total * 100):.1f}%" if total > 0 else "N/A"

    lines = []
    lines.append("# 运维工单平台 — 功能测试报告")
    lines.append("")
    lines.append("## 1. 测试概述")
    lines.append("")
    lines.append("| 项目 | 内容 |")
    lines.append("|------|------|")
    lines.append(f"| 测试目的 | 验证运维工单平台所有功能模块的正确性与完整性 |")
    lines.append(f"| 测试范围 | M01-M09 共9个功能模块 |")
    lines.append(f"| 测试时间 | {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} |")
    lines.append(f"| 测试环境 | Python {sys.version.split()[0]}, API {os.getenv('TEST_API_BASE_URL', 'http://127.0.0.1:8000')} |")
    lines.append("")

    lines.append("## 2. 测试结果统计")
    lines.append("")
    lines.append("### 2.1 总体统计")
    lines.append("")
    lines.append("| 指标 | 数值 |")
    lines.append("|------|------|")
    lines.append(f"| 总测试项数 | {total} |")
    lines.append(f"| 通过数 | {passed} |")
    lines.append(f"| 失败数 | {failed} |")
    lines.append(f"| 错误数 | {errors} |")
    lines.append(f"| 跳过数 | {skipped} |")
    lines.append(f"| 通过率 | {pass_rate} |")
    lines.append("")

    tests = data.get("tests", [])
    module_stats: dict[str, dict] = {}
    for t in tests:
        nodeid = t.get("nodeid", "")
        parts = nodeid.split("::")
        file_name = parts[0] if parts else "unknown"
        mod_key = file_name.replace("test_", "").replace(".py", "")
        if mod_key not in module_stats:
            module_stats[mod_key] = {"total": 0, "passed": 0, "failed": 0, "errors": 0, "skipped": 0}
        module_stats[mod_key]["total"] += 1
        outcome = t.get("outcome", "")
        if outcome == "passed":
            module_stats[mod_key]["passed"] += 1
        elif outcome == "failed":
            module_stats[mod_key]["failed"] += 1
        elif outcome in ("error", "errors"):
            module_stats[mod_key]["errors"] += 1
        else:
            module_stats[mod_key]["skipped"] += 1

    lines.append("### 2.2 按模块统计")
    lines.append("")
    lines.append("| 模块 | 总数 | 通过 | 失败 | 错误 | 跳过 | 通过率 |")
    lines.append("|------|------|------|------|------|------|--------|")
    for mod, stats in sorted(module_stats.items()):
        mod_total = stats["total"]
        mod_rate = f"{(stats['passed'] / mod_total * 100):.1f}%" if mod_total > 0 else "N/A"
        lines.append(f"| {mod} | {mod_total} | {stats['passed']} | {stats['failed']} | {stats['errors']} | {stats['skipped']} | {mod_rate} |")
    lines.append("")

    lines.append("## 3. 详细测试结果")
    lines.append("")
    lines.append("| 用例ID | 模块 | 测试项 | 预期结果 | 实际结果 | 状态 |")
    lines.append("|--------|------|--------|----------|----------|------|")
    for t in tests:
        nodeid = t.get("nodeid", "")
        parts = nodeid.split("::")
        test_name = parts[-1] if parts else nodeid
        file_name = parts[0] if parts else ""
        mod = file_name.replace("test_", "").replace(".py", "")
        outcome = t.get("outcome", "")
        status = "PASS" if outcome == "passed" else "FAIL" if outcome == "failed" else "ERROR" if outcome in ("error", "errors") else "SKIP"
        actual = ""
        if outcome == "failed":
            call = t.get("call", {})
            crash = call.get("crash", {})
            actual = str(crash.get("message", ""))[:80]
        elif outcome == "passed":
            actual = "符合预期"
        lines.append(f"| {test_name} | {mod} | {test_name} | — | {actual} | {status} |")
    lines.append("")

    failed_tests = [t for t in tests if t.get("outcome") == "failed"]
    if failed_tests:
        lines.append("## 4. 失败分析")
        lines.append("")
        lines.append("| 用例ID | 失败现象 | 错误信息 | 可能原因 | 建议措施 |")
        lines.append("|--------|----------|----------|----------|----------|")
        for t in failed_tests:
            nodeid = t.get("nodeid", "")
            test_name = nodeid.split("::")[-1] if "::" in nodeid else nodeid
            call = t.get("call", {})
            long_repr = str(call.get("longrepr", ""))
            crash_msg = str(call.get("crash", {}).get("message", ""))
            error_info = (crash_msg or long_repr)[:200]
            lines.append(f"| {test_name} | 断言失败 | {error_info} | 待分析 | 检查相关接口逻辑与数据 |")
        lines.append("")

    lines.append("## 5. 测试结论与建议")
    lines.append("")
    if failed == 0 and errors == 0:
        lines.append("所有测试用例均通过，系统功能模块运行正常。")
    else:
        lines.append(f"共 {failed + errors} 项测试未通过，需排查修复后重新测试。")
    lines.append("")
    lines.append("---")
    lines.append(f"*报告生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*")

    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    json_report_path = REPORTS_DIR / f"report_{ts}.json"
    with open(json_report_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return str(md_path)


def main():
    parser = argparse.ArgumentParser(description="运维工单平台功能测试执行器")
    parser.add_argument("--module", "-m", help="指定测试模块，如 m02（可逗号分隔多个）")
    parser.add_argument("--case", "-k", help="指定测试用例关键字，如 TC-M02-015")
    parser.add_argument("--report", "-r", action="store_true", help="生成测试报告")
    parser.add_argument("--base-url", help="API基础URL", default=os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000"))
    args = parser.parse_args()

    os.environ["TEST_API_BASE_URL"] = args.base_url

    targets = []
    if args.module:
        mods = [m.strip() for m in args.module.split(",")]
        for mod in mods:
            if mod in MODULE_MAP:
                targets.append(str(BASE_DIR / MODULE_MAP[mod]))
            else:
                print(f"未知模块: {mod}，可用模块: {', '.join(MODULE_MAP.keys())}")
                sys.exit(1)
    else:
        targets = [str(BASE_DIR / f) for f in MODULE_MAP.values()]

    pytest_args = targets[:]
    if args.case:
        pytest_args = ["-k", args.case] + pytest_args

    if args.report:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        json_path = REPORTS_DIR / f"raw_{ts}.json"
        print(f"正在执行测试并生成报告...")
        print(f"测试目标: {', '.join(targets)}")
        print(f"API地址: {args.base_url}")
        print("")

        cmd = [sys.executable, "-m", "pytest"] + pytest_args + [
            "-v", "--tb=short",
            f"--json-report",
            f"--json-report-file={json_path}",
            "--json-report-indent=2",
        ]
        env = os.environ.copy()
        env["PYTHONPATH"] = str(BASE_DIR)
        subprocess.run(cmd, cwd=str(BASE_DIR), env=env)

        report_path = generate_report(json_path)
        print(f"\n测试报告已生成: {report_path}")
    else:
        cmd = [sys.executable, "-m", "pytest"] + pytest_args + ["-v", "--tb=short"]
        env = os.environ.copy()
        env["PYTHONPATH"] = str(BASE_DIR)
        result = subprocess.run(cmd, cwd=str(BASE_DIR), env=env)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
