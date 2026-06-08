"""logging_config 单元测试：限流 filter 与 audit 日志格式。"""

import logging
import sys
import time
from io import StringIO
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from utils import logging_config as lc  # noqa: E402


@pytest.fixture(autouse=True)
def reset_logging_module():
    lc._CONFIGURED = False
    lc._audit_logger = None
    yield
    lc._CONFIGURED = False
    lc._audit_logger = None


def _capture_logs(level: int = logging.WARNING) -> tuple[StringIO, logging.Handler]:
    stream = StringIO()
    handler = logging.StreamHandler(stream)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter("%(message)s"))
    return stream, handler


def test_rate_limit_filter_suppresses_repeated_warnings():
    filt = lc.RateLimitFilter(window_seconds=60)
    logger = logging.getLogger("test.rate_limit")
    stream, handler = _capture_logs()
    handler.addFilter(filt)
    logger.handlers = [handler]
    logger.setLevel(logging.WARNING)
    logger.propagate = False

    for _ in range(10):
        logger.warning("SSO service unavailable: connection refused")

    output = stream.getvalue().strip().splitlines()
    assert len(output) == 1
    assert "SSO service unavailable" in output[0]


def test_rate_limit_filter_emits_suppressed_summary_after_window():
    filt = lc.RateLimitFilter(window_seconds=1)
    logger = logging.getLogger("test.rate_limit_window")
    stream, handler = _capture_logs()
    handler.addFilter(filt)
    logger.handlers = [handler]
    logger.setLevel(logging.WARNING)
    logger.propagate = False

    logger.warning("duplicate error")
    logger.warning("duplicate error")
    time.sleep(1.1)
    logger.warning("duplicate error")

    output = stream.getvalue().strip().splitlines()
    assert len(output) == 2
    assert "suppressed 1 similar messages" in output[1]


def test_audit_log_formats_event_and_fields(capsys):
    lc.setup_logging()
    lc.audit_log(
        "auth.login",
        account="zhangsan",
        user_name="张三",
        role="admin",
        client_ip="127.0.0.1",
    )
    captured = capsys.readouterr()
    line = captured.out.strip()
    assert "event=auth.login" in line
    assert "account=zhangsan" in line
    assert "user_name='张三'" in line or "user_name=张三" in line
    assert "role=admin" in line
    assert "[audit]" in line


def test_setup_logging_keeps_audit_info_when_root_is_warning(monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    monkeypatch.delenv("LOG_DIR", raising=False)
    import importlib

    import config

    importlib.reload(config)
    importlib.reload(lc)

    lc.setup_logging()
    audit = logging.getLogger("audit")
    root = logging.getLogger()

    assert root.level == logging.WARNING
    assert audit.level == logging.INFO

    stream, handler = _capture_logs(logging.INFO)
    audit.handlers = [handler]
    audit.propagate = False
    lc.audit_log("admin.users.bulk", operator="admin", count=3)
    assert "event=admin.users.bulk" in stream.getvalue()


def test_daily_file_handler_writes_by_date(tmp_path, monkeypatch):
    handler = lc.DailySizeRotatingFileHandler(
        log_dir=tmp_path,
        basename="yunwei",
        max_bytes=1024,
        retention_days=30,
    )
    monkeypatch.setattr(handler, "_today", lambda: "2026-06-08")
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.daily_file")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False

    logger.info("hello")
    handler.close()

    path = tmp_path / "yunwei-2026-06-08.log"
    assert path.is_file()
    assert "hello" in path.read_text(encoding="utf-8")


def test_daily_file_handler_rotates_when_size_exceeded(tmp_path, monkeypatch):
    handler = lc.DailySizeRotatingFileHandler(
        log_dir=tmp_path,
        basename="yunwei",
        max_bytes=40,
        retention_days=30,
    )
    monkeypatch.setattr(handler, "_today", lambda: "2026-06-08")
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.daily_rotate")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False

    logger.info("x" * 30)
    logger.info("y" * 30)
    handler.close()

    assert (tmp_path / "yunwei-2026-06-08.log").is_file()
    assert (tmp_path / "yunwei-2026-06-08.1.log").is_file()


def test_setup_logging_with_log_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    monkeypatch.setenv("LOG_STDOUT", "0")
    monkeypatch.setenv("LOG_FILE_BASENAME", "app")
    import importlib

    import config

    importlib.reload(config)
    importlib.reload(lc)

    lc.setup_logging()
    lc.audit_log("auth.login", account="demo")
    for handler in logging.getLogger("audit").handlers:
        if isinstance(handler, lc.DailySizeRotatingFileHandler):
            handler.close()

    files = list(tmp_path.glob("app-*.log"))
    assert files
    assert any("event=auth.login" in f.read_text(encoding="utf-8") for f in files)

