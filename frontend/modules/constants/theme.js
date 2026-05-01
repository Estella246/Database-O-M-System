export const UI_THEME_STORAGE_KEY = "yunwei_ui_theme";
export const UI_THEME_IDS = ["light", "dark", "eye-care", "pink-mist", "blue-lilac"];

export const CUSTOM_BG_STORAGE_KEY = "yunwei_custom_bg_data_url";
export const SKIN_BG_PRESET_STORAGE_KEY = "yunwei_bg_preset_file";
export const SKIN_BG_PRESETS = [
  { file: "preset-01.png", label: "预设 1", swatch: "preset-01" },
  { file: "preset-02.png", label: "预设 2", swatch: "preset-02" },
  { file: "preset-03.png", label: "预设 3", swatch: "preset-03" },
  { file: "preset-04.png", label: "预设 4", swatch: "preset-04" },
];
export const CUSTOM_BG_MAX_FILE_BYTES = 2 * 1024 * 1024;

export function skinPresetPublicUrl(filename) {
  return "/assets/skin-presets/" + encodeURIComponent(filename);
}

export const GROUP_TEMPLATE_KINDS = [
  { kind: "major", label: "重大问题" },
  { kind: "urgent", label: "紧急问题" },
  { kind: "itr", label: "ITR管理升级" },
  { kind: "general", label: "一般问题" },
];

export const GROUP_TEMPLATE_NAME_DEFAULTS = {
  major: "【GaussDB内部】【XX 重大问题】{Ecare单号 客户名称} GaussDB {故障描述}",
  urgent: "【GaussDB内部】【XX 紧急问题】{Ecare单号 客户名称} GaussDB {故障描述}",
  itr: "【GaussDB内部】【ITR 管理升级】{Ecare单号 客户名称} GaussDB {故障描述}",
  general: "【GaussDB内部】【一般问题】{Ecare单号 客户名称} GaussDB {故障描述}",
};

export const DEFAULT_OPERATOR_ACCOUNT = "demo_001";
export const DEFAULT_OPERATOR_NAME = "Demo User";

export const MS_PER_DAY = 86400000;
