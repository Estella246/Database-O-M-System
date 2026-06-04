export const DUTY_CALENDAR_KINDS = ["kernel", "control", "public_cloud", "poc"];

export const DUTY_CALENDAR_KIND_BY_SECTION_ID = {
  "duty-kernel-oncall": "kernel",
  "duty-control-oncall": "control",
  "duty-public-cloud-oncall": "public_cloud",
  "duty-poc-oncall": "poc",
};

export const DUTY_ROTATION_KIND_BY_SECTION_ID = {
  "duty-kernel-rotation": "kernelRotation",
  "duty-control-rotation": "controlRotation",
  "duty-public-cloud-rotation": "publicCloudRotation",
  "duty-poc-rotation": "pocRotation",
};

export const DUTY_SPECIAL_ROTATION_SUBTABLES = [
  { anchorId: "duty-special-slow-sql", title: "慢SQL(SQL)调优专项轮值表", kind: "specialSlowSql" },
  { anchorId: "duty-special-perf", title: "整体性能专项轮值表", kind: "specialPerf" },
  { anchorId: "duty-special-upgrade", title: "升级专项轮值表", kind: "specialUpgrade" },
  { anchorId: "duty-special-scale", title: "扩容专项轮值表", kind: "specialScale" },
  { anchorId: "duty-special-backup", title: "备份恢复专项轮值表", kind: "specialBackup" },
  { anchorId: "duty-special-dr", title: "容灾专项轮值表", kind: "specialDr" },
];

export const DUTY_ALL_ROTATION_KINDS = [
  "kernelRotation",
  "controlRotation",
  "publicCloudRotation",
  "pocRotation",
  ...DUTY_SPECIAL_ROTATION_SUBTABLES.map((s) => s.kind),
];

export const DUTY_RL_ONCALL_STORAGE_KEY = "yunwei_duty_rl_oncall_v1";
export const DUTY_ROTATION_STORAGE_KEY = "yunwei_duty_rotation_v1";
export const DUTY_ROTATION_STATUS_ACTIVE = "active";
export const DUTY_ROTATION_STATUS_INACTIVE = "inactive";
export const DUTY_SHIFT_FULL = "full";
export const DUTY_SHIFT_NIGHT = "night";
export const DUTY_ASSIGNMENTS_STORAGE_KEY = "yunwei_duty_calendar_v1";
export const DUTY_HOLIDAY_STORAGE_KEY = "yunwei_duty_holiday_v1";
export const DUTY_SELECTABLE_ROLE_CODES = new Set(["管理员", "普通人员"]);

export const DUTY_ROSTER_SECTIONS = [
  { id: "duty-kernel-oncall", title: "内核值班表" },
  { id: "duty-control-oncall", title: "管控值班表" },
  { id: "duty-public-cloud-oncall", title: "公有云值班表" },
  { id: "duty-poc-oncall", title: "POC值班表" },
  { id: "duty-holiday-config", title: "节假日配置" },
  { id: "duty-kernel-rotation", title: "内核轮值表" },
  { id: "duty-control-rotation", title: "管控轮值表" },
  { id: "duty-public-cloud-rotation", title: "公有云轮值表" },
  { id: "duty-poc-rotation", title: "POC轮值表" },
  { id: "duty-special-rotation", title: "专项轮值表" },
  { id: "duty-rl-oncall", title: "RL值班表" },
];

export const DUTY_CALENDAR_HOME_LABELS = Object.fromEntries(
  DUTY_CALENDAR_KINDS.map((kind) => {
    const sectionId = Object.entries(DUTY_CALENDAR_KIND_BY_SECTION_ID).find(([, k]) => k === kind)?.[0];
    const sec = DUTY_ROSTER_SECTIONS.find((s) => s.id === sectionId);
    return [kind, String(sec?.title || kind).replace(/表$/, "")];
  })
);

export const LEAVE_APPLICATION_TYPES = ["重大问题公关", "特性开发", "外出公干", "请假/调休", "在途"];

export const DUTY_FIELD_CASCADE_SEP = "/";
