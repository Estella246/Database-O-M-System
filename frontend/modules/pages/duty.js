import { DUTY_ROSTER_SECTIONS, DUTY_SPECIAL_ROTATION_SUBTABLES } from "../constants/duty.js";
import { escapeHtml, escapeAttr } from "../utils/escape.js";

export function dutyRosterAnchorValid(id) {
  if (!id) return false;
  if (DUTY_ROSTER_SECTIONS.some((s) => s.id === id)) return true;
  return DUTY_SPECIAL_ROTATION_SUBTABLES.some((s) => s.anchorId === id);
}

export function dutyFieldParsePath(path) {
  return String(path || "")
    .split(".")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

export function dutyFieldGetParentArray(tree, parts) {
  if (!parts.length) return null;
  if (parts.length === 1) return tree;
  let arr = tree;
  for (let d = 0; d < parts.length - 1; d++) {
    const n = arr[parts[d]];
    if (!n) return null;
    if (!Array.isArray(n.children)) n.children = [];
    arr = n.children;
  }
  return arr;
}

export function dutyFieldNodeAtPath(tree, parts) {
  const parent = dutyFieldGetParentArray(tree, parts);
  if (!parent) return null;
  return parent[parts[parts.length - 1]] ?? null;
}

export function dutyCascaderColumnsData(tree, tempPath) {
  const columns = [];
  let cur = Array.isArray(tree) ? tree : [];
  let d = 0;
  for (;;) {
    if (!cur.length) break;
    columns.push({ depth: d, list: cur, activeLabel: tempPath[d] ?? null });
    const label = tempPath[d];
    if (label == null || label === "") break;
    const node = cur.find((n) => String(n.label || "").trim() === label);
    if (!node || !Array.isArray(node.children) || !node.children.length) break;
    cur = node.children;
    d++;
  }
  return columns;
}

export function dutyCascaderColumnHtml(depth, nodes, activeLabel) {
  const items = (nodes || [])
    .map((node) => {
      const lab = String(node.label || "").trim();
      if (!lab) return "";
      const ch = Array.isArray(node.children) && node.children.length > 0;
      const active = lab === activeLabel ? " is-active" : "";
      const arrow = ch ? '<span class="cascade-cascader-arrow" aria-hidden="true">▸</span>' : "";
      return `<button type="button" class="cascade-cascader-item${active}" data-depth="${depth}" data-label="${escapeAttr(lab)}" data-has-children="${ch ? "1" : "0"}">${escapeHtml(lab)}${arrow}</button>`;
    })
    .filter(Boolean)
    .join("");
  return `<div class="cascade-cascader-col" role="listbox" data-col-depth="${depth}">${items}</div>`;
}

export function getDutyAssignmentsForDay(kind, dateKey, dutyAssignments) {
  const bucket = dutyAssignments[kind];
  if (!bucket || !dateKey) return [];
  const arr = bucket[dateKey];
  return Array.isArray(arr) ? arr : [];
}
