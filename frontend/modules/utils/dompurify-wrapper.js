/**
 * DOMPurify 封装 — 清洗 LLM 生成的 HTML 报告内容。
 * 允许 ECharts 所需的 script/style/div 等标签，禁止 iframe/object/embed/form 等危险标签。
 */
let purifyLib = null;

export async function loadDOMPurify() {
  if (purifyLib) return purifyLib;
  purifyLib = window.DOMPurify;
  if (!purifyLib) {
    console.warn("DOMPurify not loaded — report rendering may be unsafe");
  }
  return purifyLib;
}

export function sanitizeReportHtml(html) {
  if (!purifyLib) return html;
  return purifyLib.sanitize(html, {
    ALLOWED_TAGS: [
      "div", "span", "table", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr", "ul", "ol", "li", "style", "script", "img", "a",
      "strong", "em", "b", "i", "thead", "tbody", "colgroup", "col",
    ],
    FORBID_TAGS: ["iframe", "object", "embed", "form", "input", "link", "meta", "base", "noscript"],
    ALLOWED_ATTR: ["id", "class", "style", "src", "href", "width", "height", "colspan", "rowspan", "alt", "title"],
    ADD_TAGS: ["script"],
    FORCE_BODY: true,
  });
}