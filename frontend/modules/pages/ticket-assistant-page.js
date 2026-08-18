import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { getWhitelistLevel, whitelistAllows } from "../utils/normalize.js";
import { resolveFetchedTaMessages } from "../utils/ta-history.js";
import { API_BASE_URL } from "../services/api.js";
import { forceRequestRender, requestRender } from "../core/scheduler.js";
import { beginCreateTicketModal, ensureTicketTab, getUrlByKey, syncSingleTicketFromServer } from "./ticket-core.js";
import { openProblemFillReviewerModal } from "./problem-fill-reviewer-modal.js";
import { ensureAdminData } from "./admin-page.js";

const TA_MODEL_STORAGE_KEY = "ta_selected_model";
const ASK_USER_OTHER_LABEL = "Other";
const ASK_USER_SKIPPED_TEXT = "用户已跳过此题，未选择任何选项。";
const ASK_USER_CANCELLED_TEXT = "用户已取消本次问答，未作答。";

/** 消息拉取代数：快速切换时丢弃过期响应 */
let taMessagesFetchSeq = 0;
/** @type {AbortController | null} */
let taMessagesAbort = null;
/** 当前对话流式请求（发送 / 开聊 / 作答）的 AbortController */
/** @type {AbortController | null} */
let taChatAbort = null;

function isAbortError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  const msg = String(err.message || err || "");
  return /aborted|AbortError/i.test(msg);
}

function beginTaChatStreamAbort() {
  if (taChatAbort) {
    try {
      taChatAbort.abort();
    } catch (_) {
      /* ignore */
    }
  }
  taChatAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
  return taChatAbort;
}

function clearTaChatStreamAbort(ac) {
  if (ac && taChatAbort === ac) taChatAbort = null;
}

/** 用户停止生成：保留已流出的助手内容，去掉 streaming 标记 */
function settleStreamingAssistantOnStop(sessionId) {
  const sid = Number(sessionId || state.taActiveSessionId);
  const base =
    sid && Number(state.taActiveSessionId) === sid
      ? state.taMessages || []
      : (sid && state.taMessagesCache?.[sid]) || state.taMessages || [];
  const nextMsgs = base
    .map((m) => {
      if (!(m && m.role === "assistant" && m.streaming)) return m;
      const { streaming, ...rest } = m;
      const content = String(rest.content || "").trim();
      const files = Array.isArray(rest.files) ? rest.files : [];
      const tools = Array.isArray(rest.tools) ? rest.tools : [];
      if (!content && !files.length && !tools.length) return null;
      return {
        ...rest,
        content,
        ...(files.length ? { files } : {}),
        ...(tools.length ? { tools } : {}),
      };
    })
    .filter(Boolean);
  if (sid) cacheTaMessages(sid, nextMsgs);
  if (!sid || Number(state.taActiveSessionId) === sid) {
    state.taMessages = nextMsgs;
  }
}

/** 对齐九问：中断后端生成并断开前端 SSE */
export async function stopTicketAssistantChat() {
  if (!state.taChatLoading) return;
  const sid = Number(state.taActiveSessionId);
  const ac = taChatAbort;
  if (ac) {
    try {
      ac.abort();
    } catch (_) {
      /* ignore */
    }
  }
  if (!sid) return;
  const op = getCurrentOperator();
  try {
    await fetch(`${API_BASE_URL}/api/ticket-assistant/sessions/${sid}/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        intent: "cancel",
      }),
    });
  } catch (_) {
    /* 前端已 abort；中断失败不阻断 UI */
  }
}

function clearTicketAssistantAskUser() {
  state.taPendingAskUser = null;
  state.taAskUserUi = null;
}

function mergeTicketAssistantFiles(existing, incoming) {
  const out = [];
  const index = new Map();
  const identity = (f) => {
    const path = String(f?.path || "").trim();
    if (path) return `path:${path}`;
    let token = String(f?.download_token || "").trim();
    if (!token) {
      const url = String(f?.download_url || "");
      if (url.includes("token=")) token = url.split("token=")[1].split("&")[0].trim();
    }
    if (token) return `token:${token}`;
    const url = String(f?.download_url || "").trim();
    if (url) return `url:${url.split("?")[0]}`;
    return `name:${String(f?.name || "").trim().toLowerCase()}`;
  };
  for (const src of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!src || typeof src !== "object") continue;
    const name = String(src.name || "").trim();
    const downloadUrl = String(src.download_url || "").trim();
    if (!name && !downloadUrl) continue;
    const key = identity(src);
    const entry = {
      name: name || "download",
      download_url: downloadUrl,
      ...(src.download_token ? { download_token: String(src.download_token) } : {}),
      ...(src.path ? { path: String(src.path) } : {}),
      ...(src.mime_type ? { mime_type: String(src.mime_type) } : {}),
      ...(typeof src.size === "number" && src.size >= 0 ? { size: src.size } : {}),
    };
    if (index.has(key)) {
      out[index.get(key)] = { ...out[index.get(key)], ...entry };
    } else {
      index.set(key, out.length);
      out.push(entry);
    }
  }
  return out;
}

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFileItemsHtml(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return "";
  return `<div class="ta-file-list">${list
    .map((f) => {
      const name = String(f.name || "download");
      const url = String(f.download_url || "").trim();
      const meta = [formatFileSize(f.size), String(f.mime_type || "").trim()].filter(Boolean).join(" · ");
      if (!url) {
        return `<div class="ta-file-card ta-file-card--disabled" title="暂无下载链接">
          <span class="ta-file-icon" aria-hidden="true"></span>
          <span class="ta-file-meta"><span class="ta-file-name">${escapeHtml(name)}</span>${
            meta ? `<span class="ta-file-sub">${escapeHtml(meta)}</span>` : ""
          }</span>
        </div>`;
      }
      return `<a class="ta-file-card" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" download="${escapeAttr(name)}">
        <span class="ta-file-icon" aria-hidden="true"></span>
        <span class="ta-file-meta"><span class="ta-file-name">${escapeHtml(name)}</span>${
          meta ? `<span class="ta-file-sub">${escapeHtml(meta)}</span>` : ""
        }</span>
        <span class="ta-file-action">下载</span>
      </a>`;
    })
    .join("")}</div>`;
}

function attachFilesToStreamingAssistant(files, forSessionId) {
  const incoming = mergeTicketAssistantFiles([], files);
  if (!incoming.length) return;
  const sid =
    forSessionId != null && forSessionId !== ""
      ? Number(forSessionId)
      : Number(state.taActiveSessionId);
  const applyToVisible = sid && Number(state.taActiveSessionId) === sid;

  const apply = (msgs) => {
    const list = Array.isArray(msgs) ? [...msgs] : [];
    const last = list[list.length - 1];
    if (last && last.role === "assistant" && last.streaming) {
      last.files = mergeTicketAssistantFiles(last.files, incoming);
      return list;
    }
    list.push({
      role: "assistant",
      content: "",
      created_at: "",
      streaming: true,
      files: incoming,
    });
    return list;
  };

  if (applyToVisible) {
    state.taMessages = apply(state.taMessages);
    cacheTaMessages(sid, state.taMessages);
    forceRequestRender();
    return;
  }
  if (!sid) return;
  cacheTaMessages(sid, apply(state.taMessagesCache?.[sid] || []));
}

function takeStreamingAssistantFiles(msgs) {
  const list = Array.isArray(msgs) ? msgs : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m && m.role === "assistant" && m.streaming && Array.isArray(m.files) && m.files.length) {
      return mergeTicketAssistantFiles([], m.files);
    }
  }
  return [];
}

function takeStreamingAssistantTools(msgs) {
  const list = Array.isArray(msgs) ? msgs : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m && m.role === "assistant" && m.streaming && Array.isArray(m.tools) && m.tools.length) {
      return m.tools.map((t) => ({ ...t }));
    }
  }
  return [];
}

function formatToolJson(value, maxLen = 4000) {
  let text = "";
  try {
    text =
      typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  } catch (_) {
    text = String(value ?? "");
  }
  if (text.length > maxLen) return `${text.slice(0, maxLen)}\n…`;
  return text;
}

function toolDisplayName(tool) {
  if (!tool || typeof tool !== "object") return "unknown";
  return (
    String(tool.display_name || "").trim() ||
    String(tool.formatted_args || "").trim() ||
    String(tool.name || tool.tool_name || "unknown").trim() ||
    "unknown"
  );
}

function toolStatusOf(tool) {
  const status = String(tool?.status || "").trim().toLowerCase();
  if (status === "pending" || status === "running") return "pending";
  if (status === "timeout" || tool?.timed_out) return "timeout";
  if (status === "error" || status === "failed" || tool?.success === false) return "error";
  if (status === "completed" || tool?.success === true || tool?.result != null) return "completed";
  return status || "pending";
}

function renderToolsHtml(tools) {
  const list = Array.isArray(tools) ? tools.filter((t) => t && typeof t === "object") : [];
  if (!list.length) return "";
  const pending = list.some((t) => toolStatusOf(t) === "pending");
  const failed = list.filter((t) => {
    const s = toolStatusOf(t);
    return s === "error" || s === "timeout";
  }).length;
  const n = list.length;
  let summary = `已执行 ${n} 次工具调用`;
  if (pending) summary = `正在执行工具调用（已 ${n} 次）`;
  else if (failed === n && n > 0) summary = `${n} 次工具调用失败`;
  else if (failed > 0) summary = `已执行 ${n} 次工具调用（${failed} 次失败）`;

  const items = list
    .map((tool, idx) => {
      const id = escapeAttr(String(tool.id || tool.tool_call_id || `tool-${idx}`));
      const status = toolStatusOf(tool);
      const label = escapeHtml(toolDisplayName(tool));
      const statusLabel =
        status === "pending"
          ? "执行中"
          : status === "timeout"
            ? "超时"
            : status === "error"
              ? "失败"
              : "完成";
      const statusIcon =
        status === "pending"
          ? `<span class="ta-tool-status-spinner" aria-hidden="true"></span>`
          : status === "timeout" || status === "error"
            ? `<span class="ta-tool-status-mark is-error" aria-hidden="true">✕</span>`
            : `<span class="ta-tool-status-mark is-ok" aria-hidden="true">✅</span>`;
      const argsText = formatToolJson(tool.arguments || {});
      return `<details class="ta-tool-item is-${escapeAttr(status)}" data-ta-tool-id="${id}">
        <summary class="ta-tool-item-summary">
          <span class="ta-tool-item-name">${label}</span>
          <span class="ta-tool-item-status" title="${escapeAttr(statusLabel)}" aria-label="${escapeAttr(statusLabel)}">${statusIcon}</span>
        </summary>
        <div class="ta-tool-item-detail">
          <div class="ta-tool-detail-block">
            <div class="ta-tool-detail-label">工具名</div>
            <pre class="ta-tool-detail-pre">${escapeHtml(String(tool.name || tool.tool_name || "unknown"))}</pre>
          </div>
          <div class="ta-tool-detail-block">
            <div class="ta-tool-detail-label">参数</div>
            <pre class="ta-tool-detail-pre">${escapeHtml(argsText)}</pre>
          </div>
        </div>
      </details>`;
    })
    .join("");

  return `<details class="ta-tool-group" data-ta-tool-group>
    <summary class="ta-tool-summary">${escapeHtml(summary)}</summary>
    <div class="ta-tool-list">${items}</div>
  </details>`;
}

function patchStreamingToolsDom(tools) {
  const msg = document.querySelector(".ta-msg.ta-msg-streaming");
  if (!msg) return false;
  const html = renderToolsHtml(tools);
  let group = msg.querySelector(":scope > .ta-tool-group");
  if (!html) {
    group?.remove();
    return true;
  }
  const openIds = new Set();
  msg.querySelectorAll(".ta-tool-item[open]").forEach((el) => {
    const id = el.getAttribute("data-ta-tool-id");
    if (id) openIds.add(id);
  });
  const groupOpen = group?.open;
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const next = wrap.firstElementChild;
  if (!next) return false;
  if (group) group.replaceWith(next);
  else msg.insertBefore(next, msg.firstChild);
  if (groupOpen) next.open = true;
  next.querySelectorAll(".ta-tool-item").forEach((el) => {
    const id = el.getAttribute("data-ta-tool-id");
    if (id && openIds.has(id)) el.open = true;
  });
  scrollTaMessagesToBottom();
  return true;
}

function upsertStreamingToolCall(toolCall, forSessionId) {
  const incoming = toolCall && typeof toolCall === "object" ? toolCall : null;
  if (!incoming) return;
  const tid = String(incoming.id || "").trim();
  if (!tid) return;
  const sid =
    forSessionId != null && forSessionId !== ""
      ? Number(forSessionId)
      : Number(state.taActiveSessionId);
  const applyToVisible = sid && Number(state.taActiveSessionId) === sid;

  const apply = (msgs) => {
    const list = Array.isArray(msgs) ? [...msgs] : [];
    let last = list[list.length - 1];
    if (!(last && last.role === "assistant" && last.streaming)) {
      last = { role: "assistant", content: "", created_at: "", streaming: true, tools: [] };
      list.push(last);
    }
    const tools = Array.isArray(last.tools) ? [...last.tools] : [];
    const idx = tools.findIndex((t) => String(t.id || "") === tid);
    const entry = {
      id: tid,
      name: String(incoming.name || "unknown"),
      arguments: incoming.arguments && typeof incoming.arguments === "object" ? incoming.arguments : {},
      status: "pending",
    };
    for (const key of ["description", "formatted_args", "display_name"]) {
      if (incoming[key]) entry[key] = incoming[key];
    }
    if (idx >= 0) tools[idx] = { ...tools[idx], ...entry, status: tools[idx].status || "pending" };
    else tools.push(entry);
    last.tools = tools;
    return { list, tools };
  };

  if (applyToVisible) {
    const { list, tools } = apply(state.taMessages);
    state.taMessages = list;
    cacheTaMessages(sid, list);
    if (!patchStreamingToolsDom(tools)) forceRequestRender();
    return;
  }
  if (!sid) return;
  const { list } = apply(state.taMessagesCache?.[sid] || []);
  cacheTaMessages(sid, list);
}

function upsertStreamingToolResult(toolResult, forSessionId) {
  const incoming = toolResult && typeof toolResult === "object" ? toolResult : null;
  if (!incoming) return;
  const tid = String(incoming.tool_call_id || incoming.id || "").trim();
  const sid =
    forSessionId != null && forSessionId !== ""
      ? Number(forSessionId)
      : Number(state.taActiveSessionId);
  const applyToVisible = sid && Number(state.taActiveSessionId) === sid;

  const apply = (msgs) => {
    const list = Array.isArray(msgs) ? [...msgs] : [];
    let last = list[list.length - 1];
    if (!(last && last.role === "assistant" && last.streaming)) {
      last = { role: "assistant", content: "", created_at: "", streaming: true, tools: [] };
      list.push(last);
    }
    const tools = Array.isArray(last.tools) ? [...last.tools] : [];
    const success = incoming.success !== false && !incoming.timed_out;
    const status = incoming.timed_out ? "timeout" : success ? "completed" : "error";
    const patch = {
      status,
      success,
      result: String(incoming.result || ""),
      tool_name: String(incoming.tool_name || "").trim(),
    };
    if (incoming.timed_out) patch.timed_out = true;
    if (incoming.summary) patch.summary = incoming.summary;
    let idx = tid ? tools.findIndex((t) => String(t.id || "") === tid) : -1;
    if (idx < 0 && patch.tool_name) {
      idx = tools.findIndex((t) => toolStatusOf(t) === "pending" && String(t.name || "") === patch.tool_name);
    }
    if (idx >= 0) {
      const prev = tools[idx];
      tools[idx] = {
        ...prev,
        ...patch,
        name: prev.name || patch.tool_name || "unknown",
        id: prev.id || tid || prev.name,
      };
    } else {
      tools.push({
        id: tid || `tool-result-${tools.length + 1}`,
        name: patch.tool_name || "unknown",
        arguments: {},
        ...patch,
      });
    }
    last.tools = tools;
    return { list, tools };
  };

  if (applyToVisible) {
    const { list, tools } = apply(state.taMessages);
    state.taMessages = list;
    cacheTaMessages(sid, list);
    if (!patchStreamingToolsDom(tools)) forceRequestRender();
    return;
  }
  if (!sid) return;
  const { list } = apply(state.taMessagesCache?.[sid] || []);
  cacheTaMessages(sid, list);
}

function applyTicketAssistantAskUser(payload) {
  const ask = payload && typeof payload === "object" ? payload : null;
  const requestId = String(ask?.request_id || "").trim();
  const questions = Array.isArray(ask?.questions) ? ask.questions.filter((q) => q && String(q.question || "").trim()) : [];
  if (!requestId || !questions.length) {
    clearTicketAssistantAskUser();
    return false;
  }
  state.taPendingAskUser = {
    request_id: requestId,
    questions: questions.slice(0, 4),
    source: String(ask.source || "ask_user_interrupt").trim() || "ask_user_interrupt",
    approval_schema: String(ask.approval_schema || "").trim(),
    evolution_meta: ask.evolution_meta && typeof ask.evolution_meta === "object" ? ask.evolution_meta : null,
    plan_approval_kind: String(ask.plan_approval_kind || "").trim(),
    plan_content: String(ask.plan_content || ""),
    plan_language: String(ask.plan_language || "").trim(),
  };
  state.taAskUserUi = { page: 0, answersByPage: {} };
  return true;
}

function emptyAskUserPageState() {
  return { selected: [], custom: "", customActive: false, skippedNoSelection: false };
}

function getAskUserPageState(idx) {
  const ui = state.taAskUserUi || { page: 0, answersByPage: {} };
  const cur = ui.answersByPage?.[idx];
  return cur && typeof cur === "object" ? { ...emptyAskUserPageState(), ...cur } : emptyAskUserPageState();
}

function patchAskUserPageState(idx, updater) {
  const ui = state.taAskUserUi || { page: 0, answersByPage: {} };
  const prev = getAskUserPageState(idx);
  const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
  state.taAskUserUi = {
    ...ui,
    answersByPage: { ...(ui.answersByPage || {}), [idx]: next },
  };
}

function buildAskUserAnswers(overridesByIdx, forcedTextByIdx) {
  const pending = state.taPendingAskUser;
  const questions = Array.isArray(pending?.questions) ? pending.questions : [];
  return questions.map((q, idx) => {
    if (forcedTextByIdx && forcedTextByIdx[idx] !== undefined) {
      return {
        question: String(q.question || ""),
        selected_options: [],
        custom_input: String(forcedTextByIdx[idx] || ""),
      };
    }
    const s =
      overridesByIdx && overridesByIdx[idx]
        ? { ...emptyAskUserPageState(), ...overridesByIdx[idx] }
        : getAskUserPageState(idx);
    const customText = String(s.custom || "").trim();
    if (s.skippedNoSelection && !(s.selected || []).length && !customText) {
      return {
        question: String(q.question || ""),
        selected_options: [],
        custom_input: ASK_USER_SKIPPED_TEXT,
      };
    }
    if (s.customActive && !customText) {
      return { question: String(q.question || ""), selected_options: [], custom_input: "" };
    }
    const selected = Array.isArray(s.selected) ? [...s.selected] : [];
    const answer = {
      question: String(q.question || ""),
      selected_options: selected,
    };
    if (customText) answer.custom_input = customText;
    if (!answer.selected_options.length && !customText) {
      const first = (q.options || []).find((o) => String(o.label || "") !== ASK_USER_OTHER_LABEL);
      if (first) {
        answer.selected_options = [String(first.value || first.label || "")];
      }
    }
    return answer;
  });
}

function buildAskUserEchoSummary() {
  const pending = state.taPendingAskUser;
  const questions = Array.isArray(pending?.questions) ? pending.questions : [];
  const lines = [];
  questions.forEach((q, idx) => {
    const s = getAskUserPageState(idx);
    const customText = String(s.custom || "").trim();
    if (s.skippedNoSelection && !(s.selected || []).length && !customText) {
      lines.push(`${q.header || "问题"}：已跳过`);
      return;
    }
    const parts = [...(s.selected || [])];
    if (customText) parts.push(customText);
    if (parts.length) lines.push(`${q.header || "问题"}：${parts.join("、")}`);
  });
  return lines.length ? `【已选择】\n${lines.join("\n")}` : "";
}

function stripStreamingFlag(messages) {
  return (messages || []).map((m) => {
    if (!m || !m.streaming) return m;
    const { streaming, ...rest } = m;
    return rest;
  });
}

function clearStreamingFlags(sessionId) {
  const sid = Number(sessionId);
  if (sid && Number(state.taActiveSessionId) === sid && Number(state.taMessagesSessionId) === sid) {
    state.taMessages = stripStreamingFlag(state.taMessages);
    cacheTaMessages(sid, state.taMessages);
  } else if (sid && state.taMessagesCache?.[sid]) {
    cacheTaMessages(sid, stripStreamingFlag(state.taMessagesCache[sid]));
  }
}

/** 流结束后回拉 history.get，补上 SSE 未带上的用户气泡。 */
async function refreshTaMessagesAfterStream(sessionId) {
  const sid = Number(sessionId);
  if (!sid || Number(state.taActiveSessionId) !== sid) return;
  try {
    await fetchTicketAssistantMessages(sid);
  } catch (_) {
    /* ignore */
  }
}

function cacheTaMessages(sessionId, messages) {
  const sid = Number(sessionId);
  if (!sid) return;
  if (!state.taMessagesCache || typeof state.taMessagesCache !== "object") {
    state.taMessagesCache = {};
  }
  state.taMessagesCache[sid] = Array.isArray(messages) ? messages : [];
  // 仅当缓存的正是当前右侧会话时，同步归属 id（后台流式写缓存勿抢归属）
  if (Number(state.taActiveSessionId) === sid) {
    state.taMessagesSessionId = sid;
  }
}

function rememberCurrentTaMessages() {
  const sid = Number(state.taActiveSessionId);
  if (!sid) return;
  if (Number(state.taMessagesSessionId) !== sid) return;
  cacheTaMessages(sid, state.taMessages || []);
}

function renderAssistantMarkdown(md) {
  const src = String(md || "");
  if (!src) return "";
  const markedLib =
    (typeof globalThis !== "undefined" && globalThis.marked) ||
    (typeof window !== "undefined" && window.marked) ||
    null;
  let raw;
  try {
    raw = markedLib && typeof markedLib.parse === "function"
      ? markedLib.parse(src)
      : escapeHtml(src).replace(/\n/g, "<br>");
  } catch (_) {
    raw = escapeHtml(src).replace(/\n/g, "<br>");
  }
  const purify = typeof window !== "undefined" ? window.DOMPurify : null;
  return purify ? purify.sanitize(raw) : raw;
}

/** GFM 管道表格行（含对齐分隔行）。 */
function isMdTableLine(line) {
  const t = String(line || "").trim();
  if (!t || t.startsWith("```")) return false;
  if (!t.includes("|")) return false;
  return /^\|?[^|\n]+\|/.test(t) || /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(t);
}

/** 未闭合的 ``` 代码块起始行下标；已闭合则 -1。 */
function findOpenFenceStart(lines) {
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      open = open < 0 ? i : -1;
    }
  }
  return open;
}

/**
 * 流式 Markdown：拆成「已完成稳定前缀」与「未完成尾部」。
 * 尾部若是未结束的表格/代码块，用纯文本展示，避免 marked 反复重建 <table> 导致闪烁。
 */
function splitStreamingMarkdown(md) {
  const text = String(md || "");
  if (!text) return { stable: "", pending: "", pendingMode: "md" };
  const lines = text.split("\n");

  const fenceStart = findOpenFenceStart(lines);
  if (fenceStart >= 0) {
    return {
      stable: lines.slice(0, fenceStart).join("\n"),
      pending: lines.slice(fenceStart).join("\n"),
      pendingMode: "raw",
    };
  }

  let lastNonEmpty = lines.length - 1;
  while (lastNonEmpty >= 0 && !String(lines[lastNonEmpty] || "").trim()) lastNonEmpty--;
  if (lastNonEmpty >= 0 && isMdTableLine(lines[lastNonEmpty])) {
    let start = lastNonEmpty;
    while (start > 0 && isMdTableLine(lines[start - 1])) start--;
    return {
      stable: lines.slice(0, start).join("\n"),
      pending: lines.slice(start).join("\n"),
      pendingMode: "table-raw",
    };
  }

  const lastBreak = text.lastIndexOf("\n\n");
  if (lastBreak >= 0) {
    return {
      stable: text.slice(0, lastBreak + 2),
      pending: text.slice(lastBreak + 2),
      pendingMode: "md",
    };
  }
  return { stable: "", pending: text, pendingMode: "md" };
}

function renderStreamingPendingHtml(pendingMd, pendingMode) {
  if (!pendingMd) return "";
  if (pendingMode === "table-raw" || pendingMode === "raw") {
    return `<pre class="ta-stream-pending-raw">${escapeHtml(pendingMd)}</pre>`;
  }
  return renderAssistantMarkdown(pendingMd);
}

function ensureStreamRegions(el) {
  let stable = el.querySelector(":scope > .ta-stream-stable");
  let pending = el.querySelector(":scope > .ta-stream-pending");
  if (!stable || !pending) {
    const kept = Array.from(el.querySelectorAll(":scope > .ta-file-list"));
    el.innerHTML = '<div class="ta-stream-stable"></div><div class="ta-stream-pending"></div>';
    for (const node of kept) el.insertBefore(node, el.firstChild);
    stable = el.querySelector(":scope > .ta-stream-stable");
    pending = el.querySelector(":scope > .ta-stream-pending");
  }
  return { stable, pending };
}

function scrollTaMessagesToBottom() {
  const box = document.getElementById("ta-messages");
  if (box) box.scrollTop = box.scrollHeight;
}

/** 流式时优先就地改气泡；已完成块冻结，仅更新尾部，避免表格整段重建闪烁。 */
function patchStreamingAssistantBubble(text) {
  const el = document.getElementById("ta-stream-bubble");
  if (!el) return false;
  el.classList.remove("ta-msg-thinking-text");
  const src = String(text || "");
  const fileList = el.querySelector(":scope > .ta-file-list");
  if (!src) {
    // 已有文件时不要清掉文件卡；仅在无正文时保留思考态
    if (!fileList) {
      el.innerHTML = '<span class="ta-msg-thinking-text">正在思考…</span>';
    } else {
      Array.from(el.children).forEach((child) => {
        if (!child.classList.contains("ta-file-list")) child.remove();
      });
      if (!el.querySelector(".ta-msg-thinking-text")) {
        const tip = document.createElement("span");
        tip.className = "ta-msg-thinking-text";
        tip.textContent = "正在思考…";
        el.appendChild(tip);
      }
    }
    document.querySelector(".ta-msg-thinking")?.remove();
    scrollTaMessagesToBottom();
    return true;
  }

  // 去掉空态「正在思考」再进入分区渲染
  el.querySelectorAll(":scope > .ta-msg-thinking-text").forEach((n) => n.remove());

  const { stable: stableMd, pending: pendingMd, pendingMode } = splitStreamingMarkdown(src);
  const { stable, pending } = ensureStreamRegions(el);

  if ((stable.dataset.md || "") !== stableMd) {
    stable.dataset.md = stableMd;
    stable.innerHTML = stableMd ? renderAssistantMarkdown(stableMd) : "";
  }
  const pendingModeChanged = (pending.dataset.mode || "") !== pendingMode;
  if ((pending.dataset.md || "") !== pendingMd || pendingModeChanged) {
    pending.dataset.md = pendingMd;
    pending.dataset.mode = pendingMode;
    // 表格/代码块流式增长时只改文本，避免反复替换 DOM
    if (!pendingModeChanged && (pendingMode === "table-raw" || pendingMode === "raw")) {
      const pre = pending.querySelector(":scope > .ta-stream-pending-raw");
      if (pre) {
        pre.textContent = pendingMd;
      } else {
        pending.innerHTML = renderStreamingPendingHtml(pendingMd, pendingMode);
      }
    } else {
      pending.innerHTML = renderStreamingPendingHtml(pendingMd, pendingMode);
    }
  }

  document.querySelector(".ta-msg-thinking")?.remove();
  scrollTaMessagesToBottom();
  return true;
}

function setStreamingAssistantContent(text, forSessionId) {
  const sid =
    forSessionId != null && forSessionId !== ""
      ? Number(forSessionId)
      : Number(state.taActiveSessionId);
  const content = String(text || "");
  const applyToVisible = sid && Number(state.taActiveSessionId) === sid;

  if (applyToVisible) {
    const msgs = state.taMessages || [];
    const last = msgs[msgs.length - 1];
    if (last && last.role === "assistant" && last.streaming) {
      last.content = content;
    } else {
      state.taMessages = [
        ...msgs,
        { role: "assistant", content, created_at: "", streaming: true },
      ];
    }
    state.taStreamingText = content;
    cacheTaMessages(sid, state.taMessages);
    if (!patchStreamingAssistantBubble(state.taStreamingText)) {
      forceRequestRender();
      requestAnimationFrame(() => patchStreamingAssistantBubble(state.taStreamingText));
    }
    return;
  }

  // 用户已切走：只更新该会话缓存，不污染当前右侧
  if (!sid) return;
  const cached = [...(state.taMessagesCache?.[sid] || [])];
  const last = cached[cached.length - 1];
  if (last && last.role === "assistant" && last.streaming) {
    last.content = content;
  } else {
    cached.push({ role: "assistant", content, created_at: "", streaming: true });
  }
  cacheTaMessages(sid, cached);
}

async function consumeTicketAssistantSse(response, onEvent) {
  if (!response.ok) {
    const j = await response.json().catch(() => ({}));
    const detail = typeof j.detail === "string" ? j.detail : "请求失败";
    throw new Error(detail);
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error("浏览器不支持流式读取");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const lines = block.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let ev;
        try {
          ev = JSON.parse(raw);
        } catch (_) {
          continue;
        }
        if (ev && typeof ev === "object") await onEvent(ev);
      }
    }
  }
}

function modelKey(m) {
  if (!m || typeof m !== "object") return "";
  return String(m.alias || m.model_name || "").trim();
}

function modelLabel(m) {
  const key = modelKey(m);
  return key || "未命名模型";
}

function resolveActiveModel(models, preferred) {
  const list = Array.isArray(models) ? models : [];
  if (!list.length) return "";
  const pref = String(preferred || "").trim();
  if (pref) {
    const hit = list.find((m) => modelKey(m) === pref || m.model_name === pref);
    if (hit) return modelKey(hit);
  }
  const def = list.find((m) => m.is_default) || list[0];
  return modelKey(def);
}

/** @returns {Promise<boolean>} 是否有可见变化（需重绘） */
export async function fetchTicketAssistantModels() {
  if (state.taModelsLoading) return false;
  const op = getCurrentOperator();
  const prevModels = state.taModels;
  const prevActive = state.taActiveModel;
  state.taModelsLoading = true;
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ticket-assistant/models?operator_id=${encodeURIComponent(op.account)}`
    );
    if (!r.ok) {
      state.taModels = [];
      return false;
    }
    const j = await r.json();
    const items = Array.isArray(j.items) ? j.items : [];
    state.taModels = items;
    let preferred = "";
    try {
      preferred = String(localStorage.getItem(TA_MODEL_STORAGE_KEY) || "").trim();
    } catch (_) {
      preferred = "";
    }
    if (!preferred) preferred = String(j.active_model || state.taActiveModel || "").trim();
    state.taActiveModel = resolveActiveModel(items, preferred);
    if (state.taActiveModel) {
      try {
        localStorage.setItem(TA_MODEL_STORAGE_KEY, state.taActiveModel);
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    state.taModels = [];
  } finally {
    state.taModelsLoading = false;
    state.taModelsFetched = true;
  }
  if (state.taActiveModel !== prevActive) return true;
  if ((state.taModels || []).length !== (prevModels || []).length) return true;
  const nextKeys = (state.taModels || []).map(modelKey).join("\0");
  const prevKeys = (prevModels || []).map(modelKey).join("\0");
  return nextKeys !== prevKeys;
}

function setTicketAssistantModel(key) {
  const next = String(key || "").trim();
  if (!next) return;
  state.taActiveModel = next;
  state.taModelMenuOpen = false;
  try {
    localStorage.setItem(TA_MODEL_STORAGE_KEY, next);
  } catch (_) {
    /* ignore */
  }
}

export function ensureTicketAssistantTab() {
  const key = "assistant:ticket";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "提单助手", closable: true });
  }
  return key;
}

/**
 * 工单详情「Ask 九问」：拉已提交字段提示词 → 开九问会话并发送。
 * @returns {Promise<boolean>}
 */
export async function openAskJiuwenFromTicket(orderId) {
  const oid = String(orderId || "").trim();
  if (!oid) return false;
  if (!whitelistAllows("ticket_detail_ask_jiuwen", "readonly", getCurrentWhitelistSettings())) {
    window.alert("无 Ask 九问权限");
    return false;
  }
  const op = getCurrentOperator();
  const btn = document.getElementById("ask-jiuwen-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Ask 九问…";
  }
  try {
    const resp = await fetch(
      `${API_BASE_URL}/api/tickets/${encodeURIComponent(oid)}/ask-jiuwen-prompt?operator_id=${encodeURIComponent(op.account)}`
    );
    if (!resp.ok) {
      let msg = "获取工单问诊上下文失败";
      try {
        const errBody = await resp.json();
        if (errBody?.detail) msg = String(errBody.detail);
      } catch (_) {
        /* ignore */
      }
      window.alert(msg);
      return false;
    }
    const body = await resp.json();
    const item = body?.item || {};
    const prompt = String(item.prompt || "").trim();
    if (!prompt) {
      window.alert("工单暂无可问诊字段");
      return false;
    }
    const title = String(item.title || oid).trim();

    state.activeKey = ensureTicketAssistantTab();
    history.pushState({}, "", getUrlByKey(state.activeKey));
    state.taNeedsRefresh = false;
    state.taChatLoading = true;
    state.taChatError = "";
    state.taActiveSessionId = null;
    state.taActiveSession = null;
    state.taMessagesSessionId = null;
    state.taMessages = [
      { role: "user", content: prompt, created_at: "" },
      { role: "assistant", content: "", created_at: "", streaming: true },
    ];
    forceRequestRender();

    const created = await createTicketAssistantSession(null, {
      initialMessage: prompt,
      title,
    });
    if (!created) {
      const err = state.taChatError || "创建会话失败";
      window.alert(err);
      return false;
    }
    return true;
  } catch (e) {
    window.alert(String(e?.message || e || "Ask 九问失败"));
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Ask 九问";
    }
  }
}

/** 工作台「创建」展示：转人工模式下开创建弹窗仍依赖此权限。 */
export function canCreateViaTicketAssistant() {
  return whitelistAllows("workbench_create", "readonly", getCurrentWhitelistSettings());
}

/** 提单助手「是否支持转人工」= 是 → 完整提单；否 → 纯对话。 */
export function canTransferViaTicketAssistant() {
  return getWhitelistLevel("ticket_assistant_transfer", getCurrentWhitelistSettings()) === "editable";
}

export function beginTicketAssistantCreateModal() {
  if (!canTransferViaTicketAssistant() || !canCreateViaTicketAssistant()) return false;
  state.ticketAssistantCreateMode = true;
  state.ticketAssistantAutoCreatePending = false;
  beginCreateTicketModal();
  return true;
}

/** 进入页且无选中会话时自动打开创建弹窗（须在权限/会话列表就绪后调用）。 */
function tryAutoOpenCreateModal() {
  if (!state.ticketAssistantAutoCreatePending) return false;
  if (state.taActiveSessionId) {
    state.ticketAssistantAutoCreatePending = false;
    return false;
  }
  if (state.createModalOpen) {
    state.ticketAssistantAutoCreatePending = false;
    return false;
  }
  if (!canTransferViaTicketAssistant()) {
    state.ticketAssistantAutoCreatePending = false;
    return false;
  }
  if (!canCreateViaTicketAssistant()) {
    // 白名单未加载完时勿清 pending，避免首进永久不再自动弹窗
    if (!state.adminLoaded) return false;
    state.ticketAssistantAutoCreatePending = false;
    return false;
  }
  return beginTicketAssistantCreateModal();
}

function openTicketAssistantCreateModal() {
  if (!canTransferViaTicketAssistant() || !canCreateViaTicketAssistant()) return false;
  state.taModelMenuOpen = false;
  if (!beginTicketAssistantCreateModal()) return false;
  // beginCreateTicketModal 内 requestRender 可能与 ensureAdminData 等合并被吞，须 force
  forceRequestRender();
  return true;
}

/** 纯对话：回到欢迎区，等首条消息再建会话。 */
function resetTicketAssistantToWelcome() {
  rememberCurrentTaMessages();
  if (taMessagesAbort) {
    try {
      taMessagesAbort.abort();
    } catch (_) {
      /* ignore */
    }
    taMessagesAbort = null;
  }
  taMessagesFetchSeq += 1;
  state.taActiveSessionId = null;
  state.taActiveSession = null;
  state.taMessages = [];
  state.taMessagesSessionId = null;
  state.taMessagesLoading = false;
  state.taChatError = "";
  state.taModelMenuOpen = false;
  clearTicketAssistantAskUser();
  state.ticketAssistantAutoCreatePending = false;
  state.ticketAssistantCreateMode = false;
  forceRequestRender();
}

/** 切换历史会话：立刻换右侧，再后台拉最新（有缓存则先展示缓存）。 */
function selectTicketAssistantSession(sessionId) {
  const id = Number(sessionId);
  if (!id) return;
  if (Number(state.taActiveSessionId) === id && Number(state.taMessagesSessionId) === id) {
    // 已在该会话且内容已对齐：仍可后台轻量刷新，但右侧不先清空
    void fetchTicketAssistantMessages(id).then((changed) => {
      if (changed && Number(state.taActiveSessionId) === id) {
        forceRequestRender();
        requestAnimationFrame(scrollTaMessagesToBottom);
      }
    });
    return;
  }

  rememberCurrentTaMessages();
  state.taActiveSessionId = id;
  state.taActiveSession = (state.taSessions || []).find((s) => Number(s.id) === id) || null;
  state.taChatError = "";
  state.taModelMenuOpen = false;
  clearTicketAssistantAskUser();
  state.ticketAssistantAutoCreatePending = false;

  const cached = state.taMessagesCache?.[id];
  const hasCache = Array.isArray(cached) && cached.length > 0;
  if (hasCache) {
    state.taMessages = cached;
    state.taMessagesSessionId = id;
  } else {
    state.taMessages = [];
    state.taMessagesSessionId = id;
    state.taMessagesLoading = true;
  }
  // 先重绘：侧栏高亮 + 右侧立刻换会话（缓存或加载态），不再等网络
  forceRequestRender();
  if (hasCache) requestAnimationFrame(scrollTaMessagesToBottom);

  void fetchTicketAssistantMessages(id).then((changed) => {
    if (Number(state.taActiveSessionId) !== id) return;
    // 无缓存须再绘以清「加载中」；有缓存仅内容变化或出错时重绘，避免反复解析 Markdown
    if (changed || !hasCache || state.taChatError) {
      forceRequestRender();
      requestAnimationFrame(scrollTaMessagesToBottom);
    }
  });
}

function bindTicketAssistantUiHandlers() {
  const canTransfer = canTransferViaTicketAssistant();
  const chatOnly = !canTransfer;

  document.getElementById("ta-new-session-btn")?.addEventListener("click", () => {
    if (chatOnly) {
      resetTicketAssistantToWelcome();
      return;
    }
    openTicketAssistantCreateModal();
  });

  const toggleSidebar = () => {
    state.taHistoryOpen = !state.taHistoryOpen;
    state.taModelMenuOpen = false;
    requestRender();
  };
  document.getElementById("ta-sidebar-toggle")?.addEventListener("click", toggleSidebar);

  if (canTransfer) {
    document.getElementById("ta-welcome-composer")?.addEventListener("click", () => {
      openTicketAssistantCreateModal();
    });
  }

  document.querySelectorAll("[data-ta-session-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = Number(el.getAttribute("data-ta-session-id"));
      if (!id) return;
      selectTicketAssistantSession(id);
    });
  });

  const focusComposer = () => {
    requestAnimationFrame(() => {
      const box = document.getElementById("ta-messages");
      if (box) box.scrollTop = box.scrollHeight;
      const next = document.getElementById("ta-input");
      if (next) {
        autosizeComposer(next);
        next.focus();
      }
    });
  };

  const send = async () => {
    const input = document.getElementById("ta-input");
    const text = String(input?.value || "").trim();
    if (!text || state.taChatLoading) return;

    // 纯对话欢迎区：首条消息再建会话
    if (!state.taActiveSessionId) {
      if (!chatOnly) return;
      if (input) {
        input.value = "";
        autosizeComposer(input);
      }
      state.taModelMenuOpen = false;
      const creating = createTicketAssistantSession(null, { initialMessage: text });
      requestRender();
      await creating;
      requestRender();
      focusComposer();
      return;
    }

    if (input) {
      input.value = "";
      autosizeComposer(input);
    }
    state.taModelMenuOpen = false;
    await sendTicketAssistantChat(state.taActiveSessionId, text);
    forceRequestRender();
    focusComposer();
  };

  document.getElementById("ta-send-btn")?.addEventListener("click", () => {
    if (state.taChatLoading && !state.taTransferLoading) {
      void stopTicketAssistantChat();
      return;
    }
    void send();
  });

  const input = document.getElementById("ta-input");
  if (input && !input.disabled) {
    autosizeComposer(input);
    input.addEventListener("input", () => autosizeComposer(input));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        void send();
      }
    });
  }

  document.getElementById("ta-model-trigger")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (state.taChatLoading || state.taTransferLoading) return;
    state.taModelMenuOpen = !state.taModelMenuOpen;
    requestRender();
  });

  document.querySelectorAll("[data-ta-model]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setTicketAssistantModel(el.getAttribute("data-ta-model"));
      requestRender();
    });
  });

  if (state.taModelMenuOpen) {
    const closer = (ev) => {
      const root = document.getElementById("ta-model-select");
      if (root && root.contains(ev.target)) return;
      state.taModelMenuOpen = false;
      document.removeEventListener("pointerdown", closer, true);
      requestRender();
    };
    document.addEventListener("pointerdown", closer, true);
  }

  document.getElementById("ta-transfer-btn")?.addEventListener("click", async () => {
    if (!canTransferViaTicketAssistant()) return;
    if (!state.taActiveSessionId || state.taTransferLoading) return;
    if (!window.confirm("确认转人工？将使用问题创建信息正式建单。")) return;
    state.taModelMenuOpen = false;
    await transferTicketAssistantSession(state.taActiveSessionId);
    requestRender();
  });

  // 九问 ask_user 选择卡
  if (state.taPendingAskUser && !state.taChatLoading) {
    const pending = state.taPendingAskUser;
    const questions = Array.isArray(pending.questions) ? pending.questions : [];
    const page = Math.max(0, Math.min(Number(state.taAskUserUi?.page || 0), Math.max(0, questions.length - 1)));
    const q = questions[page] || {};
    const isMulti = !!q.multi_select;
    const isLast = page >= questions.length - 1;

    document.querySelectorAll("[data-ta-ask-opt]").forEach((el) => {
      el.addEventListener("click", () => {
        const value = String(el.getAttribute("data-ta-ask-opt") || "");
        if (!value) return;
        patchAskUserPageState(page, (prev) => {
          if (isMulti) {
            const has = (prev.selected || []).includes(value);
            return {
              ...prev,
              selected: has
                ? (prev.selected || []).filter((v) => v !== value)
                : [...(prev.selected || []), value],
              customActive: false,
              skippedNoSelection: false,
            };
          }
          return {
            ...prev,
            selected: [value],
            customActive: false,
            skippedNoSelection: false,
          };
        });
        forceRequestRender();
      });
    });

    document.querySelector("[data-ta-ask-other]")?.addEventListener("click", () => {
      patchAskUserPageState(page, (prev) => ({
        ...prev,
        selected: [],
        customActive: true,
        skippedNoSelection: false,
      }));
      forceRequestRender();
      requestAnimationFrame(() => document.getElementById("ta-ask-custom")?.focus());
    });

    const customEl = document.getElementById("ta-ask-custom");
    if (customEl) {
      customEl.addEventListener("input", () => {
        patchAskUserPageState(page, (prev) => ({
          ...prev,
          custom: customEl.value,
          customActive: true,
          skippedNoSelection: false,
        }));
      });
    }

    document.getElementById("ta-ask-prev")?.addEventListener("click", () => {
      const ui = state.taAskUserUi || { page: 0, answersByPage: {} };
      state.taAskUserUi = { ...ui, page: Math.max(0, page - 1) };
      forceRequestRender();
    });

    document.getElementById("ta-ask-next")?.addEventListener("click", async () => {
      const st = getAskUserPageState(page);
      if (st.customActive && !String(st.custom || "").trim()) {
        state.taChatError = "请填写自定义内容，或改选其他选项";
        forceRequestRender();
        return;
      }
      if (!isLast) {
        const ui = state.taAskUserUi || { page: 0, answersByPage: {} };
        state.taAskUserUi = { ...ui, page: Math.min(questions.length - 1, page + 1) };
        forceRequestRender();
        return;
      }
      await submitTicketAssistantAskUserAnswer();
      forceRequestRender();
    });

    document.getElementById("ta-ask-skip")?.addEventListener("click", async () => {
      const skippedState = { ...emptyAskUserPageState(), skippedNoSelection: true };
      patchAskUserPageState(page, () => skippedState);
      if (!isLast) {
        const ui = state.taAskUserUi || { page: 0, answersByPage: {} };
        state.taAskUserUi = {
          ...ui,
          page: Math.min(questions.length - 1, page + 1),
          answersByPage: { ...(ui.answersByPage || {}), [page]: skippedState },
        };
        forceRequestRender();
        return;
      }
      await submitTicketAssistantAskUserAnswer({
        skippedLast: true,
        overridesByIdx: { [page]: skippedState },
      });
      forceRequestRender();
    });

    document.getElementById("ta-ask-cancel")?.addEventListener("click", async () => {
      await submitTicketAssistantAskUserAnswer({ cancelled: true });
      forceRequestRender();
    });
  }
}

export async function fetchTicketAssistantSessions() {
  const op = getCurrentOperator();
  state.taSessionsLoading = true;
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ticket-assistant/sessions?operator_id=${encodeURIComponent(op.account)}`
    );
    if (!r.ok) {
      state.taSessions = [];
      return;
    }
    const j = await r.json();
    state.taSessions = Array.isArray(j.items) ? j.items : [];
  } catch (_) {
    state.taSessions = [];
  } finally {
    state.taSessionsLoading = false;
  }
}

/**
 * @returns {Promise<boolean>} 当前激活会话的消息是否有可见变化
 */
export async function fetchTicketAssistantMessages(sessionId) {
  const sid = Number(sessionId);
  if (!sid) return false;
  const op = getCurrentOperator();
  const seq = ++taMessagesFetchSeq;
  if (taMessagesAbort) {
    try {
      taMessagesAbort.abort();
    } catch (_) {
      /* ignore */
    }
  }
  taMessagesAbort = typeof AbortController !== "undefined" ? new AbortController() : null;

  state.taMessagesLoading = true;
  state.taChatError = "";
  // 仅保留「同会话」本地消息，避免切换后把上一会话内容当成 prev 留下
  const sameSession = Number(state.taMessagesSessionId) === sid;
  const prev = sameSession ? [...(state.taMessages || [])] : [];
  let changed = false;
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ticket-assistant/sessions/${sid}/messages?operator_id=${encodeURIComponent(op.account)}`,
      taMessagesAbort ? { signal: taMessagesAbort.signal } : undefined
    );
    if (seq !== taMessagesFetchSeq || Number(state.taActiveSessionId) !== sid) {
      return false;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      // 刷新竞态：历史暂时拉失败时保留本地刚写完的消息
      if (!prev.length) {
        state.taMessages = [];
        state.taMessagesSessionId = sid;
        changed = true;
      }
      state.taChatError = j.detail || "拉取历史失败";
      return changed;
    }
    const j = await r.json();
    if (seq !== taMessagesFetchSeq || Number(state.taActiveSessionId) !== sid) {
      return false;
    }
    const items = Array.isArray(j.items) ? j.items : [];
    const resolved = resolveFetchedTaMessages(prev, items, { chatLoading: state.taChatLoading });
    if (resolved === prev) {
      cacheTaMessages(sid, prev);
      return false;
    }
    const prevFingerprint = prev.map((m) => `${m.role}:${m.content}:${JSON.stringify(m.files || [])}`).join("\0");
    const nextFingerprint = resolved.map((m) => `${m.role}:${m.content}:${JSON.stringify(m.files || [])}`).join("\0");
    changed = prevFingerprint !== nextFingerprint || Number(state.taMessagesSessionId) !== sid;
    state.taMessages = resolved;
    cacheTaMessages(sid, resolved);
    return changed;
  } catch (e) {
    if (e && (e.name === "AbortError" || e.code === 20)) return false;
    if (seq !== taMessagesFetchSeq || Number(state.taActiveSessionId) !== sid) return false;
    if (!prev.length) {
      state.taMessages = [];
      state.taMessagesSessionId = sid;
      changed = true;
    }
    state.taChatError = String(e?.message || e);
    return changed;
  } finally {
    if (seq === taMessagesFetchSeq) {
      state.taMessagesLoading = false;
    }
  }
}

export async function createTicketAssistantSession(formValues, options = {}) {
  const op = getCurrentOperator();
  const initialMessage = String(options.initialMessage || "").trim();
  const title = String(options.title || "").trim();
  state.taChatLoading = true;
  state.taChatError = "";
  state.taStreamingText = "";
  let acc = "";
  let result = null;
  /** @type {number | null} */
  let streamSid = null;
  const ac = beginTaChatStreamAbort();
  try {
    if (!(state.taModels || []).length) {
      await fetchTicketAssistantModels();
    }
    // 纯对话首条：先展示用户消息 + 思考中，再开流
    if (initialMessage && !formValues) {
      state.taMessages = [
        { role: "user", content: initialMessage, created_at: "" },
        { role: "assistant", content: "", created_at: "", streaming: true },
      ];
      forceRequestRender();
    }
    const r = await fetch(`${API_BASE_URL}/api/ticket-assistant/sessions/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        form_values: formValues || {},
        initial_message: initialMessage,
        title,
        operator_id: op.account,
        operator_name: op.userName,
        model_name: state.taActiveModel || "",
      }),
      signal: ac?.signal,
    });
    await consumeTicketAssistantSse(r, async (ev) => {
      const type = String(ev.type || "");
      if (type === "session") {
        const item = ev.item || {};
        streamSid = Number(item.id) || null;
        const baseMsgs = Array.isArray(ev.messages) ? ev.messages : [];
        const streamMsgs = [
          ...baseMsgs,
          { role: "assistant", content: acc, created_at: "", streaming: true },
        ];
        if (streamSid) cacheTaMessages(streamSid, streamMsgs);
        // 用户已点进别的历史会话时不抢右侧焦点
        if (!state.taActiveSessionId || Number(state.taActiveSessionId) === streamSid) {
          state.taActiveSessionId = item.id;
          state.taActiveSession = item;
          state.taMessages = streamMsgs;
          state.taMessagesSessionId = streamSid;
          forceRequestRender();
        }
        return;
      }
      if (type === "delta") {
        acc += String(ev.delta || "");
        setStreamingAssistantContent(acc, streamSid);
        return;
      }
      if (type === "file") {
        attachFilesToStreamingAssistant(ev.files, streamSid);
        return;
      }
      if (type === "tool_call") {
        upsertStreamingToolCall(ev.tool_call || ev, streamSid);
        return;
      }
      if (type === "tool_result") {
        upsertStreamingToolResult(ev.tool_result || ev, streamSid);
        return;
      }
      if (type === "ask_user") {
        applyTicketAssistantAskUser(ev);
        const doneSid = Number(streamSid || state.taActiveSessionId);
        const base =
          Number(state.taActiveSessionId) === doneSid
            ? state.taMessages || []
            : state.taMessagesCache?.[doneSid] || [];
        const keptFiles = mergeTicketAssistantFiles(
          takeStreamingAssistantFiles(base),
          ev.files
        );
        const keptTools = Array.isArray(ev.tools) && ev.tools.length
          ? ev.tools
          : takeStreamingAssistantTools(base);
        const nextMsgs = base
          .filter((m) => !(m.role === "assistant" && m.streaming))
          .concat(
            acc.trim() || keptFiles.length || keptTools.length
              ? [
                  {
                    role: "assistant",
                    content: acc.trim(),
                    created_at: "",
                    ...(keptFiles.length ? { files: keptFiles } : {}),
                    ...(keptTools.length ? { tools: keptTools } : {}),
                  },
                ]
              : []
          );
        state.taStreamingText = "";
        if (doneSid) cacheTaMessages(doneSid, nextMsgs);
        if (Number(state.taActiveSessionId) === doneSid) {
          state.taMessages = nextMsgs;
          state.taMessagesSessionId = doneSid;
        }
        forceRequestRender();
        return;
      }
      if (type === "done") {
        const reply = String(ev.reply || acc || "").trim();
        const doneSid = Number(ev.item?.id || streamSid || state.taActiveSessionId);
        if (ev.item) {
          if (!state.taActiveSessionId || Number(state.taActiveSessionId) === doneSid) {
            state.taActiveSession = ev.item;
            state.taActiveSessionId = ev.item.id;
          }
        }
        if (ev.ask_user) applyTicketAssistantAskUser(ev.ask_user);
        const base =
          Number(state.taActiveSessionId) === doneSid
            ? state.taMessages || []
            : state.taMessagesCache?.[doneSid] || [];
        const keptFiles = mergeTicketAssistantFiles(
          takeStreamingAssistantFiles(base),
          ev.files
        );
        const keptTools = Array.isArray(ev.tools) && ev.tools.length
          ? ev.tools
          : takeStreamingAssistantTools(base);
        const msgs = Array.isArray(ev.messages) ? ev.messages : null;
        let nextMsgs;
        if (msgs && msgs.length) {
          nextMsgs = msgs.map((m, idx) => {
            if (idx !== msgs.length - 1 || m.role !== "assistant") return m;
            const files = mergeTicketAssistantFiles(m.files, keptFiles);
            const tools = Array.isArray(m.tools) && m.tools.length ? m.tools : keptTools;
            return {
              ...m,
              ...(files.length ? { files } : {}),
              ...(tools.length ? { tools } : {}),
            };
          });
          if (
            (keptFiles.length || keptTools.length) &&
            !nextMsgs.some(
              (m) =>
                m.role === "assistant" &&
                ((m.files || []).length || (m.tools || []).length)
            )
          ) {
            nextMsgs = nextMsgs.concat([
              {
                role: "assistant",
                content: reply,
                created_at: "",
                ...(keptFiles.length ? { files: keptFiles } : {}),
                ...(keptTools.length ? { tools: keptTools } : {}),
              },
            ]);
          }
        } else {
          nextMsgs = base
            .filter((m) => !(m.role === "assistant" && m.streaming))
            .concat(
              reply || keptFiles.length || keptTools.length
                ? [
                    {
                      role: "assistant",
                      content: reply,
                      created_at: "",
                      ...(keptFiles.length ? { files: keptFiles } : {}),
                      ...(keptTools.length ? { tools: keptTools } : {}),
                    },
                  ]
                : []
            );
        }
        state.taStreamingText = "";
        if (doneSid) cacheTaMessages(doneSid, nextMsgs);
        if (Number(state.taActiveSessionId) === doneSid) {
          state.taMessages = nextMsgs;
          state.taMessagesSessionId = doneSid;
        }
        result = { item: ev.item || state.taActiveSession, reply, messages: nextMsgs };
        return;
      }
      if (type === "error") {
        throw new Error(String(ev.error || "创建会话失败"));
      }
    });
    if (!result) {
      // 流结束但无 done：用累计文本兜底
      const reply = acc.trim();
      const doneSid = Number(streamSid || state.taActiveSessionId);
      if (reply) {
        const base =
          Number(state.taActiveSessionId) === doneSid
            ? state.taMessages || []
            : state.taMessagesCache?.[doneSid] || [];
        const nextMsgs = base
          .filter((m) => !(m.role === "assistant" && m.streaming))
          .concat([{ role: "assistant", content: reply, created_at: "" }]);
        if (doneSid) cacheTaMessages(doneSid, nextMsgs);
        if (Number(state.taActiveSessionId) === doneSid) state.taMessages = nextMsgs;
        result = { item: state.taActiveSession, reply, messages: nextMsgs };
      } else {
        result = {
          item: state.taActiveSession,
          reply,
          messages: state.taMessages,
        };
      }
    }
    await fetchTicketAssistantSessions();
    return result;
  } catch (e) {
    const sid = Number(streamSid || state.taActiveSessionId);
    if (isAbortError(e)) {
      settleStreamingAssistantOnStop(sid);
      state.taChatError = "";
      return { stopped: true, item: state.taActiveSession, messages: state.taMessages };
    }
    state.taChatError = String(e?.message || e);
    if (Number(state.taMessagesSessionId) === Number(state.taActiveSessionId)) {
      state.taMessages = (state.taMessages || []).filter((m) => !(m.role === "assistant" && m.streaming));
    }
    return null;
  } finally {
    clearTaChatStreamAbort(ac);
    const stopped = !!(ac && ac.signal && ac.signal.aborted);
    state.taChatLoading = false;
    state.taStreamingText = "";
    const sid = Number(streamSid || state.taActiveSessionId);
    clearStreamingFlags(sid);
    // 用户停止时勿立刻 history 覆盖，以免冲掉已流出的半截回复
    if (!stopped) await refreshTaMessagesAfterStream(sid);
    forceRequestRender();
  }
}

export async function sendTicketAssistantChat(sessionId, content) {
  const op = getCurrentOperator();
  const sid = Number(sessionId);
  state.taChatLoading = true;
  state.taChatError = "";
  state.taStreamingText = "";
  const userMsg = { role: "user", content, created_at: "" };
  state.taMessages = [
    ...(state.taMessages || []),
    userMsg,
    { role: "assistant", content: "", created_at: "", streaming: true },
  ];
  cacheTaMessages(sid, state.taMessages);
  forceRequestRender();
  let acc = "";
  let result = null;
  const ac = beginTaChatStreamAbort();
  try {
    const r = await fetch(`${API_BASE_URL}/api/ticket-assistant/sessions/${sid}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        content,
        operator_id: op.account,
        operator_name: op.userName,
        model_name: state.taActiveModel || "",
      }),
      signal: ac?.signal,
    });
    await consumeTicketAssistantSse(r, async (ev) => {
      const type = String(ev.type || "");
      if (type === "delta") {
        acc += String(ev.delta || "");
        setStreamingAssistantContent(acc, sid);
        return;
      }
      if (type === "file") {
        attachFilesToStreamingAssistant(ev.files, sid);
        return;
      }
      if (type === "tool_call") {
        upsertStreamingToolCall(ev.tool_call || ev, sid);
        return;
      }
      if (type === "tool_result") {
        upsertStreamingToolResult(ev.tool_result || ev, sid);
        return;
      }
      if (type === "ask_user") {
        applyTicketAssistantAskUser(ev);
        const base =
          Number(state.taActiveSessionId) === sid
            ? state.taMessages || []
            : state.taMessagesCache?.[sid] || state.taMessages || [];
        const keptFiles = mergeTicketAssistantFiles(
          takeStreamingAssistantFiles(base),
          ev.files
        );
        const keptTools = Array.isArray(ev.tools) && ev.tools.length
          ? ev.tools
          : takeStreamingAssistantTools(base);
        const nextMsgs = base
          .filter((m) => !(m.role === "assistant" && m.streaming))
          .concat(
            acc.trim() || keptFiles.length || keptTools.length
              ? [
                  {
                    role: "assistant",
                    content: acc.trim(),
                    created_at: "",
                    ...(keptFiles.length ? { files: keptFiles } : {}),
                    ...(keptTools.length ? { tools: keptTools } : {}),
                  },
                ]
              : []
          );
        state.taStreamingText = "";
        cacheTaMessages(sid, nextMsgs);
        if (Number(state.taActiveSessionId) === sid) state.taMessages = nextMsgs;
        forceRequestRender();
        return;
      }
      if (type === "done") {
        const reply = String(ev.reply || acc || "").trim();
        if (ev.ask_user) applyTicketAssistantAskUser(ev.ask_user);
        const base =
          Number(state.taActiveSessionId) === sid
            ? state.taMessages || []
            : state.taMessagesCache?.[sid] || state.taMessages || [];
        const keptFiles = mergeTicketAssistantFiles(
          takeStreamingAssistantFiles(base),
          ev.files
        );
        const keptTools = Array.isArray(ev.tools) && ev.tools.length
          ? ev.tools
          : takeStreamingAssistantTools(base);
        const nextMsgs = base
          .filter((m) => !(m.role === "assistant" && m.streaming))
          .concat(
            reply || keptFiles.length || keptTools.length
              ? [
                  {
                    role: "assistant",
                    content: reply,
                    created_at: "",
                    ...(keptFiles.length ? { files: keptFiles } : {}),
                    ...(keptTools.length ? { tools: keptTools } : {}),
                  },
                ]
              : []
          );
        state.taStreamingText = "";
        cacheTaMessages(sid, nextMsgs);
        if (Number(state.taActiveSessionId) === sid) {
          state.taMessages = nextMsgs;
        }
        result = { reply, messages: nextMsgs };
        return;
      }
      if (type === "error") {
        throw new Error(String(ev.error || "发送失败"));
      }
    });
    if (!result) {
      const reply = acc.trim();
      const base =
        Number(state.taActiveSessionId) === sid
          ? state.taMessages || []
          : state.taMessagesCache?.[sid] || state.taMessages || [];
      const nextMsgs = base
        .filter((m) => !(m.role === "assistant" && m.streaming))
        .concat(reply ? [{ role: "assistant", content: reply, created_at: "" }] : []);
      cacheTaMessages(sid, nextMsgs);
      if (Number(state.taActiveSessionId) === sid) state.taMessages = nextMsgs;
      result = { reply, messages: nextMsgs };
    }
    return result;
  } catch (e) {
    if (isAbortError(e)) {
      settleStreamingAssistantOnStop(sid);
      state.taChatError = "";
      return { stopped: true, messages: state.taMessages };
    }
    state.taChatError = String(e?.message || e);
    if (Number(state.taActiveSessionId) === sid) {
      state.taMessages = (state.taMessages || []).filter((m) => !(m.role === "assistant" && m.streaming));
    }
    return null;
  } finally {
    clearTaChatStreamAbort(ac);
    const stopped = !!(ac && ac.signal && ac.signal.aborted);
    state.taChatLoading = false;
    state.taStreamingText = "";
    clearStreamingFlags(sid);
    if (!stopped) await refreshTaMessagesAfterStream(sid);
    forceRequestRender();
  }
}

export async function submitTicketAssistantAskUserAnswer(options = {}) {
  const pending = state.taPendingAskUser;
  const sid = Number(state.taActiveSessionId);
  if (!pending || !sid || state.taChatLoading) return null;
  const requestId = String(pending.request_id || "").trim();
  if (!requestId) return null;

  const cancelled = !!options.cancelled;
  const skippedLast = !!options.skippedLast;
  let overridesByIdx = options.overridesByIdx || null;
  let forcedTextByIdx = options.forcedTextByIdx || null;
  if (cancelled) {
    forcedTextByIdx = {};
    (pending.questions || []).forEach((_, idx) => {
      forcedTextByIdx[idx] = ASK_USER_CANCELLED_TEXT;
    });
  }
  if (skippedLast) {
    const page = Number(state.taAskUserUi?.page || 0);
    const skippedState = { ...emptyAskUserPageState(), skippedNoSelection: true };
    overridesByIdx = { ...(overridesByIdx || {}), [page]: skippedState };
  }

  const answers = buildAskUserAnswers(overridesByIdx, forcedTextByIdx);
  if (answers.some((a) => a.custom_input === "" && a.selected_options.length === 0 && !cancelled)) {
    // Other 已选但未填：不提交
    const page = Number(state.taAskUserUi?.page || 0);
    const st = overridesByIdx?.[page] || getAskUserPageState(page);
    if (st.customActive && !String(st.custom || "").trim()) {
      state.taChatError = "请填写自定义内容，或改选其他选项";
      forceRequestRender();
      return null;
    }
  }

  const op = getCurrentOperator();
  const echo = cancelled ? "" : buildAskUserEchoSummary();
  clearTicketAssistantAskUser();
  state.taChatLoading = true;
  state.taChatError = "";
  state.taStreamingText = "";
  const baseMsgs = [...(state.taMessages || [])].filter((m) => !(m.role === "assistant" && m.streaming));
  const nextBase = echo
    ? [...baseMsgs, { role: "user", content: echo, created_at: "" }]
    : baseMsgs;
  state.taMessages = [
    ...nextBase,
    { role: "assistant", content: "", created_at: "", streaming: true },
  ];
  cacheTaMessages(sid, state.taMessages);
  forceRequestRender();

  let acc = "";
  let result = null;
  const ac = beginTaChatStreamAbort();
  try {
    const body = {
      request_id: requestId,
      answers,
      source: pending.source || "ask_user_interrupt",
      operator_id: op.account,
      operator_name: op.userName,
      model_name: state.taActiveModel || "",
    };
    if (pending.approval_schema) body.approval_schema = pending.approval_schema;
    if (pending.evolution_meta) body.evolution_meta = pending.evolution_meta;
    if (pending.plan_approval_kind) {
      body.plan_approval_kind = pending.plan_approval_kind;
      body.plan_content = pending.plan_content || "";
      if (pending.plan_language) body.plan_language = pending.plan_language;
    }
    const r = await fetch(`${API_BASE_URL}/api/ticket-assistant/sessions/${sid}/answer/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: ac?.signal,
    });
    await consumeTicketAssistantSse(r, async (ev) => {
      const type = String(ev.type || "");
      if (type === "delta") {
        acc += String(ev.delta || "");
        setStreamingAssistantContent(acc, sid);
        return;
      }
      if (type === "file") {
        attachFilesToStreamingAssistant(ev.files, sid);
        return;
      }
      if (type === "tool_call") {
        upsertStreamingToolCall(ev.tool_call || ev, sid);
        return;
      }
      if (type === "tool_result") {
        upsertStreamingToolResult(ev.tool_result || ev, sid);
        return;
      }
      if (type === "ask_user") {
        applyTicketAssistantAskUser(ev);
        const base =
          Number(state.taActiveSessionId) === sid
            ? state.taMessages || []
            : state.taMessagesCache?.[sid] || state.taMessages || [];
        const keptFiles = mergeTicketAssistantFiles(
          takeStreamingAssistantFiles(base),
          ev.files
        );
        const keptTools = Array.isArray(ev.tools) && ev.tools.length
          ? ev.tools
          : takeStreamingAssistantTools(base);
        const nextMsgs = base
          .filter((m) => !(m.role === "assistant" && m.streaming))
          .concat(
            acc.trim() || keptFiles.length || keptTools.length
              ? [
                  {
                    role: "assistant",
                    content: acc.trim(),
                    created_at: "",
                    ...(keptFiles.length ? { files: keptFiles } : {}),
                    ...(keptTools.length ? { tools: keptTools } : {}),
                  },
                ]
              : []
          );
        state.taStreamingText = "";
        cacheTaMessages(sid, nextMsgs);
        if (Number(state.taActiveSessionId) === sid) state.taMessages = nextMsgs;
        forceRequestRender();
        return;
      }
      if (type === "done") {
        const reply = String(ev.reply || acc || "").trim();
        if (ev.ask_user) applyTicketAssistantAskUser(ev.ask_user);
        const base =
          Number(state.taActiveSessionId) === sid
            ? state.taMessages || []
            : state.taMessagesCache?.[sid] || state.taMessages || [];
        const keptFiles = mergeTicketAssistantFiles(
          takeStreamingAssistantFiles(base),
          ev.files
        );
        const keptTools = Array.isArray(ev.tools) && ev.tools.length
          ? ev.tools
          : takeStreamingAssistantTools(base);
        const nextMsgs = base
          .filter((m) => !(m.role === "assistant" && m.streaming))
          .concat(
            reply || keptFiles.length || keptTools.length
              ? [
                  {
                    role: "assistant",
                    content: reply,
                    created_at: "",
                    ...(keptFiles.length ? { files: keptFiles } : {}),
                    ...(keptTools.length ? { tools: keptTools } : {}),
                  },
                ]
              : []
          );
        state.taStreamingText = "";
        cacheTaMessages(sid, nextMsgs);
        if (Number(state.taActiveSessionId) === sid) state.taMessages = nextMsgs;
        result = { reply, messages: nextMsgs };
        return;
      }
      if (type === "error") {
        throw new Error(String(ev.error || "提交选择失败"));
      }
    });
    return result;
  } catch (e) {
    if (isAbortError(e)) {
      settleStreamingAssistantOnStop(sid);
      state.taChatError = "";
      return { stopped: true, messages: state.taMessages };
    }
    state.taChatError = String(e?.message || e);
    if (Number(state.taActiveSessionId) === sid) {
      state.taMessages = (state.taMessages || []).filter((m) => !(m.role === "assistant" && m.streaming));
    }
    return null;
  } finally {
    clearTaChatStreamAbort(ac);
    const stopped = !!(ac && ac.signal && ac.signal.aborted);
    state.taChatLoading = false;
    state.taStreamingText = "";
    clearStreamingFlags(sid);
    if (!stopped) await refreshTaMessagesAfterStream(sid);
    forceRequestRender();
  }
}

export async function transferTicketAssistantSession(sessionId) {
  const op = getCurrentOperator();
  state.taTransferLoading = true;
  state.taChatError = "";
  try {
    const r = await fetch(`${API_BASE_URL}/api/ticket-assistant/sessions/${sessionId}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operator_id: op.account,
        operator_name: op.userName,
        next_node_key: "problem_review",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const d = j.detail;
      if (typeof d === "string" && d.trim()) {
        state.taChatError = d;
      } else if (d && typeof d === "object" && Array.isArray(d.errors) && d.errors.length) {
        state.taChatError = d.errors.map(String).join("；");
      } else if (d && typeof d === "object" && d.message) {
        state.taChatError = String(d.message);
      } else {
        state.taChatError = "转人工失败";
      }
      return null;
    }
    if (j.item) {
      state.taActiveSession = j.item;
      state.taSessions = (state.taSessions || []).map((s) =>
        Number(s.id) === Number(sessionId) ? { ...s, ...j.item } : s
      );
    }
    const ticketNo = String(j.ticket_no || "").trim();
    const nextHandler = String(j.next_handler || "").trim();
    if (ticketNo) {
      state.activeKey = ensureTicketTab(ticketNo);
      history.pushState({}, "", getUrlByKey(state.activeKey));
      try {
        await syncSingleTicketFromServer(ticketNo);
      } catch (_) {
        /* ignore */
      }
      try {
        const { syncOperationLogsFromServer } = await import("./ticket-page.js");
        await syncOperationLogsFromServer(ticketNo, { force: true, suppressRender: true });
      } catch (_) {
        /* ignore */
      }
      if (nextHandler) openProblemFillReviewerModal(nextHandler, ticketNo);
    }
    return j;
  } catch (e) {
    state.taChatError = String(e?.message || e);
    return null;
  } finally {
    state.taTransferLoading = false;
  }
}

function statusLabel(status) {
  if (status === "transferred") return "已转人工";
  if (status === "abandoned") return "已废弃";
  return "对话中";
}

function renderModelSelectorHtml({ disabled }) {
  const models = state.taModels || [];
  const activeKey = String(state.taActiveModel || "");
  const active =
    models.find((m) => modelKey(m) === activeKey) ||
    models.find((m) => m.model_name === activeKey) ||
    null;
  const label = active
    ? modelLabel(active)
    : state.taModelsLoading
      ? "加载模型…"
      : models.length
        ? "选择模型"
        : "默认模型";
  const open = !!state.taModelMenuOpen && !disabled && models.length > 0;
  const optionsHtml = models
    .map((m) => {
      const key = modelKey(m);
      const isActive = key === activeKey;
      return `<button type="button" class="ta-model-option ${isActive ? "active" : ""}" role="menuitemradio" aria-checked="${isActive}" data-ta-model="${escapeAttr(key)}">
        <span class="ta-model-option-label">${escapeHtml(modelLabel(m))}</span>
        ${isActive ? '<span class="ta-model-check" aria-hidden="true">✓</span>' : ""}
      </button>`;
    })
    .join("");

  return `<div class="ta-model-select ${open ? "open" : ""}" id="ta-model-select">
    <button type="button" class="ta-model-trigger" id="ta-model-trigger" title="选择模型（来自九问配置）" ${disabled || !models.length ? "disabled" : ""} aria-haspopup="menu" aria-expanded="${open}">
      <span class="ta-model-trigger-label">${escapeHtml(label)}</span>
      ${!disabled && models.length ? '<span class="ta-model-chevron" aria-hidden="true">▾</span>' : ""}
    </button>
    ${
      open
        ? `<div class="ta-model-menu" id="ta-model-menu" role="menu">
      <div class="ta-model-menu-title">已配置模型</div>
      ${optionsHtml || '<div class="ta-model-empty">暂无可用模型</div>'}
    </div>`
        : ""
    }
  </div>`;
}

function renderAskUserCardHtml() {
  const pending = state.taPendingAskUser;
  if (!pending || state.taChatLoading) return "";
  const questions = Array.isArray(pending.questions) ? pending.questions : [];
  if (!questions.length) return "";
  const ui = state.taAskUserUi || { page: 0, answersByPage: {} };
  const page = Math.max(0, Math.min(Number(ui.page || 0), questions.length - 1));
  const q = questions[page] || {};
  const st = getAskUserPageState(page);
  const options = Array.isArray(q.options) ? q.options : [];
  const normalOptions = options.filter((o) => String(o.label || "") !== ASK_USER_OTHER_LABEL);
  const hasOther = options.some((o) => String(o.label || "") === ASK_USER_OTHER_LABEL);
  const isMulti = !!q.multi_select;
  const isFree = normalOptions.length === 0;
  const isLast = page >= questions.length - 1;

  const optsHtml = normalOptions
    .map((o) => {
      const label = String(o.label || "");
      const value = String(o.value || o.label || "");
      const desc = String(o.description || "").trim();
      const selected = (st.selected || []).includes(value) || (st.selected || []).includes(label);
      return `<button type="button" class="ta-ask-opt ${selected ? "selected" : ""}" data-ta-ask-opt="${escapeAttr(value)}" ${isMulti ? 'data-ta-ask-multi="1"' : ""}>
        <span class="ta-ask-opt-label">${escapeHtml(label)}</span>
        ${desc ? `<span class="ta-ask-opt-desc">${escapeHtml(desc)}</span>` : ""}
      </button>`;
    })
    .join("");

  const otherHtml =
    hasOther || isFree
      ? `<button type="button" class="ta-ask-opt ta-ask-opt-other ${st.customActive || isFree ? "selected" : ""}" data-ta-ask-other="1">
          <span class="ta-ask-opt-label">${isFree ? "请输入" : "其他"}</span>
        </button>
        ${
          st.customActive || isFree
            ? `<textarea class="ta-ask-custom" id="ta-ask-custom" rows="2" placeholder="自定义输入…">${escapeHtml(String(st.custom || ""))}</textarea>`
            : ""
        }`
      : "";

  return `<div class="ta-ask-card" id="ta-ask-card" role="dialog" aria-label="请选择">
    <div class="ta-ask-head">
      <span class="ta-ask-title">${escapeHtml(String(q.header || "请选择"))}</span>
      ${
        questions.length > 1
          ? `<span class="ta-ask-pager">${page + 1} / ${questions.length}</span>`
          : ""
      }
    </div>
    <div class="ta-ask-question">${escapeHtml(String(q.question || ""))}</div>
    <div class="ta-ask-options">${optsHtml}${otherHtml}</div>
    <div class="ta-ask-actions">
      <button type="button" class="ta-ask-btn ghost" id="ta-ask-cancel">取消</button>
      <button type="button" class="ta-ask-btn ghost" id="ta-ask-skip">跳过</button>
      ${
        page > 0
          ? `<button type="button" class="ta-ask-btn ghost" id="ta-ask-prev">上一题</button>`
          : ""
      }
      <button type="button" class="ta-ask-btn primary" id="ta-ask-next">${
        isLast ? "确定" : "下一题"
      }</button>
    </div>
  </div>`;
}

function renderComposerHtml({ disabled, placeholder }) {
  const busy = !!disabled;
  const showStop = !!state.taChatLoading && !state.taTransferLoading;
  const ph = placeholder || "继续描述问题…（Enter 发送，Shift+Enter 换行）";
  const askCard = renderAskUserCardHtml();
  const sendDisabled = showStop ? false : busy || !!state.taPendingAskUser;
  return `<div class="ta-composer-wrap">
    ${askCard}
    <div class="ta-composer ${busy || state.taPendingAskUser ? "disabled" : ""}">
      <textarea class="ta-composer-input" id="ta-input" rows="1" placeholder="${escapeAttr(
        state.taPendingAskUser ? "请先完成上方选择…" : ph
      )}" ${busy || state.taPendingAskUser ? "disabled" : ""}></textarea>
      <div class="ta-composer-toolbar">
        <div class="ta-composer-toolbar-left"></div>
        <div class="ta-composer-actions">
          ${renderModelSelectorHtml({ disabled: busy || !!state.taPendingAskUser })}
          <button type="button" class="ta-send-btn${showStop ? " ta-send-btn--stop" : ""}" id="ta-send-btn" title="${
            showStop ? "停止" : "发送"
          }" ${sendDisabled ? "disabled" : ""} aria-label="${showStop ? "停止" : "发送"}">
            ${
              showStop
                ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>`
                : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6" />
            </svg>`
            }
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

function railIconNewChat() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 3.487a2.1 2.1 0 113 3L8.25 18.1 4.5 19.5l1.4-3.75L16.862 3.487z"/>
    <path stroke-linecap="round" stroke-linejoin="round" d="M15 5.5l3 3"/>
  </svg>`;
}

export function renderTicketAssistantPage() {
  const sessions = state.taSessions || [];
  const activeId = state.taActiveSessionId;
  const active = state.taActiveSession || sessions.find((s) => Number(s.id) === Number(activeId)) || null;
  const messages = state.taMessages || [];
  const loading = state.taChatLoading;
  const messagesLoading = !!state.taMessagesLoading;
  const transferring = state.taTransferLoading;
  const error = state.taChatError;
  const canTransfer = canTransferViaTicketAssistant();
  const canCreate = canTransfer && canCreateViaTicketAssistant();
  const chatOnly = !canTransfer;
  const activeStatus = active ? String(active.status || "chatting") : "";
  const isChatting = activeStatus === "chatting";
  // 转人工建单后仍可回到会话续聊；仅废弃会话隐藏输入框
  const canCompose = !!active && (isChatting || activeStatus === "transferred");
  const composerDisabled = loading || transferring;
  const historyOpen = !!state.taHistoryOpen;
  const canStartNew = chatOnly || canCreate;

  const listHtml = sessions
    .map((s) => {
      const id = s.id;
      const isActive = Number(id) === Number(activeId);
      const title = String(s.title || "未命名会话");
      const st = String(s.status || "chatting");
      const ticketNo = String(s.ticket_no || "").trim();
      return `<button type="button" class="ta-conv-item ${isActive ? "active" : ""}" data-ta-session-id="${escapeAttr(String(id))}">
        <span class="ta-conv-title">${escapeHtml(title.length > 42 ? `${title.slice(0, 42)}…` : title)}</span>
        <span class="ta-conv-row">
          <span class="ta-conv-status ${escapeAttr(st)}">${escapeHtml(statusLabel(st))}</span>
          ${ticketNo ? `<span class="ta-conv-meta">${escapeHtml(ticketNo)}</span>` : ""}
        </span>
      </button>`;
    })
    .join("");

  const hasStreamingAssistant = messages.some((m) => m && m.role === "assistant" && m.streaming);
  const messagesHtml = messages
    .map((m) => {
      const role = String(m.role || "");
      const content = String(m.content || "");
      const streaming = !!m.streaming;
      const filesHtml = renderFileItemsHtml(m.files);
      const toolsHtml = renderToolsHtml(m.tools);
      if (role === "user") {
        return `<div class="ta-msg ta-msg-user"><div class="ta-msg-bubble">${escapeHtml(content)}</div></div>`;
      }
      let body = "";
      if (!content) {
        body = streaming && !filesHtml && !toolsHtml ? '<span class="ta-msg-thinking-text">正在思考…</span>' : "";
      } else if (streaming) {
        // 占位分区，由 patchStreamingAssistantBubble 填充，避免整页重绘时整表闪一下
        body = '<div class="ta-stream-stable"></div><div class="ta-stream-pending"></div>';
      } else {
        body = renderAssistantMarkdown(content);
      }
      const streamAttr = streaming ? ' id="ta-stream-bubble"' : "";
      if (!body && !filesHtml && !toolsHtml) return "";
      return `<div class="ta-msg ta-msg-assistant${streaming ? " ta-msg-streaming" : ""}">${toolsHtml}<div class="ta-msg-bubble ta-msg-md"${streamAttr}>${filesHtml}${body}</div></div>`;
    })
    .join("");

  const chatBody = active
    ? `<div class="ta-chat-stage">
        <div class="ta-toolbar">
          <div class="ta-toolbar-title">${escapeHtml(String(active.title || "对话"))}</div>
          <div class="ta-toolbar-actions">
            ${
              isChatting && canTransfer
                ? `<button type="button" class="ta-transfer-btn" id="ta-transfer-btn" ${composerDisabled ? "disabled" : ""}>${transferring ? "建单中…" : "转人工"}</button>`
                : active.ticket_no
                  ? `<span class="ta-conv-meta">工单 ${escapeHtml(String(active.ticket_no))}</span>`
                  : ""
            }
          </div>
        </div>
        <div class="ta-messages" id="ta-messages">${
          messagesLoading && !messages.length
            ? '<div class="ta-msg ta-msg-assistant ta-msg-thinking"><div class="ta-msg-bubble">加载中…</div></div>'
            : `${messagesHtml}${
                loading && !hasStreamingAssistant
                  ? '<div class="ta-msg ta-msg-assistant ta-msg-thinking"><div class="ta-msg-bubble">正在思考…</div></div>'
                  : ""
              }`
        }</div>
        ${error ? `<div class="ta-error">${escapeHtml(error)}</div>` : ""}
        ${
          canCompose
            ? renderComposerHtml({ disabled: composerDisabled })
            : ""
        }
      </div>`
    : `<div class="ta-welcome">
        <div class="ta-welcome-hero">
          <img class="ta-welcome-logo" src="/assets/icons/jiuwen-home-banner.svg" alt="九问" decoding="async" fetchpriority="low" />
          <h1 class="ta-welcome-title">有什么运维问题想聊聊吗？</h1>
          ${
            chatOnly || canCreate
              ? ""
              : `<p class="ta-welcome-sub">暂无创建权限；可点击 logo 打开边栏查看历史会话。</p>`
          }
        </div>
        ${error ? `<div class="ta-error ta-error-float">${escapeHtml(error)}</div>` : ""}
        ${
          loading && !messages.length
            ? '<div class="ta-msg ta-msg-assistant ta-msg-thinking" style="max-width:720px;margin:0 auto 12px"><div class="ta-msg-bubble">正在思考…</div></div>'
            : ""
        }
        ${
          messages.length
            ? `<div class="ta-messages ta-messages--welcome" id="ta-messages" style="max-width:720px;width:100%;margin:0 auto 12px">${messagesHtml}${
                loading && !hasStreamingAssistant
                  ? '<div class="ta-msg ta-msg-assistant ta-msg-thinking"><div class="ta-msg-bubble">正在思考…</div></div>'
                  : ""
              }</div>`
            : ""
        }
        <div class="ta-welcome-composer ${chatOnly ? "ta-welcome-composer--chat" : ""}" id="ta-welcome-composer">
          ${renderComposerHtml({
            disabled: chatOnly ? composerDisabled : true,
            placeholder: chatOnly
              ? "Enter发送，Shift+Enter换行"
              : canCreate
                ? "Enter发送，Shift+Enter换行"
                : "暂无创建权限",
          })}
        </div>
      </div>`;

  const convListInner = state.taSessionsLoading
    ? '<div class="ta-conv-meta" style="padding:12px">加载中…</div>'
    : listHtml || '<div class="ta-conv-meta" style="padding:12px">暂无会话</div>';

  return `<section class="ta-page ${historyOpen ? "ta-sidebar-open" : ""}" aria-label="提单助手">
    <aside class="ta-sidebar ${historyOpen ? "open" : ""}" id="ta-sidebar" aria-label="提单助手边栏">
      <div class="ta-sidebar-top">
        <button type="button" class="ta-sidebar-toggle" id="ta-sidebar-toggle" aria-label="${historyOpen ? "关闭边栏" : "打开边栏"}" aria-expanded="${historyOpen}" aria-controls="ta-sidebar-body">
          <img class="ta-rail-logo" src="/assets/icons/jiuwen-logo.svg" alt="" width="32" height="32" />
          ${historyOpen ? `<span class="ta-sidebar-brand">九问</span>` : ""}
          <span class="ta-sidebar-tip" aria-hidden="true">${historyOpen ? "关闭边栏" : "打开边栏"}</span>
        </button>
        ${
          historyOpen
            ? `<button type="button" class="ta-sidebar-nav-item" id="ta-new-session-btn" ${canStartNew ? "" : "disabled"}>
                ${railIconNewChat()}
                <span>发起新对话</span>
              </button>`
            : `<button type="button" class="ta-rail-btn" id="ta-new-session-btn" title="新建对话" ${canStartNew ? "" : "disabled"}>
                ${railIconNewChat()}
              </button>`
        }
      </div>
      <div class="ta-sidebar-body" id="ta-sidebar-body" aria-hidden="${historyOpen ? "false" : "true"}">
        <div class="ta-sidebar-recent">
          <div class="ta-sidebar-section-label">最近</div>
          <div class="ta-conv-list" id="ta-conv-list">${convListInner}</div>
        </div>
      </div>
    </aside>
    <div class="ta-main">${chatBody}</div>
  </section>`;
}

function autosizeComposer(el) {
  if (!el) return;
  el.style.height = "auto";
  const max = 160;
  const contentH = el.scrollHeight;
  el.style.height = `${Math.min(max, Math.max(44, contentH))}px`;
  // 未顶满时隐藏滚动条（Windows 否则常显示灰色滑条）；顶满后才允许滚动
  el.style.overflowY = contentH > max ? "auto" : "hidden";
}

export async function bindTicketAssistantPage() {
  // 先绑事件：taNeedsRefresh 拉数期间欢迎页编辑框也须可点出创建弹窗
  bindTicketAssistantUiHandlers();

  if (state.taNeedsRefresh) {
    state.taNeedsRefresh = false;
    state.taModelsFetched = false;
    await ensureAdminData();
    await Promise.all([fetchTicketAssistantSessions(), fetchTicketAssistantModels()]);
    // 流式对话进行中不要重拉历史，避免冲掉正在打字的气泡
    if (state.taActiveSessionId && !state.taChatLoading) {
      await fetchTicketAssistantMessages(state.taActiveSessionId);
      const found = (state.taSessions || []).find((s) => Number(s.id) === Number(state.taActiveSessionId));
      if (found) state.taActiveSession = found;
    }
    tryAutoOpenCreateModal();
    // 会话/模型异步就绪后须 force，避免与 ensureAdminData 的 requestRender 合并被吞
    forceRequestRender();
    return;
  }

  if (tryAutoOpenCreateModal()) {
    forceRequestRender();
    return;
  }

  // 仅首次未拉取时补一次；空列表也算已拉取，禁止死循环重绘
  if (!state.taModelsFetched && !state.taModelsLoading) {
    void fetchTicketAssistantModels().then((changed) => {
      if (changed) requestRender();
    });
  }

  requestAnimationFrame(() => {
    const box = document.getElementById("ta-messages");
    if (box) box.scrollTop = box.scrollHeight;
  });
}
