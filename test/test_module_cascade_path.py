"""责任田模块路径归一化：老库 JSON 数组 → 一级/二级/三级。"""
from __future__ import annotations

from utils.module_cascade_path import normalize_module_cascade_path


def test_normalize_json_array_with_wrong_quotes():
    raw = '[”SQL引擎，“分区表”，“分区自动扩展”]'
    assert normalize_module_cascade_path(raw) == "SQL引擎/分区表/分区自动扩展"


def test_normalize_valid_json_array():
    raw = '["SQL引擎", "分区表", "分区自动扩展"]'
    assert normalize_module_cascade_path(raw) == "SQL引擎/分区表/分区自动扩展"


def test_normalize_slash_path_unchanged():
    raw = "存储引擎/块存储/事务"
    assert normalize_module_cascade_path(raw) == "存储引擎/块存储/事务"


def test_normalize_empty():
    assert normalize_module_cascade_path("") == ""
    assert normalize_module_cascade_path(None) == ""
