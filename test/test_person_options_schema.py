"""人员白名单 schema：next_handler 从 user_account 加载。"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))

from utils.person_options import (
    person_whitelist_options_are_placeholder_only,
    should_resolve_person_options_from_user_account,
)


def test_next_handler_always_resolves_from_user_account():
    assert should_resolve_person_options_from_user_account("next_handler", "external_api", ["temp"])
    assert should_resolve_person_options_from_user_account(
        "next_handler", "static", ["李潇雨 l30030745"]
    )


def test_placeholder_detection():
    assert person_whitelist_options_are_placeholder_only(["temp"])
    assert person_whitelist_options_are_placeholder_only(["姓名+工号"])
    assert not person_whitelist_options_are_placeholder_only(["张三 l1", "李四 l2"])
