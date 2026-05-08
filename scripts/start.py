#!/usr/bin/env python3
"""
一键启动运维工单平台服务

用法:
    python scripts/start.py              # 正常启动（自动检测数据库状态）
    python scripts/start.py --reset-db   # 强制重新初始化数据库
    python scripts/start.py --skip-check # 跳过检查直接启动
"""

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# 与测试套件（conftest 等）及依赖生态一致：低于 3.10 时类型注解与部分依赖易出问题
MIN_PYTHON = (3, 10)

# 项目路径常量
ROOT = Path(__file__).parent.parent.resolve()
BACKEND_DIR = ROOT / "backend"
VENV_DIR = BACKEND_DIR / ".venv"
ENV_FILE = BACKEND_DIR / ".env"
MIG_DIR = ROOT / "db" / "migrations"

# 跨平台虚拟环境路径
if sys.platform == "win32":
    VENV_PYTHON = VENV_DIR / "Scripts" / "python.exe"
    VENV_PIP = VENV_DIR / "Scripts" / "pip.exe"
else:
    VENV_PYTHON = VENV_DIR / "bin" / "python"
    VENV_PIP = VENV_DIR / "bin" / "pip"


def parse_args():
    parser = argparse.ArgumentParser(description="一键启动运维工单平台")
    parser.add_argument(
        "--reset-db", action="store_true", help="强制重新初始化数据库（清空数据）"
    )
    parser.add_argument(
        "--skip-check", action="store_true", help="跳过数据库检查，直接启动服务"
    )
    return parser.parse_args()


def print_status(tag, msg):
    """统一状态输出格式"""
    tags = {"ok": "[OK]", "doing": "[...]", "warn": "[!]", "ask": "[?]"}
    print(f"{tags.get(tag, tag)} {msg}")


def _python_meets_min(py_exe: str) -> bool:
    try:
        subprocess.run(
            [
                py_exe,
                "-c",
                f"import sys; sys.exit(0 if sys.version_info[:2] >= {MIN_PYTHON} else 1)",
            ],
            check=True,
            capture_output=True,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return False


def find_python_for_venv() -> str:
    """选择用于创建 backend/.venv 的解释器（须 >= 3.10）。"""
    candidates: list[str] = []
    if _python_meets_min(sys.executable):
        candidates.append(sys.executable)
    for name in ("python3.13", "python3.12", "python3.11", "python3.10"):
        path = shutil.which(name)
        if path and path not in candidates and _python_meets_min(path):
            candidates.append(path)
    if sys.platform == "win32":
        for ver in ("3.13", "3.12", "3.11", "3.10"):
            try:
                out = subprocess.run(
                    ["py", f"-{ver}", "-c", "import sys; print(sys.executable)"],
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout.strip()
                if out and out not in candidates and _python_meets_min(out):
                    candidates.append(out)
            except (subprocess.CalledProcessError, FileNotFoundError, OSError):
                continue
    if candidates:
        chosen = candidates[0]
        print_status("ok", f"将使用 Python 创建虚拟环境: {chosen}")
        return chosen
    print_status("warn", f"未找到 Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} 及以上解释器。")
    print("    请先安装对应版本（如 macOS: brew install python@3.11；Windows: 官网安装包并勾选 PATH；或安装后确保 PATH 中有 python3.11）。")
    print(f"    然后使用例如: python3.11 scripts/start.py")
    sys.exit(1)


def check_existing_venv_python():
    """若已有 .venv 但 Python 版本过低，提示删除后重试。"""
    if not VENV_PYTHON.exists():
        return
    if _python_meets_min(str(VENV_PYTHON)):
        return
    print_status(
        "warn",
        f"现有虚拟环境 {VENV_PYTHON} 的 Python 版本低于 {MIN_PYTHON[0]}.{MIN_PYTHON[1]}，与项目要求不符。",
    )
    print("    请删除目录 backend/.venv 后重新运行一键启动脚本，以使用本机已安装的 Python 3.10+ 重建环境。")
    sys.exit(1)


def ensure_venv():
    """确保虚拟环境存在（Python >= 3.10）。"""
    check_existing_venv_python()
    if VENV_PYTHON.exists():
        print_status("ok", "虚拟环境已存在")
        return
    py = find_python_for_venv()
    print_status("doing", "创建虚拟环境...")
    subprocess.run([py, "-m", "venv", str(VENV_DIR)], check=True)
    print_status("ok", "虚拟环境创建完成")


def install_deps():
    """安装项目依赖"""
    print_status("doing", "安装依赖...")
    req_file = BACKEND_DIR / "requirements.txt"
    subprocess.run([str(VENV_PIP), "install", "-r", str(req_file)], check=True)
    print_status("ok", "依赖安装完成")


def parse_env_file(filepath):
    """解析 .env 文件"""
    env_vars = {}
    if filepath.exists():
        for line in filepath.read_text(encoding="utf-8").strip().splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                env_vars[key.strip()] = value.strip()
    return env_vars


def configure_database():
    """配置数据库连接"""
    # 优先读取 .env 文件
    if ENV_FILE.exists():
        env_vars = parse_env_file(ENV_FILE)
        dsn = env_vars.get("DATABASE_URL")
        if dsn:
            print_status("ok", f"使用现有数据库配置: {dsn}")
            return dsn

    # 提示用户输入
    print_status("ask", "请输入数据库连接串")
    print("    格式: postgresql://user:pass@host:port/dbname")
    print("    留空使用默认: postgresql://postgres:123@localhost:5432/yunwei_ticket")
    dsn = input("DATABASE_URL: ").strip()

    if not dsn:
        dsn = "postgresql://postgres:123@localhost:5432/yunwei_ticket"
        print_status("warn", f"使用默认配置: {dsn}")

    # 写入 .env 文件
    ENV_FILE.write_text(f"DATABASE_URL={dsn}\n", encoding="utf-8")
    print_status("ok", f"配置已写入 {ENV_FILE}")
    return dsn


def ensure_minio_env_template():
    """在 backend/.env 末尾补充 MinIO 可选变量模板（不覆盖已有 MINIO_ENDPOINT= 配置）。"""
    if not ENV_FILE.exists():
        return
    try:
        text = ENV_FILE.read_text(encoding="utf-8")
    except OSError:
        return
    if re.search(r"^\s*MINIO_ENDPOINT\s*=", text, flags=re.MULTILINE):
        return
    block = """
# --- 富文本图片 MinIO（可选）---
# 不配或留空时，工单富文本「插入图片」接口不可用（HTTP 503）；配置并启动 MinIO 后填入下列变量。
MINIO_ENDPOINT=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=
MINIO_USE_SSL=false
MINIO_PUBLIC_BASE_URL=
"""
    ENV_FILE.write_text(text.rstrip() + block, encoding="utf-8")
    print_status("ok", f"已在 {ENV_FILE} 补充 MinIO 可选环境变量模板（按需填写）")


def check_database_has_data(dsn):
    """检查数据库是否已有数据"""
    # 确保 psycopg 已安装
    subprocess.run(
        [str(VENV_PIP), "install", "psycopg[binary]"],
        check=True,
        capture_output=True,
    )

    # 使用虚拟环境 Python 执行检查
    check_script = f'''
import psycopg
conn = psycopg.connect("{dsn}")
result = conn.execute("SELECT to_regclass('public.workflow_template')").fetchone()
has_table = result[0] is not None
if has_table:
    result2 = conn.execute("SELECT COUNT(*) FROM workflow_template").fetchone()
    has_data = result2[0] > 0
else:
    has_data = False
conn.close()
print("HAS_DATA", has_data)
'''
    result = subprocess.run(
        [str(VENV_PYTHON), "-c", check_script],
        capture_output=True,
        text=True,
        check=True,
    )
    return "HAS_DATA True" in result.stdout


def execute_sql_file(dsn, sql_file):
    """执行单个 SQL 文件"""
    # 使用 pathlib 处理路径，避免 Windows 反斜杠转义问题
    sql_file_path = Path(sql_file).as_posix()
    script = f'''
import psycopg
with psycopg.connect("{dsn}") as conn:
    with open(r"{sql_file_path}", "r", encoding="utf-8") as f:
        sql = f.read()
    conn.execute(sql)
    conn.commit()
'''
    subprocess.run([str(VENV_PYTHON), "-c", script], check=True)


def run_migrations(dsn):
    """执行数据库迁移"""
    print_status("doing", "执行数据库迁移...")
    sql_files = sorted(glob.glob(str(MIG_DIR / "*.sql")))

    if not sql_files:
        print_status("warn", "未找到迁移文件")
        return

    for sql_file in sql_files:
        filename = Path(sql_file).name
        print(f"    执行: {filename}")
        try:
            execute_sql_file(dsn, sql_file)
        except subprocess.CalledProcessError as e:
            print_status("warn", f"迁移文件 {filename} 执行失败，跳过继续...")

    print_status("ok", "数据库迁移完成")


def drop_all_tables(dsn):
    """删除所有表（用于 reset-db）"""
    print_status("warn", "正在清空数据库...")
    script = f'''
import psycopg
with psycopg.connect("{dsn}") as conn:
    # 获取所有表名
    result = conn.execute("""
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    """).fetchall()
    tables = [r[0] for r in result]
    # 删除所有表
    for tbl in tables:
        conn.execute("DROP TABLE IF EXISTS " + tbl + " CASCADE")
    conn.commit()
    print("DROPPED", len(tables), "tables")
'''
    subprocess.run([str(VENV_PYTHON), "-c", script], check=True)


def check_and_migrate(dsn, reset_db=False):
    """检查数据库状态并执行迁移"""
    print_status("doing", "检查数据库状态...")

    if reset_db:
        print_status("warn", "--reset-db 模式，将清空并重新初始化数据库")
        drop_all_tables(dsn)
        run_migrations(dsn)
        return

    has_data = check_database_has_data(dsn)
    if has_data:
        print_status("ok", "数据库已初始化，跳过迁移")
        return

    print_status("ok", "数据库为空，开始初始化")
    run_migrations(dsn)


def start_server():
    """启动后端服务"""
    print_status("doing", "启动后端服务...")
    print_status("ok", "服务地址: http://localhost:8000")
    print("    按 Ctrl+C 停止服务")
    print()

    subprocess.run(
        [
            str(VENV_PYTHON),
            "-m",
            "uvicorn",
            "app:app",
            "--host",
            "localhost",
            "--port",
            "8000",
        ],
        cwd=str(BACKEND_DIR),
    )


def main():
    args = parse_args()

    print("=" * 50)
    print("  运维工单平台 - 一键启动脚本")
    print("=" * 50)
    print()

    # 1. 创建虚拟环境
    ensure_venv()

    # 2. 安装依赖
    install_deps()

    # 3. 配置数据库连接
    dsn = configure_database()
    ensure_minio_env_template()

    # 4. 检测数据库状态并执行迁移
    if not args.skip_check:
        check_and_migrate(dsn, reset_db=args.reset_db)

    # 5. 启动后端服务
    start_server()


if __name__ == "__main__":
    main()