/**
 * 月度报告富文本编辑：编辑区支持「加粗 + 预设字体颜色」。
 * 存储为受清洗的 HTML（仅 b/strong/i/em/u/span/font/br/div/p + style(color/font-weight)/color），
 * 网页只读、HTML 导出共用同一份清洗后的 HTML，确保字号/加粗/颜色一致；
 * Excel 导出用 richToPlainText 退化为纯文本。
 */
import { escapeHtml } from "../utils/escape.js";

// 预设常用色（工具条色块）。
export const RICH_COLORS = [
  { label: "黑", value: "#2f2b25" },
  { label: "红", value: "#d94e4e" },
  { label: "橙", value: "#e08e0b" },
  { label: "蓝", value: "#3f86ff" },
  { label: "绿", value: "#2e9b5b" },
];

const ALLOWED_TAGS = ["b", "strong", "i", "em", "u", "span", "font", "br", "div", "p"];
const ALLOWED_ATTR = ["style", "color"];

/** 清洗富文本 HTML：无 DOMPurify 时退化为纯文本转义（安全优先）。 */
export function sanitizeRichHtml(html) {
  const s = String(html == null ? "" : html);
  const purify = typeof window !== "undefined" ? window.DOMPurify : null;
  if (purify && typeof purify.sanitize === "function") {
    return purify.sanitize(s, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOWED_URI_REGEXP: /^$/, // 不允许任何 URI 属性
    });
  }
  return escapeHtml(s);
}

/** 渲染可编辑富文本块（contenteditable）。dataAttrs 透传业务绑定属性（如 data-mr-major）。 */
export function renderRichEditable(value, dataAttrs = "", { cls = "", placeholder = "" } = {}) {
  const safe = sanitizeRichHtml(value);
  const ph = placeholder ? ` data-placeholder="${escapeHtml(placeholder)}"` : "";
  const klass = `mr-rich-edit${cls ? ` ${cls}` : ""}`;
  return `<div class="${klass}" contenteditable="true" data-mr-rich${ph} ${dataAttrs}>${safe}</div>`;
}

/** 渲染只读富文本（清洗后的 HTML，外层 white-space:pre-wrap 保留换行）。 */
export function renderRichReadonly(value) {
  return sanitizeRichHtml(value);
}

/** 富文本工具条：加粗 + 预设色块。作用于当前聚焦的富文本块。 */
export function renderRichToolbar() {
  const swatches = RICH_COLORS.map(
    (c) => `<button type="button" class="mr-rich-color" data-mr-rich-color="${c.value}" title="${escapeHtml(c.label)}" style="background:${c.value}" aria-label="${escapeHtml(c.label)}"></button>`
  ).join("");
  return `<div class="mr-rich-toolbar" data-mr-rich-toolbar>
    <button type="button" class="mr-rich-btn" data-mr-rich-cmd="bold" title="加粗"><b>B</b></button>
    <span class="mr-rich-color-group">${swatches}</span>
  </div>`;
}

/** 富文本 → 纯文本（Excel 导出用）：块级标签转换行，去除其余标签并解码实体。 */
export function richToPlainText(html) {
  const safe = sanitizeRichHtml(html);
  if (typeof document !== "undefined") {
    const tmp = document.createElement("div");
    tmp.innerHTML = safe.replace(/<br\s*\/?>(?!$)/gi, "\n").replace(/<\/(div|p)>/gi, "\n$&");
    return (tmp.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }
  return safe
    .replace(/<br\s*\/?>(?!$)/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 当前聚焦的富文本块；工具条按钮作用于它。
let lastRichEl = null;

/**
 * 绑定富文本工具条（全局一次）：
 * - 跟踪聚焦的 [data-mr-rich]；
 * - 工具条按钮通过 execCommand 应用加粗/颜色，并派发 input 事件，
 *   由各段已有的 input 监听读取 innerHTML 写回草稿。
 */
export function bindRichTextToolbar() {
  document.querySelectorAll("[data-mr-rich]").forEach((el) => {
    el.addEventListener("focusin", () => { lastRichEl = el; });
  });
  document.querySelectorAll("[data-mr-rich-toolbar]").forEach((bar) => {
    bar.addEventListener("mousedown", (ev) => {
      const btn = ev.target.closest("[data-mr-rich-cmd],[data-mr-rich-color]");
      if (!btn) return;
      ev.preventDefault(); // 阻止工具条夺取焦点，保留编辑区选区
      const el = lastRichEl;
      if (!el || !el.isConnected) return;
      el.focus();
      try { document.execCommand("styleWithCSS", false, true); } catch (_) { /* ignore */ }
      if (btn.hasAttribute("data-mr-rich-cmd")) {
        try { document.execCommand(btn.getAttribute("data-mr-rich-cmd"), false, null); } catch (_) { /* ignore */ }
      } else {
        try { document.execCommand("foreColor", false, btn.getAttribute("data-mr-rich-color")); } catch (_) { /* ignore */ }
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}
