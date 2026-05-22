"""验证 config.py 中小鲁班和 Welink 配置项的 os.getenv 回退逻辑。"""

import importlib
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# Names of config constants that should read from env with fallback
_ENV_CONFIG_NAMES = [
    "XIAOLUBAN_MESSAGE_URL",
    "XIAOLUBAN_MESSAGE_SEND_TOKEN",
    "XIAOLUBAN_GROUP_CHAT_ID",
    "WELINK_APP_ID",
    "WELINK_APP_SECRET",
    "WELINK_HIS_APP_ID",
    "WELINK_HIS_STATIC_TOKEN",
    "WELINK_DYNAMIC_TOKEN_URL",
    "WELINK_CREATE_GROUP_URL",
    "WELINK_CARD_MESSAGE_URL",
]

# Expected default values when env vars are absent
_DEFAULTS = {
    "XIAOLUBAN_MESSAGE_URL": "http://test.xiaoluban-message.com",
    "XIAOLUBAN_MESSAGE_SEND_TOKEN": "test_UHUGUknkgslfhlskhg",
    "XIAOLUBAN_GROUP_CHAT_ID": "test_group_chat_001",
    "WELINK_APP_ID": "***",
    "WELINK_APP_SECRET": "***",
    "WELINK_HIS_APP_ID": "****",
    "WELINK_HIS_STATIC_TOKEN": "****",
    "WELINK_DYNAMIC_TOKEN_URL": "***",
    "WELINK_CREATE_GROUP_URL": "***",
    "WELINK_CARD_MESSAGE_URL": "***",
}


def _import_config_with_env(env_vars: dict[str, str | None]):
    """Import config module with specific env overrides, returning the module."""
    saved = {}
    for name in _ENV_CONFIG_NAMES:
        saved[name] = os.environ.get(name)
        val = env_vars.get(name)
        if val is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = val
    try:
        if "config" in sys.modules:
            del sys.modules["config"]
        config = importlib.import_module("config")
    finally:
        for name in _ENV_CONFIG_NAMES:
            if saved[name] is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = saved[name]
            if "config" in sys.modules:
                del sys.modules["config"]
    return config


class TestConfigEnvFallback:
    """When .env has no value, config constants fall back to their defaults."""

    def test_all_defaults_without_env(self):
        config = _import_config_with_env({n: None for n in _ENV_CONFIG_NAMES})
        for name in _ENV_CONFIG_NAMES:
            assert getattr(config, name) == _DEFAULTS[name], f"{name} fallback mismatch"

    def test_env_overrides_default(self):
        env_overrides = {
            "XIAOLUBAN_MESSAGE_URL": "https://prod.xiaoluban.com",
            "WELINK_APP_ID": "prod_app_id",
        }
        config = _import_config_with_env(env_overrides)
        assert config.XIAOLUBAN_MESSAGE_URL == "https://prod.xiaoluban.com"
        assert config.WELINK_APP_ID == "prod_app_id"
        # Non-overridden items still fall back
        assert config.XIAOLUBAN_MESSAGE_SEND_TOKEN == _DEFAULTS["XIAOLUBAN_MESSAGE_SEND_TOKEN"]

    def test_partial_env_override(self):
        env_overrides = {"WELINK_CARD_MESSAGE_URL": "https://prod.card.url"}
        config = _import_config_with_env(env_overrides)
        assert config.WELINK_CARD_MESSAGE_URL == "https://prod.card.url"
        assert config.WELINK_APP_ID == "***"

    def test_empty_env_string_uses_default(self):
        """An empty string in env is a valid value (not missing); os.getenv returns it."""
        env_overrides = {"WELINK_APP_ID": ""}
        config = _import_config_with_env(env_overrides)
        assert config.WELINK_APP_ID == ""