import {
  UI_THEME_STORAGE_KEY,
  UI_THEME_IDS,
  CUSTOM_BG_STORAGE_KEY,
  SKIN_BG_PRESET_STORAGE_KEY,
  SKIN_BG_PRESETS,
  skinPresetPublicUrl,
} from "../constants/theme.js";

function getStoredUiTheme() {
  try {
    const v = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
    if (UI_THEME_IDS.includes(v)) return v;
  } catch (_) {
    /* ignore */
  }
  return "light";
}

function applyUiTheme(theme) {
  const t = UI_THEME_IDS.includes(theme) ? theme : "light";
  if (t === "light") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", t);
  }
  try {
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, t);
  } catch (_) {
    /* ignore */
  }
}

function hasStoredCustomBg() {
  try {
    const s = window.localStorage.getItem(CUSTOM_BG_STORAGE_KEY);
    return Boolean(s && String(s).startsWith("data:image/"));
  } catch (_) {
    return false;
  }
}

function getStoredPresetBgFile() {
  try {
    const f = window.localStorage.getItem(SKIN_BG_PRESET_STORAGE_KEY);
    const file = String(f || "").trim();
    if (!file || !SKIN_BG_PRESETS.some((p) => p.file === file)) return "";
    return file;
  } catch (_) {
    return "";
  }
}

function getBackgroundKind() {
  if (hasStoredCustomBg()) return "custom";
  if (getStoredPresetBgFile()) return "preset";
  return "none";
}

function applyPageBackgroundFromStorage() {
  const root = document.documentElement;
  let dataUrl = "";
  try {
    dataUrl = window.localStorage.getItem(CUSTOM_BG_STORAGE_KEY) || "";
  } catch (_) {
    /* ignore */
  }
  if (dataUrl && String(dataUrl).startsWith("data:image/")) {
    root.style.setProperty("--yunwei-custom-bg", `url(${JSON.stringify(dataUrl)})`);
    document.body.classList.add("has-custom-bg");
    return;
  }
  const presetFile = getStoredPresetBgFile();
  if (presetFile) {
    const u = skinPresetPublicUrl(presetFile);
    root.style.setProperty("--yunwei-custom-bg", `url(${JSON.stringify(u)})`);
    document.body.classList.add("has-custom-bg");
    return;
  }
  root.style.removeProperty("--yunwei-custom-bg");
  document.body.classList.remove("has-custom-bg");
}

function clearPageBackground() {
  try {
    window.localStorage.removeItem(CUSTOM_BG_STORAGE_KEY);
    window.localStorage.removeItem(SKIN_BG_PRESET_STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
  applyPageBackgroundFromStorage();
}

export function loadOperatorBadgePos() {
  try {
    const raw = window.localStorage.getItem("operator_badge_pos");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const left = Number(parsed?.left);
    const top = Number(parsed?.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left, top };
  } catch (_) {
    return null;
  }
}

export {
  getStoredUiTheme,
  applyUiTheme,
  hasStoredCustomBg,
  getStoredPresetBgFile,
  getBackgroundKind,
  applyPageBackgroundFromStorage,
  clearPageBackground,
};
