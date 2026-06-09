"""加载 backend/.env，供 scripts/ 下 CLI 与 uvicorn 使用同一套 DATABASE_URL / LEGACY_DATABASE_URL。"""
from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"


def load_backend_env() -> Path:
    """加载 backend/.env（不覆盖已 export 的环境变量）。返回 .env 路径。"""
    env_path = BACKEND_DIR / ".env"
    load_dotenv(env_path, override=False)
    return env_path
