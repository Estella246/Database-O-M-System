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
  const direct = String(ticket?.hcsVersion || ticket?.version || "").trim();
  if (direct) return direct;
  const desc = String(ticket?.description || "");
  const m = desc.match(/(\d+\.\d+(?:\.\d+)?(?:\.SPC\d+)?)/);
  if (m) return m[1];
  return "未知版本";
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
