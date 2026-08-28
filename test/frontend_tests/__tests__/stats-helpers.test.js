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

/** 与 stats.statLaborTakeTopPeople 口径一致 */
function statLaborTakeTopPeople(labels, values, limit) {
  const n = Number(limit);
  if (!(n > 0)) {
    return {
      labels: Array.isArray(labels) ? labels : [],
      values: Array.isArray(values) ? values : [],
    };
  }
  const lim = Math.floor(n);
  return {
    labels: (Array.isArray(labels) ? labels : []).slice(0, lim),
    values: (Array.isArray(values) ? values : []).slice(0, lim),
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
  return gauss || "未知版本";
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
  return /^\d+\.\d+\.(?:\d+|RC\d+)/i.test(s);
}

function statsTopCountEntries(mapOrEntries, limit = 10) {
  const entries = mapOrEntries instanceof Map ? Array.from(mapOrEntries.entries()) : mapOrEntries;
  return entries.sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, Math.max(1, limit));
}

function buildStatsOwnershipL1BarData(rows, kind = "intro", l1Label = "", dtsDedup = false) {
  const moduleKind = statsOwnershipModuleKind(kind);
  let scoped = rows || [];
  const l1 = String(l1Label || "").trim();
  if (l1 && l1 !== "all" && l1 !== "全部") {
    scoped = scoped.filter((t) => statsParseModulePathLevels(statsTicketModulePath(t, moduleKind)).l1 === l1);
  }
  if (dtsDedup) scoped = statsDedupeTicketsByDts(scoped);
  return statsTopCountEntries(
    statsCountBy(scoped, (t) => statsParseModulePathLevels(statsTicketModulePath(t, moduleKind)).l2),
    20
  ).map(([name, value]) => ({ name, value }));
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

function statsCountBy(rows, keyFn) {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!k) return;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}

function normalizeDutyCascadeValue(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("[")) {
    const parts = parseLegacyModuleArray(s);
    if (parts.length) return parts.join("/");
  }
  return s
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function parseLegacyModuleArray(s) {
  try {
    const data = JSON.parse(s);
    if (Array.isArray(data)) {
      return data.map((x) => stripLegacyModuleQuotes(String(x || ""))).filter(Boolean);
    }
  } catch {
    /* 老库非标准 JSON */
  }
  const inner = s.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return [];
  const quoted = [...inner.matchAll(/["""''「『]([^"""''」』]+)["""''」』]/g)];
  if (quoted.length) {
    return quoted.map((m) => stripLegacyModuleQuotes(m[1])).filter(Boolean);
  }
  return inner
    .split(/[,，]/)
    .map((part) => stripLegacyModuleQuotes(part))
    .filter(Boolean);
}

function stripLegacyModuleQuotes(token) {
  return String(token || "")
    .trim()
    .replace(/["""''「」『』'"\u201c\u201d\u2018\u2019]/g, "")
    .trim();
}

function statsTicketModulePath(ticket, kind = "intro") {
  const key = kind === "owner" ? "issue_owner_module" : "issue_intro_module";
  return normalizeDutyCascadeValue(ticket?.[key] ?? "");
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

function getStatsLaborDomainOptions(adminUsers) {
  const set = new Set();
  (Array.isArray(adminUsers) ? adminUsers : []).forEach((u) => {
    const d = String(u.expert_domain || "").trim();
    if (d) set.add(d);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function statsUserDomainByPerson(raw, adminUsers) {
  const hit = statsFindAdminUserByPerson(raw, adminUsers);
  return hit ? String(hit.expert_domain || "").trim() : "";
}

function filterLaborPersonRecordByDomain(record, selectedDomain, adminUsers) {
  if (!selectedDomain) return record || {};
  const out = {};
  Object.entries(record || {}).forEach(([name, v]) => {
    if (statsUserDomainByPerson(name, adminUsers) === selectedDomain) out[name] = v;
  });
  return out;
}

function laborOpenStageCounts(counts, selectedGroup, selectedDomain, personGroupFn, adminUsers) {
  if (!selectedDomain) {
    if (selectedGroup && counts?.by_group_stage_open?.[selectedGroup]) {
      return counts.by_group_stage_open[selectedGroup];
    }
    return counts?.by_stage_open || {};
  }
  const out = {};
  Object.entries(counts?.by_person_stage_open || {}).forEach(([name, stages]) => {
    if (selectedGroup && personGroupFn(name) !== selectedGroup) return;
    if (statsUserDomainByPerson(name, adminUsers) !== selectedDomain) return;
    Object.entries(stages || {}).forEach(([st, v]) => {
      out[st] = (out[st] || 0) + (Number(v) || 0);
    });
  });
  return out;
}

function laborGroupStageOpenStack(counts, selectedGroup, _selectedDomain, allGroupOptions) {
  const stackGroups = selectedGroup ? [selectedGroup] : allGroupOptions;
  return {
    stackGroups,
    getCount: (gi, key) => counts?.by_group_stage_open?.[stackGroups[gi]]?.[key] || 0,
  };
}

function laborStageAllCounts(counts, selectedDomain, adminUsers) {
  if (!selectedDomain) return counts?.by_stage_all || {};
  const byPerson = counts?.by_person_current_stage;
  const source =
    byPerson && Object.keys(byPerson).length
      ? byPerson
      : counts?.by_person_stage_open || {};
  const out = {};
  Object.entries(source).forEach(([name, stages]) => {
    if (statsUserDomainByPerson(name, adminUsers) !== selectedDomain) return;
    Object.entries(stages || {}).forEach(([st, v]) => {
      out[st] = (out[st] || 0) + (Number(v) || 0);
    });
  });
  return out;
}

function laborStageDwellHours(dwellByStageHours, byPersonStageHours, selectedDomain, stages, adminUsers) {
  const list = Array.isArray(stages) ? stages : [];
  if (!selectedDomain) {
    return list.map((st) => Math.round(Number(dwellByStageHours?.[st]) || 0));
  }
  return list.map((st) => {
    let sum = 0;
    let n = 0;
    Object.entries(byPersonStageHours || {}).forEach(([name, sm]) => {
      if (statsUserDomainByPerson(name, adminUsers) !== selectedDomain) return;
      if (sm == null || sm[st] == null || sm[st] === "") return;
      sum += Number(sm[st]) || 0;
      n += 1;
    });
    return n ? Math.round(sum / n) : 0;
  });
}

function statsTicketMatchesLaborProductLine(ticket, productLineFilter, adminUsers) {
  const filter = String(productLineFilter || "").trim();
  if (!filter) return true;
  const raw = String(ticket?.currentHandler || ticket?.assignee || ticket?.creatorName || "").trim();
  return statsUserProductLineByPerson(raw, adminUsers) === filter;
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

describe("statLaborTakeTopPeople", () => {
  const labels = Array.from({ length: 20 }, (_, i) => `P${i}`);
  const values = Array.from({ length: 20 }, (_, i) => 20 - i);

  test("limit=15 时截取前15人", () => {
    const { labels: labs, values: vals } = statLaborTakeTopPeople(labels, values, 15);
    expect(labs).toHaveLength(15);
    expect(vals).toHaveLength(15);
    expect(labs[0]).toBe("P0");
    expect(labs[14]).toBe("P14");
    expect(vals[0]).toBe(20);
    expect(vals[14]).toBe(6);
  });

  test("不传 limit 时保留全部（放大弹窗）", () => {
    const { labels: labs, values: vals } = statLaborTakeTopPeople(labels, values);
    expect(labs).toHaveLength(20);
    expect(vals).toHaveLength(20);
  });

  test("人数不足 limit 时返回全部", () => {
    const { labels: labs } = statLaborTakeTopPeople(["甲", "乙"], [3, 1], 15);
    expect(labs).toEqual(["甲", "乙"]);
  });
});

/** 与 stats-page.statLaborPersonNestedLabels 口径一致（组别 + 领域 + 合计降序） */
function statLaborPersonNestedLabels(byPersonNested, selectedGroup, personGroupFn, countKeys = null, selectedDomain = "", personDomainFn = null) {
  const entries = Object.entries(byPersonNested || {}).filter(([name]) => name && name !== "未分配");
  let scoped = selectedGroup
    ? entries.filter(([name]) => personGroupFn(name) === selectedGroup)
    : entries;
  if (selectedDomain && typeof personDomainFn === "function") {
    scoped = scoped.filter(([name]) => personDomainFn(name) === selectedDomain);
  }
  const keys = Array.isArray(countKeys) && countKeys.length ? countKeys : null;
  return scoped
    .map(([name, nested]) => {
      const obj = nested || {};
      const total = keys
        ? keys.reduce((sum, k) => sum + (Number(obj[k]) || 0), 0)
        : Object.values(obj).reduce((sum, v) => sum + (Number(v) || 0), 0);
      return [name, total];
    })
    .filter(([, total]) => total > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return String(a[0]).localeCompare(String(b[0]), "zh-CN");
    })
    .map(([name]) => name);
}

describe("statLaborPersonNestedLabels", () => {
  const stackStages = ["问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭"];
  const byPersonStage = {
    甲: { 运维分析: 1, 开发分析: 2 },
    乙: { 运维分析: 5 },
    丙: { 开发分析: 1 },
    未分配: { 运维分析: 9 },
  };
  const groupOf = (name) => ({ 甲: "一组", 乙: "一组", 丙: "二组", 丁: "一组" }[name] || "未分组");

  test("未选组别时按合计降序列出全部人员", () => {
    expect(statLaborPersonNestedLabels(byPersonStage, "", groupOf)).toEqual(["乙", "甲", "丙"]);
  });

  test("选组别后仅保留该组人员", () => {
    expect(statLaborPersonNestedLabels(byPersonStage, "一组", groupOf)).toEqual(["乙", "甲"]);
    expect(statLaborPersonNestedLabels(byPersonStage, "二组", groupOf)).toEqual(["丙"]);
  });

  test("仅按堆叠阶段合计，剔除柱顶为 0 的人", () => {
    const nested = {
      ...byPersonStage,
      // 堆叠阶段与关闭均为 0
      戊: { 运维分析: 0 },
    };
    expect(statLaborPersonNestedLabels(nested, "", groupOf, stackStages)).toEqual(["乙", "甲", "丙"]);
  });

  test("关闭并入审核关闭后计入排序", () => {
    function mergeLaborClosedIntoAuditClose(byPersonStage) {
      const out = {};
      Object.entries(byPersonStage || {}).forEach(([person, nested]) => {
        const next = { ...(nested || {}) };
        const closed = (Number(next["关闭"]) || 0) + (Number(next["已关闭"]) || 0);
        if (closed > 0) {
          next["审核关闭"] = (Number(next["审核关闭"]) || 0) + closed;
          delete next["关闭"];
          delete next["已关闭"];
        }
        out[person] = next;
      });
      return out;
    }
    const nested = mergeLaborClosedIntoAuditClose({
      甲: { 运维分析: 1 },
      丁: { 关闭: 8 },
    });
    expect(statLaborPersonNestedLabels(nested, "", groupOf, stackStages)).toEqual(["丁", "甲"]);
    expect(nested["丁"]["审核关闭"]).toBe(8);
  });

  test("未闭环滞留人按单阶段筛：仅累加所选阶段", () => {
    const byPersonStageOpen = {
      甲: { 运维分析: 2, 开发分析: 3 },
      乙: { 运维分析: 5 },
      丙: { 开发分析: 1 },
    };
    const labels = statLaborPersonNestedLabels(byPersonStageOpen, "", groupOf, ["运维分析"]);
    expect(labels).toEqual(["乙", "甲"]);
    expect(labels.map((name) => Number(byPersonStageOpen[name]?.["运维分析"]) || 0)).toEqual([5, 2]);
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
  test("内核版本 gauss_version 优先于其它字段", () => {
    expect(statsTicketVersion({ gauss_version: "505.2.1.SPC0800", hcsVersion: "505.2.0" })).toBe("505.2.1.SPC0800");
  });

  test("gaussVersion 驼峰键兼容", () => {
    expect(statsTicketVersion({ gaussVersion: "505.2.0" })).toBe("505.2.0");
  });

  test("无 gauss_version 时不回退 hcsVersion 或描述中的小数", () => {
    expect(statsTicketVersion({ hcsVersion: "505.2.0" })).toBe("未知版本");
    expect(statsTicketVersion({ description: "版本505.1.0问题" })).toBe("未知版本");
    expect(statsTicketVersion({ description: "响应时间0.2秒超时" })).toBe("未知版本");
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
      { issue_intro_module: "存储引擎/段页管理/空闲空间管理" },
      { issue_intro_module: "存储引擎/段页管理/其他" },
      { issue_intro_module: "存储引擎/事务/MVCC" },
    ];
    const data = buildStatsOwnershipL1BarData(rows, "intro", "存储引擎");
    expect(data).toEqual([
      { name: "段页管理", value: 2 },
      { name: "事务", value: 1 },
    ]);
  });

  test("buildStatsOwnershipL1BarData 模块全部时跨一级计数", () => {
    const rows = [
      { issue_intro_module: "存储引擎/段页管理/空闲空间管理" },
      { issue_intro_module: "SQL引擎/驱动/JDBC" },
      { issue_intro_module: "SQL引擎/驱动/ODBC" },
    ];
    expect(buildStatsOwnershipL1BarData(rows, "intro", "all")).toEqual([
      { name: "驱动", value: 2 },
      { name: "段页管理", value: 1 },
    ]);
  });

  test("statsDedupeTicketsByDts 按 DTS 去重", () => {
    const rows = [
      { dts_no: "DTS001", issue_intro_module: "SQL引擎/驱动/JDBC" },
      { dts_no: "DTS001", issue_intro_module: "SQL引擎/驱动/ODBC" },
      { dts_no: "DTS002", issue_intro_module: "SQL引擎/驱动/JDBC" },
    ];
    expect(buildStatsOwnershipL1BarData(rows, "intro", "SQL引擎", true)).toEqual([{ name: "驱动", value: 2 }]);
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

  test("buildStatsOwnershipCoreBarData 统计 RC 形态 C 版本", () => {
    const rows = [
      { gauss_version: "503.0.RC3" },
      { gauss_version: "503.0.RC3.B013" },
      { gauss_version: "505.2.RC1" },
    ];
    expect(buildStatsOwnershipCoreBarData(rows)).toEqual([
      { name: "503.0.RC3", value: 1 },
      { name: "505.2.RC1", value: 1 },
    ]);
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

  test("老库 JSON 数组格式模块路径可解析", () => {
    const raw = '[”SQL引擎，“分区表”，“分区自动扩展”]';
    const data = buildStatsOwnershipSunburstData([{ issue_intro_module: raw }], "intro");
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      name: "SQL引擎",
      children: [{ name: "分区表", children: [{ name: "分区自动扩展", value: 1 }] }],
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

describe("statsSvgHorizontalZoom", () => {
  function statsSvgCategoryMinSpan(categoryCount, minVisible = 3) {
    const n = Math.max(0, Number(categoryCount) || 0);
    if (n < 2) return 1;
    const minVis = Math.max(2, Math.min(n, Number(minVisible) || 3));
    return minVis / n;
  }

  function statsSvgWheelHorizontalZoom(state, deltaY, opts = {}) {
    const minSpan = Math.max(0.05, Math.min(1, Number(opts.minSpan) || 0.3));
    const zoomIn = Number(deltaY) < 0;
    const factor = zoomIn ? 0.85 : 1.18;
    const center = state.start + state.span / 2;
    let span = zoomIn ? Math.max(minSpan, state.span * factor) : Math.min(1, state.span * factor);
    let start = center - span / 2;
    start = Math.max(0, Math.min(1 - span, start));
    return { start, span };
  }

  function statsSvgPanHorizontalZoom(state, deltaStart) {
    const d = Number(deltaStart) || 0;
    let start = state.start + d;
    start = Math.max(0, Math.min(1 - state.span, start));
    return { start, span: state.span };
  }

  function statsSvgApplyHorizontalZoomViewBox(svg, state, fullVb) {
    if (!svg || !fullVb || !state) return;
    const x = fullVb.x + fullVb.w * state.start;
    const visibleW = fullVb.w * state.span;
    svg.setAttribute("viewBox", `${x} ${fullVb.y} ${visibleW} ${fullVb.h}`);
  }

  test("statsSvgCategoryMinSpan 按类目数限制最小可见比例", () => {
    expect(statsSvgCategoryMinSpan(1)).toBe(1);
    expect(statsSvgCategoryMinSpan(10)).toBe(0.3);
    expect(statsSvgCategoryMinSpan(5, 2)).toBe(0.4);
  });

  test("statsSvgWheelHorizontalZoom 滚轮向上放大、向下缩小", () => {
    const full = { start: 0, span: 1 };
    const zoomIn = statsSvgWheelHorizontalZoom(full, -120, { minSpan: 0.3 });
    expect(zoomIn.span).toBeLessThan(1);
    expect(zoomIn.start).toBeGreaterThanOrEqual(0);
    const zoomOut = statsSvgWheelHorizontalZoom(zoomIn, 120, { minSpan: 0.3 });
    expect(zoomOut.span).toBeGreaterThan(zoomIn.span);
  });

  test("statsSvgPanHorizontalZoom 平移不超出边界", () => {
    const st = { start: 0.2, span: 0.4 };
    expect(statsSvgPanHorizontalZoom(st, 0.5).start).toBe(0.6);
    expect(statsSvgPanHorizontalZoom(st, -0.5).start).toBe(0);
    expect(statsSvgPanHorizontalZoom({ start: 0.6, span: 0.4 }, 0.2).start).toBe(0.6);
  });

  test("statsSvgApplyHorizontalZoomViewBox 写入 viewBox", () => {
    const svg = { _vb: "", setAttribute(k, v) { if (k === "viewBox") this._vb = v; } };
    statsSvgApplyHorizontalZoomViewBox(svg, { start: 0.25, span: 0.5 }, { x: 0, y: 0, w: 560, h: 260 });
    expect(svg._vb).toBe("140 0 280 260");
  });
});

describe("buildStatsCategoryXDataZoom", () => {
  function statsEchartsCategoryCount(opt) {
    if (!opt || typeof opt !== "object") return 0;
    const xa = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
    if (!xa || xa.type !== "category") return 0;
    return Array.isArray(xa.data) ? xa.data.length : 0;
  }

  function buildStatsCategoryXDataZoom(categoryCount, opts = {}) {
    const n = Math.max(0, Number(categoryCount) || 0);
    if (n < 2) return [];
    const minVisible = Math.max(2, Math.min(n, Number(opts.minVisible) || 3));
    return [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "filter",
        zoomOnMouseWheel: true,
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
        minSpan: Math.min(100, (minVisible / n) * 100),
      },
    ];
  }

  function withStatsCategoryXDataZoom(opt, opts = {}) {
    if (!opt || typeof opt !== "object") return opt;
    const dataZoom = buildStatsCategoryXDataZoom(statsEchartsCategoryCount(opt), opts);
    if (!dataZoom.length) return opt;
    return { ...opt, dataZoom };
  }

  test("类目少于 2 时不注入 dataZoom", () => {
    expect(buildStatsCategoryXDataZoom(1)).toEqual([]);
    expect(
      withStatsCategoryXDataZoom({
        xAxis: { type: "category", data: ["A"] },
        series: [{ type: "bar", data: [1] }],
      }).dataZoom
    ).toBeUndefined();
  });

  test("类目足够时注入 inside 横轴滚轮缩放", () => {
    const dz = buildStatsCategoryXDataZoom(10);
    expect(dz).toHaveLength(1);
    expect(dz[0]).toMatchObject({
      type: "inside",
      xAxisIndex: 0,
      zoomOnMouseWheel: true,
      moveOnMouseWheel: false,
    });
    expect(dz[0].minSpan).toBe(30);
  });

  test("withStatsCategoryXDataZoom 跳过非 category 横轴", () => {
    const pieOpt = { series: [{ type: "pie", data: [{ value: 1, name: "A" }] }] };
    expect(withStatsCategoryXDataZoom(pieOpt)).toBe(pieOpt);
  });
});

describe("buildStatsOwnershipZoomChartOption", () => {
  function buildStatsOwnershipZoomChartOption(opt) {
    if (!opt || typeof opt !== "object") return opt;
    const zOpt = JSON.parse(JSON.stringify(opt));
    if (opt.tooltip && typeof opt.tooltip.formatter === "function") {
      zOpt.tooltip = { ...(zOpt.tooltip || {}), formatter: opt.tooltip.formatter };
    }
    const dur = Number(zOpt.animationDuration) || 980;
    const easing = zOpt.animationEasing || "cubicOut";
    zOpt.animation = true;
    zOpt.animationDuration = dur;
    zOpt.animationEasing = easing;
    zOpt.animationDurationUpdate = dur;
    zOpt.animationEasingUpdate = easing;
    if (Array.isArray(zOpt.series)) {
      zOpt.series = zOpt.series.map((s, si) => {
        if (!s || typeof s !== "object") return s;
        const next = { ...s, animation: true, animationDuration: dur, animationEasing: easing };
        if (s.type === "bar") {
          next.animationDelay = (dataIndex) => dataIndex * 55;
        }
        const orig = Array.isArray(opt.series) ? opt.series[si] : null;
        if (orig?.label && typeof orig.label.formatter === "function") {
          next.label = { ...(next.label || {}), formatter: orig.label.formatter };
        }
        if (s.type === "sunburst") {
          next.label = { ...(next.label || {}), show: true };
          if (Array.isArray(next.levels)) {
            next.levels = next.levels.map((lv) => {
              if (!lv || typeof lv !== "object" || !lv.label) return lv;
              return { ...lv, label: { ...lv.label, show: true } };
            });
          }
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

  test("保留 tooltip.formatter（JSON 克隆不会丢掉）", () => {
    const formatter = () => "x";
    const out = buildStatsOwnershipZoomChartOption({
      tooltip: { trigger: "axis", formatter },
      series: [{ type: "line", data: [1] }],
    });
    expect(out.tooltip.formatter).toBe(formatter);
  });

  test("旭日图放大后恢复 label.show", () => {
    const out = buildStatsOwnershipZoomChartOption({
      series: [
        {
          type: "sunburst",
          label: { show: false, fontSize: 10 },
          levels: [
            {},
            { r0: "18%", r: "42%", label: { show: false, rotate: "tangential" } },
            { r0: "64%", r: "88%", label: { show: false, position: "inside" } },
          ],
        },
      ],
    });
    expect(out.series[0].label.show).toBe(true);
    expect(out.series[0].levels[1].label.show).toBe(true);
    expect(out.series[0].levels[2].label.show).toBe(true);
  });

  test("放大时保留系列 label.formatter", () => {
    const formatter = (params) => `avg:${params.dataIndex}`;
    const out = buildStatsOwnershipZoomChartOption({
      series: [{ type: "bar", data: [1], label: { show: true, formatter } }],
    });
    expect(out.series[0].label.formatter).toBe(formatter);
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

describe("stats labor domain (expert_domain) filter", () => {
  const adminUsers = [
    { account: "a100001", user_name: "张三", expert_domain: "存储引擎", group_name: "特战队" },
    { account: "b200002", user_name: "李四", expert_domain: "SQL引擎", group_name: "尖刀连" },
    { account: "c300003", user_name: "王五", expert_domain: "存储引擎", group_name: "特战队" },
    { account: "d400004", user_name: "赵六", expert_domain: "", group_name: "突击队" },
  ];
  const domainOf = (name) => statsUserDomainByPerson(name, adminUsers);
  const groupOf = (name) => ({ 张三: "特战队", 李四: "尖刀连", 王五: "特战队", 赵六: "突击队" }[name] || "未分组");

  test("getStatsLaborDomainOptions returns distinct sorted values", () => {
    expect(getStatsLaborDomainOptions(adminUsers)).toEqual(["存储引擎", "SQL引擎"]);
  });

  test("statsUserDomainByPerson resolves expert_domain", () => {
    expect(statsUserDomainByPerson("张三 a100001", adminUsers)).toBe("存储引擎");
    expect(statsUserDomainByPerson("李四", adminUsers)).toBe("SQL引擎");
    expect(statsUserDomainByPerson("赵六 d400004", adminUsers)).toBe("");
  });

  test("filterLaborPersonRecordByDomain keeps matching people", () => {
    const byPerson = { 张三: 3, 李四: 2, 王五: 1, 赵六: 9 };
    expect(filterLaborPersonRecordByDomain(byPerson, "", adminUsers)).toEqual(byPerson);
    expect(filterLaborPersonRecordByDomain(byPerson, "存储引擎", adminUsers)).toEqual({ 张三: 3, 王五: 1 });
    expect(filterLaborPersonRecordByDomain(byPerson, "SQL引擎", adminUsers)).toEqual({ 李四: 2 });
  });

  test("statLaborPersonNestedLabels filters by domain", () => {
    const nested = {
      张三: { 运维分析: 2 },
      李四: { 运维分析: 5 },
      王五: { 开发分析: 1 },
    };
    expect(statLaborPersonNestedLabels(nested, "", groupOf, null, "存储引擎", domainOf)).toEqual([
      "张三",
      "王五",
    ]);
    expect(statLaborPersonNestedLabels(nested, "特战队", groupOf, null, "存储引擎", domainOf)).toEqual([
      "张三",
      "王五",
    ]);
    expect(statLaborPersonNestedLabels(nested, "特战队", groupOf, null, "SQL引擎", domainOf)).toEqual([]);
  });

  test("laborOpenStageCounts aggregates by_person_stage_open when domain selected", () => {
    const counts = {
      by_stage_open: { 运维分析: 99, 开发分析: 99 },
      by_group_stage_open: { 特战队: { 运维分析: 10 } },
      by_person_stage_open: {
        张三: { 运维分析: 2, 开发分析: 1 },
        李四: { 运维分析: 5 },
        王五: { 运维分析: 3 },
      },
    };
    expect(laborOpenStageCounts(counts, "", "", groupOf, adminUsers)).toEqual(counts.by_stage_open);
    expect(laborOpenStageCounts(counts, "", "存储引擎", groupOf, adminUsers)).toEqual({
      运维分析: 5,
      开发分析: 1,
    });
    expect(laborOpenStageCounts(counts, "特战队", "存储引擎", groupOf, adminUsers)).toEqual({
      运维分析: 5,
      开发分析: 1,
    });
  });

  test("laborGroupStageOpenStack ignores domain (各组未闭环不受领域支配)", () => {
    const counts = {
      by_group_stage_open: {
        特战队: { 运维分析: 100 },
        尖刀连: { 运维分析: 50 },
      },
      by_person_stage_open: {
        张三: { 运维分析: 2 },
        李四: { 运维分析: 5 },
      },
    };
    const all = ["特战队", "尖刀连", "突击队"];
    const { stackGroups, getCount } = laborGroupStageOpenStack(counts, "", "存储引擎", all);
    expect(stackGroups).toEqual(all);
    expect(getCount(0, "运维分析")).toBe(100);
    expect(getCount(1, "运维分析")).toBe(50);
  });

  test("laborStageAllCounts filters by domain via by_person_current_stage", () => {
    const counts = {
      by_stage_all: { 运维分析: 99, 关闭: 10 },
      by_person_current_stage: {
        张三: { 运维分析: 2, 关闭: 1 },
        李四: { 运维分析: 5 },
        王五: { 关闭: 3 },
      },
    };
    expect(laborStageAllCounts(counts, "", adminUsers)).toEqual(counts.by_stage_all);
    expect(laborStageAllCounts(counts, "存储引擎", adminUsers)).toEqual({
      运维分析: 2,
      关闭: 4,
    });
  });

  test("laborStageDwellHours averages person hours when domain selected", () => {
    const stages = ["运维分析", "开发分析"];
    const globalHours = { 运维分析: 99, 开发分析: 88 };
    const byPerson = {
      张三: { 运维分析: 10, 开发分析: 4 },
      李四: { 运维分析: 20 },
      王五: { 运维分析: 30, 开发分析: 8 },
    };
    expect(laborStageDwellHours(globalHours, byPerson, "", stages, adminUsers)).toEqual([99, 88]);
    // 存储引擎：张三+王五 → 运维 (10+30)/2=20，开发 (4+8)/2=6
    expect(laborStageDwellHours(globalHours, byPerson, "存储引擎", stages, adminUsers)).toEqual([
      20, 6,
    ]);
  });
});

describe("buildStatsLaborEchart options", () => {
  const STAT_LABOR_CHART_COLORS = ["#c45", "#48c", "#8c4"];
  const STAT_LABOR_STACK_CHART_COLORS = ["#a1", "#b2", "#c3"];
  const STAT_OWNERSHIP_MULTILINE_REF_COLORS = ["#2563eb", "#84cc16", "#eab308"];

  function statOwnershipAxisLabel() {
    return { color: "#5c574f", fontSize: 11 };
  }

  function statOwnershipSplitLineStyle() {
    return { lineStyle: { color: "rgba(180, 172, 158, 0.35)" } };
  }

  function statsEchartsCategoryCount(opt) {
    if (!opt || typeof opt !== "object") return 0;
    const xa = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
    if (!xa || xa.type !== "category") return 0;
    return Array.isArray(xa.data) ? xa.data.length : 0;
  }

  function buildStatsCategoryXDataZoom(categoryCount, opts = {}) {
    const n = Math.max(0, Number(categoryCount) || 0);
    if (n < 2) return [];
    const minVisible = Math.max(2, Math.min(n, Number(opts.minVisible) || 3));
    return [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "filter",
        zoomOnMouseWheel: true,
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
        minSpan: Math.min(100, (minVisible / n) * 100),
      },
    ];
  }

  function withStatsCategoryXDataZoom(opt, opts = {}) {
    if (!opt || typeof opt !== "object") return opt;
    const dataZoom = buildStatsCategoryXDataZoom(statsEchartsCategoryCount(opt), opts);
    if (!dataZoom.length) return opt;
    return { ...opt, dataZoom };
  }

  function buildStatsLaborEchartBarOption(labels, values, opts = {}) {
    const labs = labels?.length ? labels : ["—"];
    const vals = values?.length ? values : labs.map(() => 0);
    const colors = opts.colors || labs.map((_, i) => STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length]);
    const rotate = labs.length > 8 ? 28 : labs.length > 4 ? 22 : 0;
    return withStatsCategoryXDataZoom({
      animation: true,
      color: STAT_LABOR_CHART_COLORS,
      grid: { left: 48, right: 16, top: opts.showValues ? (opts.yUnit ? 46 : 38) : (opts.yUnit ? 36 : 28), bottom: rotate ? 56 : 44 },
      ...(opts.aria ? { aria: { enabled: true, label: { enabled: true, description: opts.aria } } } : {}),
      xAxis: { type: "category", data: labs, axisLabel: { interval: 0, rotate } },
      yAxis: { type: "value", name: opts.yUnit || "", splitLine: statOwnershipSplitLineStyle() },
      series: [
        {
          type: "bar",
          label: {
            show: !!opts.showValues,
            position: "top",
            fontSize: 10,
            color: "#5c574f",
            formatter: (p) => (Number(p.value) > 0 ? p.value : ""),
          },
          data: vals.map((v, i) => ({
            value: v,
            itemStyle: { color: colors[i] || STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length] },
          })),
        },
      ],
    });
  }

  function buildStatsLaborEchartStackedBarOption(groups, seriesKeys, getValues, opts = {}) {
    const grps = groups?.length ? groups : ["—"];
    const keys = seriesKeys?.length ? seriesKeys : ["—"];
    const seriesColors = Array.isArray(opts.seriesColors) ? opts.seriesColors : null;
    const totals = grps.map((_, gi) =>
      keys.reduce((sum, key) => sum + (Number(getValues(gi, key)) || 0), 0)
    );
    const series = keys.map((name, si) => ({
      name,
      type: "bar",
      stack: "total",
      data: grps.map((_, gi) => Number(getValues(gi, name)) || 0),
      itemStyle: {
        color:
          (seriesColors && seriesColors[si]) ||
          STAT_LABOR_STACK_CHART_COLORS[si % STAT_LABOR_STACK_CHART_COLORS.length],
      },
      ...(si === keys.length - 1
        ? {
            label: {
              show: true,
              formatter: (params) => {
                const t = totals[params.dataIndex];
                return t > 0 ? String(t) : "";
              },
            },
          }
        : {}),
    }));
    return withStatsCategoryXDataZoom({
      legend: { type: "scroll", bottom: 0 },
      xAxis: { type: "category", data: grps },
      yAxis: { type: "value" },
      series,
    });
  }

  function buildStatsLaborEchartPieOption(slices, opts = {}) {
    const palette =
      Array.isArray(opts.colors) && opts.colors.length
        ? opts.colors
        : STAT_LABOR_CHART_COLORS;
    const items = (slices || []).filter((s) => s && String(s.label || "").trim());
    const data = (items.length ? items : [{ label: "暂无数据", value: 0 }]).map((s, i) => ({
      name: String(s.label || "—"),
      value: Number(s.value) || 0,
      itemStyle: { color: palette[i % palette.length] },
    }));
    return {
      color: palette,
      legend: { type: "scroll", orient: "horizontal", bottom: 0 },
      series: [{ type: "pie", radius: ["34%", "56%"], center: ["50%", "44%"], data, label: { show: false } }],
    };
  }

  test("柱状图注入 dataZoom 与 y 轴单位", () => {
    const opt = buildStatsLaborEchartBarOption(["张三", "李四"], [3, 5], { yUnit: "小时" });
    expect(opt.series[0].type).toBe("bar");
    expect(opt.yAxis.name).toBe("小时");
    expect(opt.dataZoom).toHaveLength(1);
  });

  test("柱状图默认无数值标签（历史图表外观不变）", () => {
    const opt = buildStatsLaborEchartBarOption(["张三"], [3]);
    expect(opt.series[0].label.show).toBe(false);
    expect(opt.aria).toBeUndefined();
  });

  test("柱状图 showValues 开启柱顶数值标签（值>0 才显示）", () => {
    const opt = buildStatsLaborEchartBarOption(["张三", "李四"], [3, 0], { showValues: true });
    expect(opt.series[0].label.show).toBe(true);
    expect(opt.series[0].label.position).toBe("top");
    expect(opt.series[0].label.formatter({ value: 3 })).toBe(3);
    expect(opt.series[0].label.formatter({ value: 0 })).toBe("");
    // 标签占位：grid.top 留出数值高度
    expect(opt.grid.top).toBe(38);
  });

  test("柱状图 aria 描述映射 ECharts aria.label.description（不再是死参数）", () => {
    const opt = buildStatsLaborEchartBarOption(["张三"], [3], { aria: "领域分布" });
    expect(opt.aria).toEqual({ enabled: true, label: { enabled: true, description: "领域分布" } });
  });

  test("堆叠柱图含合计标签", () => {
    const opt = buildStatsLaborEchartStackedBarOption(["特战队"], ["运维分析", "开发分析"], (gi, key) =>
      gi === 0 && key === "运维分析" ? 2 : 0
    );
    expect(opt.series).toHaveLength(2);
    expect(opt.series[0].data).toEqual([2]);
    expect(opt.series[1].data).toEqual([0]);
    expect(typeof opt.series[1].label.formatter).toBe("function");
    expect(opt.series[1].label.formatter({ dataIndex: 0 })).toBe("2");
  });

  test("堆叠柱图支持自定义系列色", () => {
    const opt = buildStatsLaborEchartStackedBarOption(
      ["张三"],
      ["流转至责任田", "独立闭环"],
      () => 1,
      { seriesColors: ["#1565c0", "#f57c00"] }
    );
    expect(opt.series[0].itemStyle.color).toBe("#1565c0");
    expect(opt.series[1].itemStyle.color).toBe("#f57c00");
  });

  test("堆叠柱图柱顶为各阶段单数之和", () => {
    const opt = buildStatsLaborEchartStackedBarOption(
      ["张三"],
      ["运维分析", "开发分析", "关闭"],
      (gi, key) => {
        if (key === "运维分析") return 2;
        if (key === "开发分析") return 4;
        return 0;
      }
    );
    expect(opt.series[2].label.formatter({ dataIndex: 0 })).toBe("6");
  });

  test("饼图无横轴 dataZoom", () => {
    const opt = buildStatsLaborEchartPieOption([{ label: "运维分析", value: 4 }]);
    expect(opt.series[0].type).toBe("pie");
    expect(opt.dataZoom).toBeUndefined();
  });

  test("饼图图例置底避免与环形图重叠", () => {
    const opt = buildStatsLaborEchartPieOption([
      { label: "问题填写", value: 1 },
      { label: "运维分析", value: 4 },
    ]);
    expect(opt.legend.orient).toBe("horizontal");
    expect(opt.legend.bottom).toBe(0);
    expect(opt.series[0].center).toEqual(["50%", "44%"]);
    expect(opt.series[0].label.show).toBe(false);
  });

  test("饼图扇区色可指定为折线色板", () => {
    const opt = buildStatsLaborEchartPieOption(
      [
        { label: "问题填写", value: 1 },
        { label: "运维分析", value: 4 },
      ],
      { colors: STAT_OWNERSHIP_MULTILINE_REF_COLORS }
    );
    expect(opt.color).toEqual(STAT_OWNERSHIP_MULTILINE_REF_COLORS);
    expect(opt.series[0].data[0].itemStyle.color).toBe(STAT_OWNERSHIP_MULTILINE_REF_COLORS[0]);
    expect(opt.series[0].data[1].itemStyle.color).toBe(STAT_OWNERSHIP_MULTILINE_REF_COLORS[1]);
  });
});

describe("工单度量阶段/环境分布饼图（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");
  const statsSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats.js"), "utf8");

  test("工单度量页新增阶段/环境/来源分布饼图", () => {
    expect(pageSrc).not.toContain("现网问题来源数量趋势");
    expect(pageSrc).not.toContain("ownSourceLine");
    expect(pageSrc).toContain("工单发生阶段分布");
    expect(pageSrc).toContain("工单发生环境分布");
    expect(pageSrc).toContain("工单问题来源分布");
    expect(pageSrc).toContain("质量问题来源分布");
    expect(pageSrc).toContain("ownStagePie");
    expect(pageSrc).toContain("ownEnvPie");
    expect(pageSrc).toContain("ownSourcePie");
    expect(pageSrc).toContain("ownQualitySourcePie");
    expect(pageSrc).toContain("stats-ownership-echart-stage-pie");
    expect(pageSrc).toContain("stats-ownership-echart-env-pie");
    expect(pageSrc).toContain("stats-ownership-echart-source-pie");
    expect(pageSrc).toContain("stats-ownership-echart-quality-source-pie");
    expect(pageSrc).toContain("showSliceLabel: true");
    expect(pageSrc).toContain("payload.stage_pie");
    expect(pageSrc).toContain("payload.env_pie");
    expect(pageSrc).toContain("payload.source_pie");
    expect(pageSrc).toContain("payload.quality_source_pie");
    const sourceIdx = pageSrc.indexOf('renderOwnershipGlassCard("工单问题来源分布"');
    const qualitySourceIdx = pageSrc.indexOf('renderOwnershipGlassCard("质量问题来源分布"');
    expect(sourceIdx).toBeGreaterThan(-1);
    expect(qualitySourceIdx).toBeGreaterThan(sourceIdx);
  });

  test("饼图外侧引出线标注名称、数量与占比", () => {
    expect(statsSrc).toContain("showSliceLabel");
    expect(statsSrc).toContain('position: "outside"');
    expect(statsSrc).toContain('formatter: "{b}\\n{c} ({d}%)"');
    expect(statsSrc).toContain("length: 16");
    expect(statsSrc).toContain("length2: 14");
  });

  test("人力投入与工单度量饼图使用折线色板", () => {
    expect(statsSrc).toContain("opts.colors");
    expect(pageSrc).toContain("laborPie7: buildStatsLaborEchartPieOption");
    expect(pageSrc).toContain("ownStagePie: buildStatsLaborEchartPieOption");
    expect(pageSrc).toContain("ownEnvPie: buildStatsLaborEchartPieOption");
    expect(pageSrc).toContain("ownSourcePie: buildStatsLaborEchartPieOption");
    expect(pageSrc).toContain("ownQualitySourcePie: buildStatsLaborEchartPieOption");
    expect(pageSrc.match(/colors: STAT_OWNERSHIP_MULTILINE_REF_COLORS/g)?.length).toBe(5);
  });
});

describe("工单度量质量问题数量趋势（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");

  test("新增质量问题数量趋势，工单数量趋势仍用 trend.total", () => {
    expect(pageSrc).toContain("工单数量趋势");
    expect(pageSrc).toContain("质量问题数量趋势");
    expect(pageSrc).toContain("ownQualityTrend");
    expect(pageSrc).toContain("stats-ownership-echart-quality-trend");
    expect(pageSrc).toContain("payload.trend?.quality_yes");
    expect(pageSrc).toContain('name: "质量问题"');
    expect(pageSrc).toContain("payload.trend?.total");
    const ticketIdx = pageSrc.indexOf('renderOwnershipGlassCard("工单数量趋势"');
    const qualityIdx = pageSrc.indexOf('renderOwnershipGlassCard("质量问题数量趋势"');
    expect(ticketIdx).toBeGreaterThan(-1);
    expect(qualityIdx).toBeGreaterThan(ticketIdx);
  });
});

describe("工单度量质量问题版本趋势（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");

  test("新增质量问题版本趋势，版本工单数量趋势仍用全量 by_version_time", () => {
    expect(pageSrc).toContain("版本工单数量趋势");
    expect(pageSrc).toContain("质量问题版本趋势");
    expect(pageSrc).toContain("ownQualityVerLine");
    expect(pageSrc).toContain("stats-ownership-echart-quality-ver-line");
    expect(pageSrc).toContain("by_version_time_quality");
    expect(pageSrc).toContain("by_c_version_time_quality");
    expect(pageSrc).toContain("by_r_version_time_quality");
    expect(pageSrc).toContain("scoped?.by_version_time");
    const allIdx = pageSrc.indexOf('renderOwnershipGlassCard("版本工单数量趋势"');
    const qIdx = pageSrc.indexOf('renderOwnershipGlassCard("质量问题版本趋势"');
    expect(allIdx).toBeGreaterThan(-1);
    expect(qIdx).toBeGreaterThan(allIdx);
  });
});

describe("工单度量 TOP类型问题趋势（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");

  test("新增 TOP类型问题趋势，数据用 by_issue_type_time", () => {
    expect(pageSrc).toContain("TOP类型问题趋势");
    expect(pageSrc).toContain("ownIssueTypeLine");
    expect(pageSrc).toContain("stats-ownership-echart-issue-type");
    expect(pageSrc).toContain("payload.by_issue_type_time");
    const verIdx = pageSrc.indexOf('renderOwnershipGlassCard("质量问题版本趋势"');
    const typeIdx = pageSrc.indexOf('renderOwnershipGlassCard("TOP类型问题趋势"');
    expect(verIdx).toBeGreaterThan(-1);
    expect(typeIdx).toBeGreaterThan(verIdx);
  });
});

describe("工单度量工单数量TOP局点（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");
  const statsSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats.js"), "utf8");

  test("卡片标题为工单数量TOP局点，显示条数为 5/10/15/20", () => {
    expect(pageSrc).toContain("工单数量TOP局点");
    expect(pageSrc).not.toContain("全量问题TOP局点");
    expect(statsSrc).toContain("STAT_OWNERSHIP_TOP_SITE_N_OPTIONS = [5, 10, 15, 20]");
    expect(statsSrc).toContain("export function statsOwnershipTopSiteN");
  });
});

describe("工单度量质量问题TOP局点（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");

  test("新增质量问题TOP局点，工单数量TOP局点仍用 payload.top_site", () => {
    expect(pageSrc).toContain("工单数量TOP局点");
    expect(pageSrc).toContain("质量问题TOP局点");
    expect(pageSrc).toContain("ownQualityTopSite");
    expect(pageSrc).toContain("stats-ownership-echart-quality-top-site");
    expect(pageSrc).toContain("payload.top_site_quality");
    expect(pageSrc).toContain("payload.top_site || []");
    const allIdx = pageSrc.indexOf('renderOwnershipGlassCard("工单数量TOP局点"');
    const qIdx = pageSrc.indexOf('renderOwnershipGlassCard("质量问题TOP局点"');
    expect(allIdx).toBeGreaterThan(-1);
    expect(qIdx).toBeGreaterThan(allIdx);
  });
});

describe("工单度量质量问题TOP版本（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");

  test("新增质量问题TOP版本，工单数量TOP版本仍用全量 by_version_time", () => {
    expect(pageSrc).toContain("工单数量TOP版本");
    expect(pageSrc).toContain("质量问题TOP版本");
    expect(pageSrc).toContain("ownQualityTopVer");
    expect(pageSrc).toContain("stats-ownership-echart-quality-top-ver");
    expect(pageSrc).toContain("by_c_version_time_quality");
    expect(pageSrc).toContain("by_r_version_time_quality");
    expect(pageSrc).toContain("payload.by_version_time_quality");
    const allIdx = pageSrc.indexOf('renderOwnershipGlassCard("工单数量TOP版本"');
    const qIdx = pageSrc.indexOf('renderOwnershipGlassCard("质量问题TOP版本"');
    expect(allIdx).toBeGreaterThan(-1);
    expect(qIdx).toBeGreaterThan(allIdx);
  });
});

describe("工单度量质量问题TOP高发模块（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");
  const statsSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats.js"), "utf8");
  const stateSrc = fs.readFileSync(path.join(root, "frontend/modules/state/state.js"), "utf8");

  test("卡片改名为质量问题TOP高发模块，去掉 DTS 去重，模块默认全部，带显示条数", () => {
    expect(pageSrc).toContain("质量问题TOP高发模块");
    expect(pageSrc).not.toContain("一级模块透视问题数量");
    expect(pageSrc).not.toContain("DTS单号去重");
    expect(pageSrc).not.toContain("statsOwnershipL1DtsDedup");
    expect(pageSrc).toContain("statsOwnershipL1N");
    expect(pageSrc).toContain('`${l1ModuleKey}_raw`');
    expect(statsSrc).toContain('{ key: "all", label: "全部" }');
    expect(statsSrc).toContain("STAT_OWNERSHIP_L1_N_OPTIONS = [5, 10, 15, 20]");
    expect(statsSrc).toContain("export function statsOwnershipL1N");
    expect(stateSrc).toContain('statsOwnershipL1ModuleFilter: "all"');
    expect(stateSrc).not.toContain("statsOwnershipL1DtsDedup");
  });
});

describe("工单度量工单数量TOP版本（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");
  const statsSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats.js"), "utf8");

  test("新增工单数量TOP版本，独立版本粒度 + 显示条数 5/10/15/20，趋势图仍为折线", () => {
    expect(pageSrc).toContain("工单数量TOP版本");
    expect(pageSrc).not.toContain("全量问题TOP版本");
    expect(pageSrc).toContain("statsOwnershipTopVerGranularity");
    expect(pageSrc).toContain("statsOwnershipTopVerN");
    expect(pageSrc).toContain("版本工单数量趋势");
    expect(pageSrc).toContain('type: "line"');
    expect(statsSrc).toContain("STAT_OWNERSHIP_TOP_VER_N_OPTIONS = [5, 10, 15, 20]");
    expect(statsSrc).toContain("export function statsOwnershipTopVerN");
    expect(statsSrc).toContain("export function statsOwnershipTopEntriesFromTimeMap");
    expect(statsSrc).toContain("statsOwnershipTopVerGranularity");
  });
});

describe("工单度量全量问题TOP模块（源文件哨兵）", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "../../..");
  const pageSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats-page.js"), "utf8");
  const statsSrc = fs.readFileSync(path.join(root, "frontend/modules/pages/stats.js"), "utf8");

  test("已去掉全量问题TOP模块卡片与数据组装", () => {
    expect(pageSrc).not.toContain("全量问题TOP模块");
    expect(pageSrc).not.toContain("ownTopModuleBar");
    expect(pageSrc).not.toContain("stats-ownership-echart-top-mod");
    expect(pageSrc).not.toContain("payload.top_mod_intro");
    expect(statsSrc).not.toContain("buildStatsOwnershipTopModuleBarData");
  });
});

describe("statsOwnershipTopEntriesFromTimeMap", () => {
  function statsOwnershipTopEntriesFromTimeMap(byTime, n) {
    const parsed = Number(n);
    const lim = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10;
    return Object.keys(byTime || {})
      .map((name) => ({
        name,
        value: (byTime[name] || []).reduce((acc, v) => acc + (Number(v) || 0), 0),
      }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name), "zh-CN"))
      .slice(0, lim);
  }

  test("按合计降序截取 TOP N，过滤 0 值", () => {
    const byTime = {
      A: [1, 1],
      B: [5, 0],
      C: [0, 0],
      D: [3, 3],
    };
    expect(statsOwnershipTopEntriesFromTimeMap(byTime, 2)).toEqual([
      { name: "D", value: 6 },
      { name: "B", value: 5 },
    ]);
  });

  test("非法条数回落到默认 10", () => {
    const byTime = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`v${String(i).padStart(2, "0")}`, [12 - i]])
    );
    expect(statsOwnershipTopEntriesFromTimeMap(byTime, 0)).toHaveLength(10);
    expect(statsOwnershipTopEntriesFromTimeMap(byTime, 5)).toHaveLength(5);
  });
});

describe("formatOwnershipVersionAxisTooltip", () => {
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatOwnershipVersionAxisTooltip(params) {
    const list = Array.isArray(params) ? params : params ? [params] : [];
    if (!list.length) return "";
    const axis = String(list[0]?.axisValueLabel ?? list[0]?.axisValue ?? "");
    const rows = list
      .map((p) => ({
        marker: p.marker || "",
        name: String(p.seriesName || ""),
        value: Number(p.value) || 0,
      }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh-CN"));
    if (!rows.length) return escapeHtml(axis);
    return `${escapeHtml(axis)}<br/>${rows
      .map((r) => `${r.marker}${escapeHtml(r.name)}: ${r.value}`)
      .join("<br/>")}`;
  }

  test("只列数量>0并按数量降序", () => {
    const html = formatOwnershipVersionAxisTooltip([
      { axisValueLabel: "2026-01", marker: "•", seriesName: "A", value: 0 },
      { axisValueLabel: "2026-01", marker: "•", seriesName: "B", value: 2 },
      { axisValueLabel: "2026-01", marker: "•", seriesName: "C", value: 5 },
    ]);
    expect(html).toBe("2026-01<br/>•C: 5<br/>•B: 2");
  });

  test("该时间点全为0时仅显示轴标签", () => {
    expect(
      formatOwnershipVersionAxisTooltip([
        { axisValue: "2026-01", seriesName: "A", value: 0 },
        { axisValue: "2026-01", seriesName: "B", value: 0 },
      ])
    ).toBe("2026-01");
  });
});

describe("bindStatsOwnershipVerTooltipPreferWheel", () => {
  test("重复绑定同一 DOM 只挂一次监听", () => {
    const listeners = [];
    const dom = {
      __statsVerTipWheelBound: false,
      addEventListener(type, fn, opts) {
        listeners.push({ type, fn, opts });
      },
    };
    function bindStatsOwnershipVerTooltipPreferWheel(el) {
      if (!el || el.__statsVerTipWheelBound) return;
      el.__statsVerTipWheelBound = true;
      el.addEventListener("wheel", () => {}, { capture: true, passive: false });
    }
    bindStatsOwnershipVerTooltipPreferWheel(dom);
    bindStatsOwnershipVerTooltipPreferWheel(dom);
    expect(dom.__statsVerTipWheelBound).toBe(true);
    expect(listeners).toHaveLength(1);
    expect(listeners[0].type).toBe("wheel");
    expect(listeners[0].opts.capture).toBe(true);
  });
});
