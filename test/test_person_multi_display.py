"""多人人员字段（协同处理人）规范化存读。"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))

from utils.person_display import (
    MULTI_PERSON_DELIMITER,
    canonical_multi_person_display,
    parse_multi_person_parts,
)


def test_parse_single_person_without_delimiter():
    assert parse_multi_person_parts("张三 l30030745") == ["张三 l30030745"]


def test_parse_two_persons_with_fullwidth_semicolon():
    raw = f"张三 l30030745{MULTI_PERSON_DELIMITER}李四 l30030746"
    assert parse_multi_person_parts(raw) == ["张三 l30030745", "李四 l30030746"]


def test_canonical_multi_normalizes_each_and_dedupes():
    raw = f"l30030745 张三{MULTI_PERSON_DELIMITER}张三 l30030745"
    assert canonical_multi_person_display(raw) == "张三 l30030745"


def test_canonical_multi_empty():
    assert canonical_multi_person_display("") == ""
