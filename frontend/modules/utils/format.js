import { normalizeIssueSeverity } from "./normalize.js";
import { TICKET_LIST_FILTER_KEYS } from "../constants/workflow.js";
import { escapeHtml } from "./escape.js";

export function listPreviewText(raw, maxLen = 160) {
  const t = String(raw || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "--";
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

export function ticketCreatedAtMs(t) {
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

export function formatTicketSlaDhM(ticket) {
  const startMs = ticketCreatedAtMs(ticket);
  if (!startMs) return "--";
  const delta = Math.max(0, Date.now() - startMs);
  const minutesTotal = Math.floor(delta / 60000);
  const days = Math.floor(minutesTotal / (60 * 24));
  const hours = Math.floor((minutesTotal % (60 * 24)) / 60);
  const minutes = minutesTotal % 60;
  return `${days}天${hours}时${minutes}分`;
}

export function sortTicketsByCreatedAtDesc(items) {
  return [...items].sort((a, b) => {
    const diff = ticketCreatedAtMs(b) - ticketCreatedAtMs(a);
    if (diff !== 0) return diff;
    return String(b.orderId || "").localeCompare(String(a.orderId || ""), undefined, { numeric: true });
  });
}

export function formatDutyRlNowZh() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDutyRlTableDateLabel(dk) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return dk;
  const parts = dk.split("-").map((v) => parseInt(v, 10));
  return `${parts[0]}年${parts[1]}月${parts[2]}日`;
}

export function formatDutyRotationLastAccept(at) {
  if (!at || !String(at).trim()) return "—";
  const s = String(at).trim();
  const d = new Date(s.replace(" ", "T"));
  if (!Number.isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return s;
}

export function dutyRotationDatetimeLocalValue(at) {
  if (!at) return "";
  const s = String(at).trim();
  const d = new Date(s.replace(" ", "T"));
  if (!Number.isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}T${m[2]}:${m[3]}` : "";
}

export function formatLeaveIsoDisplay(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function leaveSegmentDurationHours(startVal, endVal) {
  if (!startVal || !endVal) return "—";
  const a = new Date(startVal);
  const b = new Date(endVal);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return "—";
  return ((b - a) / 3600000).toFixed(2);
}

export function formatReqDate(d) {
  if (!d) return "—";
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function formatReqDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function operatorMatchesPersonField(fieldValue, operator) {
  const raw = String(fieldValue || "").trim();
  if (!raw) return false;
  const acc = String(operator.account || "").trim();
  const name = String(operator.userName || "").trim();
  if (acc && (raw === acc || raw.includes(acc))) return true;
  if (name && (raw === name || raw.includes(name))) return true;
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (acc && tokens.includes(acc)) return true;
  if (name && tokens.includes(name)) return true;
  return false;
}

export function ticketCreatorMatchesOperator(ticket, operator) {
  const cid = String(ticket.creatorId || "").trim();
  const acc = String(operator.account || "").trim();
  if (cid && acc && cid === acc) return true;
  return operatorMatchesPersonField(String(ticket.creatorName || ""), operator);
}

export function ticketLocalActivityDateKey(ticket) {
  const raw = ticket.createdAt ?? ticket.created_at;
  if (raw) {
    const ms = Date.parse(String(raw));
    if (!Number.isNaN(ms)) return localYmd(new Date(ms));
  }
  const sd = String(ticket.startDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(sd)) return sd.slice(0, 10);
  return "";
}

export function priorityBadgeClass(p) {
  if (p <= 3) return "urgent";
  if (p <= 6) return "high";
  return "low";
}

export function categoryBadgeClass(c) {
  if (c === "管控需求") return "cat-control";
  if (c === "内核需求") return "cat-kernel";
  if (c === "管控和内核需求") return "cat-both";
  return "cat-other";
}

export function valueBadgeClass(v) {
  if (v === "质量加固") return "val-quality";
  if (v === "性能提升") return "val-perf";
  if (v === "竞争力提升") return "val-compet";
  if (v === "定位能力提升") return "val-locate";
  if (v === "恢复能力提升") return "val-recover";
  if (v === "感知能力提升") return "val-perceive";
  return "val-quality";
}

export function dutyRlSlotFilled(s) {
  return !!(s && String(s.account || "").trim());
}

export function formatRlTodayBannerPart(slot) {
  if (!dutyRlSlotFilled(slot)) return "—";
  const name = String(slot.user_name || "").trim() || "—";
  const acc = String(slot.account || "").trim();
  const phone = String(slot.phone || "").trim() || "—";
  return `${escapeHtml(name)}<span class="duty-rl-view-sep" aria-hidden="true"> · </span>${escapeHtml(acc)}<span class="duty-rl-view-sep" aria-hidden="true"> · </span><span class="duty-rl-phone-tag" title="手机号"><span class="duty-rl-phone-tag-label">手机</span><span class="duty-rl-phone-tag-value">${escapeHtml(phone)}</span></span>`;
}

export function makeNewTicketId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const prefix = `YW${ymd}`;
  const key = `yw_ticket_seq_${ymd}`;
  let last = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(last) || last < 0) last = -1;
  const next = (last + 1) % 1000;
  window.localStorage.setItem(key, String(next));
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export function ticketListFilterDisplayValue(ticket, colKey) {
  switch (colKey) {
    case "currentStage": {
      const s = String((ticket.currentStage ?? ticket.node) || "").trim();
      return s || "（空）";
    }
    case "startDate":
    case "start_date": {
      const s = String(ticket.startDate || "").trim();
      return s || "（空）";
    }
    case "severity":
      return normalizeIssueSeverity(ticket.severity ?? ticket.priority);
    case "location": {
      const s = String(ticket.location || "").trim();
      return s || "（空）";
    }
    case "bizEnv":
    case "biz_env": {
      const s = String(ticket.bizEnv || "").trim();
      return s || "（空）";
    }
    case "currentHandler": {
      const s = String(ticket.currentHandler ?? ticket.assignee ?? "").trim();
      return s || "（空）";
    }
    case "next_handler": {
      // 下一步处理人：需要从节点数据获取
      const s = String(ticket.next_handler || "").trim();
      return s || "（空）";
    }
    case "description":
    case "issue_desc":
      return listPreviewText(ticket.description || "--", 200);
    case "handle_mode": {
      const s = String(ticket.handle_mode || ticket.handleMode || "").trim();
      return s || "（空）";
    }
    case "issue_type":
    case "issue_type_judge": {
      const s = String(ticket.issue_type || ticket.issueType || ticket.issue_type_judge || "").trim();
      return s || "（空）";
    }
    case "component": {
      const s = String(ticket.component || "").trim();
      return s || "（空）";
    }
    case "product_line": {
      const s = String(ticket.product_line || ticket.productLine || "").trim();
      return s || "（空）";
    }
    case "hcs_version": {
      const s = String(ticket.hcs_version || ticket.hcsVersion || "").trim();
      return s || "（空）";
    }
    case "hcs_mode": {
      const s = String(ticket.hcs_mode || ticket.hcsMode || "").trim();
      return s || "（空）";
    }
    case "deploy_mode": {
      const s = String(ticket.deploy_mode || ticket.deployMode || "").trim();
      return s || "（空）";
    }
    case "gauss_version": {
      const s = String(ticket.gauss_version || ticket.gaussVersion || "").trim();
      return s || "（空）";
    }
    // 扩展字段：从 ticket 对象直接获取（后端已扁平化返回）
    default: {
      const rawValue = ticket[colKey];
      if (rawValue !== undefined && rawValue !== null && String(rawValue).trim()) {
        return String(rawValue).trim();
      }
      return "（空）";
    }
  }
}

export function uniqueTicketListFilterValues(tickets, colKey) {
  const set = new Set();
  (tickets || []).forEach((t) => {
    const v = ticketListFilterDisplayValue(t, colKey);
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export function filterTicketsByListColumnFilters(tickets, filters) {
  const sel = filters?.selected || {};
  return (tickets || []).filter((t) =>
    TICKET_LIST_FILTER_KEYS.every((key) => {
      const picked = sel[key] || [];
      if (picked.length === 0) return true;
      const val = ticketListFilterDisplayValue(t, key);
      return picked.includes(val);
    })
  );
}

export function localYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function formatYmdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function tabIndicatorMetrics(tabsWrap, target) {
  const wrapRect = tabsWrap.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const cs = getComputedStyle(tabsWrap);
  const bl = parseFloat(cs.borderLeftWidth) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  return {
    x: targetRect.left - wrapRect.left - bl,
    y: targetRect.top - wrapRect.top - bt,
    w: targetRect.width,
    h: targetRect.height,
  };
}
