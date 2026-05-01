import { escapeHtml } from "../utils/escape.js";

const HEATMAP_CELL_BG = ["#e4e1d8", "#bfe9c9", "#7ccf8d", "#3faa60", "#2a7a45"];
const HEATMAP_COL_PX = 12;
const HEATMAP_CELL_PX = 12;
const HEATMAP_GAP_PX = 2;

export { HEATMAP_CELL_BG, HEATMAP_COL_PX, HEATMAP_CELL_PX, HEATMAP_GAP_PX };

export function normalizeHomePersonalQualityScope(v) {
  if (v === "quality") return "quality";
  if (v === "nonQuality") return "non_quality";
  return "all";
}

export function heatmapPadCellStyle() {
  return `display:block;box-sizing:border-box;width:${HEATMAP_CELL_PX}px;height:${HEATMAP_CELL_PX}px;min-width:${HEATMAP_CELL_PX}px;min-height:${HEATMAP_CELL_PX}px;opacity:0;pointer-events:none;border:1px solid transparent;background:transparent`;
}

export function heatmapDataCellStyle(level) {
  const lv = Math.min(4, Math.max(0, Number(level) || 0));
  const bg = HEATMAP_CELL_BG[lv];
  return `display:block;box-sizing:border-box;width:${HEATMAP_CELL_PX}px;height:${HEATMAP_CELL_PX}px;min-width:${HEATMAP_CELL_PX}px;min-height:${HEATMAP_CELL_PX}px;border-radius:3px;border:1px solid rgba(55,48,32,0.1);background:${bg}`;
}
