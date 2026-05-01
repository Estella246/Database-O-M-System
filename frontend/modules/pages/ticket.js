import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { NODE_KEY_BY_STEP, STEP_BY_NODE_KEY, HANDLE_MODE_ROUTE } from "../constants/workflow.js";
import { normalizeDutyCascadeValue } from "../utils/normalize.js";

export function normalizeNodeKey(rawNode) {
  const raw = String(rawNode || "").trim();
  if (!raw) return "";
  if (NODE_KEY_BY_STEP[raw]) return NODE_KEY_BY_STEP[raw];
  const lowered = raw.toLowerCase();
  if (STEP_BY_NODE_KEY[lowered]) return lowered;
  return "";
}

export function formatValidationErrors(errors, fields) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  const labelByKey = Object.fromEntries((fields || []).map((f) => [String(f.key || ""), String(f.label || f.key || "")]));
  const msgs = errors.map((raw) => {
    const text = String(raw || "").trim();
    const reqMatch = text.match(/^([a-zA-Z0-9_]+)\s+is required$/);
    if (reqMatch) {
      const key = reqMatch[1];
      const label = labelByKey[key] || key;
      return `【${label}】为必填项`;
    }
    const oneOfMatch = text.match(/^([a-zA-Z0-9_]+)\s+must be one of\s+/);
    if (oneOfMatch) {
      const key = oneOfMatch[1];
      const label = labelByKey[key] || key;
      return `【${label}】取值不在白名单中`;
    }
    return text;
  });
  return msgs.join("；");
}

export function renderReadOnlyFieldValue(field, value) {
  if (field.type === "richtext") {
    return `<div class="readonly-value readonly-rich">${value || '<span class="readonly-empty">-</span>'}</div>`;
  }
  const text = String(value || "").trim();
  return `<div class="readonly-value">${text ? escapeHtml(text) : '<span class="readonly-empty">-</span>'}</div>`;
}

export function renderPassedInlineValue(field, value) {
  if (field.type === "richtext") {
    return String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function renderWorkflowFlatSelect(field, value, editable, ctx) {
  const { options, usePlaceholder, enableSearch } = ctx;
  const viewOnly = !!(field.readonly || !editable);
  const keyEsc = escapeAttr(field.key);
  const norm = String(value || "").trim();
  if (viewOnly) {
    return `<div class="wf-flat-select wf-flat-select--readonly" data-wf-flat-select data-field-key="${keyEsc}">
      <span class="wf-flat-select-readonly">${escapeHtml(norm || "—")}</span>
    </div>`;
  }
  const ph = usePlaceholder;
  const labelText = norm || (ph ? "请选择" : String(options[0] || ""));
  const placeholderBtn = ph
    ? `<button type="button" class="wf-flat-select-item wf-flat-select-item--placeholder${!norm ? " is-active" : ""}" data-wf-flat-value-pick="" tabindex="-1">${escapeHtml("请选择")}</button>`
    : "";
  const optsBtns = options
    .map((item) => {
      const sel = item === norm ? " is-active" : "";
      return `<button type="button" class="wf-flat-select-item${sel}" data-wf-flat-value-pick="${escapeAttr(item)}" tabindex="-1">${escapeHtml(item)}</button>`;
    })
    .join("");
  const searchWrap = enableSearch
    ? `<div class="wf-flat-select-search-wrap">
        <input type="text" class="wf-flat-select-search" data-wf-flat-search placeholder="${escapeAttr("搜索版本关键字")}" />
      </div>`
    : "";
  return `<div class="wf-flat-select" data-wf-flat-select data-field-key="${keyEsc}" data-wf-flat-placeholder="${ph ? "1" : "0"}">
    <input type="hidden" name="${escapeAttr(field.key)}" value="${escapeAttr(norm)}" data-wf-flat-value />
    <div class="wf-flat-select-inner">
      <button type="button" class="wf-flat-select-trigger cascade-cascader-trigger" aria-expanded="false" aria-haspopup="listbox">
        <span class="wf-flat-select-label cascade-cascader-label${!norm && ph ? " is-placeholder" : ""}">${escapeHtml(labelText)}</span>
        <span class="cascade-cascader-caret" aria-hidden="true">▾</span>
      </button>
      <div class="wf-flat-select-panel" hidden>
        ${searchWrap}
        <div class="wf-flat-select-scroll" data-wf-flat-list>${placeholderBtn}${optsBtns}</div>
        ${enableSearch ? `<div class="wf-flat-select-empty" data-wf-flat-empty hidden>${escapeHtml("无匹配项")}</div>` : ""}
      </div>
    </div>
  </div>`;
}

export function renderCascadeWhitelistControl(field, value, editable = true) {
  const viewOnly = !!(field.readonly || !editable);
  const keyEsc = escapeAttr(field.key);
  const norm = normalizeDutyCascadeValue(value);
  const tree = field.cascade_options;

  if (viewOnly) {
    return `<div class="cascade-select cascade-cascader cascade-select--readonly" data-cascade-field="${keyEsc}">
      <input type="hidden" name="${escapeAttr(field.key)}" value="${escapeAttr(norm)}" data-cascade-hidden />
      <span class="cascade-readonly-text">${escapeHtml(norm || "—")}</span>
    </div>`;
  }

  const jsonRaw = JSON.stringify(tree != null ? tree : []).replace(/</g, "\\u003c");
  const jsonEsc = escapeHtml(jsonRaw);
  const phCls = norm ? "cascade-cascader-label" : "cascade-cascader-label is-placeholder";
  return `<div class="cascade-select cascade-cascader" data-cascade-field="${keyEsc}">
    <script type="application/json" class="cascade-tree-data">${jsonEsc}</script>
    <input type="hidden" name="${escapeAttr(field.key)}" value="${escapeAttr(norm)}" data-cascade-hidden />
    <div class="cascade-cascader-inner">
      <button type="button" class="cascade-cascader-trigger" aria-expanded="false" aria-haspopup="true">
        <span class="${phCls}">${escapeHtml(norm || "请选择")}</span>
        <span class="cascade-cascader-caret" aria-hidden="true">▾</span>
      </button>
      <div class="cascade-cascader-panel" hidden>
        <div class="cascade-cascader-columns" data-cascade-columns></div>
        <div class="cascade-cascader-footer">
          <span class="cascade-cascader-preview"></span>
          <button type="button" class="cascade-cascader-confirm">${escapeHtml("确定")}</button>
        </div>
      </div>
    </div>
  </div>`;
}

export function resolveNextNodeKey(nodeKey, handleMode) {
  const mode = String(handleMode || "").trim();
  if (mode === "问题解决关闭" || mode === "非问题关闭") return nodeKey;
  if (mode.startsWith("提交其他")) return nodeKey;
  if (nodeKey === "problem_fill") return "problem_review";
  const routeMap = HANDLE_MODE_ROUTE[nodeKey] || {};
  return routeMap[mode] || null;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("image read failed"));
    reader.readAsDataURL(file);
  });
}
