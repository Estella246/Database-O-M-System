/**
 * 前端统计页面辅助函数单元测试
 * 对应模块：frontend/modules/pages/stats.js
 */

function statLaborHash(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) h = Math.imul(31, h) + str.charCodeAt(i) || 0;
  return Math.abs(h);
}

function statLaborRand(seed, i) {
  const x = Math.sin(statLaborHash(String(seed)) + i * 999.983) * 10000;
  return x - Math.floor(x);
}

function statLaborSeriesInt(seed, n, minV, maxV) {
  return Array.from({ length: n }, (_, i) => {
    const r = statLaborRand(seed, i);
    return minV + Math.floor(r * (maxV - minV + 1));
  });
}

function statLaborBarEntriesDesc(record) {
  const entries = Object.entries(record || {}).map(([label, raw]) => [label, Number(raw) || 0]);
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return String(a[0]).localeCompare(String(b[0]), "zh-CN");
  });
  return {
    labels: entries.map(([label]) => label),
    values: entries.map(([, value]) => value),
  };
}

function statLaborBarTopRoundPath(x, y, w, h, rMax) {
  const hh = Math.max(h, 0);
  if (hh < 0.5) return "";
  const rr = Math.min(Math.max(rMax, 0), w / 2, hh / 2, 9);
  if (rr < 0.75) {
    return `M${x},${y + hh}L${x},${y}L${x + w},${y}L${x + w},${y + hh}Z`;
  }
  return `M${x},${y + hh}L${x},${y + rr}Q${x},${y} ${x + rr},${y}L${x + w - rr},${y}Q${x + w},${y} ${x + w},${y + rr}L${x + w},${y + hh}Z`;
}

function getStatsReportPeriodBounds(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "week": {
      const dow = today.getDay();
      const monOffset = dow === 0 ? -6 : 1 - dow;
      const start = new Date(today);
      start.setDate(today.getDate() + monOffset);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }
    case "biweek": {
      const end = new Date(today);
      const start = new Date(today);
      start.setDate(today.getDate() - 13);
      return { start, end };
    }
    case "month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start, end };
    }
    case "quarter": {
      const q = Math.floor(today.getMonth() / 3);
      const start = new Date(today.getFullYear(), q * 3, 1);
      const end = new Date(today.getFullYear(), q * 3 + 3, 0);
      return { start, end };
    }
    case "year": {
      const start = new Date(today.getFullYear(), 0, 1);
      const end = new Date(today.getFullYear(), 12, 0);
      return { start, end };
    }
    default:
      return { start: today, end: today };
  }
}

function statReportMix(period, salt) {
  let h = salt * 1315423911;
  const s = `${period}:${salt}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  return ((h >>> 0) % 10000) / 10000;
}

function statsNormalizePersonName(raw) {
  const base = String(raw || "").trim();
  if (!base) return "";
  const compact = base.replace(/[()（）]/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const accountLike = (token) => /^[a-zA-Z]\d{6,}$/.test(String(token || "").trim());
  const tokens = compact.split(" ").filter(Boolean);
  if (!tokens.length) return compact;
  const nonAccountTokens = tokens.filter((t) => !accountLike(t));
  if (nonAccountTokens.length && nonAccountTokens.length !== tokens.length) {
    return nonAccountTokens.join(" ");
  }
  const withoutSuffix = compact.replace(/[\s·_-]*[a-zA-Z]\d{6,}$/i, "").trim();
  if (withoutSuffix) return withoutSuffix;
  return compact;
}

function statsTicketPersonName(ticket) {
  const raw = String(ticket?.currentHandler || ticket?.assignee || ticket?.creatorName || "").trim();
  return statsNormalizePersonName(raw) || "未分配";
}

function statsTicketStage(ticket) {
  const st = String(ticket?.status || "").trim().toLowerCase();
  if (st === "closed") return "关闭";
  if (st === "suspended") return "暂时挂起";
  return String(ticket?.currentStage || ticket?.node || "").trim() || "问题审核";
}

function statsTicketIsQuality(ticket) {
  const sev = String(ticket?.severity || "").trim();
  return sev === "严重" || sev === "致命";
}

function statsTicketQualityIssueValue(ticket) {
  const raw = String(ticket?.isQualityIssue ?? ticket?.is_quality_issue ?? "").trim();
  if (!raw) return "";
  if (raw.includes("新发现")) return "new";
  if (raw.includes("已知")) return "known";
  if (raw === "否") return "no";
  if (raw === "是") return "known";
  return "";
}

function statsFilterOwnershipRows(rows, quality = "all", component = "all") {
  let scoped = rows || [];
  const comp = String(component || "all").trim();
  if (comp !== "all") {
    scoped = scoped.filter((t) => statsTicketComponent(t) === comp);
  }
  const qf = String(quality || "all").trim();
  if (qf === "all") return scoped;
  return scoped.filter((t) => {
    const v = statsTicketQualityIssueValue(t);
    if (!v) return false;
    if (qf === "yes") return v === "known" || v === "new";
    if (qf === "known" || qf === "new" || qf === "no") return v === qf;
    return true;
  });
}

function statsTicketComponent(ticket) {
  const raw = String(ticket?.component || ticket?.problemComponent || "").trim();
  if (raw.includes("内核")) return "kernel";
  if (raw.includes("管控")) return "control";
  const desc = String(ticket?.description || "");
  if (desc.includes("内核")) return "kernel";
  if (desc.includes("管控")) return "control";
  return "all";
}

function statsTicketVersion(ticket) {
  const gauss = String(ticket?.gauss_version ?? ticket?.gaussVersion ?? "").trim();
  if (gauss) return gauss;
  const direct = String(ticket?.hcsVersion || ticket?.version || "").trim();
  if (direct) return direct;
  const desc = String(ticket?.description || "");
  const m = desc.match(/(\d+\.\d+(?:\.\d+)?(?:\.SPC\d+)?)/);
  if (m) return m[1];
  return "未知版本";
}

function statsOwnershipModuleKind(raw) {
  return raw === "owner" ? "owner" : "intro";
}

function statsDedupeTicketsByDts(rows) {
  const seen = new Set();
  const out = [];
  (rows || []).forEach((t) => {
    const dts = String(t?.dts_no ?? "").trim();
    if (dts) {
      if (seen.has(dts)) return;
      seen.add(dts);
    }
    out.push(t);
  });
  return out;
}

function statsIsSpcGaussVersion(ver) {
  const s = String(ver || "").trim();
  return /SPC/i.test(s) || /\.B\d/i.test(s);
}

function statsIsCoreCGaussVersion(ver) {
  const s = String(ver || "").trim();
  if (!s || statsIsSpcGaussVersion(s)) return false;
  return /^\d+\.\d+\.\d+/.test(s);
}

function statsTopCountEntries(mapOrEntries, limit = 10) {
  const entries = mapOrEntries instanceof Map ? Array.from(mapOrEntries.entries()) : mapOrEntries;
  return entries.sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, Math.max(1, limit));
}

function buildStatsOwnershipL1BarData(rows, kind = "intro", l1Label = "", dtsDedup = false) {
  const moduleKind = statsOwnershipModuleKind(kind);
  let scoped = rows || [];
  const l1 = String(l1Label || "").trim();
  if (l1) {
    scoped = scoped.filter((t) => statsParseModulePathLevels(statsTicketModulePath(t, moduleKind)).l1 === l1);
  }
  if (dtsDedup) scoped = statsDedupeTicketsByDts(scoped);
  return statsTopCountEntries(
    statsCountBy(scoped, (t) => statsParseModulePathLevels(statsTicketModulePath(t, moduleKind)).l2),
    20
  ).map(([name, value]) => ({ name, value }));
}

function buildStatsOwnershipTopModuleBarData(rows, kind = "intro", limit = 10) {
  const moduleKind = statsOwnershipModuleKind(kind);
  const counts = statsCountBy(rows || [], (t) => {
    const path = statsTicketModulePath(t, moduleKind);
    if (!path) return null;
    const { l1 } = statsParseModulePathLevels(path);
    return l1 === "未填写" ? null : l1;
  });
  return statsTopCountEntries(counts, limit).map(([name, value]) => ({ name, value }));
}

function buildStatsOwnershipSpcBarData(rows, { openOnly = false, limit = 10 } = {}) {
  let scoped = rows || [];
  if (openOnly) scoped = scoped.filter((t) => String(t?.status || "").toLowerCase() !== "closed");
  const filtered = scoped.filter((t) => statsIsSpcGaussVersion(statsTicketVersion(t)));
  return statsTopCountEntries(statsCountBy(filtered, (t) => statsTicketVersion(t)), limit).map(([name, value]) => ({
    name,
    value,
  }));
}

function buildStatsOwnershipCoreBarData(rows, limit = 10) {
  const filtered = (rows || []).filter((t) => statsIsCoreCGaussVersion(statsTicketVersion(t)));
  return statsTopCountEntries(statsCountBy(filtered, (t) => statsTicketVersion(t)), limit).map(([name, value]) => ({
    name,
    value,
  }));
}

function buildStatsOwnershipHotspotTableData(rows, kind = "intro", { moduleLimit = 8, versionLimit = 5 } = {}) {
  const moduleKind = statsOwnershipModuleKind(kind);
  const byL1 = statsCountBy(rows || [], (t) => {
    const path = statsTicketModulePath(t, moduleKind);
    if (!path) return null;
    const { l1 } = statsParseModulePathLevels(path);
    return l1 === "未填写" ? null : l1;
  });
  const moduleRows = statsTopCountEntries(byL1, moduleLimit).map(([name]) => name);
  const versionCols = statsTopCountEntries(
    statsCountBy(rows || [], (t) => {
      const ver = statsTicketVersion(t);
      return ver === "未知版本" ? null : ver;
    }),
    versionLimit
  ).map(([name]) => name);
  const cells = moduleRows.map((l1) => {
    const rowTickets = (rows || []).filter(
      (t) => statsParseModulePathLevels(statsTicketModulePath(t, moduleKind)).l1 === l1
    );
    const counts = versionCols.map((ver) => rowTickets.filter((t) => statsTicketVersion(t) === ver).length);
    return { l1, counts };
  });
  return { moduleRows, versionCols, cells };
}

function statsCountBy(rows, keyFn) {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!k) return;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}

function statsTicketModulePath(ticket, kind = "intro") {
  const key = kind === "owner" ? "issue_owner_module" : "issue_intro_module";
  return String(ticket?.[key] ?? "").trim();
}

function statsParseModulePathLevels(path) {
  const s = String(path || "").trim();
  if (!s) return { l1: "未填写", l2: "未填写", l3: "未填写" };
  const parts = s.split("/").map((p) => p.trim()).filter(Boolean);
  return {
    l1: parts[0] || "未填写",
    l2: parts.length >= 2 ? parts[1] : "未填写",
    l3: parts.length >= 3 ? parts[2] : "未填写",
  };
}

function statsSunburstBranchCount(l3Map) {
  let n = 0;
  l3Map.forEach((v) => {
    n += v;
  });
  return n;
}

function statsSunburstModuleParts(path) {
  return String(path || "")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "未填写");
}

function buildStatsOwnershipSunburstData(rows, kind = "intro") {
  const l1Map = new Map();
  (rows || []).forEach((t) => {
    const parts = statsSunburstModuleParts(statsTicketModulePath(t, kind));
    if (!parts.length) return;
    const [l1, l2, l3] = parts;
    if (!l1Map.has(l1)) l1Map.set(l1, new Map());
    const l2Map = l1Map.get(l1);
    if (parts.length === 1) {
      if (!l2Map.has("__leaf__")) l2Map.set("__leaf__", new Map());
      const l3Map = l2Map.get("__leaf__");
      l3Map.set("__leaf__", (l3Map.get("__leaf__") || 0) + 1);
      return;
    }
    if (parts.length === 2) {
      if (!l2Map.has(l2)) l2Map.set(l2, new Map());
      const l3Map = l2Map.get(l2);
      l3Map.set("__leaf__", (l3Map.get("__leaf__") || 0) + 1);
      return;
    }
    if (!l2Map.has(l2)) l2Map.set(l2, new Map());
    const l3Map = l2Map.get(l2);
    l3Map.set(l3, (l3Map.get(l3) || 0) + 1);
  });

  const branchCount = (l3Map) => {
    let n = 0;
    l3Map.forEach((v) => {
      n += v;
    });
    return n;
  };

  const l1Total = (l2Map) => {
    let n = 0;
    l2Map.forEach((l3Map) => {
      n += branchCount(l3Map);
    });
    return n;
  };

  const l3Nodes = (l3Map) =>
    Array.from(l3Map.entries())
      .filter(([name]) => name !== "__leaf__")
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

  const l2Nodes = (l2Map) => {
    const out = [];
    Array.from(l2Map.entries())
      .filter(([name]) => name !== "__leaf__")
      .sort((a, b) => branchCount(b[1]) - branchCount(a[1]))
      .forEach(([name, l3Map]) => {
        const children = l3Nodes(l3Map);
        const leafAtL2 = l3Map.get("__leaf__") || 0;
        if (children.length) out.push({ name, children });
        else if (leafAtL2) out.push({ name, value: leafAtL2 });
      });
    return out;
  };

  return Array.from(l1Map.entries())
    .sort((a, b) => l1Total(b[1]) - l1Total(a[1]))
    .map(([l1, l2Map]) => {
      const leafL1 = (l2Map.get("__leaf__") || new Map()).get("__leaf__") || 0;
      const children = l2Nodes(l2Map);
      if (children.length) return { name: l1, children };
      if (leafL1) return { name: l1, value: leafL1 };
      return null;
    })
    .filter(Boolean);
}

function statsFindAdminUserByPerson(raw, adminUsers) {
  const name = String(raw || "").trim();
  if (!name) return null;
  const normalized = statsNormalizePersonName(name);
  const users = Array.isArray(adminUsers) ? adminUsers : [];
  return (
    users.find((u) => {
      const userName = String(u.user_name || "").trim();
      const account = String(u.account || "").trim();
      const userNameNormalized = statsNormalizePersonName(userName);
      return userName === name || account === name || userNameNormalized === normalized || account === normalized;
    }) || null
  );
}

function getStatsLaborProductLineOptions(adminUsers) {
  const set = new Set();
  (Array.isArray(adminUsers) ? adminUsers : []).forEach((u) => {
    const pl = String(u.product_line || "").trim();
    if (pl) set.add(pl);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function statsUserProductLineByPerson(raw, adminUsers) {
  const hit = statsFindAdminUserByPerson(raw, adminUsers);
  return hit ? String(hit.product_line || "").trim() : "";
}

function statsTicketMatchesLaborProductLine(ticket, productLineFilter, adminUsers) {
  const filter = String(productLineFilter || "").trim();
  if (!filter) return true;
  const raw = String(ticket?.currentHandler || ticket?.assignee || ticket?.creatorName || "").trim();
  return statsUserProductLineByPerson(raw, adminUsers) === filter;
}

function renderUploadKpiCard(label, value, unit) {
  return `
    <div class="upload-kpi-card">
      <div class="upload-kpi-label">${label}</div>
      <div class="upload-kpi-value">${String(value)}${unit ? `<span class="upload-kpi-unit">${unit}</span>` : ""}</div>
    </div>
  `;
}

describe("statLaborHash", () => {
  test("返回正整数", () => {
    expect(statLaborHash("test")).toBeGreaterThan(0);
    expect(Number.isInteger(statLaborHash("test"))).toBe(true);
  });

  test("相同输入返回相同结果", () => {
    expect(statLaborHash("abc")).toBe(statLaborHash("abc"));
  });

  test("不同输入返回不同结果", () => {
    expect(statLaborHash("abc")).not.toBe(statLaborHash("xyz"));
  });
});

describe("statLaborRand", () => {
  test("返回0到1之间的数", () => {
    for (let i = 0; i < 20; i++) {
      const v = statLaborRand("seed", i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("相同种子返回相同结果", () => {
    expect(statLaborRand("seed", 0)).toBe(statLaborRand("seed", 0));
  });
});

describe("statLaborSeriesInt", () => {
  test("返回指定长度的数组", () => {
    const result = statLaborSeriesInt("seed", 5, 0, 10);
    expect(result).toHaveLength(5);
  });

  test("值在指定范围内", () => {
    const result = statLaborSeriesInt("seed", 20, 3, 8);
    result.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
    });
  });
});

describe("statLaborBarEntriesDesc", () => {
  test("按数值从大到小排序", () => {
    const { labels, values } = statLaborBarEntriesDesc({ 张三: 3, 李四: 8, 王五: 5 });
    expect(labels).toEqual(["李四", "王五", "张三"]);
    expect(values).toEqual([8, 5, 3]);
  });

  test("空对象返回空数组", () => {
    const { labels, values } = statLaborBarEntriesDesc({});
    expect(labels).toEqual([]);
    expect(values).toEqual([]);
  });

  test("数值相同时按标签名排序", () => {
    const { labels } = statLaborBarEntriesDesc({ 王五: 2, 张三: 2, 李四: 2 });
    expect(labels).toEqual(["李四", "王五", "张三"]);
  });
});

describe("statLaborBarTopRoundPath", () => {
  test("高度为0返回空字符串", () => {
    expect(statLaborBarTopRoundPath(0, 0, 20, 0, 6)).toBe("");
  });

  test("正常高度返回SVG路径", () => {
    const path = statLaborBarTopRoundPath(10, 20, 30, 40, 6);
    expect(path).toContain("M");
    expect(path).toContain("Z");
  });

  test("小高度不使用圆角", () => {
    const path = statLaborBarTopRoundPath(0, 0, 20, 0.3, 6);
    expect(path).not.toContain("Q");
  });
});

describe("getStatsReportPeriodBounds", () => {
  test("week返回7天范围", () => {
    const { start, end } = getStatsReportPeriodBounds("week");
    const diff = (end - start) / (1000 * 60 * 60 * 24);
    expect(diff).toBe(6);
  });

  test("biweek返回14天范围", () => {
    const { start, end } = getStatsReportPeriodBounds("biweek");
    const diff = (end - start) / (1000 * 60 * 60 * 24);
    expect(diff).toBe(13);
  });

  test("month返回当月范围", () => {
    const { start, end } = getStatsReportPeriodBounds("month");
    expect(start.getDate()).toBe(1);
  });

  test("year返回当年范围", () => {
    const { start, end } = getStatsReportPeriodBounds("year");
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });

  test("未知period返回当天", () => {
    const { start, end } = getStatsReportPeriodBounds("unknown");
    expect(start.getTime()).toBe(end.getTime());
  });
});

describe("statReportMix", () => {
  test("返回0到1之间的数", () => {
    const v = statReportMix("week", 42);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  test("相同参数返回相同结果", () => {
    expect(statReportMix("week", 42)).toBe(statReportMix("week", 42));
  });
});

describe("statsNormalizePersonName", () => {
  test("空值返回空字符串", () => {
    expect(statsNormalizePersonName("")).toBe("");
    expect(statsNormalizePersonName(null)).toBe("");
  });

  test("纯姓名直接返回", () => {
    expect(statsNormalizePersonName("张三")).toBe("张三");
  });

  test("去除账号后缀", () => {
    expect(statsNormalizePersonName("张三 A123456")).toBe("张三");
  });

  test("去除括号", () => {
    expect(statsNormalizePersonName("张三(A123456)")).toBe("张三");
  });
});

describe("statsTicketPersonName", () => {
  test("从currentHandler取值", () => {
    expect(statsTicketPersonName({ currentHandler: "李四" })).toBe("李四");
  });

  test("空值返回未分配", () => {
    expect(statsTicketPersonName({})).toBe("未分配");
  });
});

describe("statsTicketStage", () => {
  test("closed返回关闭", () => {
    expect(statsTicketStage({ status: "closed" })).toBe("关闭");
  });

  test("suspended返回暂时挂起", () => {
    expect(statsTicketStage({ status: "suspended" })).toBe("暂时挂起");
  });

  test("空值返回问题审核", () => {
    expect(statsTicketStage({})).toBe("问题审核");
  });
});

describe("statsTicketIsQuality", () => {
  test("严重返回true", () => {
    expect(statsTicketIsQuality({ severity: "严重" })).toBe(true);
  });

  test("致命返回true", () => {
    expect(statsTicketIsQuality({ severity: "致命" })).toBe(true);
  });

  test("一般返回false", () => {
    expect(statsTicketIsQuality({ severity: "一般" })).toBe(false);
  });
});

describe("statsTicketQualityIssueValue", () => {
  test("新发现返回new", () => {
    expect(statsTicketQualityIssueValue({ isQualityIssue: "新发现" })).toBe("new");
  });

  test("已知返回known", () => {
    expect(statsTicketQualityIssueValue({ isQualityIssue: "已知" })).toBe("known");
  });

  test("否返回no", () => {
    expect(statsTicketQualityIssueValue({ isQualityIssue: "否" })).toBe("no");
  });

  test("空值返回空字符串", () => {
    expect(statsTicketQualityIssueValue({})).toBe("");
  });
});

describe("statsFilterOwnershipRows", () => {
  const rows = [
    {
      orderId: "1",
      isQualityIssue: "是（已知质量问题）",
      issue_intro_module: "存储引擎/A/B",
      component: "内核问题",
    },
    {
      orderId: "2",
      isQualityIssue: "是（新发现质量问题）",
      issue_intro_module: "SQL引擎/C/D",
      component: "内核问题",
    },
    { orderId: "3", isQualityIssue: "否", issue_intro_module: "存储引擎/E/F", component: "管控问题" },
  ];

  test("全部质量问题 yes", () => {
    expect(statsFilterOwnershipRows(rows, "yes", "all")).toHaveLength(2);
  });

  test("已知质量问题 known", () => {
    expect(statsFilterOwnershipRows(rows, "known", "all")).toHaveLength(1);
  });

  test("内核组件筛选", () => {
    expect(statsFilterOwnershipRows(rows, "all", "kernel")).toHaveLength(2);
  });

  test("质量问题且内核", () => {
    expect(statsFilterOwnershipRows(rows, "yes", "kernel")).toHaveLength(2);
  });

  test("筛选后可生成旭日图", () => {
    const filtered = statsFilterOwnershipRows(rows, "yes", "all");
    const sun = buildStatsOwnershipSunburstData(filtered, "intro");
    expect(sun.some((n) => n.name === "存储引擎")).toBe(true);
    expect(sun.some((n) => n.name === "SQL引擎")).toBe(true);
  });
});

describe("statsTicketComponent", () => {
  test("内核返回kernel", () => {
    expect(statsTicketComponent({ component: "内核" })).toBe("kernel");
  });

  test("管控返回control", () => {
    expect(statsTicketComponent({ component: "管控" })).toBe("control");
  });

  test("description中匹配", () => {
    expect(statsTicketComponent({ description: "内核问题" })).toBe("kernel");
  });

  test("无匹配返回all", () => {
    expect(statsTicketComponent({})).toBe("all");
  });
});

describe("statsTicketVersion", () => {
  test("内核版本 gauss_version 优先", () => {
    expect(statsTicketVersion({ gauss_version: "505.2.1.SPC0800", hcsVersion: "505.2.0" })).toBe("505.2.1.SPC0800");
  });

  test("直接版本号", () => {
    expect(statsTicketVersion({ hcsVersion: "505.2.0" })).toBe("505.2.0");
  });

  test("从description提取版本号", () => {
    expect(statsTicketVersion({ description: "版本505.1.0问题" })).toBe("505.1.0");
  });

  test("无版本返回未知版本", () => {
    expect(statsTicketVersion({})).toBe("未知版本");
  });
});

describe("statsCountBy", () => {
  test("统计频次", () => {
    const rows = [{ t: "a" }, { t: "b" }, { t: "a" }];
    const m = statsCountBy(rows, (r) => r.t);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(1);
  });

  test("空数组返回空Map", () => {
    const m = statsCountBy([], (r) => r);
    expect(m.size).toBe(0);
  });

  test("keyFn返回空值跳过", () => {
    const rows = [{ t: "a" }, { t: "" }, { t: "a" }];
    const m = statsCountBy(rows, (r) => r.t || null);
    expect(m.size).toBe(1);
    expect(m.get("a")).toBe(2);
  });
});

describe("renderUploadKpiCard", () => {
  test("无单位渲染", () => {
    const html = renderUploadKpiCard("总数", 42, "");
    expect(html).toContain("总数");
    expect(html).toContain("42");
    expect(html).not.toContain("upload-kpi-unit");
  });

  test("有单位渲染", () => {
    const html = renderUploadKpiCard("时长", 5, "h");
    expect(html).toContain("5");
    expect(html).toContain("h");
    expect(html).toContain("upload-kpi-unit");
  });
});

// Doer统计分类函数
function statsTicketDoerAssistCategory(ticketNodeData) {
  const val = ticketNodeData?.ops_analysis?.use_doer_assist || "";
  if (val === "使用Doer，问题定位/解决") return "doer_resolved";
  if (val === "使用Doer，仅提供思路/辅助提效") return "doer_helped";
  if (val === "使用Doer，无帮助") return "doer_no_help";
  if (val === "未使用Doer") return "no_doer";
  if (val === "紧急疑难工单") return "urgent_hard";
  // 如果 ops_analysis 节点不存在或字段为空，返回 "not_filled"
  if (!ticketNodeData?.ops_analysis || val === "") return "not_filled";
  return "unknown";
}

// Doer使用情况优先级定义（数值越大优先级越高）
const STAT_DOER_CATEGORY_PRIORITY = {
  doer_resolved: 5,
  doer_helped: 4,
  doer_no_help: 3,
  no_doer: 2,
  urgent_hard: 2,
  not_filled: 1,
  unknown: 0,
};

// 单阶段分类函数（内部使用）
function classifySinglePhaseDoerAssist(phaseNodeData) {
  const val = phaseNodeData?.use_doer_assist || "";
  if (val === "使用Doer，问题定位/解决") return "doer_resolved";
  if (val === "使用Doer，仅提供思路/辅助提效") return "doer_helped";
  if (val === "使用Doer，无帮助") return "doer_no_help";
  if (val === "未使用Doer") return "no_doer";
  if (val === "紧急疑难工单") return "urgent_hard";
  if (!phaseNodeData || val === "") return "not_filled";
  return "unknown";
}

// 多阶段Doer分类函数：支持运维分析和开发分析两阶段，向上取整取优先级最高值
function statsTicketDoerAssistCategoryMulti(ticketNodeData, includeOps, includeDev) {
  const categories = [];
  if (includeOps) categories.push(classifySinglePhaseDoerAssist(ticketNodeData?.ops_analysis));
  if (includeDev) categories.push(classifySinglePhaseDoerAssist(ticketNodeData?.dev_analysis));
  if (categories.length === 0) return "unknown";
  // 向上取整：取优先级最高的值
  let maxPriority = -1;
  let bestCategory = "unknown";
  for (const cat of categories) {
    const priority = STAT_DOER_CATEGORY_PRIORITY[cat] || 0;
    if (priority > maxPriority) {
      maxPriority = priority;
      bestCategory = cat;
    }
  }
  return bestCategory;
}

describe("statsTicketDoerAssistCategory", () => {
  test("使用Doer，问题定位/解决 返回 doer_resolved", () => {
    expect(statsTicketDoerAssistCategory({ ops_analysis: { use_doer_assist: "使用Doer，问题定位/解决" } })).toBe("doer_resolved");
  });

  test("使用Doer，仅提供思路/辅助提效 返回 doer_helped", () => {
    expect(statsTicketDoerAssistCategory({ ops_analysis: { use_doer_assist: "使用Doer，仅提供思路/辅助提效" } })).toBe("doer_helped");
  });

  test("使用Doer，无帮助 返回 doer_no_help", () => {
    expect(statsTicketDoerAssistCategory({ ops_analysis: { use_doer_assist: "使用Doer，无帮助" } })).toBe("doer_no_help");
  });

  test("未使用Doer 返回 no_doer", () => {
    expect(statsTicketDoerAssistCategory({ ops_analysis: { use_doer_assist: "未使用Doer" } })).toBe("no_doer");
  });

  test("紧急疑难工单 返回 urgent_hard", () => {
    expect(statsTicketDoerAssistCategory({ ops_analysis: { use_doer_assist: "紧急疑难工单" } })).toBe("urgent_hard");
  });

  test("空值返回 not_filled", () => {
    expect(statsTicketDoerAssistCategory({})).toBe("not_filled");
    expect(statsTicketDoerAssistCategory(null)).toBe("not_filled");
    expect(statsTicketDoerAssistCategory({ ops_analysis: {} })).toBe("not_filled");
  });

  test("空字符串返回 not_filled", () => {
    expect(statsTicketDoerAssistCategory({ ops_analysis: { use_doer_assist: "" } })).toBe("not_filled");
  });

  test("无效值返回 unknown", () => {
    expect(statsTicketDoerAssistCategory({ ops_analysis: { use_doer_assist: "其他值" } })).toBe("unknown");
  });
});

describe("statsTicketDoerAssistCategoryMulti", () => {
  // 测试1：两阶段都选中-向上取整（运维优于开发）
  test("两阶段选中-运维问题定位优于开发思路", () => {
    const data = {
      ops_analysis: { use_doer_assist: "使用Doer，问题定位/解决" },
      dev_analysis: { use_doer_assist: "使用Doer，仅提供思路/辅助提效" }
    };
    expect(statsTicketDoerAssistCategoryMulti(data, true, true)).toBe("doer_resolved");
  });

  // 测试2：两阶段都选中-向上取整（开发优于运维）
  test("两阶段选中-开发思路优于运维无帮助", () => {
    const data = {
      ops_analysis: { use_doer_assist: "使用Doer，无帮助" },
      dev_analysis: { use_doer_assist: "使用Doer，仅提供思路/辅助提效" }
    };
    expect(statsTicketDoerAssistCategoryMulti(data, true, true)).toBe("doer_helped");
  });

  // 测试3：两阶段都选中-运维未使用Doer，开发问题定位
  test("两阶段选中-开发问题定位优于运维未使用", () => {
    const data = {
      ops_analysis: { use_doer_assist: "未使用Doer" },
      dev_analysis: { use_doer_assist: "使用Doer，问题定位/解决" }
    };
    expect(statsTicketDoerAssistCategoryMulti(data, true, true)).toBe("doer_resolved");
  });

  // 测试4：单阶段-只统计运维分析
  test("单阶段-只统计运维分析", () => {
    const data = {
      ops_analysis: { use_doer_assist: "未使用Doer" },
      dev_analysis: { use_doer_assist: "使用Doer，问题定位/解决" }
    };
    expect(statsTicketDoerAssistCategoryMulti(data, true, false)).toBe("no_doer");
  });

  // 测试5：单阶段-只统计开发分析
  test("单阶段-只统计开发分析", () => {
    const data = {
      ops_analysis: { use_doer_assist: "未使用Doer" },
      dev_analysis: { use_doer_assist: "使用Doer，问题定位/解决" }
    };
    expect(statsTicketDoerAssistCategoryMulti(data, false, true)).toBe("doer_resolved");
  });

  // 测试6：两阶段都未选中
  test("两阶段都未选中返回unknown", () => {
    const data = {
      ops_analysis: { use_doer_assist: "使用Doer，问题定位/解决" },
      dev_analysis: { use_doer_assist: "使用Doer，仅提供思路/辅助提效" }
    };
    expect(statsTicketDoerAssistCategoryMulti(data, false, false)).toBe("unknown");
  });

  // 测试7：节点不存在
  test("节点不存在返回not_filled", () => {
    expect(statsTicketDoerAssistCategoryMulti({}, true, true)).toBe("not_filled");
    expect(statsTicketDoerAssistCategoryMulti({ ops_analysis: null, dev_analysis: null }, true, true)).toBe("not_filled");
  });

  // 测试8：节点字段为空
  test("节点字段为空返回not_filled", () => {
    const data = {
      ops_analysis: { use_doer_assist: "" },
      dev_analysis: { use_doer_assist: "" }
    };
    expect(statsTicketDoerAssistCategoryMulti(data, true, true)).toBe("not_filled");
  });

  // 测试9：运维未填写，开发有值
  test("运维未填写-开发有值向上取整", () => {
    const data = {
      ops_analysis: { use_doer_assist: "" },
      dev_analysis: { use_doer_assist: "使用Doer，问题定位/解决" }
    };
    expect(statsTicketDoerAssistCategoryMulti(data, true, true)).toBe("doer_resolved");
  });

  // 测试10：未使用Doer与紧急疑难工单优先级相同（同级）
  test("未使用Doer与紧急疑难工单优先级相同", () => {
    const data = {
      ops_analysis: { use_doer_assist: "未使用Doer" },
      dev_analysis: { use_doer_assist: "紧急疑难工单" }
    };
    // 优先级相同（都是2），返回第一个（运维分析）
    expect(statsTicketDoerAssistCategoryMulti(data, true, true)).toBe("no_doer");
  });

  // 测试11：两阶段优先级相同都是问题定位
  test("两阶段都是问题定位返回问题定位", () => {
    const data = {
      ops_analysis: { use_doer_assist: "使用Doer，问题定位/解决" },
      dev_analysis: { use_doer_assist: "使用Doer，问题定位/解决" }
    };
    expect(statsTicketDoerAssistCategoryMulti(data, true, true)).toBe("doer_resolved");
  });
});

describe("ownership stats real data helpers", () => {
  test("buildStatsOwnershipL1BarData 按二级模块聚合", () => {
    const rows = [
      { issue_owner_module: "存储引擎/段页管理/空闲空间管理" },
      { issue_owner_module: "存储引擎/段页管理/其他" },
      { issue_owner_module: "存储引擎/事务/MVCC" },
    ];
    const data = buildStatsOwnershipL1BarData(rows, "owner", "存储引擎");
    expect(data).toEqual([
      { name: "段页管理", value: 2 },
      { name: "事务", value: 1 },
    ]);
  });

  test("statsDedupeTicketsByDts 按 DTS 去重", () => {
    const rows = [
      { dts_no: "DTS001", issue_owner_module: "SQL引擎/驱动/JDBC" },
      { dts_no: "DTS001", issue_owner_module: "SQL引擎/驱动/ODBC" },
      { dts_no: "DTS002", issue_owner_module: "SQL引擎/驱动/JDBC" },
    ];
    expect(buildStatsOwnershipL1BarData(rows, "owner", "SQL引擎", true)).toEqual([{ name: "驱动", value: 2 }]);
  });

  test("buildStatsOwnershipSpcBarData 统计 SPC 版本", () => {
    const rows = [
      { gauss_version: "505.2.1.SPC0800" },
      { gauss_version: "505.2.1.SPC0800" },
      { gauss_version: "505.2.1" },
    ];
    expect(buildStatsOwnershipSpcBarData(rows)).toEqual([{ name: "505.2.1.SPC0800", value: 2 }]);
  });

  test("buildStatsOwnershipCoreBarData 统计 C 版本", () => {
    const rows = [{ gauss_version: "505.2.1" }, { gauss_version: "505.2.1.SPC0800" }];
    expect(buildStatsOwnershipCoreBarData(rows)).toEqual([{ name: "505.2.1", value: 1 }]);
  });
});

describe("buildStatsOwnershipSunburstData", () => {
  test("按问题引入模块路径聚合三级结构", () => {
    const rows = [
      { issue_intro_module: "存储引擎/段页管理/空闲空间管理" },
      { issue_intro_module: "存储引擎/段页管理/空闲空间管理" },
      { issue_intro_module: "SQL引擎/驱动/JDBC" },
    ];
    const data = buildStatsOwnershipSunburstData(rows, "intro");
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      name: "存储引擎",
      children: [{ name: "段页管理", children: [{ name: "空闲空间管理", value: 2 }] }],
    });
    expect(data[1]).toMatchObject({
      name: "SQL引擎",
      children: [{ name: "驱动", children: [{ name: "JDBC", value: 1 }] }],
    });
  });

  test("问题归属模块与引入模块分别统计", () => {
    const rows = [
      {
        issue_intro_module: "存储引擎/段页管理/空闲空间管理",
        issue_owner_module: "SQL引擎/驱动/ODBC",
      },
    ];
    expect(buildStatsOwnershipSunburstData(rows, "intro")[0].name).toBe("存储引擎");
    expect(buildStatsOwnershipSunburstData(rows, "owner")[0]).toMatchObject({
      name: "SQL引擎",
      children: [{ name: "驱动", children: [{ name: "ODBC", value: 1 }] }],
    });
  });

  test("未填写模块不纳入旭日图", () => {
    const data = buildStatsOwnershipSunburstData([{ issue_intro_module: "" }], "intro");
    expect(data).toEqual([]);
  });

  test("模块路径占位未填写不纳入旭日图", () => {
    const data = buildStatsOwnershipSunburstData(
      [{ issue_intro_module: "存储引擎/未填写/未填写" }, { issue_intro_module: "未填写/未填写/未填写" }],
      "intro"
    );
    expect(data).toEqual([{ name: "存储引擎", value: 1 }]);
  });
});

describe("buildStatsOwnershipZoomChartOption", () => {
  function buildStatsOwnershipZoomChartOption(opt) {
    if (!opt || typeof opt !== "object") return opt;
    const zOpt = JSON.parse(JSON.stringify(opt));
    const dur = Number(zOpt.animationDuration) || 980;
    const easing = zOpt.animationEasing || "cubicOut";
    zOpt.animation = true;
    zOpt.animationDuration = dur;
    zOpt.animationEasing = easing;
    zOpt.animationDurationUpdate = dur;
    zOpt.animationEasingUpdate = easing;
    if (Array.isArray(zOpt.series)) {
      zOpt.series = zOpt.series.map((s) => {
        if (!s || typeof s !== "object") return s;
        const next = { ...s, animation: true, animationDuration: dur, animationEasing: easing };
        if (s.type === "bar") {
          next.animationDelay = (dataIndex) => dataIndex * 55;
        }
        return next;
      });
    }
    return zOpt;
  }

  test("强制开启顶层与系列动画", () => {
    const out = buildStatsOwnershipZoomChartOption({
      animationDuration: 800,
      series: [{ type: "line", data: [1, 2] }],
    });
    expect(out.animation).toBe(true);
    expect(out.animationDuration).toBe(800);
    expect(out.series[0].animation).toBe(true);
  });

  test("柱状图系列附带逐条延迟函数", () => {
    const out = buildStatsOwnershipZoomChartOption({
      series: [{ type: "bar", data: [3, 5] }],
    });
    expect(typeof out.series[0].animationDelay).toBe("function");
    expect(out.series[0].animationDelay(2)).toBe(110);
  });
});

describe("stats labor product line filter", () => {
  const adminUsers = [
    { account: "a100001", user_name: "张三", product_line: "公有云", group_name: "特战队" },
    { account: "b200002", user_name: "李四", product_line: "混合云（HCS）", group_name: "尖刀连" },
    { account: "c300003", user_name: "王五", product_line: "", group_name: "突击队" },
  ];

  test("getStatsLaborProductLineOptions returns distinct sorted values", () => {
    expect(getStatsLaborProductLineOptions(adminUsers)).toEqual(["公有云", "混合云（HCS）"]);
  });

  test("statsTicketMatchesLaborProductLine defaults to all", () => {
    const ticket = { currentHandler: "张三 a100001" };
    expect(statsTicketMatchesLaborProductLine(ticket, "", adminUsers)).toBe(true);
    expect(statsTicketMatchesLaborProductLine(ticket, "   ", adminUsers)).toBe(true);
  });

  test("statsTicketMatchesLaborProductLine filters by usr_account product_line", () => {
    const ticketA = { currentHandler: "张三 a100001" };
    const ticketB = { currentHandler: "李四 b200002" };
    expect(statsTicketMatchesLaborProductLine(ticketA, "公有云", adminUsers)).toBe(true);
    expect(statsTicketMatchesLaborProductLine(ticketA, "混合云（HCS）", adminUsers)).toBe(false);
    expect(statsTicketMatchesLaborProductLine(ticketB, "混合云（HCS）", adminUsers)).toBe(true);
  });

  test("statsTicketMatchesLaborProductLine excludes unknown or empty product_line users", () => {
    const ticket = { currentHandler: "王五 c300003" };
    expect(statsTicketMatchesLaborProductLine(ticket, "公有云", adminUsers)).toBe(false);
    expect(statsUserProductLineByPerson("王五 c300003", adminUsers)).toBe("");
  });
});
