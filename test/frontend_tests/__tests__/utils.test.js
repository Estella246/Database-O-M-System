/**
 * 前端工具函数单元测试
 * 对应测试用例：TC-M13-001 ~ TC-M13-039
 * 测试基于 frontend/app.js 中的实际函数实现
 */

/** 模拟全局变量和环境 */
global.window = {
  localStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn()
  },
  location: {
    search: '',
    protocol: 'http:',
    hostname: 'localhost'
  }
};

global.document = {
  documentElement: {
    setAttribute: jest.fn(),
    removeAttribute: jest.fn(),
    style: {
      setProperty: jest.fn(),
      removeProperty: jest.fn()
    }
  },
  body: {
    classList: {
      add: jest.fn(),
      remove: jest.fn()
    }
  }
};

/** ====== 从 app.js 提取的工具函数 ====== */

/** 问题严重性展示文案（与 option 一致：一般 / 严重 / 致命） */
function normalizeIssueSeverity(raw) {
  const s = String(raw || "").trim();
  if (s === "一般" || s === "严重" || s === "致命") return s;
  const lower = s.toLowerCase();
  if (lower === "urgent") return "致命";
  if (lower === "high") return "严重";
  if (lower === "low" || lower === "medium") return "一般";
  return s || "一般";
}

/** 沿用原有 .p.urgent / .high / .low 圆点样式，不新增 CSS */
function severityPillClass(label) {
  const s = normalizeIssueSeverity(label);
  if (s === "致命") return "urgent";
  if (s === "严重") return "high";
  if (s === "一般") return "low";
  return "medium";
}

/** 首页列表「问题描述」等：去标签并截断，避免撑破表格 */
function listPreviewText(raw, maxLen = 160) {
  const t = String(raw || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "--";
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

/** 问题详情顶栏：截断后的问题描述（空则 ""） */
function ticketDetailDescPreview(ticket, maxDescLen = 80) {
  const preview = listPreviewText(ticket?.description, maxDescLen);
  if (!preview || preview === "--") return "";
  return preview;
}

/** 问题详情顶栏纯文本标题：Order {单号} + 空格 + 截断描述 */
function ticketDetailHeading(ticket, maxDescLen = 80) {
  const orderId = String(ticket?.orderId || "").trim();
  const base = `Order ${orderId || "—"}`;
  const preview = ticketDetailDescPreview(ticket, maxDescLen);
  return preview ? `${base} ${preview}` : base;
}

function ticketCreatedAtMs(t) {
  const raw = t?.createdAt ?? t?.created_at;
  if (raw) {
    const ms = Date.parse(String(raw));
    if (!Number.isNaN(ms)) return ms;
  }
  const sd = String(t?.startDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(sd)) {
    const ms = Date.parse(`${sd}T12:00:00`);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

function ticketSlaStartMs(t) {
  const raw = t?.createdAt ?? t?.created_at;
  if (!raw) return 0;
  const ms = Date.parse(String(raw));
  return Number.isNaN(ms) ? 0 : ms;
}

function ticketIsTemporarySuspended(t) {
  const status = String(t?.status ?? "").trim();
  if (status.toLowerCase() === "suspended" || status === "暂时挂起") return true;
  const stage = String(t?.currentStage ?? t?.current_stage ?? t?.node ?? "").trim();
  return stage === "暂时挂起";
}

function ticketSlaEndMs(t, nowMs = Date.now()) {
  const closedRaw = t?.closedAt ?? t?.closed_at;
  if (closedRaw) {
    const ms = Date.parse(String(closedRaw));
    if (!Number.isNaN(ms)) return ms;
  }
  return nowMs;
}

function ticketSlaPausedMs(t, nowMs = Date.now()) {
  const baseSec = Number(t?.slaPausedSeconds ?? t?.sla_paused_seconds ?? 0);
  let pausedMs = (Number.isFinite(baseSec) ? Math.max(0, baseSec) : 0) * 1000;
  if (ticketIsTemporarySuspended(t)) {
    const susRaw = t?.suspendedAt ?? t?.suspended_at;
    if (susRaw) {
      const susMs = Date.parse(String(susRaw));
      if (!Number.isNaN(susMs)) {
        const endMs = ticketSlaEndMs(t, nowMs);
        pausedMs += Math.max(0, endMs - susMs);
      }
    }
  }
  return pausedMs;
}

/** 首页 SLA 列：终点 − 建单 − 挂起累计，格式 X天Y时Z分 */
function formatTicketSlaDhM(ticket, nowMs = Date.now()) {
  const startMs = ticketSlaStartMs(ticket);
  if (!startMs) return "--";
  const endMs = ticketSlaEndMs(ticket, nowMs);
  const pausedMs = ticketSlaPausedMs(ticket, nowMs);
  const delta = Math.max(0, endMs - startMs - pausedMs);
  const minutesTotal = Math.floor(delta / 60000);
  const days = Math.floor(minutesTotal / (60 * 24));
  const hours = Math.floor((minutesTotal % (60 * 24)) / 60);
  const minutes = minutesTotal % 60;
  return `${days}天${hours}时${minutes}分`;
}

function makeNewTicketId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const prefix = `YW${ymd}`;
  const key = "yw_ticket_seq_global";
  let last = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(last) || last < 0) last = -1;
  const next = (last + 1) % 1000;
  window.localStorage.setItem(key, String(next));
  return `${prefix}${String(next).padStart(3, "0")}`;
}

function makeNewHotpatchTicketId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const prefix = `HPM${ymd}`;
  const key = "hpm_ticket_seq_global";
  let last = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(last) || last < 0) last = -1;
  const next = (last + 1) % 1000;
  window.localStorage.setItem(key, String(next));
  return `${prefix}${String(next).padStart(3, "0")}`;
}

const _CREATE_DRAFT_TICKET_ID_PREFIX = "draft-";

function makeCreateDraftTicketId() {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `${_CREATE_DRAFT_TICKET_ID_PREFIX}${uuid}`;
}

function isCreateDraftTicketId(orderId) {
  const s = String(orderId || "").trim();
  return s.startsWith(_CREATE_DRAFT_TICKET_ID_PREFIX) && s.length > _CREATE_DRAFT_TICKET_ID_PREFIX.length;
}

function sortTicketsByCreatedAtDesc(items) {
  return [...items].sort((a, b) => {
    const diff = ticketCreatedAtMs(b) - ticketCreatedAtMs(a);
    if (diff !== 0) return diff;
    return String(b.orderId || "").localeCompare(String(a.orderId || ""), undefined, { numeric: true });
  });
}


function ticketListFilterDisplayValue(ticket, colKey) {
  switch (colKey) {
    case "currentStage": {
      const s = String((ticket.currentStage ?? ticket.node) || "").trim();
      return s || "（空）";
    }
    case "startDate": {
      const s = String(ticket.startDate || "").trim();
      return s || "（空）";
    }
    case "severity":
      return normalizeIssueSeverity(ticket.severity ?? ticket.priority);
    case "location": {
      const s = String(ticket.location || "").trim();
      return s || "（空）";
    }
    case "bizEnv": {
      const s = String(ticket.bizEnv || "").trim();
      return s || "（空）";
    }
    case "currentHandler": {
      const s = String(ticket.currentHandler ?? ticket.assignee ?? "").trim();
      return s || "（空）";
    }
    case "description":
      return listPreviewText(ticket.description || "--", 200);
    default:
      return "";
  }
}

function uniqueTicketListFilterValues(tickets, colKey) {
  const set = new Set();
  (tickets || []).forEach((t) => {
    const v = ticketListFilterDisplayValue(t, colKey);
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function filterTicketsByListColumnFilters(tickets, filters) {
  const sel = filters?.selected || {};
  const activeKeys = Object.keys(sel).filter((k) => (sel[k] || []).length > 0);
  return (tickets || []).filter((t) =>
    activeKeys.every((key) => {
      const picked = sel[key] || [];
      const val = ticketListFilterDisplayValue(t, key);
      return picked.includes(val);
    })
  );
}

/** ====== 测试用例 ====== */

describe('normalizeIssueSeverity', () => {
  test('TC-M13-001: 问题严重性规范化-中文输入', () => {
    expect(normalizeIssueSeverity("一般")).toBe("一般");
    expect(normalizeIssueSeverity("严重")).toBe("严重");
    expect(normalizeIssueSeverity("致命")).toBe("致命");
  });

  test('TC-M13-002: 问题严重性规范化-英文输入urgent', () => {
    expect(normalizeIssueSeverity("urgent")).toBe("致命");
  });

  test('TC-M13-003: 问题严重性规范化-high', () => {
    expect(normalizeIssueSeverity("high")).toBe("严重");
  });

  test('TC-M13-004: 问题严重性规范化-low', () => {
    expect(normalizeIssueSeverity("low")).toBe("一般");
    expect(normalizeIssueSeverity("medium")).toBe("一般");
  });

  test('TC-M13-005: 问题严重性规范化-空值', () => {
    expect(normalizeIssueSeverity("")).toBe("一般");
    expect(normalizeIssueSeverity(null)).toBe("一般");
    expect(normalizeIssueSeverity(undefined)).toBe("一般");
  });
});

describe('severityPillClass', () => {
  test('TC-M13-016: 严重性样式类-致命', () => {
    expect(severityPillClass("致命")).toBe("urgent");
    expect(severityPillClass("urgent")).toBe("urgent");
  });

  test('TC-M13-017: 严重性样式类-严重', () => {
    expect(severityPillClass("严重")).toBe("high");
    expect(severityPillClass("high")).toBe("high");
  });

  test('TC-M13-018: 严重性样式类-一般', () => {
    expect(severityPillClass("一般")).toBe("low");
    expect(severityPillClass("low")).toBe("low");
    expect(severityPillClass("medium")).toBe("low");
  });

  test('TC-M13-019: 严重性样式类-未知值', () => {
    expect(severityPillClass("未知")).toBe("medium");
    expect(severityPillClass("")).toBe("low");
  });
});

describe('listPreviewText', () => {
  test('TC-M13-006: 列表预览文本-正常截断', () => {
    const longText = "这是一段很长的文本需要截断显示，用于测试文本截断功能是否正常工作";
    const result = listPreviewText(longText, 20);
    expect(result).toBe("这是一段很长的文本需要截断显示，用于测试…");
    expect(result.length).toBe(21);
  });

  test('TC-M13-007: 列表预览文本-HTML标签过滤', () => {
    expect(listPreviewText("<div>test</div>")).toBe("test");
    expect(listPreviewText("<p>Hello <span>World</span></p>")).toBe("Hello World");
    expect(listPreviewText("<script>alert('xss')</script>")).toBe("alert('xss')");
  });

  test('TC-M13-020: 列表预览文本-空值处理', () => {
    expect(listPreviewText("")).toBe("--");
    expect(listPreviewText(null)).toBe("--");
  });

  test('TC-M13-021: 列表预览文本-不截断情况', () => {
    expect(listPreviewText("短文本")).toBe("短文本");
  });
});

describe('ticketDetailHeading', () => {
  test('拼接截断后的问题描述（无间隔符）', () => {
    const longDesc = "甲".repeat(100);
    expect(ticketDetailHeading({ orderId: "YW99996498202", description: longDesc }, 10)).toBe(
      `Order YW99996498202 ${"甲".repeat(10)}…`
    );
  });

  test('无问题描述时仅显示 Order 单号', () => {
    expect(ticketDetailHeading({ orderId: "YW20260402001", description: "" })).toBe("Order YW20260402001");
    expect(ticketDetailHeading({ orderId: "YW20260402001", description: "--" })).toBe("Order YW20260402001");
  });

  test('短描述不去截断', () => {
    expect(ticketDetailHeading({ orderId: "YW1", description: "连接超时" })).toBe("Order YW1 连接超时");
  });
});

describe('ticketCreatedAtMs', () => {
  test('TC-M13-022: 工单时间戳-createdAt字段', () => {
    const ticket = { createdAt: "2026-04-01T12:00:00.000Z" };
    const result = ticketCreatedAtMs(ticket);
    expect(result).toBe(Date.parse("2026-04-01T12:00:00.000Z"));
  });

  test('TC-M13-023: 工单时间戳-created_at字段', () => {
    const ticket = { created_at: "2026-04-02T08:30:00.000Z" };
    const result = ticketCreatedAtMs(ticket);
    expect(result).toBe(Date.parse("2026-04-02T08:30:00.000Z"));
  });

  test('TC-M13-024: 工单时间戳-startDate字段', () => {
    const ticket = { startDate: "2026-04-03" };
    const result = ticketCreatedAtMs(ticket);
    expect(result).toBe(Date.parse("2026-04-03T12:00:00"));
  });

  test('TC-M13-025: 工单时间戳-空值', () => {
    expect(ticketCreatedAtMs({})).toBe(0);
    expect(ticketCreatedAtMs({ createdAt: null })).toBe(0);
    expect(ticketCreatedAtMs(null)).toBe(0);
  });
});

describe('formatTicketSlaDhM', () => {
  test('TC-M13-008: SLA时间格式化-正常计算', () => {
    const ticket = { createdAt: new Date(Date.now() - 3600000).toISOString() };
    const result = formatTicketSlaDhM(ticket);
    expect(result).toMatch(/^0天1时.*分$/);
  });

  test('TC-M13-009: SLA时间格式化-空值处理', () => {
    expect(formatTicketSlaDhM({})).toBe("--");
    expect(formatTicketSlaDhM({ createdAt: null })).toBe("--");
    expect(formatTicketSlaDhM(null)).toBe("--");
  });

  test('TC-M13-026: SLA时间格式化-多天计算', () => {
    const ticket = { createdAt: new Date(Date.now() - 86400000 * 2 - 3600000 * 5).toISOString() };
    const result = formatTicketSlaDhM(ticket);
    expect(result).toMatch(/^2天.*时.*分$/);
  });

  test('TC-M13-027a: SLA时间格式化-已关闭取closedAt', () => {
    const createdAt = "2026-01-01T00:00:00Z";
    const closedAt = "2026-01-03T12:00:00Z";
    const nowMs = Date.parse("2026-06-01T00:00:00Z");
    const result = formatTicketSlaDhM({ createdAt, closedAt, status: "closed" }, nowMs);
    expect(result).toBe("2天12时0分");
  });

  test('TC-M13-027c: SLA时间格式化-挂起中扣当前挂起段', () => {
    const createdAt = "2026-01-01T12:00:00Z";
    const suspendedAt = "2026-01-01T13:00:00Z";
    const nowMs = Date.parse("2026-01-01T13:30:00Z");
    const result = formatTicketSlaDhM(
      { createdAt, suspendedAt, status: "suspended", currentStage: "暂时挂起" },
      nowMs
    );
    expect(result).toBe("0天1时0分");
  });

  test('TC-M13-027d: SLA时间格式化-关单扣除已累计挂起时长', () => {
    // 12:00 建单 → 13:00 挂起 → 14:00 解除 → 15:00 关单 => 2h
    const createdAt = "2026-01-01T12:00:00Z";
    const closedAt = "2026-01-01T15:00:00Z";
    const nowMs = Date.parse("2026-01-02T00:00:00Z");
    const result = formatTicketSlaDhM(
      { createdAt, closedAt, status: "closed", slaPausedSeconds: 3600 },
      nowMs
    );
    expect(result).toBe("0天2时0分");
  });

  test('TC-M13-027b: SLA时间格式化-不回退startDate', () => {
    const ticket = { startDate: "2020-01-01" };
    expect(formatTicketSlaDhM(ticket)).toBe("--");
  });
});

describe('makeNewTicketId', () => {
  test('TC-M13-010: 工单编号生成-格式正确性', () => {
    window.localStorage.getItem.mockReturnValue("-1");
    const result = makeNewTicketId();
    const regex = /^YW\d{8}\d{3}$/;
    expect(result).toMatch(regex);
    expect(result.startsWith("YW")).toBe(true);
  });

  test('TC-M13-027: 工单编号生成-序列号递增', () => {
    window.localStorage.getItem.mockReturnValue("5");
    const result = makeNewTicketId();
    expect(result.endsWith("006")).toBe(true);
  });
});

describe('makeCreateDraftTicketId', () => {
  test('TC-M13-040: 创建草稿 ID 为 draft-uuid', () => {
    global.crypto = { randomUUID: () => '550e8400-e29b-41d4-a716-446655440000' };
    const result = makeCreateDraftTicketId();
    expect(result).toBe('draft-550e8400-e29b-41d4-a716-446655440000');
    expect(isCreateDraftTicketId(result)).toBe(true);
    expect(isCreateDraftTicketId('YW20260625001')).toBe(false);
  });
});

describe('makeNewHotpatchTicketId', () => {
  test('TC-M13-038: 热补丁流程号-格式 HPM+日期+三位', () => {
    window.localStorage.getItem.mockReturnValue("-1");
    const result = makeNewHotpatchTicketId();
    expect(result).toMatch(/^HPM\d{8}\d{3}$/);
    expect(result.startsWith("HPM")).toBe(true);
    expect(result.length).toBe(14);
  });

  test('TC-M13-039: 热补丁流程号-序列与 YW 分 key 递增', () => {
    window.localStorage.getItem.mockImplementation((k) => {
      if (k === "hpm_ticket_seq_global") return "7";
      return "-1";
    });
    const hpm = makeNewHotpatchTicketId();
    expect(hpm.endsWith("008")).toBe(true);
    window.localStorage.getItem.mockImplementation((k) => {
      if (k === "yw_ticket_seq_global") return "2";
      return "-1";
    });
    const yw = makeNewTicketId();
    expect(yw.endsWith("003")).toBe(true);
  });
});

describe('sortTicketsByCreatedAtDesc', () => {
  test('TC-M13-011: 工单列表排序-按创建时间降序', () => {
    const tickets = [
      { orderId: "1001", createdAt: "2026-04-01T12:00:00.000Z" },
      { orderId: "1002", createdAt: "2026-04-03T12:00:00.000Z" },
      { orderId: "1003", createdAt: "2026-04-02T12:00:00.000Z" },
    ];
    const result = sortTicketsByCreatedAtDesc(tickets);
    expect(result[0].orderId).toBe("1002");
    expect(result[1].orderId).toBe("1003");
    expect(result[2].orderId).toBe("1001");
  });

  test('TC-M13-028: 工单列表排序-相同时间按编号降序', () => {
    const sameTime = "2026-04-01T12:00:00.000Z";
    const tickets = [
      { orderId: "1001", createdAt: sameTime },
      { orderId: "1003", createdAt: sameTime },
      { orderId: "1002", createdAt: sameTime },
    ];
    const result = sortTicketsByCreatedAtDesc(tickets);
    expect(result[0].orderId).toBe("1003");
    expect(result[1].orderId).toBe("1002");
    expect(result[2].orderId).toBe("1001");
  });
});

describe('ticketListFilterDisplayValue', () => {
  test('TC-M13-029: 筛选显示值-currentStage', () => {
    const ticket = { currentStage: "开发闭环" };
    expect(ticketListFilterDisplayValue(ticket, "currentStage")).toBe("开发闭环");
  });

  test('TC-M13-030: 筛选显示值-severity', () => {
    const ticket = { severity: "urgent" };
    expect(ticketListFilterDisplayValue(ticket, "severity")).toBe("致命");
  });

  test('TC-M13-031: 筛选显示值-location', () => {
    const ticket = { location: "华东-上海" };
    expect(ticketListFilterDisplayValue(ticket, "location")).toBe("华东-上海");
  });

  test('TC-M13-032: 筛选显示值-空字段', () => {
    const ticket = { currentStage: "" };
    expect(ticketListFilterDisplayValue(ticket, "currentStage")).toBe("（空）");
  });
});

describe('uniqueTicketListFilterValues', () => {
  test('TC-M13-033: 筛选值去重-正常', () => {
    const tickets = [
      { currentStage: "开发闭环", severity: "致命" },
      { currentStage: "问题审核", severity: "严重" },
      { currentStage: "开发闭环", severity: "一般" },
    ];
    const result = uniqueTicketListFilterValues(tickets, "currentStage");
    expect(result).toEqual(["开发闭环", "问题审核"]);
  });

  test('TC-M13-034: 筛选值去重-包含空值', () => {
    const tickets = [
      { currentStage: "开发闭环" },
      { currentStage: "" },
      { currentStage: "问题审核" },
    ];
    const result = uniqueTicketListFilterValues(tickets, "currentStage");
    expect(result).toEqual(["（空）", "开发闭环", "问题审核"]);
  });
});

describe('filterTicketsByListColumnFilters', () => {
  test('TC-M13-012: 工单过滤-按阶段筛选', () => {
    const tickets = [
      { orderId: "1001", currentStage: "开发闭环" },
      { orderId: "1002", currentStage: "问题审核" },
      { orderId: "1003", currentStage: "开发闭环" },
    ];
    const filters = { selected: { currentStage: ["开发闭环"] } };
    const result = filterTicketsByListColumnFilters(tickets, filters);
    expect(result).toHaveLength(2);
    expect(result.every(t => t.currentStage === "开发闭环")).toBe(true);
  });

  test('TC-M13-035: 工单过滤-多条件筛选', () => {
    const tickets = [
      { orderId: "1001", currentStage: "开发闭环", severity: "致命" },
      { orderId: "1002", currentStage: "问题审核", severity: "严重" },
      { orderId: "1003", currentStage: "开发闭环", severity: "一般" },
    ];
    const filters = { selected: { currentStage: ["开发闭环"], severity: ["致命"] } };
    const result = filterTicketsByListColumnFilters(tickets, filters);
    expect(result).toHaveLength(1);
    expect(result[0].orderId).toBe("1001");
  });

  test('TC-M13-036: 工单过滤-无筛选条件', () => {
    const tickets = [
      { orderId: "1001", currentStage: "开发闭环" },
      { orderId: "1002", currentStage: "问题审核" },
    ];
    const filters = { selected: {} };
    const result = filterTicketsByListColumnFilters(tickets, filters);
    expect(result).toHaveLength(2);
  });

  test('TC-M13-037: 工单过滤-空筛选条件', () => {
    const tickets = [
      { orderId: "1001", currentStage: "开发闭环" },
    ];
    const result = filterTicketsByListColumnFilters(tickets, null);
    expect(result).toHaveLength(1);
  });
});