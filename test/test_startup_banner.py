"""启动横幅单元测试。"""

import logging
import sys
from io import StringIO
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from utils.startup_banner import emit_startup_banner, startup_banner_text  # noqa: E402


def test_startup_banner_text_has_brand_and_art():
    text = startup_banner_text()
    assert "DATABASE · O · M · SYSTEM" in text
    assert "运维工单平台" in text
    assert "#" in text
    assert "====" in text
    assert "🚀" not in text
    assert "⚡" not in text
    assert "✅" not in text


def test_emit_startup_banner_goes_through_logger():
    stream = StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.startup_banner")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False

    emit_startup_banner(logger)

    logged = stream.getvalue()
    assert "DATABASE · O · M · SYSTEM" in logged
    assert "运维工单平台 · 服务已就绪" in logged
    assert "Database-O-M-System startup complete" in logged


def test_emit_startup_banner_without_logger_prints(capsys):
    emit_startup_banner(None)
    printed = capsys.readouterr().out
    assert "DATABASE · O · M · SYSTEM" in printed
