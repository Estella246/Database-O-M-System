"""统一 logging 配置：stdout / 本地文件（按日+按大小轮转）、限流、业务 audit 日志。"""
from __future__ import annotations

import logging
import re
import sys
import threading
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from config import (
    LOG_DIR,
    LOG_FILE_BASENAME,
    LOG_LEVEL,
    LOG_MAX_BYTES,
    LOG_MAX_FILES_PER_DAY,
    LOG_RATE_LIMIT_SECONDS,
    LOG_RETENTION_DAYS,
    LOG_STDOUT,
)

_CONFIGURED = False
_audit_logger: logging.Logger | None = None
_operator_name_cache: dict[str, str] = {}
_LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
_DAILY_FILE_RE = re.compile(r"^(.+)-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$")


class RateLimitFilter(logging.Filter):
    """同一 logger+level+message 在窗口内只输出一次，窗口结束补打 suppressed 摘要。"""

    def __init__(self, window_seconds: int = 60) -> None:
        super().__init__()
        self.window_seconds = window_seconds
        self._state: dict[str, tuple[float, int]] = {}

    def _key(self, record: logging.LogRecord) -> str:
        return f"{record.name}|{record.levelno}|{record.getMessage()}"

    def filter(self, record: logging.LogRecord) -> bool:
        if record.levelno < logging.WARNING:
            return True
        key = self._key(record)
        now = time.time()
        if key in self._state:
            last_logged, suppressed = self._state[key]
            if now - last_logged < self.window_seconds:
                self._state[key] = (last_logged, suppressed + 1)
                return False
            if suppressed > 0:
                record.msg = (
                    f"{record.getMessage()} "
                    f"(suppressed {suppressed} similar messages in last {self.window_seconds}s)"
                )
                record.args = None
            self._state[key] = (now, 0)
            return True
        self._state[key] = (now, 0)
        return True


class DailySizeRotatingFileHandler(logging.Handler):
    """按自然日切分；同一日内单文件超过 max_bytes 时递增序号新建文件。

    示例（basename=yunwei）：
      /var/log/yunwei/yunwei-2026-06-08.log
      /var/log/yunwei/yunwei-2026-06-08.1.log
    """

    def __init__(
        self,
        log_dir: str | Path,
        basename: str = "yunwei",
        max_bytes: int = 50 * 1024 * 1024,
        max_files_per_day: int = 0,
        retention_days: int = 30,
        encoding: str = "utf-8",
    ) -> None:
        super().__init__()
        self.log_dir = Path(log_dir)
        self.basename = basename
        self.max_bytes = max(1, int(max_bytes))
        self.max_files_per_day = max(0, int(max_files_per_day))
        self.retention_days = max(1, int(retention_days))
        self.encoding = encoding
        self._lock = threading.Lock()
        self._stream = None
        self._current_date: str | None = None
        self._current_index = 0

    def _today(self) -> str:
        return date.today().isoformat()

    def _path_for(self, day: str, index: int) -> Path:
        if index <= 0:
            return self.log_dir / f"{self.basename}-{day}.log"
        return self.log_dir / f"{self.basename}-{day}.{index}.log"

    def _open_stream(self, day: str, index: int) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        path = self._path_for(day, index)
        self._stream = open(path, "a", encoding=self.encoding)
        self._current_date = day
        self._current_index = index

    def _close_stream(self) -> None:
        if self._stream is not None:
            self._stream.close()
            self._stream = None

    def _current_path(self) -> Path | None:
        if self._current_date is None:
            return None
        return self._path_for(self._current_date, self._current_index)

    def _needs_size_rotation_for(self, msg: str) -> bool:
        path = self._current_path()
        if path is None:
            return False
        try:
            current = path.stat().st_size if path.exists() else 0
        except OSError:
            current = 0
        return current + len(msg.encode(self.encoding)) > self.max_bytes

    def _rotate_for_size(self) -> None:
        assert self._current_date is not None
        self._close_stream()
        next_index = self._current_index + 1
        if self.max_files_per_day > 0 and next_index > self.max_files_per_day:
            overflow = self._path_for(self._current_date, next_index)
            if overflow.exists():
                overflow.unlink()
        self._open_stream(self._current_date, next_index)

    def _switch_day_if_needed(self, day: str) -> None:
        if self._current_date == day and self._stream is not None:
            return
        self._close_stream()
        self._cleanup_old_files()
        self._open_stream(day, 0)

    def _cleanup_old_files(self) -> None:
        if not self.log_dir.is_dir():
            return
        cutoff = date.today() - timedelta(days=self.retention_days)
        for path in self.log_dir.iterdir():
            if not path.is_file():
                continue
            match = _DAILY_FILE_RE.match(path.name)
            if not match or match.group(1) != self.basename:
                continue
            try:
                file_day = date.fromisoformat(match.group(2))
            except ValueError:
                continue
            if file_day < cutoff:
                try:
                    path.unlink()
                except OSError:
                    pass

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record) + "\n"
        except Exception:
            self.handleError(record)
            return

        with self._lock:
            try:
                day = self._today()
                self._switch_day_if_needed(day)
                while self._needs_size_rotation_for(msg):
                    self._rotate_for_size()
                assert self._stream is not None
                self._stream.write(msg)
                self._stream.flush()
            except Exception:
                self.handleError(record)

    def close(self) -> None:
        with self._lock:
            self._close_stream()
        super().close()


def _parse_level(name: str, default: int = logging.INFO) -> int:
    level = getattr(logging, str(name or "").strip().upper(), None)
    return level if isinstance(level, int) else default


def _configure_third_party_loggers() -> None:
    """压低第三方库例行 INFO/DEBUG（如 APScheduler 每轮 Running job），保留 WARNING+。"""
    for name in ("apscheduler",):
        logging.getLogger(name).setLevel(logging.WARNING)


def _format_field(value: Any) -> str:
    if value is None:
        return "-"
    text = str(value).replace("\n", " ").strip()
    if not text:
        return "-"
    if any(ch in text for ch in (" ", "=", "\t")):
        return repr(text)
    return text


def clear_operator_name_cache() -> None:
    """测试或运维场景下清空操作人姓名缓存。"""
    _operator_name_cache.clear()


def operator_log_label(account: str) -> str:
    """日志中展示操作人：优先 user_name，查不到则回退工号。"""
    acc = str(account or "").strip()
    if not acc:
        return "-"
    cached = _operator_name_cache.get(acc)
    if cached is not None:
        return cached
    name = ""
    try:
        from database import db_conn

        with db_conn() as conn:
            row = conn.execute(
                "SELECT user_name FROM user_account WHERE account = %s",
                (acc,),
            ).fetchone()
            if row:
                name = str(row.get("user_name") or "").strip()
    except Exception:
        pass
    label = name or acc
    _operator_name_cache[acc] = label
    return label


def _build_handlers() -> list[logging.Handler]:
    formatter = logging.Formatter(_LOG_FORMAT)
    rate_filter = RateLimitFilter(window_seconds=LOG_RATE_LIMIT_SECONDS)
    handlers: list[logging.Handler] = []

    if LOG_STDOUT or not LOG_DIR:
        stdout_handler = logging.StreamHandler(sys.stdout)
        stdout_handler.setFormatter(formatter)
        stdout_handler.addFilter(rate_filter)
        handlers.append(stdout_handler)

    if LOG_DIR:
        try:
            file_handler = DailySizeRotatingFileHandler(
                log_dir=LOG_DIR,
                basename=LOG_FILE_BASENAME,
                max_bytes=LOG_MAX_BYTES,
                max_files_per_day=LOG_MAX_FILES_PER_DAY,
                retention_days=LOG_RETENTION_DAYS,
            )
            file_handler.setFormatter(formatter)
            file_handler.addFilter(rate_filter)
            handlers.append(file_handler)
        except OSError as exc:
            print(
                f"WARNING: LOG_DIR={LOG_DIR!r} 不可用，仅输出到 stdout: {exc}",
                file=sys.stderr,
            )

    if not handlers:
        fallback = logging.StreamHandler(sys.stdout)
        fallback.setFormatter(formatter)
        fallback.addFilter(rate_filter)
        handlers.append(fallback)

    return handlers


def setup_logging() -> None:
    global _CONFIGURED, _audit_logger
    if _CONFIGURED:
        return

    root_level = _parse_level(LOG_LEVEL, logging.INFO)
    handlers = _build_handlers()

    root = logging.getLogger()
    root.handlers.clear()
    for handler in handlers:
        root.addHandler(handler)
    root.setLevel(root_level)

    audit_logger = logging.getLogger("audit")
    audit_logger.handlers.clear()
    for handler in handlers:
        audit_logger.addHandler(handler)
    audit_logger.setLevel(logging.INFO)
    audit_logger.propagate = False
    _audit_logger = audit_logger

    _configure_third_party_loggers()

    _CONFIGURED = True


def audit_log(event: str, **fields: Any) -> None:
    """输出结构化业务审计日志：event=... key=value ..."""
    if _audit_logger is None:
        setup_logging()
    assert _audit_logger is not None
    parts = [f"event={_format_field(event)}"]
    for key, value in fields.items():
        if key == "operator":
            value = operator_log_label(str(value or ""))
        parts.append(f"{key}={_format_field(value)}")
    _audit_logger.info(" ".join(parts))
