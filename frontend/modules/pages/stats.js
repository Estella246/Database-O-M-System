import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { normalizeIssueSeverity } from "../utils/normalize.js";
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
  "statsLaborInputGroup",
  "statsLaborOpenHoldPersonGroup",
  "statsLaborOpenHoldPersonStage",
  "statsLaborOpenHoldStageGroup",
  "statsLaborGroupStackGroup",
  "statsLaborAvgDwellGroup",
  "statsLaborPersonDwellGroup",
  "statsLaborFlowDetailGroup",
]);
export const STAT_LABOR_FIELD_STATE_KEYS = new Set([
  "statsLaborInputCollab",
  "statsLaborAvgDwellQuality",
  "statsLaborPersonDwellModule",
  "statsLaborInterceptQuality",
  "statsLaborCommandoFlowQuality",
  "statsLaborFlowDetailQuality",
]);

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
export const STAT_OWNERSHIP_R_LINES = ["503", "505", "506", "V5R001", "V5R002"];
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

// Doer统计分类函数：根据工单节点数据返回Doer使用情况分类
export function statsTicketDoerAssistCategory(ticketNodeData) {
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
    const d = statLaborBarTopRoundPath(x, y, bw, bh, 6);
    rects += `<path class="stat-bar-rect" d="${d}" fill="${fill}" style="--stat-bar-i:${i}"><title>${escapeHtml(String(lab))}: ${v}</title></path>`;
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

export function getStatsReportPeriodBounds(period) {
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

export function statReportMix(period, salt) {
  let h = salt * 1315423911;
  const s = `${period}:${salt}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  return ((h >>> 0) % 10000) / 10000;
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
  const direct = String(ticket?.hcsVersion || ticket?.version || "").trim();
  if (direct) return direct;
  const desc = String(ticket?.description || "");
  const m = desc.match(/(\d+\.\d+(?:\.\d+)?(?:\.SPC\d+)?)/);
  if (m) return m[1];
  return "未知版本";
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

export function renderUploadKpiCard(label, value, unit) {
  return `
    <div class="upload-kpi-card">
      <div class="upload-kpi-label">${escapeHtml(label)}</div>
      <div class="upload-kpi-value">${escapeHtml(String(value))}${unit ? `<span class="upload-kpi-unit">${escapeHtml(unit)}</span>` : ""}</div>
    </div>
  `;
}
