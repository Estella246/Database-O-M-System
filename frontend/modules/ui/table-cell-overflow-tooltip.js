/**
 * 列表表格单元格：仅在文字未完整展示时设置 title，悬停可见全文。
 */

export function cellNeedsOverflowTooltip(cell, fullText) {
  const full = String(fullText || "").trim();
  if (!full) return false;
  const visible = String(cell?.textContent || "").trim();
  if (!visible || visible === "（空）") return false;
  if (full.length > visible.length) return true;
  if (cell && cell.scrollWidth > cell.clientWidth + 1) return true;
  if (cell && cell.scrollHeight > cell.clientHeight + 1) return true;
  return false;
}

export function applyTableCellOverflowTooltips(rootEl) {
  if (!rootEl?.querySelectorAll) return;
  rootEl.querySelectorAll("td[data-cell-full-text]").forEach((cell) => {
    const fullText = (cell.getAttribute("data-cell-full-text") || "").replace(/\s+/g, " ").trim();
    if (cellNeedsOverflowTooltip(cell, fullText)) {
      cell.setAttribute("title", fullText);
    } else {
      cell.removeAttribute("title");
    }
  });
}
