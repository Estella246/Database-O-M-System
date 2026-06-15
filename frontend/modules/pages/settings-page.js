import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import { requestRender } from "../core/scheduler.js";
import { UI_THEME_IDS, SKIN_BG_PRESETS, SKIN_BG_PRESET_STORAGE_KEY, CUSTOM_BG_STORAGE_KEY, skinPresetPublicUrl, CUSTOM_BG_MAX_FILE_BYTES } from "../constants/theme.js";
import { getStoredUiTheme, getBackgroundKind, hasStoredCustomBg, getStoredPresetBgFile, applyUiTheme, applyPageBackgroundFromStorage, clearPageBackground } from "../ui/theme.js";

export function ensureListTab() {
  const key = "list";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "工作台", closable: true });
  }
  return key;
}

export function ensurePatchListTab() {
  const key = "patch:list";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "补丁管理", closable: true });
  }
  return key;
}

export function ensureSettingsTab() {
  const key = "settings:appearance";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "设置", closable: true });
  }
  return key;
}

export function ensureOncallEvaTab() {
  const key = "oncall:eva";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "运维效率", closable: true });
  }
  return key;
}

export function ensureLeaveTab() {
  const key = "leave:application";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "请假申请", closable: true });
  }
  return key;
}

export function ensureRequirementTab() {
  const key = "req:manage";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "质量改进", closable: true });
  }
  return key;
}

export function ensureMajorProblemTab() {
  const key = "major:problem";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "重大问题", closable: true });
  }
  return key;
}

export function ensureSiteProfileTab() {
  const key = "site:profile";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "局点档案", closable: true });
  }
  return key;
}

export function renderSettingsAppearanceHtml() {
  const cur = getStoredUiTheme();
  const themes = [
    { id: "light", label: "浅色", swatch: "light" },
    { id: "dark", label: "暗黑", swatch: "dark" },
    { id: "eye-care", label: "护眼色", swatch: "eye-care" },
    { id: "pink-mist", label: "浅粉渐变", swatch: "pink-mist" },
    { id: "blue-lilac", label: "蓝紫渐变", swatch: "blue-lilac" },
  ];
  const tiles = themes
    .map(
      ({ id, label, swatch }) => `
        <button type="button" class="settings-skin-tile ${cur === id ? "active" : ""}" data-ui-theme="${id}" role="radio" aria-checked="${cur === id}" aria-label="${label}">
          <span class="settings-skin-swatch settings-skin-swatch--${swatch}" aria-hidden="true"></span>
          <span class="settings-skin-label">${label}</span>
        </button>`
    )
    .join("");
  const bgKind = getBackgroundKind();
  const presetTiles = SKIN_BG_PRESETS.map(
    ({ file, label, swatch }) => `
        <button type="button" class="settings-skin-tile settings-skin-tile--preset ${
          !hasStoredCustomBg() && getStoredPresetBgFile() === file ? "active" : ""
        }" data-bg-preset-file="${escapeAttr(file)}" role="radio" aria-checked="${
          !hasStoredCustomBg() && getStoredPresetBgFile() === file
        }" aria-label="${escapeAttr(label)}">
          <span class="settings-skin-swatch settings-skin-swatch--${swatch}" aria-hidden="true"></span>
          <span class="settings-skin-label">${escapeHtml(label)}</span>
        </button>`
  ).join("");
  const bgStatusLine =
    bgKind === "custom"
      ? "当前已使用本机保存的背景图。"
      : bgKind === "preset"
        ? "当前使用内置预设背景。"
        : "";
  return `
      <section class="settings-page" aria-label="设置">
        <div class="section-title">皮肤设置</div>
        <div class="settings-skin-grid" role="radiogroup" aria-label="皮肤设置">
          ${tiles}
        </div>
        <div class="section-title">背景预设</div>
        <div class="settings-skin-grid settings-skin-grid--presets" role="radiogroup" aria-label="背景预设">
          ${presetTiles}
        </div>
        <div class="section-title">背景图（本机）</div>
        <div class="settings-custom-bg">
          <div class="settings-custom-bg-row">
            <label class="settings-custom-bg-file-label">
              <input type="file" id="settings-custom-bg-file" class="settings-custom-bg-file" accept="image/*" />
              <span>选择图片</span>
            </label>
            <button type="button" class="action settings-custom-bg-clear" id="settings-custom-bg-clear">清除背景图</button>
          </div>
          <p class="settings-custom-bg-hint">单张不超过 2MB；超出请先在本地缩小尺寸或压缩后再上传。</p>
          <p class="settings-custom-bg-status" id="settings-custom-bg-status" role="status">${bgStatusLine}</p>
        </div>
      </section>`;
}

export function bindSettingsAppearancePage() {
  document.querySelectorAll(".settings-skin-tile[data-ui-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.getAttribute("data-ui-theme");
      if (!UI_THEME_IDS.includes(theme)) return;
      applyUiTheme(theme);
      document.querySelectorAll(".settings-skin-tile[data-ui-theme]").forEach((b) => {
        const on = b.getAttribute("data-ui-theme") === theme;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    });
  });

  const fileInput = document.getElementById("settings-custom-bg-file");
  const statusEl = document.getElementById("settings-custom-bg-status");
  const clearBtn = document.getElementById("settings-custom-bg-clear");

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > CUSTOM_BG_MAX_FILE_BYTES) {
        if (statusEl) statusEl.textContent = `文件超过 ${CUSTOM_BG_MAX_FILE_BYTES / 1024 / 1024}MB，请换较小的图片。`;
        fileInput.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl.startsWith("data:image/")) {
          if (statusEl) statusEl.textContent = "请选择图片文件。";
          return;
        }
        try {
          window.localStorage.removeItem(SKIN_BG_PRESET_STORAGE_KEY);
          window.localStorage.setItem(CUSTOM_BG_STORAGE_KEY, dataUrl);
          applyPageBackgroundFromStorage();
          syncSettingsPresetTileActive();
          if (statusEl) statusEl.textContent = "已保存，仅保存在本浏览器，下次打开仍会生效。";
        } catch (err) {
          const name = err && typeof err === "object" ? err.name : "";
          if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
            if (statusEl) statusEl.textContent = "存储空间不足，请换更小的图片或清除站点数据后重试。";
          } else if (statusEl) {
            statusEl.textContent = "保存失败，请重试。";
          }
        }
        fileInput.value = "";
      };
      reader.onerror = () => {
        if (statusEl) statusEl.textContent = "读取文件失败。";
        fileInput.value = "";
      };
      reader.readAsDataURL(file);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearPageBackground();
      if (fileInput) fileInput.value = "";
      syncSettingsPresetTileActive();
      if (statusEl) statusEl.textContent = "已恢复为渐变背景。";
    });
  }

  document.querySelectorAll(".settings-skin-tile--preset[data-bg-preset-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const file = btn.getAttribute("data-bg-preset-file");
      if (!file || !SKIN_BG_PRESETS.some((p) => p.file === file)) return;
      try {
        window.localStorage.removeItem(CUSTOM_BG_STORAGE_KEY);
        window.localStorage.setItem(SKIN_BG_PRESET_STORAGE_KEY, file);
      } catch (_) {
        /* ignore */
      }
      applyPageBackgroundFromStorage();
      syncSettingsPresetTileActive();
      if (statusEl) {
        statusEl.textContent = "已启用内置预设背景。";
      }
    });
  });
}

export function syncSettingsPresetTileActive() {
  const customOn = hasStoredCustomBg();
  const cur = customOn ? "" : getStoredPresetBgFile();
  document.querySelectorAll(".settings-skin-tile--preset[data-bg-preset-file]").forEach((btn) => {
    const file = btn.getAttribute("data-bg-preset-file") || "";
    const on = Boolean(cur && file === cur);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  });
}
