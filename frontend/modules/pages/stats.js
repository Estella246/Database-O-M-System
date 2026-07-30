import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { normalizeIssueSeverity, normalizeDutyCascadeValue } from "../utils/normalize.js";
import { ticketCreatedAtMs, formatYmdLocal } from "../utils/format.js";
import { parseYmdToDate } from "../utils/date.js";
import { WORKFLOW_NODES } from "../constants/workflow.js";

export const STAT_LABOR_DEMO_ROSTER = {
  内核一组: ["张三", "李四", "王五", "孙八"],
  管控二组: ["赵六", "钱七"],
  尖刀连: ["周九", "吴十", "郑一"],
  特战队: ["陈二", "刘三"],
  突击队: ["杨四", "黄五", "林六"],
};
export const STAT_LABOR_STACK_STAGES = ["问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭"];
export const STAT_LABOR_PIE_STAGES = [...WORKFLOW_NODES, "关闭", "暂时挂起"];
export const STAT_LABOR_CHART_COLORS = [
  "#facc15",
  "#fbbf24",
  "#f59e0b",
  "#f97316",
  "#ea580c",
  "#ef4444",
  "#dc2626",
  "#b91c1c",
  "#06b6d4",
  "#22c55e",
  "#e879f9",
];
export const STAT_LABOR_STACK_CHART_COLORS = [
  "#d32f2f",
  "#f57c00",
  "#fbc02d",
  "#388e3c",
  "#00838f",
  "#1565c0",
  "#6a1b9a",
  "#c2185b",
];
export const STAT_LABOR_SELECT_STATE_KEYS = new Set([
  "statsLaborProductLine",
  "statsLaborGroup",
  "statsLaborDomain",
  "statsLaborQuality",
  "statsLaborComponent",
  "statsLaborOpenHoldPersonStage",
]);
export const STAT_LABOR_FIELD_STATE_KEYS = new Set(["statsLaborInputCollab"]);

export const STAT_OWNERSHIP_VERSIONS_FULL = [
  "505.2.0",
  "505.1.1",
  "505.2.RC1",
  "505.1.0",
  "505.0.0",
  "503.2.0",
  "V500R002C00",
  "V500R002C10",
  "V500R001C00",
  "V500R001C10",
  "V500R001C20",
];
export const STAT_OWNERSHIP_VERSIONS_SHORT = ["505.2", "505.1", "503.1", "506.0", "505.0"];
export const STAT_OWNERSHIP_BIZ_ENVS = ["电信云", "移动云", "金融专网", "政务云", "互联网", "混合云"];
export const STAT_OWNERSHIP_R_LINES = ["503", "505", "506", "507", "V5R001", "V5R002"];
export const STAT_OWNERSHIP_MULTILINE_REF_COLORS = [
  "#2563eb",
  "#84cc16",
  "#eab308",
  "#fb7185",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#15803d",
];
export const STAT_OWNERSHIP_CORE_C = ["505.2.1", "505.1.0", "503.2.0", "506.0.0", "505.0.0"];
export const STAT_OWNERSHIP_SPC = [
  "505.2.1.SPC0800",
  "505.2.1.B021",
  "506.0.0.SPC0100",
  "503.1.0.SPC2000",
  "505.2.0.SPC0100",
];
export const STAT_OWNERSHIP_MODULES_L3 = ["事务管理", "OM", "逻辑复制", "索引管理", "备份恢复", "查询优化"];
export const STAT_OWNERSHIP_MODULES_L1 = [
  { key: "storage", label: "存储引擎" },
  { key: "sql", label: "SQL引擎" },
  { key: "peripheral", label: "周边组件" },
];
export const STAT_OWNERSHIP_SITE_NAMES = [
  "华东-杭州局点",
  "华北-北京局点",
  "华南-深圳局点",
  "西南-成都局点",
  "金融-上海局点",
  "政务-西安局点",
  "混合-武汉局点",
  "测试-苏州局点",
  "生产-南京局点",
  "灾备-广州局点",
  "研发-廊坊局点",
  "外场-青岛局点",
  "核心-重庆局点",
  "边缘-厦门局点",
  "园区-天津局点",
];
export const STAT_OWNERSHIP_SELECT_KEYS = new Set([
  "statsOwnershipPrecision",
  "statsOwnershipQuality",
  "statsOwnershipComponent",
  "statsOwnershipSunburstKind",
  "statsOwnershipL1Class",
  "statsOwnershipL1ModuleFilter",
  "statsOwnershipL1DtsDedup",
  "statsOwnershipTopSiteN",
  "statsOwnershipTopInstanceSiteN",
  "statsOwnershipTopModuleKind",
  "statsOwnershipHotspotKind",
]);

// Doer辅助使用选项值常量
export const STAT_DOER_ASSIST_VALUES = [
  "使用Doer，问题定位/解决",
  "使用Doer，仅提供思路/辅助提效",
  "使用Doer，无帮助",
  "未使用Doer",
  "紧急疑难工单",
];

// Doer使用情况优先级定义（数值越大优先级越高，用于向上取整）
export const STAT_DOER_CATEGORY_PRIORITY = {
  doer_resolved: 5,    // 问题定位/解决（最高）
  doer_helped: 4,      // 思路/辅助提效
  doer_no_help: 3,     // 无帮助
  no_doer: 2,          // 未使用Doer
  urgent_hard: 2,      // 紧急疑难工单（同级）
  not_filled: 1,       // 未填写
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

// Doer统计分类函数：根据工单节点数据返回Doer使用情况分类（保留原函数，兼容只统计运维分析）
export function statsTicketDoerAssistCategory(ticketNodeData) {
  return classifySinglePhaseDoerAssist(ticketNodeData?.ops_analysis);
}

// 多阶段Doer分类函数：支持运维分析和开发分析两阶段，向上取整取优先级最高值
export function statsTicketDoerAssistCategoryMulti(ticketNodeData, includeOps, includeDev) {
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

export function statLaborHash(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) h = Math.imul(31, h) + str.charCodeAt(i) || 0;
  return Math.abs(h);
}

export function statLaborRand(seed, i) {
  const x = Math.sin(statLaborHash(String(seed)) + i * 999.983) * 10000;
  return x - Math.floor(x);
}

export function statLaborPeopleForGroupFilter(groupFilter) {
  const g = String(groupFilter || "").trim();
  if (g && STAT_LABOR_DEMO_ROSTER[g]) return [...STAT_LABOR_DEMO_ROSTER[g]];
  if (g) {
    const base = STAT_LABOR_DEMO_ROSTER[Object.keys(STAT_LABOR_DEMO_ROSTER)[0]] || [];
    return base.map((n) => `${n}·${g.slice(0, 2)}`);
  }
  const out = [];
  Object.values(STAT_LABOR_DEMO_ROSTER).forEach((arr) => arr.forEach((n) => out.push(n)));
  return out;
}

export function statLaborSeriesInt(seed, n, minV, maxV) {
  return Array.from({ length: n }, (_, i) => {
    const r = statLaborRand(seed, i);
    return minV + Math.floor(r * (maxV - minV + 1));
  });
}

/** 柱状图：将 { 标签: 数值 } 转为 labels/values，按数值从大到小排序 */
export function statLaborBarEntriesDesc(record) {
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

/**
 * 人力投入人员轴：截取已按合计降序的前 N 人。
 * limit 未传或 ≤0 时返回原数组（放大弹窗用）；卡片区默认 15。
 */
export function statLaborTakeTopPeople(labels, values, limit) {
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

export function statLaborBarTopRoundPath(x, y, w, h, rMax) {
  const hh = Math.max(h, 0);
  if (hh < 0.5) return "";
  const rr = Math.min(Math.max(rMax, 0), w / 2, hh / 2, 9);
  if (rr < 0.75) {
    return `M${x},${y + hh}L${x},${y}L${x + w},${y}L${x + w},${y + hh}Z`;
  }
  return `M${x},${y + hh}L${x},${y + rr}Q${x},${y} ${x + rr},${y}L${x + w - rr},${y}Q${x + w},${y} ${x + w},${y + rr}L${x + w},${y + hh}Z`;
}

export function statLaborSvgBarVertical(labels, values, opts = {}) {
  const W = 560;
  const H = 260;
  const pl = 40;
  const pr = 20;
  const pb = 56;
  const pt = 28;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(labels.length, 1);
  const gap = 6;
  const bw = Math.max(10, Math.min(44, (innerW - gap * (n - 1)) / n));
  const maxVal = Math.max(1, ...values, opts.maxHint || 0);
  let rects = "";
  labels.forEach((lab, i) => {
    const v = values[i] || 0;
    const h = (v / maxVal) * innerH;
    const slot = innerW / n;
    const x = pl + i * slot + (slot - bw) / 2;
    const y = pt + innerH - h;
    const fh = opts.fills && opts.fills[i];
    let fill = STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length];
    if (fh) {
      if (String(fh).startsWith("url(")) fill = String(fh);
      else if (String(fh).startsWith("#")) fill = String(fh);
      else fill = String(fh);
    }
    const bh = Math.max(h, 1);
    const cx = x + bw / 2;
    const d = statLaborBarTopRoundPath(x, y, bw, bh, 6);
    rects += `<path class="stat-bar-rect" d="${d}" fill="${fill}" style="--stat-bar-i:${i}"><title>${escapeHtml(String(lab))}: ${v}</title></path>`;
    if (opts.showValues && v > 0) rects += `<text class="stat-bar-val" x="${cx}" y="${y - 4}" text-anchor="middle">${v}</text>`;
  });
  let yAxis = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round((maxVal * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxis += `<text class="stat-axis-text" x="4" y="${y + 4}">${val}</text>`;
    yAxis += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }
  let xLabels = "";
  labels.forEach((lab, i) => {
    const slot = innerW / n;
    const cx = pl + i * slot + slot / 2;
    const short = String(lab).length > 5 ? `${String(lab).slice(0, 4)}…` : String(lab);
    xLabels += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 12}" transform="rotate(-22 ${cx} ${H - 12})">${escapeHtml(short)}</text>`;
  });
  return `<svg class="stat-svg-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(
    opts.aria || "柱状图"
  )}">${yAxis}${rects}${xLabels}</svg>`;
}

export function statLaborSvgMultiLine(labels, seriesList, opts = {}) {
  const W = 560;
  const H = 260;
  const pl = 44;
  const pr = 18;
  const pb = 52;
  const pt = 28;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(labels.length, 1);
  let maxVal = 1;
  for (const s of seriesList) {
    for (const v of s.values) {
      const nv = Number(v) || 0;
      if (nv > maxVal) maxVal = nv;
    }
  }
  if (opts.maxHint && opts.maxHint > maxVal) maxVal = opts.maxHint;
  let yAxis = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round((maxVal * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxis += `<text class="stat-axis-text" x="4" y="${y + 4}">${val}</text>`;
    yAxis += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }
  let xLabels = "";
  labels.forEach((lab, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const cx = pl + t * innerW;
    const short = String(lab).length > 7 ? `${String(lab).slice(0, 6)}…` : String(lab);
    xLabels += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 12}" transform="rotate(-20 ${cx} ${H - 12})">${escapeHtml(short)}</text>`;
  });
  let paths = "";
  let dots = "";
  for (let si = 0; si < seriesList.length; si++) {
    const s = seriesList[si];
    const stroke = s.stroke || STAT_LABOR_CHART_COLORS[si % STAT_LABOR_CHART_COLORS.length];
    const nums = s.values.map((v) => Number(v) || 0);
    const pts = nums.map((vn, i) => {
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const x = pl + t * innerW;
      const y = pt + innerH - (vn / maxVal) * innerH;
      return { x, y, vn };
    });
    const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
    paths += `<path class="stat-line-path" d="${lineD || ""}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
    dots += pts.map((p, i) =>
      `<circle class="stat-line-dot stat-line-dot--multi" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${stroke}" style="--stat-line-i:${i}"><title>${escapeHtml(String(labels[i] || ""))} · ${escapeHtml(s.name || "")}: ${p.vn}</title></circle>`
    ).join("");
  }
  return `<svg class="stat-svg-chart stat-svg-chart--line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(opts.aria || "多线折线图")}">${yAxis}${paths}${dots}${xLabels}</svg>`;
}

/**
 * 双Y轴多折线图（左侧小时，右侧百分比）
 * 用于展示滞留时间和效率提升百分比的对比趋势
 * 效率提升百分比可能为负数，需要独立Y轴避免超出图表
 * @param {Array} labels - X轴标签
 * @param {Array} seriesList - 折线数据数组，前N-1条用左Y轴，最后一条用右Y轴
 * @param {Object} opts - 配置选项 { aria, leftUnit, rightUnit, leftMaxHint, rightMinHint, rightMaxHint }
 */
export function statLaborSvgDualAxisMultiLine(labels, seriesList, opts = {}) {
  const W = 600;
  const H = 280;
  const pl = 48;  // 左侧Y轴空间
  const pr = 52;  // 右侧Y轴空间
  const pb = 56;
  const pt = 32;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(labels.length, 1);

  // 分离左Y轴系列（小时）和右Y轴系列（百分比）
  const leftSeries = seriesList.slice(0, -1);  // 前N-1条用左Y轴
  const rightSeries = seriesList.length > 1 ? seriesList[seriesList.length - 1] : null;

  // 计算左Y轴范围（小时，从0开始）
  let leftMax = 1;
  for (const s of leftSeries) {
    for (const v of s.values) {
      const nv = Number(v) || 0;
      if (nv > leftMax) leftMax = nv;
    }
  }
  if (opts.leftMaxHint && opts.leftMaxHint > leftMax) leftMax = opts.leftMaxHint;
  const leftMin = 0;

  // 计算右Y轴范围（百分比，支持负数）
  let rightMax = 100;
  let rightMin = 0;
  if (rightSeries) {
    for (const v of rightSeries.values) {
      const nv = Number(v) || 0;
      if (nv > rightMax) rightMax = nv;
      if (nv < rightMin) rightMin = nv;
    }
    // 自动扩展范围，确保有合理刻度
    if (rightMin < 0) {
      // 向下扩展到更负的整数刻度
      const absMin = Math.abs(rightMin);
      const step = Math.max(10, Math.ceil(absMin / 10) * 10);
      rightMin = -step;
    }
    if (rightMax < 50) rightMax = 50;  // 至少到50%
    if (opts.rightMinHint && opts.rightMinHint < rightMin) rightMin = opts.rightMinHint;
    if (opts.rightMaxHint && opts.rightMaxHint > rightMax) rightMax = opts.rightMaxHint;
  }
  const rightSpan = Math.max(rightMax - rightMin, 1);

  // 左侧Y轴刻度（小时）
  let yAxisLeft = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round((leftMax * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxisLeft += `<text class="stat-axis-text" x="8" y="${y + 4}">${val}</text>`;
    yAxisLeft += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }
  // 左侧单位提示
  if (opts.leftUnit) {
    yAxisLeft += `<text class="stat-line-unit" x="${pl}" y="${pt - 6}">${escapeHtml(opts.leftUnit)}</text>`;
  }

  // 右侧Y轴刻度（百分比）
  let yAxisRight = "";
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round(rightMin + (rightSpan * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxisRight += `<text class="stat-axis-text stat-axis-text--right" x="${W - 8}" y="${y + 4}">${val}%</text>`;
  }

  // X轴标签
  let xLabels = "";
  labels.forEach((lab, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const cx = pl + t * innerW;
    const short = String(lab).length > 5 ? `${String(lab).slice(0, 4)}…` : String(lab);
    xLabels += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 12}" transform="rotate(-22 ${cx} ${H - 12})">${escapeHtml(short)}</text>`;
  });

  let paths = "";
  let dots = "";

  // 渲染左Y轴折线（小时）
  for (let si = 0; si < leftSeries.length; si++) {
    const s = leftSeries[si];
    const stroke = s.stroke || STAT_LABOR_CHART_COLORS[si % STAT_LABOR_CHART_COLORS.length];
    const nums = s.values.map((v) => Number(v) || 0);
    const pts = nums.map((vn, i) => {
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const x = pl + t * innerW;
      const y = pt + innerH - (vn / leftMax) * innerH;
      return { x, y, vn };
    });
    const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
    paths += `<path class="stat-line-path" d="${lineD || ""}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
    dots += pts.map((p, i) =>
      `<circle class="stat-line-dot stat-line-dot--multi" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${stroke}" style="--stat-line-i:${i}"><title>${escapeHtml(String(labels[i] || ""))} · ${escapeHtml(s.name || "")}: ${p.vn.toFixed(1)}h</title></circle>`
    ).join("");
  }

  // 渲染右Y轴折线（百分比）
  if (rightSeries) {
    const stroke = rightSeries.stroke || "#f97316";
    // 过滤无效值，确保连线连续
    const validPts = [];
    rightSeries.values.forEach((v, i) => {
      const vn = Number(v);
      if (!Number.isFinite(vn)) return;  // 跳过无效值
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const x = pl + t * innerW;
      // 使用右Y轴范围计算位置
      const y = pt + innerH - ((vn - rightMin) / rightSpan) * innerH;
      validPts.push({ x, y, vn, i });
    });
    // 生成路径：连续有效点之间连线
    let lineD = "";
    let segmentStart = true;
    validPts.forEach((p) => {
      if (segmentStart) {
        lineD += `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
        segmentStart = false;
      } else {
        lineD += `L ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
      }
    });
    paths += `<path class="stat-line-path stat-line-path--pct" d="${lineD || ""}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
    dots += validPts.map((p) =>
      `<circle class="stat-line-dot stat-line-dot--pct" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${stroke}" style="--stat-line-i:${p.i}"><title>${escapeHtml(String(labels[p.i] || ""))} · ${escapeHtml(rightSeries.name || "")}: ${p.vn}%</title></circle>`
    ).join("");
  }

  // 图例
  const legendHtml = `<div class="stat-dual-axis-legend">
    ${leftSeries.map((s, i) => `<span class="stat-dual-axis-legend-item"><i style="background:${s.stroke || STAT_LABOR_CHART_COLORS[i]}"></i>${escapeHtml(s.name || "")}</span>`).join("")}
    ${rightSeries ? `<span class="stat-dual-axis-legend-item stat-dual-axis-legend-item--pct"><i style="background:${rightSeries.stroke}"></i>${escapeHtml(rightSeries.name || "")}</span>` : ""}
  </div>`;

  const svg = `<svg class="stat-svg-chart stat-svg-chart--dual-axis" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(opts.aria || "双Y轴折线图")}">${yAxisLeft}${yAxisRight}${paths}${dots}${xLabels}</svg>`;

  return `${legendHtml}${svg}`;
}

export function statLaborSvgLine(labels, values, opts = {}) {
  const W = 560;
  const H = 260;
  const pl = 44;
  const pr = 18;
  const pb = 52;
  const pt = 28;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(labels.length, 1);
  const nums = values.map((v) => Number(v) || 0);
  const maxVal = Math.max(1, ...nums, opts.maxHint || 0);
  const minVal = opts.minHint !== undefined ? opts.minHint : 0;
  const span = Math.max(maxVal - minVal, 1e-6);
  const pts = values.map((v, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const x = pl + t * innerW;
    const vn = Number(v) || 0;
    const y = pt + innerH - ((vn - minVal) / span) * innerH;
    return { x, y, vn };
  });
  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const areaD =
    pts.length > 1
      ? `${lineD} L ${pts[pts.length - 1].x.toFixed(2)} ${(pt + innerH).toFixed(2)} L ${pts[0].x.toFixed(2)} ${(pt + innerH).toFixed(2)} Z`
      : "";
  const stroke = opts.stroke || "#ea580c";
  const gradId = `stat-line-grad-${Math.abs(statLaborHash(opts.aria || "line"))}`;
  let yAxis = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = minVal + (span * t) / ticks;
    const disp =
      opts.yDecimals === 1 ? val.toFixed(1) : opts.yDecimals === 2 ? val.toFixed(2) : Math.round(val);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxis += `<text class="stat-axis-text" x="4" y="${y + 4}">${disp}</text>`;
    yAxis += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }
  let xLabels = "";
  labels.forEach((lab, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const cx = pl + t * innerW;
    const short = String(lab).length > 7 ? `${String(lab).slice(0, 6)}…` : String(lab);
    xLabels += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 12}" transform="rotate(-20 ${cx} ${H - 12})">${escapeHtml(short)}</text>`;
  });
  const unitHint = opts.yUnit ? `<text class="stat-line-unit" x="${pl}" y="${pt - 6}">${escapeHtml(String(opts.yUnit))}</text>` : "";
  const fillGrad = `<defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${stroke}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${stroke}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>`;
  const area = areaD ? `<path class="stat-line-area" d="${areaD}" fill="url(#${gradId})" />` : "";
  const pathEl = `<path class="stat-line-path" d="${lineD || ""}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
  const dots = pts
    .map(
      (p, i) =>
        `<circle class="stat-line-dot" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${stroke}" style="--stat-line-i:${i}"><title>${escapeHtml(String(labels[i] || ""))}: ${p.vn}</title></circle>`
    )
    .join("");
  return `<svg class="stat-svg-chart stat-svg-chart--line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(
    opts.aria || "折线图"
  )}">${fillGrad}${yAxis}${area}${pathEl}${dots}${unitHint}${xLabels}</svg>`;
}

/**
 * 柱状图+折线图组合图表
 * 柱状图显示数量，折线图显示占比百分比（右侧Y轴）
 * @param {Array} labels - X轴标签
 * @param {Array} barValues - 柱状图数值（数量）
 * @param {Array} lineValues - 折线图数值（百分比，0-100）
 * @param {Object} opts - 配置选项 { aria, barColor, lineColor, barLabel, lineLabel }
 */
export function statLaborSvgBarLineCombo(labels, barValues, lineValues, opts = {}) {
  const W = 640;
  const H = 280;
  const pl = 48; // 左侧Y轴空间
  const pr = 52; // 右侧Y轴空间（百分比）
  const pb = 56;
  const pt = 36;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(labels.length, 1);
  const gap = 6;
  const bw = Math.max(12, Math.min(40, (innerW - gap * (n - 1)) / n));

  // 柱状图最大值
  const maxBar = Math.max(1, ...barValues, opts.maxBarHint || 0);
  // 折线图固定最大100%
  const maxLine = 100;

  const barColor = opts.barColor || "#3b82f6";
  const lineColor = opts.lineColor || "#f97316";

  let bars = "";
  labels.forEach((lab, i) => {
    const v = barValues[i] || 0;
    const slot = innerW / n;
    const x = pl + i * slot + (slot - bw) / 2;
    const h = (v / maxBar) * innerH;
    const y = pt + innerH - h;
    const bh = Math.max(h, 1);
    const d = statLaborBarTopRoundPath(x, y, bw, bh, 6);
    bars += `<path class="stat-bar-rect" d="${d}" fill="${barColor}" style="--stat-bar-i:${i}">
      <title>${escapeHtml(String(lab))}: ${v}个</title>
    </path>`;
  });

  // 折线图点计算（百分比，右侧Y轴）
  // 过滤无效值，确保连线连续
  const validLinePts = [];
  lineValues.forEach((v, i) => {
    const numVal = Number(v);
    if (!Number.isFinite(numVal)) return;  // 跳过无效值
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const x = pl + t * innerW;
    const y = pt + innerH - (numVal / maxLine) * innerH;
    validLinePts.push({ x, y, v: numVal, i });
  });

  // 生成路径：连续有效点之间连线，无效点处断开后重新开始
  let lineD = "";
  let segmentStart = true;
  validLinePts.forEach((p) => {
    if (segmentStart) {
      lineD += `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
      segmentStart = false;
    } else {
      lineD += `L ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
    }
  });
  const linePath = `<path class="stat-line-path stat-line-path--combo" d="${lineD || ""}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
  const lineDots = validLinePts.map((p) =>
    `<circle class="stat-line-dot stat-line-dot--combo" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${lineColor}" style="--stat-line-i:${p.i}">
      <title>${escapeHtml(String(labels[p.i] || ""))}: ${p.v}%</title>
    </circle>`
  ).join("");

  // 左侧Y轴（数量）
  let yAxisLeft = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round((maxBar * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxisLeft += `<text class="stat-axis-text" x="8" y="${y + 4}">${val}</text>`;
    yAxisLeft += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }

  // 右侧Y轴（百分比）
  let yAxisRight = "";
  for (let t = 0; t <= ticks; t += 1) {
    const pct = Math.round((100 * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxisRight += `<text class="stat-axis-text stat-axis-text--right" x="${W - 8}" y="${y + 4}">${pct}%</text>`;
  }

  // X轴标签
  let xLabels = "";
  labels.forEach((lab, i) => {
    const slot = innerW / n;
    const cx = pl + i * slot + slot / 2;
    const short = String(lab).length > 5 ? `${String(lab).slice(0, 4)}…` : String(lab);
    xLabels += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 12}" transform="rotate(-22 ${cx} ${H - 12})">${escapeHtml(short)}</text>`;
  });

  // 图例
  const legendHtml = `<div class="stat-bar-line-legend">
    <span class="stat-bar-line-legend-item"><i style="background:${barColor}"></i>${escapeHtml(opts.barLabel || "数量")}</span>
    <span class="stat-bar-line-legend-item"><i style="background:${lineColor}"></i>${escapeHtml(opts.lineLabel || "占比")}</span>
  </div>`;

  const svg = `<svg class="stat-svg-chart stat-svg-chart--bar-line-combo" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(opts.aria || "柱状图+折线图组合")}">
    ${yAxisLeft}${yAxisRight}${bars}${linePath}${lineDots}${xLabels}
  </svg>`;

  return `${legendHtml}${svg}`;
}

export function statLaborSvgStackedBars(groups, seriesKeys, getValues, opts = {}) {
  const W = 580;
  const H = 280;
  const pl = 44;
  const pr = 24;
  const pb = 52;
  const pt = 36;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;
  const n = Math.max(groups.length, 1);
  const slot = innerW / n;
  const bw = Math.min(52, slot * 0.62);
  let maxStack = 1;
  const stacks = groups.map((g, gi) => {
    const vals = seriesKeys.map((k) => getValues(gi, k));
    const t = vals.reduce((a, b) => a + b, 0);
    maxStack = Math.max(maxStack, t);
    return vals;
  });
  let body = "";
  groups.forEach((g, gi) => {
    const vals = stacks[gi];
    const total = vals.reduce((a, b) => a + b, 0);
    const cx = pl + gi * slot + slot / 2;
    let yAcc = pt + innerH;
    let topSi = -1;
    for (let si = seriesKeys.length - 1; si >= 0; si -= 1) {
      if (vals[si] > 0) {
        topSi = si;
        break;
      }
    }
    const x0 = cx - bw / 2;
    vals.forEach((v, si) => {
      if (!v) return;
      const h = (v / maxStack) * innerH;
      yAcc -= h;
      const fill = STAT_LABOR_STACK_CHART_COLORS[si % STAT_LABOR_STACK_CHART_COLORS.length];
      const isTop = si === topSi;
      if (isTop) {
        const d = statLaborBarTopRoundPath(x0, yAcc, bw, h, 6);
        body += `<path class="stat-bar-rect stat-bar-rect--stack" d="${d}" fill="${fill}" style="--stat-bar-i:${gi + si}"><title>${escapeHtml(seriesKeys[si])}: ${v}</title></path>`;
      } else {
        body += `<rect class="stat-bar-rect stat-bar-rect--stack" x="${x0.toFixed(1)}" y="${yAcc.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" style="--stat-bar-i:${gi + si}"><title>${escapeHtml(seriesKeys[si])}: ${v}</title></rect>`;
      }
    });
    body += `<text class="stat-stack-total" x="${cx}" y="${pt + 4}">${total}</text>`;
    const short = String(g).length > 6 ? `${String(g).slice(0, 5)}…` : String(g);
    body += `<text class="stat-axis-text stat-axis-text--x" x="${cx}" y="${H - 14}" transform="rotate(-22 ${cx} ${H - 14})">${escapeHtml(short)}</text>`;
  });
  let yAxis = "";
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round((maxStack * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxis += `<text class="stat-axis-text" x="4" y="${y + 4}">${val}</text>`;
    yAxis += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }
  return `<svg class="stat-svg-chart stat-svg-chart--stacked" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(
    opts.aria || "堆叠柱状图"
  )}">${yAxis}${body}</svg>`;
}

export function statLaborSvgPie(slices, opts = {}) {
  const cx = 100;
  const cy = 100;
  const r = opts.donut ? 68 : 78;
  const normalized = (Array.isArray(slices) ? slices : []).map((s) => {
    const n = Number(s?.value);
    return {
      ...s,
      value: Number.isFinite(n) ? Math.max(0, n) : 0,
    };
  });
  const total = normalized.reduce((a, s) => a + s.value, 0);
  if (total <= 0) {
    return `<svg class="stat-pie-svg" viewBox="0 0 200 200" role="img" aria-label="${escapeAttr(
      opts.aria || "饼图"
    )}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(148, 163, 184, 0.22)" stroke="rgba(148, 163, 184, 0.45)" stroke-width="1.5"></circle></svg>`;
  }
  const positive = normalized
    .map((s, i) => ({ ...s, i }))
    .filter((s) => s.value > 0);
  if (positive.length === 1) {
    const only = positive[0];
    const hex = STAT_LABOR_CHART_COLORS[only.i % STAT_LABOR_CHART_COLORS.length];
    return `<svg class="stat-pie-svg" viewBox="0 0 200 200" role="img" aria-label="${escapeAttr(
      opts.aria || "饼图"
    )}"><circle class="stat-pie-slice" cx="${cx}" cy="${cy}" r="${r}" fill="${hex}" style="--stat-pie-i:${only.i}"><title>${escapeHtml(
      only.label
    )}: ${only.value} (100.0%)</title></circle></svg>`;
  }
  let angle = -Math.PI / 2;
  let paths = "";
  normalized.forEach((s, i) => {
    const frac = s.value / total;
    if (frac <= 0) return;
    const hex = STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length];
    const a2 = angle + frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = frac > 0.5 ? 1 : 0;
    paths += `<path class="stat-pie-slice" d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${hex}" style="--stat-pie-i:${i}"><title>${escapeHtml(s.label)}: ${s.value} (${((frac * 100).toFixed(1))}%)</title></path>`;
    angle = a2;
  });
  return `<svg class="stat-pie-svg" viewBox="0 0 200 200" role="img" aria-label="${escapeAttr(opts.aria || "饼图")}">${paths}</svg>`;
}

export function statLaborPieLegend(slices) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  return `<ul class="stat-pie-legend">
    ${slices
      .map((s, i) => {
        const pct = ((s.value / total) * 100).toFixed(1);
        const c = STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length];
        return `<li class="stat-pie-legend-item" style="--stat-pie-i:${i}"><span class="stat-pie-legend-dot" style="background:${c}"></span><span class="stat-pie-legend-label">${escapeHtml(s.label)}</span><span class="stat-pie-legend-val">${s.value}</span><span class="stat-pie-legend-pct">${pct}%</span></li>`;
      })
      .join("")}
  </ul>`;
}

export function statLaborStackLegend(keys) {
  return `<div class="stat-stack-legend" role="list">
    ${keys
      .map((k, i) => {
        const c = STAT_LABOR_STACK_CHART_COLORS[i % STAT_LABOR_STACK_CHART_COLORS.length];
        return `<span class="stat-stack-legend-item" role="listitem"><i style="background:${c}"></i>${escapeHtml(k)}</span>`;
      })
      .join("")}
  </div>`;
}

export function statOwnershipSplitLineStyle() {
  return { lineStyle: { color: "rgba(200, 192, 175, 0.38)", type: "dashed" } };
}

export function statOwnershipAxisLabel() {
  return { color: "#7a7368", fontSize: 11 };
}

/**
 * 多系列 axis tooltip（按版本透视 / 现网问题来源趋势等）：
 * 仅列出该时间点数量 > 0 的系列，并按数量降序。
 */
export function formatOwnershipVersionAxisTooltip(params) {
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

/** 按版本透视 tooltip DOM class（appendToBody 后用其定位） */
export const STATS_OWNERSHIP_VER_TOOLTIP_CLASS = "stats-ownership-ver-tooltip";

/**
 * 图表悬停出 tooltip 时，滚轮优先滚动 tooltip（避免被 dataZoom 抢走）。
 * @param {HTMLElement | null | undefined} dom 图表容器
 */
export function bindStatsOwnershipVerTooltipPreferWheel(dom) {
  if (!dom || typeof document === "undefined" || dom.__statsVerTipWheelBound) return;
  dom.__statsVerTipWheelBound = true;
  const tipSelector = `.${STATS_OWNERSHIP_VER_TOOLTIP_CLASS}`;
  const findTip = () => {
    const tip = document.querySelector(tipSelector);
    if (!tip) return null;
    const style = window.getComputedStyle(tip);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return null;
    }
    return tip;
  };
  dom.addEventListener(
    "wheel",
    (e) => {
      const tip = findTip();
      if (!tip) return;
      if (tip.scrollHeight <= tip.clientHeight + 1) return;
      tip.scrollTop += e.deltaY;
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true, passive: false }
  );
  // 鼠标已进入 tooltip（enterable）时，阻止事件冒泡到图表 dataZoom
  if (!document.__statsVerTipDocWheelBound) {
    document.__statsVerTipDocWheelBound = true;
    document.addEventListener(
      "wheel",
      (e) => {
        const tip = e.target?.closest?.(tipSelector);
        if (!tip) return;
        e.stopPropagation();
      },
      { capture: true, passive: true }
    );
  }
}

export function statsTicketDayYmd(ticket) {
  const s = String(ticket?.startDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = ticketCreatedAtMs(ticket);
  if (!ms) return "";
  return formatYmdLocal(new Date(ms));
}

export function statsNormalizePersonName(raw) {
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

export function statsFindAdminUserByPerson(raw, adminUsers) {
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

export function getStatsLaborProductLineOptions(adminUsers) {
  const set = new Set();
  (Array.isArray(adminUsers) ? adminUsers : []).forEach((u) => {
    const pl = String(u.product_line || "").trim();
    if (pl) set.add(pl);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function statsUserProductLineByPerson(raw, adminUsers) {
  const hit = statsFindAdminUserByPerson(raw, adminUsers);
  return hit ? String(hit.product_line || "").trim() : "";
}

/** 用户表 expert_domain 去重，供人力投入「领域」下拉 */
export function getStatsLaborDomainOptions(adminUsers) {
  const set = new Set();
  (Array.isArray(adminUsers) ? adminUsers : []).forEach((u) => {
    const d = String(u.expert_domain || "").trim();
    if (d) set.add(d);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function statsUserDomainByPerson(raw, adminUsers) {
  const hit = statsFindAdminUserByPerson(raw, adminUsers);
  return hit ? String(hit.expert_domain || "").trim() : "";
}

export function statsTicketMatchesLaborProductLine(ticket, productLineFilter, adminUsers) {
  const filter = String(productLineFilter || "").trim();
  if (!filter) return true;
  const raw = String(ticket?.currentHandler || ticket?.assignee || ticket?.creatorName || "").trim();
  return statsUserProductLineByPerson(raw, adminUsers) === filter;
}

export function statsTicketPersonName(ticket) {
  const raw = String(ticket?.currentHandler || ticket?.assignee || ticket?.creatorName || "").trim();
  return statsNormalizePersonName(raw) || "未分配";
}

export function statsTicketStage(ticket) {
  const st = String(ticket?.status || "").trim().toLowerCase();
  if (st === "closed") return "关闭";
  if (st === "suspended") return "暂时挂起";
  return String(ticket?.currentStage || ticket?.node || "").trim() || "问题审核";
}

export function statsTicketIsQuality(ticket) {
  const sev = normalizeIssueSeverity(ticket?.severity || "");
  return sev === "严重" || sev === "致命";
}

export function statsTicketQualityIssueValue(ticket) {
  const raw = String(ticket?.isQualityIssue ?? ticket?.is_quality_issue ?? "").trim();
  if (!raw) return "";
  if (raw.includes("新发现")) return "new";
  if (raw.includes("已知")) return "known";
  if (raw === "否") return "no";
  if (raw === "是") return "known";
  return "";
}

/** 问题归属：按顶部「是否质量问题 / 问题组件」筛选（与后端 stats_charts 口径一致） */
export function statsFilterOwnershipRows(rows, quality = "all", component = "all") {
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

export function statsTicketComponent(ticket) {
  const raw = String(ticket?.component || ticket?.problemComponent || "").trim();
  if (raw.includes("内核")) return "kernel";
  if (raw.includes("管控")) return "control";
  const desc = String(ticket?.description || "");
  if (desc.includes("内核")) return "kernel";
  if (desc.includes("管控")) return "control";
  return "all";
}

export function statsTicketVersion(ticket) {
  const gauss = String(ticket?.gauss_version ?? ticket?.gaussVersion ?? "").trim();
  return gauss || "未知版本";
}

export function statsOwnershipModuleKind(raw) {
  return raw === "owner" ? "owner" : "intro";
}

export function statsDedupeTicketsByDts(rows) {
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

export function statsIsSpcGaussVersion(ver) {
  const s = String(ver || "").trim();
  return /SPC/i.test(s) || /\.B\d/i.test(s);
}

export function statsIsCoreCGaussVersion(ver) {
  const s = String(ver || "").trim();
  if (!s || statsIsSpcGaussVersion(s)) return false;
  return /^\d+\.\d+\.\d+/.test(s);
}

function statsTopCountEntries(mapOrEntries, limit = 10) {
  const entries = mapOrEntries instanceof Map ? Array.from(mapOrEntries.entries()) : mapOrEntries;
  return entries.sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, Math.max(1, limit));
}

/** 一级模块透视：在指定一级模块下按二级模块计数 */
export function buildStatsOwnershipL1BarData(rows, kind = "intro", l1Label = "", dtsDedup = false) {
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

/** 全量问题 TOP 一级模块（未填写模块不计入） */
export function buildStatsOwnershipTopModuleBarData(rows, kind = "intro", limit = 10) {
  const moduleKind = statsOwnershipModuleKind(kind);
  const counts = statsCountBy(rows || [], (t) => {
    const path = statsTicketModulePath(t, moduleKind);
    if (!path) return null;
    const { l1 } = statsParseModulePathLevels(path);
    return l1 === "未填写" ? null : l1;
  });
  return statsTopCountEntries(counts, limit).map(([name, value]) => ({ name, value }));
}

/** SPC / B 版本 TOP 柱状图 */
export function buildStatsOwnershipSpcBarData(rows, { openOnly = false, limit = 10 } = {}) {
  let scoped = rows || [];
  if (openOnly) scoped = scoped.filter((t) => String(t?.status || "").toLowerCase() !== "closed");
  const filtered = scoped.filter((t) => statsIsSpcGaussVersion(statsTicketVersion(t)));
  return statsTopCountEntries(statsCountBy(filtered, (t) => statsTicketVersion(t)), limit).map(([name, value]) => ({
    name,
    value,
  }));
}

/** CORE C 版本 TOP 柱状图 */
export function buildStatsOwnershipCoreBarData(rows, limit = 10) {
  const filtered = (rows || []).filter((t) => statsIsCoreCGaussVersion(statsTicketVersion(t)));
  return statsTopCountEntries(statsCountBy(filtered, (t) => statsTicketVersion(t)), limit).map(([name, value]) => ({
    name,
    value,
  }));
}

/** 问题高发模块表：一级模块 × 版本 */
export function buildStatsOwnershipHotspotTableData(rows, kind = "intro", { moduleLimit = 8, versionLimit = 5 } = {}) {
  const moduleKind = statsOwnershipModuleKind(kind);
  const byL1 = statsCountBy(rows || [], (t) => statsParseModulePathLevels(statsTicketModulePath(t, moduleKind)).l1);
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
    const counts = versionCols.map(
      (ver) => rowTickets.filter((t) => statsTicketVersion(t) === ver).length
    );
    return { l1, counts };
  });
  return { moduleRows, versionCols, cells };
}

export function statsGroupByPrecisionLabel(ymd, precision) {
  const d = parseYmdToDate(ymd);
  if (!d) return "—";
  if (precision === "day") return `${d.getMonth() + 1}/${d.getDate()}`;
  if (precision === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (precision === "quarter") return `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`;
  return String(d.getFullYear());
}

export function statsCountBy(rows, keyFn) {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!k) return;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}

/** 工单列表中的问题引入/归属模块路径（后端已按节点继承合并为单值） */
export function statsTicketModulePath(ticket, kind = "intro") {
  const key = kind === "owner" ? "issue_owner_module" : "issue_intro_module";
  return normalizeDutyCascadeValue(ticket?.[key] ?? "");
}

/** 将「一级/二级/三级」模块路径拆为三级名称 */
export function statsParseModulePathLevels(path) {
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

/** 旭日图模块路径：只保留实际填写层级，跳过「未填写」占位 */
export function statsSunburstModuleParts(path) {
  return String(path || "")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "未填写");
}

/** 按工单模块路径构建旭日图三级树（leaf 为计数；未填写模块不计入） */
export function buildStatsOwnershipSunburstData(rows, kind = "intro") {
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
      const leafL1 = ((l2Map.get("__leaf__") || new Map()).get("__leaf__")) || 0;
      const children = l2Nodes(l2Map);
      if (children.length) return { name: l1, children };
      if (leafL1) return { name: l1, value: leafL1 };
      return null;
    })
    .filter(Boolean);
}

export function buildStatsOwnershipTimeLabels(startYmd, endYmd, precision) {
  const start = parseYmdToDate(startYmd);
  const end = parseYmdToDate(endYmd);
  if (!start || !end || start > end) return { labels: ["—"], n: 1 };
  const labels = [];
  if (precision === "day") {
    const d = new Date(start);
    const endT = end.getTime();
    let guard = 0;
    while (d.getTime() <= endT && guard < 400) {
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
      d.setDate(d.getDate() + 1);
      guard += 1;
    }
  } else if (precision === "month") {
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    const endM = new Date(end.getFullYear(), end.getMonth(), 1);
    while (d <= endM) {
      labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      d.setMonth(d.getMonth() + 1);
    }
  } else if (precision === "quarter") {
    const d = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
    const endT = end.getTime();
    let guard = 0;
    while (d.getTime() <= endT && guard < 80) {
      const q = Math.floor(d.getMonth() / 3) + 1;
      labels.push(`${d.getFullYear()}Q${q}`);
      d.setMonth(d.getMonth() + 3);
      guard += 1;
    }
  } else {
    for (let y = start.getFullYear(); y <= end.getFullYear(); y += 1) labels.push(String(y));
  }
  if (!labels.length) labels.push("—");
  return { labels, n: labels.length };
}

/**
 * 分组柱状图（每个分组有多个并列柱子）
 * 用于对比两组数据在各阶段的情况
 * @param {Array} groups - 分组标签数组（如阶段名称）
 * @param {Array} seriesNames - 系列名称数组（如["使用Doer", "未使用Doer"]）
 * @param {Function} getValues - (groupIndex, seriesIndex) => number
 * @param {Object} opts - 配置选项 { aria, seriesColors, yUnit, maxHint }
 */
export function statLaborSvgGroupedBars(groups, seriesNames, getValues, opts = {}) {
  const W = 620;
  const H = 300;
  const pl = 52;
  const pr = 28;
  const pb = 60;
  const pt = 40;
  const innerW = W - pl - pr;
  const innerH = H - pt - pb;

  const nGroups = Math.max(groups.length, 1);
  const nSeries = Math.max(seriesNames.length, 1);
  const groupWidth = innerW / nGroups;
  const barGap = 4;
  const barWidth = Math.max(12, Math.min(36, (groupWidth - barGap * (nSeries - 1)) / nSeries));

  // 计算最大值
  let maxVal = 1;
  for (let gi = 0; gi < nGroups; gi++) {
    for (let si = 0; si < nSeries; si++) {
      const v = getValues(gi, si) || 0;
      if (v > maxVal) maxVal = v;
    }
  }
  if (opts.maxHint && opts.maxHint > maxVal) maxVal = opts.maxHint;

  const seriesColors = opts.seriesColors || STAT_LABOR_CHART_COLORS.slice(0, nSeries);

  let bars = "";
  groups.forEach((group, gi) => {
    const groupCenterX = pl + gi * groupWidth + groupWidth / 2;
    const seriesTotalWidth = barWidth * nSeries + barGap * (nSeries - 1);
    const startX = groupCenterX - seriesTotalWidth / 2;

    for (let si = 0; si < nSeries; si++) {
      const val = getValues(gi, si) || 0;
      if (val === 0) continue;

      const barX = startX + si * (barWidth + barGap);
      const barH = (val / maxVal) * innerH;
      const barY = pt + innerH - barH;
      const fill = seriesColors[si] || STAT_LABOR_CHART_COLORS[si % STAT_LABOR_CHART_COLORS.length];

      const d = statLaborBarTopRoundPath(barX, barY, barWidth, Math.max(barH, 1), 6);
      bars += `<path class="stat-bar-rect stat-bar-rect--grouped" d="${d}" fill="${fill}" style="--stat-bar-i:${gi * nSeries + si}">
        <title>${escapeHtml(group)} · ${escapeHtml(seriesNames[si])}: ${val.toFixed(1)}h</title>
      </path>`;
    }

    // X轴标签（阶段名称）
    const shortLabel = String(group).length > 5 ? `${String(group).slice(0, 4)}…` : String(group);
    bars += `<text class="stat-axis-text stat-axis-text--x" x="${groupCenterX}" y="${H - 12}"
      transform="rotate(-22 ${groupCenterX} ${H - 12})">${escapeHtml(shortLabel)}</text>`;
  });

  // Y轴刻度
  let yAxis = "";
  const ticks = 5;
  for (let t = 0; t <= ticks; t++) {
    const val = Math.round((maxVal * t) / ticks);
    const y = pt + innerH - (t / ticks) * innerH;
    yAxis += `<text class="stat-axis-text" x="8" y="${y + 4}">${val}</text>`;
    yAxis += `<line class="stat-grid-line" x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}"/>`;
  }

  // 单位提示
  const unitHint = opts.yUnit ? `<text class="stat-line-unit" x="${pl}" y="${pt - 8}">${escapeHtml(opts.yUnit)}</text>` : "";

  return `<svg class="stat-svg-chart stat-svg-chart--grouped" viewBox="0 0 ${W} ${H}"
    preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(opts.aria || '分组柱状图')}">
    ${yAxis}${bars}${unitHint}
  </svg>`;
}

/**
 * 分组柱状图图例HTML
 * @param {Array} seriesNames - 系列名称数组
 * @param {Array} seriesColors - 系列颜色数组
 * @param {Array} seriesCounts - 系列数量数组（可选）
 */
export function statLaborGroupedLegend(seriesNames, seriesColors, seriesCounts = []) {
  const items = seriesNames.map((name, i) => {
    const color = seriesColors[i] || STAT_LABOR_CHART_COLORS[i];
    const countStr = seriesCounts[i] !== undefined ? ` (${seriesCounts[i]}个)` : "";
    return `<span class="stat-grouped-legend-item" role="listitem">
      <i class="stat-grouped-legend-color" style="background:${color}"></i>${escapeHtml(name)}${countStr}
    </span>`;
  });
  return `<div class="stat-grouped-legend" role="list">${items.join("")}</div>`;
}

const STAT_LABOR_ECHART_TOOLTIP = {
  trigger: "axis",
  backgroundColor: "rgba(255, 252, 244, 0.94)",
  borderColor: "rgba(220, 212, 198, 0.9)",
  textStyle: { color: "#4a453d", fontSize: 12 },
};

const STAT_LABOR_ECHART_ANIM = { animation: true, animationDuration: 980, animationEasing: "cubicOut" };

/** 人力投入：ECharts 柱状图 */
export function buildStatsLaborEchartBarOption(labels, values, opts = {}) {
  const labs = labels?.length ? labels : ["—"];
  const vals = values?.length ? values : labs.map(() => 0);
  const colors = opts.colors || labs.map((_, i) => STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length]);
  const rotate = labs.length > 8 ? 28 : labs.length > 4 ? 22 : 0;
  return withStatsCategoryXDataZoom({
    ...STAT_LABOR_ECHART_ANIM,
    color: STAT_LABOR_CHART_COLORS,
    tooltip: STAT_LABOR_ECHART_TOOLTIP,
    grid: { left: 48, right: 16, top: opts.yUnit ? 36 : 28, bottom: rotate ? 56 : 44 },
    xAxis: {
      type: "category",
      data: labs,
      axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate },
    },
    yAxis: {
      type: "value",
      name: opts.yUnit || "",
      nameTextStyle: { fontSize: 11, color: "#5c574f" },
      splitLine: statOwnershipSplitLineStyle(),
      axisLabel: statOwnershipAxisLabel(),
    },
    series: [
      {
        type: "bar",
        data: vals.map((v, i) => ({
          value: v,
          itemStyle: {
            color: colors[i] || STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length],
            borderRadius: [8, 8, 0, 0],
          },
        })),
        barWidth: "52%",
      },
    ],
  });
}

/**
 * 人力投入：ECharts 堆叠柱状图
 * @param {Function} getValues - (groupIndex, seriesKey) => number；第二参为系列名（与 SVG 堆叠柱一致）
 * @param {Object} [opts]
 * @param {string[]} [opts.seriesColors] 系列色；不传则用 STAT_LABOR_STACK_CHART_COLORS
 * 柱顶数字默认各阶段单数之和（放大弹窗须保留 label.formatter，见 buildStatsOwnershipZoomChartOption）
 */
export function buildStatsLaborEchartStackedBarOption(groups, seriesKeys, getValues, opts = {}) {
  const grps = groups?.length ? groups : ["—"];
  const keys = seriesKeys?.length ? seriesKeys : ["—"];
  const seriesColors = Array.isArray(opts.seriesColors) ? opts.seriesColors : null;
  const rotate = grps.length > 8 ? 28 : grps.length > 4 ? 22 : 0;
  const totals = grps.map((_, gi) =>
    keys.reduce((sum, key) => sum + (Number(getValues(gi, key)) || 0), 0)
  );
  const series = keys.map((name, si) => ({
    name,
    type: "bar",
    stack: "total",
    barWidth: "52%",
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
            position: "top",
            color: "#5c574f",
            fontSize: 11,
            formatter: (params) => {
              const t = totals[params.dataIndex];
              return t > 0 ? String(t) : "";
            },
          },
        }
      : {}),
  }));
  return withStatsCategoryXDataZoom({
    ...STAT_LABOR_ECHART_ANIM,
    tooltip: {
      ...STAT_LABOR_ECHART_TOOLTIP,
      axisPointer: { type: "shadow" },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      textStyle: { fontSize: 10, color: "#5c574f" },
    },
    grid: { left: 48, right: 16, top: opts.yUnit ? 36 : 28, bottom: rotate ? 88 : 72 },
    xAxis: {
      type: "category",
      data: grps,
      axisLabel: { ...statOwnershipAxisLabel(), interval: 0, rotate },
    },
    yAxis: {
      type: "value",
      name: opts.yUnit || "",
      nameTextStyle: { fontSize: 11, color: "#5c574f" },
      splitLine: statOwnershipSplitLineStyle(),
      axisLabel: statOwnershipAxisLabel(),
    },
    series,
  });
}

/** 人力投入：ECharts 饼图（多阶段类目，图例置底避免与环形图重叠） */
export function buildStatsLaborEchartPieOption(slices, opts = {}) {
  const items = (slices || []).filter((s) => s && String(s.label || "").trim());
  const data = (items.length ? items : [{ label: "暂无数据", value: 0 }]).map((s, i) => ({
    name: String(s.label || "—"),
    value: Number(s.value) || 0,
    itemStyle: { color: STAT_LABOR_CHART_COLORS[i % STAT_LABOR_CHART_COLORS.length] },
  }));
  return {
    ...STAT_LABOR_ECHART_ANIM,
    color: STAT_LABOR_CHART_COLORS,
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(255, 252, 244, 0.94)",
      borderColor: "rgba(220, 212, 198, 0.9)",
      textStyle: { color: "#4a453d", fontSize: 12 },
      formatter: "{b}: {c} ({d}%)",
    },
    legend: {
      type: "scroll",
      orient: "horizontal",
      bottom: 0,
      left: "center",
      width: "92%",
      textStyle: { fontSize: 10, color: "#5c574f" },
      pageIconSize: 10,
      pageTextStyle: { fontSize: 10, color: "#5c574f" },
    },
    series: [
      {
        type: "pie",
        radius: ["34%", "56%"],
        center: ["50%", "44%"],
        data,
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          label: { show: true, fontSize: 11, color: "#4a453d", formatter: "{b}: {c} ({d}%)" },
        },
        itemStyle: { borderRadius: 4, borderColor: "rgba(255, 252, 244, 0.9)", borderWidth: 1.5 },
      },
    ],
  };
}

/** SVG 横轴滚轮缩放：默认最少可见类目数 */
export const STAT_SVG_HORIZONTAL_ZOOM_MIN_VISIBLE = 3;

export function statsSvgParseViewBox(viewBoxStr) {
  const parts = String(viewBoxStr || "0 0 0 0")
    .trim()
    .split(/\s+/)
    .map(Number);
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

export function createStatsSvgHorizontalZoomState() {
  return { start: 0, span: 1 };
}

/** 按横轴类目数计算 viewBox 最小可见宽度比例 */
export function statsSvgCategoryMinSpan(categoryCount, minVisible = STAT_SVG_HORIZONTAL_ZOOM_MIN_VISIBLE) {
  const n = Math.max(0, Number(categoryCount) || 0);
  if (n < 2) return 1;
  const minVis = Math.max(2, Math.min(n, Number(minVisible) || STAT_SVG_HORIZONTAL_ZOOM_MIN_VISIBLE));
  return minVis / n;
}

/** deltaY < 0 放大（滚轮向上），deltaY > 0 缩小 */
export function statsSvgWheelHorizontalZoom(state, deltaY, opts = {}) {
  const minSpan = Math.max(0.05, Math.min(1, Number(opts.minSpan) || 0.3));
  const zoomIn = Number(deltaY) < 0;
  const factor = zoomIn ? 0.85 : 1.18;
  const center = state.start + state.span / 2;
  let span = zoomIn ? Math.max(minSpan, state.span * factor) : Math.min(1, state.span * factor);
  let start = center - span / 2;
  start = Math.max(0, Math.min(1 - span, start));
  return { start, span };
}

export function statsSvgPanHorizontalZoom(state, deltaStart) {
  const d = Number(deltaStart) || 0;
  let start = state.start + d;
  start = Math.max(0, Math.min(1 - state.span, start));
  return { start, span: state.span };
}

export function statsSvgApplyHorizontalZoomViewBox(svg, state, fullVb) {
  if (!svg || !fullVb || !state) return;
  const x = fullVb.x + fullVb.w * state.start;
  const visibleW = fullVb.w * state.span;
  svg.setAttribute("viewBox", `${x} ${fullVb.y} ${visibleW} ${fullVb.h}`);
}

export function statsSvgCountXCategories(svgEl) {
  if (!svgEl || typeof svgEl.querySelectorAll !== "function") return 0;
  return svgEl.querySelectorAll(".stat-axis-text--x").length;
}

/** 从 ECharts option 读取 category 横轴类目数量 */
export function statsEchartsCategoryCount(opt) {
  if (!opt || typeof opt !== "object") return 0;
  const xa = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
  if (!xa || xa.type !== "category") return 0;
  return Array.isArray(xa.data) ? xa.data.length : 0;
}

/**
 * 统计图表横轴滚轮缩放（ECharts dataZoom inside）
 * @param {number} categoryCount - 横轴类目数
 * @param {{ minVisible?: number }} opts
 */
export function buildStatsCategoryXDataZoom(categoryCount, opts = {}) {
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

/** 为含 category 横轴的 ECharts option 注入滚轮横向缩放 */
export function withStatsCategoryXDataZoom(opt, opts = {}) {
  if (!opt || typeof opt !== "object") return opt;
  const dataZoom = buildStatsCategoryXDataZoom(statsEchartsCategoryCount(opt), opts);
  if (!dataZoom.length) return opt;
  return { ...opt, dataZoom };
}

/** 问题归属放大弹窗：在卡片选项基础上强制开启 ECharts 入场动画 */
export function buildStatsOwnershipZoomChartOption(opt) {
  if (!opt || typeof opt !== "object") return opt;
  const zOpt = JSON.parse(JSON.stringify(opt));
  // JSON.stringify 会丢掉函数；保留 tooltip / 系列 label.formatter
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
      // 问题模块透视：卡片隐藏标签，放大后恢复文字
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
