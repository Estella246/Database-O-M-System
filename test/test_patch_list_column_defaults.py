"""补丁管理列表默认列配置（与前端 column-fields.js 契约一致）。"""
import re
from pathlib import Path


def _column_fields_js() -> str:
    root = Path(__file__).resolve().parents[1]
    return (root / "frontend" / "modules" / "constants" / "column-fields.js").read_text(encoding="utf-8")


def test_patch_list_default_column_keys_order():
    body = _column_fields_js()
    m = re.search(r"export const DEFAULT_PATCH_LIST_COLUMN_KEYS = \[(.*?)\];", body, re.S)
    assert m, "应定义 DEFAULT_PATCH_LIST_COLUMN_KEYS"
    keys = re.findall(r'"([^"]+)"', m.group(1))
    assert keys == [
        "processId",
        "currentStage",
        "currentHandler",
        "start_date",
        "creatorName",
    ], "补丁管理默认列顺序与字段 key 须与产品一致"


def test_get_default_selected_columns_patch_branch():
    """通过源码确认 getDefaultSelectedColumns 对 patch 命名空间使用补丁专用默认列。"""
    body = _column_fields_js()
    assert "DEFAULT_PATCH_TABLE_COLUMNS" in body
    assert re.search(
        r'if \(namespace === "patch"\)[\s\S]*?DEFAULT_PATCH_TABLE_COLUMNS',
        body,
    ), "getDefaultSelectedColumns 应在 patch 命名空间返回 DEFAULT_PATCH_TABLE_COLUMNS"


def test_patch_column_catalog_imports_hotpatch_fields():
    body = _column_fields_js()
    assert "hotpatch-export-fields.js" in body
    assert "HOTPATCH_EXPORT_FIELDS_BY_NODE" in body
