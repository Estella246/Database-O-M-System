import json
import os
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


def load_test_data() -> dict:
    with open(TEST_DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


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
