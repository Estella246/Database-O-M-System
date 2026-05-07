import { formatYmdLocal } from "../utils/format.js";

let rootEl = null;
let onDocKey = null;
let onWinScroll = null;

export function destroyWorkbenchCreatedCalendarOverlay() {
  if (onDocKey) {
    document.removeEventListener("keydown", onDocKey, true);
    onDocKey = null;
  }
  if (onWinScroll) {
    window.removeEventListener("scroll", onWinScroll, true);
    onWinScroll = null;
  }
  if (rootEl) {
    rootEl.remove();
    rootEl = null;
  }
}

function monthCells(viewYear, viewMonth) {
  const cells = [];
  const first = new Date(viewYear, viewMonth, 1);
  const pad = first.getDay();
  for (let i = 0; i < 42; i += 1) {
    const day = i - pad + 1;
    const dt = new Date(viewYear, viewMonth, day);
    const inMonth = dt.getMonth() === viewMonth;
    cells.push({ dt, inMonth, ymd: formatYmdLocal(dt) });
  }
  return cells;
}

function positionPanel(panel, anchorEl) {
  if (!anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  const pad = 8;
  const pw = 280;
  const ph = 320;
  let left = r.left;
  let top = r.bottom + 6;
  if (left + pw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pw - pad);
  if (top + ph > window.innerHeight - pad) top = Math.max(pad, r.top - ph - 6);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

/**
 * @param {object} opts
 * @param {{ which: string, viewYear: number, viewMonth: number }} opts.cfg
 * @param {string} opts.selectedStart
 * @param {string} opts.selectedEnd
 * @param {HTMLElement | null} opts.anchorEl
 * @param {(y: number, m: number) => void} opts.onNavigate
 * @param {(ymd: string) => void} opts.onPick
 * @param {() => void} opts.onClear
 * @param {() => void} opts.onClose
 */
export function mountWorkbenchCreatedCalendarOverlay(opts) {
  destroyWorkbenchCreatedCalendarOverlay();
  const { cfg, selectedStart, selectedEnd, anchorEl, onNavigate, onPick, onClear, onClose } = opts;
  if (!anchorEl) {
    onClose();
    return;
  }

  const layer = document.createElement("div");
  layer.className = "workbench-glass-cal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "workbench-glass-cal-backdrop";
  backdrop.setAttribute("aria-label", "关闭日历");
  backdrop.addEventListener("click", () => onClose());

  const panel = document.createElement("div");
  panel.className = "workbench-glass-cal-panel";

  const head = document.createElement("div");
  head.className = "workbench-glass-cal-head";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "workbench-glass-cal-nav";
  prevBtn.textContent = "‹";
  prevBtn.setAttribute("aria-label", "上一月");

  const title = document.createElement("div");
  title.className = "workbench-glass-cal-title";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "workbench-glass-cal-nav";
  nextBtn.textContent = "›";
  nextBtn.setAttribute("aria-label", "下一月");

  const refreshTitle = () => {
    title.textContent = `${cfg.viewYear}年${cfg.viewMonth + 1}月`;
  };
  refreshTitle();

  prevBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    let y = cfg.viewYear;
    let m = cfg.viewMonth;
    if (m === 0) {
      m = 11;
      y -= 1;
    } else {
      m -= 1;
    }
    onNavigate(y, m);
  });
  nextBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    let y = cfg.viewYear;
    let m = cfg.viewMonth;
    if (m === 11) {
      m = 0;
      y += 1;
    } else {
      m += 1;
    }
    onNavigate(y, m);
  });

  head.append(prevBtn, title, nextBtn);

  const weekRow = document.createElement("div");
  weekRow.className = "workbench-glass-cal-weekdays";
  const wk = ["日", "一", "二", "三", "四", "五", "六"];
  wk.forEach((w) => {
    const c = document.createElement("div");
    c.className = "workbench-glass-cal-wd";
    c.textContent = w;
    weekRow.appendChild(c);
  });

  const grid = document.createElement("div");
  grid.className = "workbench-glass-cal-grid";

  const todayYmd = formatYmdLocal(new Date());
  const selForWhich = cfg.which === "start" ? selectedStart : selectedEnd;

  monthCells(cfg.viewYear, cfg.viewMonth).forEach(({ dt, inMonth, ymd }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "workbench-glass-cal-day";
    if (!inMonth) b.classList.add("is-muted");
    b.textContent = String(dt.getDate());
    if (ymd === todayYmd) b.classList.add("is-today");
    if (selForWhich && ymd === selForWhich) b.classList.add("is-selected");
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onPick(ymd);
    });
    grid.appendChild(b);
  });

  const foot = document.createElement("div");
  foot.className = "workbench-glass-cal-foot";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "workbench-glass-cal-clear";
  clearBtn.textContent = cfg.which === "start" ? "清除开始日期" : "清除结束日期";
  clearBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClear();
  });
  foot.appendChild(clearBtn);

  panel.addEventListener("click", (ev) => ev.stopPropagation());
  panel.append(head, weekRow, grid, foot);
  layer.append(backdrop, panel);
  document.body.appendChild(layer);
  rootEl = layer;
  positionPanel(panel, anchorEl);

  onDocKey = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      onClose();
    }
  };
  document.addEventListener("keydown", onDocKey, true);

  onWinScroll = () => onClose();
  window.addEventListener("scroll", onWinScroll, true);
}
