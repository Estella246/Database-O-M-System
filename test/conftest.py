import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from datetime import datetime

import pytest

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"

sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
load_dotenv(BACKEND_DIR / ".env")

# Skip SSO authentication for API tests (requires running backend with SKIP_SSO_AUTH=1)
# If backend is not started with SKIP_SSO_AUTH, tests will fail with 401 errors
os.environ["SKIP_SSO_AUTH"] = os.getenv("SKIP_SSO_AUTH", "1")

import psycopg
from psycopg.errors import OperationalError, UndefinedTable
from psycopg.rows import dict_row

BASE_URL = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000")
TEST_DATA_PATH = BASE_DIR / "test_data" / "test_data.json"
REPORTS_DIR = BASE_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

MIGRATIONS_DIR = PROJECT_ROOT / "db" / "migrations"

def load_test_data() -> dict:
    with open(TEST_DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    preset = BASE_DIR / "test_data" / "admin_whitelist_full.json"
    if preset.is_file():
        extra = json.loads(preset.read_text(encoding="utf-8"))
        data.setdefault("permissions", [])
        data["permissions"] = list(data["permissions"]) + list(extra)
    return data


def _split_sql_migration_statements(text: str) -> list[str]:
    """Split SQL into statements, properly handling PostgreSQL dollar-quoted strings."""
    # Simple approach: remove file-level BEGIN/COMMIT at start/end of file
    lines = text.strip().splitlines()

    # Remove leading BEGIN if present (transaction wrapper)
    start_idx = 0
    while start_idx < len(lines):
        line = lines[start_idx].strip()
        if not line or line.startswith("--"):
            start_idx += 1
            continue
        if line.upper().startswith("BEGIN") and (line.upper() == "BEGIN" or line.upper().startswith("BEGIN;")):
            start_idx += 1
        break
    lines = lines[start_idx:]

    # Remove trailing COMMIT if present
    end_idx = len(lines) - 1
    while end_idx >= 0:
        line = lines[end_idx].strip()
        if not line or line.startswith("--"):
            end_idx -= 1
            continue
        if line.upper() == "COMMIT" or line.upper() == "COMMIT;":
            end_idx -= 1
        break
    lines = lines[:end_idx + 1]

    text = "\n".join(lines)

    # Now split by semicolons, respecting dollar-quoted strings
    out: list[str] = []
    i = 0

    def find_dollar_quote_tag(text: str, pos: int) -> tuple[str, int] | None:
        """Find a dollar-quote delimiter starting at pos. Returns (full_tag, end_pos) or None."""
        if pos >= len(text) or text[pos] != "$":
            return None
        # Find all characters between first $ and second $
        start = pos
        pos += 1
        # Collect tag characters (can be empty for $$)
        while pos < len(text) and text[pos] not in ("$", "\n", " ", "\t", ";"):
            pos += 1
        # Now check if we have the closing $
        if pos < len(text) and text[pos] == "$":
            full_tag = text[start:pos + 1]  # Includes both $ delimiters
            return full_tag, pos + 1
        return None

    while i < len(text):
        # Skip whitespace and comments at start
        while i < len(text):
            if text[i].isspace():
                i += 1
            elif text[i:i+2] == "--":
                while i < len(text) and text[i] != "\n":
                    i += 1
            elif text[i:i+2] == "/*":
                i += 2
                while i < len(text) - 1 and text[i:i+2] != "*/":
                    i += 1
                i += 2
            else:
                break

        if i >= len(text):
            break

        stmt_start = i
        stmt_end = None
        dollar_quote_tags: list[str] = []  # Stack of active dollar-quote tags

        while i < len(text):
            # Check for dollar-quote delimiter
            if text[i] == "$":
                result = find_dollar_quote_tag(text, i)
                if result:
                    full_tag, new_pos = result
                    i = new_pos
                    if dollar_quote_tags and dollar_quote_tags[-1] == full_tag:
                        # End of dollar-quoted section
                        dollar_quote_tags.pop()
                    else:
                        # Start of dollar-quoted section
                        dollar_quote_tags.append(full_tag)
                else:
                    # Not a valid dollar-quote, just a regular $ character
                    i += 1
            elif text[i] == ";" and not dollar_quote_tags:
                # Statement terminator outside dollar-quoted section
                stmt_end = i + 1
                i += 1
                break
            else:
                i += 1

        if stmt_end is None:
            stmt = text[stmt_start:].strip()
            if stmt and not stmt.startswith("--"):
                if not stmt.endswith(";"):
                    stmt += ";"
                out.append(stmt)
        else:
            stmt = text[stmt_start:stmt_end].strip()
            if stmt and not stmt.startswith("--"):
                if not stmt.endswith(";"):
                    stmt += ";"
                # Skip pure BEGIN/COMMIT statements (within function bodies they're inside $$)
                if stmt.upper() not in ("BEGIN;", "COMMIT;"):
                    out.append(stmt)

    return out


def _apply_sql_file_psycopg(conn, path: Path) -> None:
    raw = path.read_text(encoding="utf-8")
    for stmt in _split_sql_migration_statements(raw):
        conn.execute(stmt)


def _apply_pending_migrations(conn) -> None:
    """按文件名排序执行尚未记录在 pytest_migration_applied 中的迁移。"""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pytest_migration_applied (
            filename TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.commit()
    applied_rows = conn.execute("SELECT filename FROM pytest_migration_applied").fetchall()
    applied = {r["filename"] for r in applied_rows}
    dsn = os.environ.get("DATABASE_URL", "")
    psql_exe = shutil.which("psql")
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        name = path.name
        if name in applied:
            continue
        if psql_exe and dsn:
            r = subprocess.run(
                [psql_exe, dsn, "-v", "ON_ERROR_STOP=1", "-f", str(path)],
                capture_output=True,
                text=True,
                timeout=180,
            )
            if r.returncode != 0:
                pytest.fail(
                    f"迁移 {name} 执行失败（已使用 psql）。stderr:\n{r.stderr}\nstdout:\n{r.stdout}"
                )
        else:
            _apply_sql_file_psycopg(conn, path)
        conn.execute(
            "INSERT INTO pytest_migration_applied (filename) VALUES (%s)",
            (name,),
        )
        conn.commit()


def _try_psql_files(dsn: str, paths: list[Path]) -> bool:
    exe = shutil.which("psql")
    if not exe:
        return False
    for p in paths:
        r = subprocess.run(
            [exe, dsn, "-v", "ON_ERROR_STOP=1", "-f", str(p)],
            capture_output=True,
            text=True,
            timeout=180,
        )
        if r.returncode != 0:
            return False
    return True


def _ensure_upload_session_schema(conn) -> None:
    row = conn.execute("SELECT to_regclass('public.upload_session') AS n").fetchone()
    if row and row.get("n"):
        return
    m33 = MIGRATIONS_DIR / "0033_upload_sessions.sql"
    m34 = MIGRATIONS_DIR / "0034_upload_sessions_extended.sql"
    if not m33.is_file() or not m34.is_file():
        return
    dsn = os.environ.get("DATABASE_URL", "")
    if dsn and _try_psql_files(dsn, [m33, m34]):
        return
    _apply_sql_file_psycopg(conn, m33)
    _apply_sql_file_psycopg(conn, m34)


def _ensure_builtin_skill_seed(conn) -> None:
    row = conn.execute(
        "SELECT to_regclass('public.ticket_analysis_skill') AS n"
    ).fetchone()
    if not row or not row.get("n"):
        return
    cnt_row = conn.execute(
        "SELECT COUNT(*)::int AS c FROM ticket_analysis_skill WHERE is_builtin IS TRUE"
    ).fetchone()
    if cnt_row and int(cnt_row.get("c") or 0) > 0:
        return
    conn.execute(
        """
        INSERT INTO ticket_analysis_skill (
            name, description, api_base_url, api_key, model,
            max_tokens, temperature, system_prompt, analysis_prompt_template,
            input_fields, output_format, is_enabled, is_builtin, sort_order,
            creator_id, creator_name, updated_by
        )
        SELECT %s, '', %s, %s, 'gpt-4o',
            4096, 0.3, '系统', %s,
            NULL, NULL, TRUE, TRUE, 0, 'system', '系统', 'system'
        WHERE NOT EXISTS (
            SELECT 1 FROM ticket_analysis_skill WHERE is_builtin IS TRUE LIMIT 1
        )
        """,
        (
            "pytest内置Skill占位",
            "https://api.example.com/v1",
            "pytest-builtin-key",
            "请分析工单 {ticket_no}",
        ),
    )


def _check_database_has_existing_data(conn) -> bool:
    """检查数据库是否已有核心表和数据。"""
    try:
        # 检查核心表是否存在
        result = conn.execute(
            "SELECT to_regclass('public.workflow_template') AS exists"
        ).fetchone()
        if not result or not result.get("exists"):
            return False

        # 检查核心表是否有数据
        result = conn.execute(
            "SELECT COUNT(*) AS cnt FROM workflow_template LIMIT 1"
        ).fetchone()
        if result and result.get("cnt", 0) > 0:
            return True

        # 检查更多核心表
        result = conn.execute(
            "SELECT to_regclass('public.workflow_node') AS exists"
        ).fetchone()
        if result and result.get("exists"):
            result = conn.execute(
                "SELECT COUNT(*) AS cnt FROM workflow_node LIMIT 1"
            ).fetchone()
            if result and result.get("cnt", 0) > 0:
                return True

        return False
    except Exception:
        return False


def _reset_database(conn) -> None:
    """清空数据库所有表（保留 pytest_migration_applied）。"""
    # 获取所有表名
    rows = conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    ).fetchall()
    tables = [r["table_name"] for r in rows]

    # 先删除所有表（按依赖顺序，从子表到父表）
    for table in tables:
        if table != "pytest_migration_applied":
            conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    # 清空迁移记录表
    conn.execute("DELETE FROM pytest_migration_applied")

    # 删除所有触发器函数
    conn.execute("DROP FUNCTION IF EXISTS set_updated_at() CASCADE")

    conn.commit()


def _mark_all_migrations_as_applied(conn) -> None:
    """将所有迁移文件标记为已应用（用于已存在数据的数据库）。"""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pytest_migration_applied (
            filename TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.commit()

    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        name = path.name
        conn.execute(
            "INSERT INTO pytest_migration_applied (filename) VALUES (%s) ON CONFLICT DO NOTHING",
            (name,),
        )
    conn.commit()


# 命令行选项：是否重置数据库
def pytest_addoption(parser):
    parser.addoption(
        "--reset-db",
        action="store_true",
        default=False,
        help="清空数据库并重新执行所有迁移",
    )


@pytest.fixture(scope="session", autouse=True)
def ensure_database_schema_and_test_bootstrap(request):
    """有 DATABASE_URL 时：检测已有数据则跳过迁移，否则执行迁移；--reset-db 时清空重建。"""
    db_dsn = os.getenv("DATABASE_URL")
    if not db_dsn:
        return

    reset_db = request.config.getoption("--reset-db", default=False)
    skip_migrate = os.getenv("PYTEST_SKIP_AUTO_MIGRATE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    try:
        with psycopg.connect(db_dsn, row_factory=dict_row) as conn:
            # 如果指定了 --reset-db，清空数据库
            if reset_db:
                print("\n[INFO] --reset-db 已指定，正在清空数据库...")
                _reset_database(conn)
                print("[INFO] 数据库已清空，重新执行迁移...")
                _apply_pending_migrations(conn)
                _ensure_upload_session_schema(conn)
                _ensure_builtin_skill_seed(conn)
                conn.commit()
                return

            # 如果环境变量指定跳过迁移
            if skip_migrate:
                print("\n[INFO] PYTEST_SKIP_AUTO_MIGRATE 已设置，跳过迁移")
                _ensure_upload_session_schema(conn)
                _ensure_builtin_skill_seed(conn)
                conn.commit()
                return

            # 检查数据库是否已有数据
            has_data = _check_database_has_existing_data(conn)

            if has_data:
                print("\n[INFO] 数据库已有数据，仅执行未应用的迁移")
                _apply_pending_migrations(conn)
                _ensure_upload_session_schema(conn)
                _ensure_builtin_skill_seed(conn)
                conn.commit()
                return

            # 数据库为空，执行迁移
            print("\n[INFO] 数据库为空，正在执行迁移...")
            _apply_pending_migrations(conn)
            _ensure_upload_session_schema(conn)
            _ensure_builtin_skill_seed(conn)
            conn.commit()

    except OperationalError:
        # 本机未启动 Postgres 等：不阻断无需库的用例（如纯 CSS）
        return
    except Exception as e:
        pytest.fail(f"数据库 schema / bootstrap 失败（已连接 DATABASE_URL）: {e}")


@pytest.fixture(scope="session")
def browser():
    try:
        import playwright  # noqa: F401
    except ImportError:
        pytest.fail(
            "未安装 Playwright。请执行: pip install playwright && playwright install chromium"
        )
    from playwright.sync_api import sync_playwright
    p = sync_playwright().start()
    b = p.chromium.launch(headless=True)
    yield b
    b.close()
    p.stop()


class APIClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self._session = None

    def _get_session(self):
        if self._session is None:
            import httpx
            self._session = httpx.Client(base_url=self.base_url, timeout=30.0)
        return self._session

    def get(self, path: str, params: dict = None, **kwargs):
        return self._get_session().get(path, params=params, **kwargs)

    def post(self, path: str, json: dict = None, **kwargs):
        return self._get_session().post(path, json=json, **kwargs)

    def put(self, path: str, json: dict = None, **kwargs):
        return self._get_session().put(path, json=json, **kwargs)

    def patch(self, path: str, json: dict = None, **kwargs):
        return self._get_session().patch(path, json=json, **kwargs)

    def delete(self, path: str, params: dict = None, **kwargs):
        return self._get_session().delete(path, params=params, **kwargs)

    def close(self):
        if self._session is not None:
            self._session.close()
            self._session = None


@pytest.fixture(scope="session")
def api_client():
    client = APIClient(BASE_URL)
    yield client
    client.close()


@pytest.fixture(scope="session")
def test_data():
    return load_test_data()


@pytest.fixture(scope="session")
def admin_client(api_client, test_data):
    return api_client


@pytest.fixture(scope="session")
def ensure_test_users(api_client, test_data):
    api_client.post("/api/admin/users/bulk", json={
        "items": test_data["users"],
        "operator_id": "admin",
    })
    return test_data["users"]


@pytest.fixture(scope="session", autouse=True)
def restore_permissions(api_client, test_data, ensure_test_users):
    expected_permissions = test_data.get("permissions", [])
    expected_keys = {
        (item["role_code"], item["is_pl"], item["node_key"], item["field_key"])
        for item in expected_permissions
    }
    yield
    resp_after = api_client.get("/api/admin/permissions")
    if resp_after.status_code == 200:
        current_items = resp_after.json().get("items", [])
        for item in current_items:
            key = (item["role_code"], item["is_pl"], item["node_key"], item["field_key"])
            if key not in expected_keys:
                api_client.delete("/api/admin/permissions", params={
                    "role_code": item["role_code"],
                    "is_pl": item["is_pl"],
                    "node_key": item["node_key"],
                    "field_key": item["field_key"],
                })
    if expected_permissions:
        api_client.post("/api/admin/permissions/bulk", json={
            "items": expected_permissions,
            "operator_id": "test_admin",
        })


@pytest.fixture(scope="session")
def ensure_approver_whitelist(api_client, test_data, ensure_test_users):
    api_client.put("/api/leave/approver-whitelist", json={
        "operator_id": "test_admin",
        "accounts": test_data["leave_approver_whitelist"],
    })
    return test_data["leave_approver_whitelist"]


@pytest.fixture(scope="session")
def ensure_baseline_version(api_client, test_data):
    resp = api_client.post("/api/params/baseline-versions", json={
        **test_data["baseline_version"],
        "operator_id": "test_admin",
    })
    if resp.status_code == 200:
        return resp.json()["item"]
    resp2 = api_client.get("/api/params/baseline-versions")
    items = resp2.json().get("items", [])
    for it in items:
        if it.get("version_label") == test_data["baseline_version"]["version_label"]:
            return it
    return None


@pytest.fixture(scope="session", autouse=True)
def ensure_holiday_config(api_client, test_data, ensure_test_users):
    holiday = test_data.get("holiday_config")
    if not holiday:
        return None
    db_dsn = os.getenv("DATABASE_URL")
    if db_dsn:
        try:
            with psycopg.connect(db_dsn, row_factory=dict_row) as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS holiday_day_config (
                        holiday_date DATE PRIMARY KEY,
                        day_type VARCHAR(32) NOT NULL,
                        updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT chk_holiday_day_type CHECK (day_type IN ('workday', 'weekend_holiday'))
                    )
                """)
                conn.execute("""
                    ALTER TABLE duty_calendar_assignment
                    ADD COLUMN IF NOT EXISTS last_accept_at VARCHAR(64) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS last_dispatch_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS last_dispatch_ticket_no VARCHAR(32) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS last_dispatch_node_key VARCHAR(64) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS last_dispatch_rule JSONB NOT NULL DEFAULT '{}'::jsonb
                """)
                conn.execute("""
                    ALTER TABLE duty_rotation_entry
                    ADD COLUMN IF NOT EXISTS last_dispatch_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS last_dispatch_ticket_no VARCHAR(32) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS last_dispatch_node_key VARCHAR(64) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS last_dispatch_rule JSONB NOT NULL DEFAULT '{}'::jsonb
                """)
                conn.execute("""
                    ALTER TABLE duty_site_oncall_row
                    ADD COLUMN IF NOT EXISTS last_dispatch_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS last_dispatch_ticket_no VARCHAR(32) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS last_dispatch_node_key VARCHAR(64) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS last_dispatch_rule JSONB NOT NULL DEFAULT '{}'::jsonb
                """)
                conn.commit()
        except Exception:
            pass
    resp = api_client.put("/api/duty/holidays", json={
        "operator_id": "test_admin",
        "year": holiday["year"],
        "month": holiday["month"],
        "days": holiday["days"],
    })
    if resp.status_code == 200:
        return resp.json()
    return None
