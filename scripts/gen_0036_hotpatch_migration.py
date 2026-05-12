#!/usr/bin/env python3
"""Generate db/migrations/0036_hotpatch_workflow.sql from docs/Hotpatch/补丁管理字段.xlsx."""
from __future__ import annotations

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "docs/Hotpatch/补丁管理字段.xlsx"
OUT = ROOT / "db/migrations/0036_hotpatch_workflow.sql"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

NODE_KEY_BY_CN = {
    "诉求填写": "hp_demand_fill",
    "开发填写": "hp_dev_fill",
    "热补丁CCB": "hp_ccb",
    "计划制定": "hp_plan",
    "指定开发": "hp_assign_dev",
    "指定测试": "hp_assign_test",
    "开发分析": "hp_dev_analysis",
    "测试分析": "hp_test_analysis",
    "热补丁串讲": "hp_walkthrough",
    "PM自检": "hp_pm_check",
    "DE自检": "hp_de_check",
    "TSE自检": "hp_tse_check",
    "工程人员自检": "hp_eng_check",
    "转测发起": "hp_transfer_start",
    "转测确认": "hp_transfer_confirm",
    "测试验证": "hp_test_verify",
    "BU测试结论": "hp_bu_conclusion",
    "评审发布": "hp_review_publish",
}

NODE_ORDER = [
    "hp_demand_fill",
    "hp_dev_fill",
    "hp_ccb",
    "hp_plan",
    "hp_assign_dev",
    "hp_assign_test",
    "hp_dev_analysis",
    "hp_test_analysis",
    "hp_walkthrough",
    "hp_pm_check",
    "hp_de_check",
    "hp_tse_check",
    "hp_eng_check",
    "hp_transfer_start",
    "hp_transfer_confirm",
    "hp_test_verify",
    "hp_bu_conclusion",
    "hp_review_publish",
]

CN_BY_KEY = {v: k for k, v in NODE_KEY_BY_CN.items()}


def load_xlsx(path: Path) -> dict[str, list[dict[str, str]]]:
    z = zipfile.ZipFile(path)
    shared: list[str] = []
    try:
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(".//m:si", NS):
            ts = si.findall(".//m:t", NS)
            shared.append("".join(t.text or "" for t in ts))
    except KeyError:
        pass
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    sheets: list[tuple[str, str]] = []
    for sh in wb.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet"):
        sheets.append(
            (
                str(sh.get("name") or ""),
                str(sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id") or ""),
            )
        )
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    id_to_target = {rel.get("Id"): rel.get("Target") for rel in rels}
    out: dict[str, list[dict[str, str]]] = {}
    for name, rid in sheets:
        path_x = "xl/" + id_to_target[rid].lstrip("/")
        sheet = ET.fromstring(z.read(path_x))
        rows: list[dict[str, str]] = []
        for row in sheet.findall(".//m:row", NS):
            row_cells: dict[str, str] = {}
            for c in row.findall("m:c", NS):
                ref = str(c.get("r") or "")
                col = "".join(x for x in ref if x.isalpha())
                t = c.get("t")
                v = c.find("m:v", NS)
                val = v.text if v is not None else ""
                if t == "s" and str(val).isdigit():
                    val = shared[int(val)]
                row_cells[col] = str(val or "")
            rows.append(row_cells)
        out[name] = rows
    return out


def col_idx(col_letters: str) -> int:
    n = 0
    for ch in col_letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def row_cells_to_list(row_cells: dict[str, str]) -> list[str]:
    if not row_cells:
        return []
    mx = 0
    for k in row_cells:
        letters = "".join(x for x in k if x.isalpha())
        mx = max(mx, col_idx(letters))
    lst = [""] * (mx + 1)
    for k, v in row_cells.items():
        letters = "".join(x for x in k if x.isalpha())
        lst[col_idx(letters)] = v
    return lst


def slug(s: str) -> str:
    s = re.sub(r"[^\w\u4e00-\u9fff]+", "_", (s or "").strip())
    return s.lower()[:64]


def sql_escape(s: str) -> str:
    return (s or "").replace("'", "''")


def map_field_type(cell_type: str, details: str) -> str:
    t = (cell_type or "").strip()
    d = (details or "").strip()
    if "富文本" in t:
        return "richtext"
    if "时间" in t or "年月日" in t or (t == "时间框" and "年月日" in d):
        return "date"
    if "白名单" in t:
        return "whitelist"
    return "text"


def split_options(details: str) -> list[str]:
    if not details:
        return []
    parts = re.split(r"[\n\r]+", details)
    return [p.strip() for p in parts if p.strip()]


def field_key_for(node_key: str, label: str, sort_order: int, seen: set[str]) -> str:
    m = {
        "填写日期": "fill_date",
        "DTS单号": "dts_no",
        "DTS描述": "dts_desc",
        "DTS基线版本": "dts_baseline_version",
        "问题类型": "problem_type",
        "期望补丁版本": "expected_patch_version",
        "处理方式": "handle_mode",
        "下一步处理人": "next_handler",
    }
    if label in m:
        base = m[label]
    elif label in ("DE", "SE", "PL", "XM", "TSE", "TE", "PM"):
        base = "hp_" + label.lower()
    else:
        base = slug(label)
        if not base or base == "处理方式":
            base = f"f_{sort_order}"
    # 测试分析 sheet 中第二行「处理方式」实为富文本块，与 handle_mode 重名
    if node_key == "hp_test_analysis" and label == "处理方式" and "handle_mode" in seen:
        base = "test_analysis_context"
    if base in seen:
        base = f"{base}_{sort_order}"
    seen.add(base)
    return base


def build_constraints(
    node_key: str,
    field_key: str,
    required_default: bool,
    special: str,
    handle_opts: list[str],
) -> dict | None:
    c: dict = {}
    sp = (special or "").strip()
    # optional when not forward submit (all business fields optional except handle+next)
    forward_labels = [h for h in handle_opts if "转交" not in h and "返回" not in h and "裁决" not in h and "打回" not in h]
    forward = forward_labels[0] if len(forward_labels) == 1 else None
    relax_modes = [m for m in handle_opts if m != forward] if forward else []

    if field_key in ("handle_mode", "next_handler"):
        if field_key == "next_handler" and node_key == "hp_plan":
            c["visible_when_all"] = [{"field": "handle_mode", "values": relax_modes}]
            c["required_when_visible"] = True
        elif field_key == "next_handler" and node_key == "hp_walkthrough":
            c["visible_when_all"] = [{"field": "handle_mode", "values": relax_modes}]
            c["required_when_visible"] = True
        elif field_key == "next_handler" and node_key == "hp_review_publish":
            c["visible_when_all"] = [{"field": "handle_mode", "values": relax_modes}]
            c["required_when_visible"] = True
        return c or None

    if not relax_modes or not forward:
        return None
    c["optional_when_all"] = [{"field": "handle_mode", "values": relax_modes}]
    if required_default and sp and "选填" in sp:
        pass
    return c


def main() -> None:
    data = load_xlsx(XLSX)
    lines: list[str] = [
        "BEGIN;",
        "",
        "ALTER TABLE ticket ADD COLUMN IF NOT EXISTS flow_context JSONB;",
        "",
        "INSERT INTO workflow_template (template_code, template_name, version)",
        "VALUES ('HOTPATCH', '热补丁管理', 1)",
        "ON CONFLICT (template_code) DO NOTHING;",
        "",
        "WITH t AS (SELECT id FROM workflow_template WHERE template_code = 'HOTPATCH')",
        "INSERT INTO workflow_node (template_id, node_key, node_name, node_order, is_terminal)",
    ]
    sel_rows = []
    for i, nk in enumerate(NODE_ORDER, start=1):
        cn = CN_BY_KEY.get(nk, nk)
        sel_rows.append(f"SELECT t.id, '{nk}', '{sql_escape(cn)}', {i}, FALSE FROM t")
    lines.append(" UNION ALL ".join(sel_rows))
    lines.append("ON CONFLICT (template_id, node_key) DO NOTHING;")
    lines.append("")

    # option_set for baseline version reuse marker — use external in node_field_def via set_code
    lines += [
        "INSERT INTO option_set (set_code, set_name, source_type)",
        "VALUES ('OS_HP_PROBLEM_TYPE', '热补丁问题类型', 'static')",
        "ON CONFLICT (set_code) DO NOTHING;",
        "INSERT INTO option_item (option_set_id, option_value, option_label, sort_order)",
        "SELECT os.id, v.ov, v.ol, v.so FROM option_set os",
        "JOIN (VALUES",
        "  ('OS_HP_PROBLEM_TYPE', '生产环境-问题首次发现', '生产环境-问题首次发现', 1),",
        "  ('OS_HP_PROBLEM_TYPE', '生产环境-内部测试已知', '生产环境-内部测试已知', 2),",
        "  ('OS_HP_PROBLEM_TYPE', '生产环境-巡检/运维类', '生产环境-巡检/运维类', 3),",
        "  ('OS_HP_PROBLEM_TYPE', '生产环境-其他局点已发生', '生产环境-其他局点已发生', 4),",
        "  ('OS_HP_PROBLEM_TYPE', '客户测试环境', '客户测试环境', 5),",
        "  ('OS_HP_PROBLEM_TYPE', '下游测试环境', '下游测试环境', 6)",
        ") AS v(set_code, ov, ol, so) ON os.set_code = v.set_code",
        "ON CONFLICT (option_set_id, option_value) DO NOTHING;",
        "",
    ]

    field_sql_parts: list[str] = []
    for sheet_name, rows in data.items():
        if not rows:
            continue
        title = (row_cells_to_list(rows[0]) or [""])[0].strip()
        node_key = NODE_KEY_BY_CN.get(title)
        if not node_key:
            continue
        seen_keys: set[str] = set()
        sort_order = 0
        handle_modes_row: list[str] = []
        for ridx, rcells in enumerate(rows):
            if ridx < 2:
                continue
            lst = row_cells_to_list(rcells)
            if len(lst) < 3:
                continue
            label = (lst[0] or "").strip()
            req_cell = (lst[1] or "").strip()
            ftype_cell = (lst[2] or "").strip()
            details = (lst[3] or "").strip() if len(lst) > 3 else ""
            special = (lst[4] or "").strip() if len(lst) > 4 else ""
            inherit = (lst[5] or "").strip() if len(lst) > 5 else ""
            if not label or label == "字段名":
                continue
            sort_order += 1
            fk = field_key_for(node_key, label, sort_order, seen_keys)
            req = req_cell == "是"
            ft = map_field_type(ftype_cell, details)
            opts = split_options(details)
            if fk == "handle_mode":
                handle_modes_row = list(opts)
            constraints: dict = {}
            ui_props: dict = {}
            if inherit and "继承" in inherit:
                ui_props["inherit_previous"] = True
            bc = build_constraints(node_key, fk, req, special, handle_modes_row)
            if bc:
                constraints.update(bc)
            if fk == "problem_type":
                pass
            elif ft == "whitelist" and opts and fk != "next_handler":
                constraints["static_options"] = opts
            elif ft == "whitelist" and fk == "next_handler":
                constraints["static_options"] = ["temp"]
            option_set_sql = "NULL"
            if fk == "problem_type":
                option_set_sql = "(SELECT id FROM option_set WHERE set_code = 'OS_HP_PROBLEM_TYPE' LIMIT 1)"
            elif fk == "expected_patch_version":
                ft = "whitelist"
                option_set_sql = "(SELECT id FROM option_set WHERE set_code = 'OS_UPGRADE_BASELINE' LIMIT 1)"
            default_type = "none"
            default_val = "NULL"
            if fk == "fill_date":
                default_type = "today"
            read_only = "FALSE"
            cons_json = "NULL" if not constraints else "'" + sql_escape(json.dumps(constraints, ensure_ascii=False)) + "'::jsonb"
            ui_json = "NULL" if not ui_props else "'" + sql_escape(json.dumps(ui_props, ensure_ascii=False)) + "'::jsonb"
            field_sql_parts.append(
                f"""SELECT wn.id, '{sql_escape(fk)}', '{sql_escape(label)}', '{ft}', {str(req).upper()}, {read_only},
  '{default_type}', {default_val}, {option_set_sql}, {cons_json}, {ui_json}, {sort_order}
FROM workflow_node wn JOIN workflow_template wt ON wt.id = wn.template_id
WHERE wt.template_code = 'HOTPATCH' AND wn.node_key = '{node_key}'"""
            )

    lines.append(
        "INSERT INTO node_field_def (node_id, field_key, field_name, field_type, required, read_only, default_type, default_value, option_set_id, constraints_json, ui_props_json, sort_order)"
    )
    lines.append(" " + " UNION ALL ".join(field_sql_parts))
    lines.append(
        "ON CONFLICT (node_id, field_key) DO UPDATE SET field_name = EXCLUDED.field_name, field_type = EXCLUDED.field_type, required = EXCLUDED.required, constraints_json = EXCLUDED.constraints_json, ui_props_json = EXCLUDED.ui_props_json, sort_order = EXCLUDED.sort_order, is_active = TRUE;"
    )
    lines.append("")
    lines.append("COMMIT;")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Wrote", OUT, "lines", len(lines))


if __name__ == "__main__":
    main()
