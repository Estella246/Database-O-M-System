/**
 * 侧栏拖拽改宽（localStorage 持久化）
 * 逻辑须与 frontend/modules/ui/sidebar-resize.js 一致（Jest 以 CJS 跑测，故内联实现）。
 */

const SIDEBAR_WIDTH_STORAGE_KEY = "gauss_sidebar_width_px";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "gauss_sidebar_collapsed";
const SIDEBAR_WIDTH_DEFAULT = 136;
const SIDEBAR_WIDTH_MIN = 112;
const SIDEBAR_WIDTH_MAX = 360;

function clampSidebarWidth(px) {
  const n = Math.round(Number(px));
  if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n));
}

function loadStoredSidebarWidth(storage) {
  try {
    const raw = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw == null || raw === "") return SIDEBAR_WIDTH_DEFAULT;
    return clampSidebarWidth(Number(raw));
  } catch (_) {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

function saveStoredSidebarWidth(storage, px) {
  storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(px)));
}

function loadStoredSidebarCollapsed(storage) {
  try {
    return storage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function saveStoredSidebarCollapsed(storage, collapsed) {
  storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
}

describe("sidebar-resize", () => {
  /** @type {Map<string, string>} */
  let map;

  beforeEach(() => {
    map = new Map();
  });

  const storage = () => ({
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  });

  test("clampSidebarWidth enforces min/max and default", () => {
    expect(clampSidebarWidth(80)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(500)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth("nope")).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(180.6)).toBe(181);
  });

  test("load/save round-trip via storage", () => {
    const s = storage();
    saveStoredSidebarWidth(s, 200);
    expect(loadStoredSidebarWidth(s)).toBe(200);
    expect(s.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("200");
  });

  test("loadStoredSidebarWidth falls back when missing", () => {
    expect(loadStoredSidebarWidth(storage())).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  test("load/save collapsed round-trip", () => {
    const s = storage();
    expect(loadStoredSidebarCollapsed(s)).toBe(false);
    saveStoredSidebarCollapsed(s, true);
    expect(loadStoredSidebarCollapsed(s)).toBe(true);
    expect(s.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("1");
    saveStoredSidebarCollapsed(s, false);
    expect(loadStoredSidebarCollapsed(s)).toBe(false);
  });
});
