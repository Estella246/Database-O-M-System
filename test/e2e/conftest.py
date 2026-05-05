import json
import os
import subprocess
import sys
import time

import pytest

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(BASE_DIR))
BACKEND_DIR = os.path.abspath(os.path.join(PROJECT_ROOT, "backend"))

E2E_PORT = int(os.getenv("E2E_PORT", "8999"))
E2E_BASE_URL = f"http://127.0.0.1:{E2E_PORT}"

E2E_OPERATOR_ACCOUNT = os.getenv("E2E_OPERATOR_ACCOUNT", "test_admin").strip()
E2E_OPERATOR_NAME = os.getenv("E2E_OPERATOR_NAME", "测试管理员").strip()

NETWORK_ERROR_PATTERNS = [
    "ERR_CONNECTION_REFUSED",
    "Failed to fetch",
    "net::ERR_",
]

_backend_proc = None
_log_file = None


class _E2EApiClient:
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


def _is_network_error(msg: str) -> bool:
    return any(p in msg for p in NETWORK_ERROR_PATTERNS)


@pytest.fixture(scope="session")
def backend_server():
    global _backend_proc, _log_file
    env = os.environ.copy()
    log_path = os.path.join(PROJECT_ROOT, ".e2e_backend.log")
    _log_file = open(log_path, "w", encoding="utf-8")
    _backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(E2E_PORT)],
        cwd=BACKEND_DIR,
        stdout=_log_file,
        stderr=_log_file,
        env=env,
    )
    deadline = time.time() + 15
    import httpx
    while time.time() < deadline:
        try:
            r = httpx.get(f"{E2E_BASE_URL}/health", timeout=2)
            if r.status_code == 200:
                break
        except Exception:
            pass
        time.sleep(0.5)
    else:
        _backend_proc.terminate()
        try:
            _backend_proc.wait(timeout=5)
        except Exception:
            _backend_proc.kill()
        _log_file.close()
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            log_content = f.read()
        pytest.fail(
            f"E2E backend server failed to start.\nLog:\n{log_content}"
        )
    yield E2E_BASE_URL
    _backend_proc.terminate()
    try:
        _backend_proc.wait(timeout=5)
    except Exception:
        _backend_proc.kill()
    _log_file.close()


@pytest.fixture(scope="session", autouse=True)
def e2e_database_bootstrap(backend_server: str):
    """将 test_data + admin_whitelist_full 写入 E2E 后端，与 API 测试数据源对齐。"""
    from e2e_bootstrap import seed_e2e_backend

    try:
        seed_e2e_backend(backend_server)
    except Exception as exc:
        pytest.fail(f"E2E 会话数据引导失败: {exc}")


@pytest.fixture(scope="session")
def playwright_instance(backend_server, e2e_database_bootstrap):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        pytest.fail(
            "未安装 Playwright。请执行: pip install playwright && playwright install chromium"
        )
    pw = sync_playwright().start()
    yield pw
    pw.stop()


@pytest.fixture(scope="session")
def e2e_browser(playwright_instance):
    browser = playwright_instance.chromium.launch(headless=True)
    yield browser
    browser.close()


@pytest.fixture
def page(e2e_browser, backend_server):
    context = e2e_browser.new_context()
    pg = context.new_page()
    pg.set_default_navigation_timeout(60000)
    pg.set_default_timeout(30000)
    pg.goto(f"{backend_server}/", wait_until="domcontentloaded")
    pg.wait_for_selector("#root", timeout=15000)
    pg.evaluate(
        f"""() => {{
        window.localStorage.setItem('demo_operator_account', {json.dumps(E2E_OPERATOR_ACCOUNT)});
        window.localStorage.setItem('demo_operator_name', {json.dumps(E2E_OPERATOR_NAME)});
    }}"""
    )
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_selector("#root", timeout=15000)
    yield pg
    context.close()


@pytest.fixture
def clean_local_storage(page, backend_server):
    page.goto(f"{backend_server}/")
    page.wait_for_selector("#root", timeout=10000)
    page.evaluate("window.localStorage.clear()")
    page.evaluate(
        f"""() => {{
        window.localStorage.setItem('demo_operator_account', {json.dumps(E2E_OPERATOR_ACCOUNT)});
        window.localStorage.setItem('demo_operator_name', {json.dumps(E2E_OPERATOR_NAME)});
    }}"""
    )
    yield


@pytest.fixture
def save_restore_local_storage(page, backend_server):
    page.goto(f"{backend_server}/")
    page.wait_for_selector("#root", timeout=10000)
    snapshot = page.evaluate("JSON.stringify(window.localStorage)")
    yield
    page.evaluate("window.localStorage.clear()")
    if snapshot and snapshot != "{}":
        page.evaluate("(data) => { Object.entries(JSON.parse(data)).forEach(([k,v]) => window.localStorage.setItem(k,v)) }", snapshot)


@pytest.fixture
def collect_js_errors(page):
    errors = []

    def on_pageerror(err):
        errors.append(err)

    def on_console(msg):
        if msg.type == "error":
            errors.append(msg)

    page.on("pageerror", on_pageerror)
    page.on("console", on_console)
    yield errors


@pytest.fixture
def assert_no_js_errors(collect_js_errors):
    yield
    js_errors = []
    for e in collect_js_errors:
        msg = str(e)
        if hasattr(e, "text"):
            msg = e.text
        if _is_network_error(msg):
            continue
        js_errors.append(msg)
    assert js_errors == [], f"发现 {len(js_errors)} 个 JS 错误:\n" + "\n".join(js_errors)


@pytest.fixture(scope="session")
def api_client(backend_server, e2e_database_bootstrap):
    client = _E2EApiClient(backend_server)
    yield client
    client.close()


@pytest.fixture(scope="session")
def e2e_workbench_multipage_seed(api_client):
    """批量 API 建单，保证工作台列表至少两页（默认每页 10 条）。"""
    from e2e_api import seed_workbench_tickets_for_pagination

    seed_workbench_tickets_for_pagination(api_client, 22)
    return True
