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

import psycopg
from psycopg.errors import UndefinedTable
from psycopg.rows import dict_row

BASE_URL = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000")
TEST_DATA_PATH = BASE_DIR / "test_data" / "test_data.json"
REPORTS_DIR = BASE_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

MIGRATIONS_DIR = PROJECT_ROOT / "db" / "migrations"

HAS_PLAYWRIGHT = False
try:
    import playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    pass


def load_test_data() -> dict:
    with open(TEST_DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _split_sql_migration_statements(text: str) -> list[str]:
    text = re.sub(r"(?m)^\s*BEGIN\s*;?\s*", "", text, flags=re.I)
    text = re.sub(r"(?m)\s*COMMIT\s*;?\s*$", "", text, flags=re.I)
    text = text.strip() + "\n"
    parts = re.split(r";\s*\r?\n", text)
    out: list[str] = []
    for p in parts:
        s = p.strip()
        if not s:
            continue
        meaningful = False
        for line in s.splitlines():
            t = line.strip()
            if not t or t.startswith("--"):
                continue
            meaningful = True
            break
        if meaningful:
            out.append(s + ";")
    return out


def _apply_sql_file_psycopg(conn, path: Path) -> None:
    raw = path.read_text(encoding="utf-8")
    for stmt in _split_sql_migration_statements(raw):
        conn.execute(stmt)


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


@pytest.fixture(scope="session", autouse=True)
def ensure_upload_session_and_skill_bootstrap():
    """有 DATABASE_URL 时补齐 upload 表（0033/0034）并保证至少一条内置 Skill，减少 M12 用例 skip。"""
    db_dsn = os.getenv("DATABASE_URL")
    if not db_dsn:
        return
    try:
        with psycopg.connect(db_dsn, row_factory=dict_row) as conn:
            _ensure_upload_session_schema(conn)
            _ensure_builtin_skill_seed(conn)
            conn.commit()
    except Exception:
        pass


@pytest.fixture(scope="session")
def browser():
    if not HAS_PLAYWRIGHT:
        pytest.skip("pytest-playwright not installed")
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

    def get(self, path: str, params: dict | None = None, **kwargs):
        return self._get_session().get(path, params=params, **kwargs)

    def post(self, path: str, json: dict | None = None, **kwargs):
        return self._get_session().post(path, json=json, **kwargs)

    def put(self, path: str, json: dict | None = None, **kwargs):
        return self._get_session().put(path, json=json, **kwargs)

    def patch(self, path: str, json: dict | None = None, **kwargs):
        return self._get_session().patch(path, json=json, **kwargs)

    def delete(self, path: str, params: dict | None = None, **kwargs):
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
