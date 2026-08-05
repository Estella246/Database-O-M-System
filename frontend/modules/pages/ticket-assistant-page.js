import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { getWhitelistLevel, whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { forceRequestRender, requestRender } from "../core/scheduler.js";
import { beginCreateTicketModal, ensureTicketTab, getUrlByKey, syncSingleTicketFromServer } from "./ticket-core.js";
import { openProblemFillReviewerModal } from "./problem-fill-reviewer-modal.js";
import { ensureAdminData } from "./admin-page.js";

const TA_MODEL_STORAGE_KEY = "ta_selected_model";

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

function scrollTaMessagesToBottom() {
  const box = document.getElementById("ta-messages");
  if (box) box.scrollTop = box.scrollHeight;
}

/** 流式时优先就地改气泡，避免整页重绘打断打字效果。 */
function patchStreamingAssistantBubble(text) {
  const el = document.getElementById("ta-stream-bubble");
  if (!el) return false;
  el.classList.remove("ta-msg-thinking-text");
  el.innerHTML = renderAssistantMarkdown(text) || '<span class="ta-msg-thinking-text">正在思考…</span>';
  document.querySelector(".ta-msg-thinking")?.remove();
  scrollTaMessagesToBottom();
  return true;
}

function setStreamingAssistantContent(text) {
  const msgs = state.taMessages || [];
  const last = msgs[msgs.length - 1];
  if (last && last.role === "assistant" && last.streaming) {
    last.content = String(text || "");
  } else {
    state.taMessages = [
      ...msgs,
      { role: "assistant", content: String(text || ""), created_at: "", streaming: true },
    ];
  }
  state.taStreamingText = String(text || "");
  if (!patchStreamingAssistantBubble(state.taStreamingText)) {
    forceRequestRender();
    requestAnimationFrame(() => patchStreamingAssistantBubble(state.taStreamingText));
  }
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
  state.taActiveSessionId = null;
  state.taActiveSession = null;
  state.taMessages = [];
  state.taChatError = "";
  state.taModelMenuOpen = false;
  state.ticketAssistantAutoCreatePending = false;
  state.ticketAssistantCreateMode = false;
  forceRequestRender();
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
    el.addEventListener("click", async () => {
      const id = Number(el.getAttribute("data-ta-session-id"));
      if (!id) return;
      state.taActiveSessionId = id;
      state.taActiveSession = (state.taSessions || []).find((s) => Number(s.id) === id) || null;
      state.taChatError = "";
      state.taModelMenuOpen = false;
      state.ticketAssistantAutoCreatePending = false;
      await fetchTicketAssistantMessages(id);
      requestRender();
      requestAnimationFrame(() => {
        const box = document.getElementById("ta-messages");
        if (box) box.scrollTop = box.scrollHeight;
      });
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

export async function fetchTicketAssistantMessages(sessionId) {
  const op = getCurrentOperator();
  state.taMessagesLoading = true;
  state.taChatError = "";
  const prev =
    Number(state.taActiveSessionId) === Number(sessionId) ? [...(state.taMessages || [])] : [];
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ticket-assistant/sessions/${sessionId}/messages?operator_id=${encodeURIComponent(op.account)}`
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      // 刷新竞态：历史暂时拉失败时保留本地刚写完的消息
      if (!prev.length) state.taMessages = [];
      state.taChatError = j.detail || "拉取历史失败";
      return;
    }
    const j = await r.json();
    const items = Array.isArray(j.items) ? j.items : [];
    // 九问历史偶发尚未落库 / 流式进行中：勿用更短或空历史冲掉本地消息
    if (prev.length && (!items.length || items.length < prev.length || state.taChatLoading)) {
      state.taMessages = prev;
      return;
    }
    state.taMessages = items;
  } catch (e) {
    if (!prev.length) state.taMessages = [];
    state.taChatError = String(e?.message || e);
  } finally {
    state.taMessagesLoading = false;
  }
}

export async function createTicketAssistantSession(formValues, options = {}) {
  const op = getCurrentOperator();
  const initialMessage = String(options.initialMessage || "").trim();
  state.taChatLoading = true;
  state.taChatError = "";
  state.taStreamingText = "";
  let acc = "";
  let result = null;
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
        operator_id: op.account,
        operator_name: op.userName,
        model_name: state.taActiveModel || "",
      }),
    });
    await consumeTicketAssistantSse(r, async (ev) => {
      const type = String(ev.type || "");
      if (type === "session") {
        const item = ev.item || {};
        state.taActiveSessionId = item.id;
        state.taActiveSession = item;
        const baseMsgs = Array.isArray(ev.messages) ? ev.messages : [];
        state.taMessages = [
          ...baseMsgs,
          { role: "assistant", content: acc, created_at: "", streaming: true },
        ];
        forceRequestRender();
        return;
      }
      if (type === "delta") {
        acc += String(ev.delta || "");
        setStreamingAssistantContent(acc);
        return;
      }
      if (type === "done") {
        const reply = String(ev.reply || acc || "").trim();
        if (ev.item) {
          state.taActiveSession = ev.item;
          state.taActiveSessionId = ev.item.id;
        }
        const msgs = Array.isArray(ev.messages) ? ev.messages : null;
        if (msgs && msgs.length) {
          state.taMessages = msgs;
        } else {
          state.taMessages = (state.taMessages || [])
            .filter((m) => !(m.role === "assistant" && m.streaming))
            .concat(reply ? [{ role: "assistant", content: reply, created_at: "" }] : []);
        }
        state.taStreamingText = "";
        result = { item: state.taActiveSession, reply, messages: state.taMessages };
        return;
      }
      if (type === "error") {
        throw new Error(String(ev.error || "创建会话失败"));
      }
    });
    if (!result) {
      // 流结束但无 done：用累计文本兜底
      const reply = acc.trim();
      if (reply) {
        state.taMessages = (state.taMessages || [])
          .filter((m) => !(m.role === "assistant" && m.streaming))
          .concat([{ role: "assistant", content: reply, created_at: "" }]);
      }
      result = {
        item: state.taActiveSession,
        reply,
        messages: state.taMessages,
      };
    }
    await fetchTicketAssistantSessions();
    return result;
  } catch (e) {
    state.taChatError = String(e?.message || e);
    state.taMessages = (state.taMessages || []).filter((m) => !(m.role === "assistant" && m.streaming));
    return null;
  } finally {
    state.taChatLoading = false;
    state.taStreamingText = "";
    // 去掉 streaming 标记
    state.taMessages = (state.taMessages || []).map((m) => {
      if (!m || !m.streaming) return m;
      const { streaming, ...rest } = m;
      return rest;
    });
  }
}

export async function sendTicketAssistantChat(sessionId, content) {
  const op = getCurrentOperator();
  state.taChatLoading = true;
  state.taChatError = "";
  state.taStreamingText = "";
  const userMsg = { role: "user", content, created_at: "" };
  state.taMessages = [
    ...(state.taMessages || []),
    userMsg,
    { role: "assistant", content: "", created_at: "", streaming: true },
  ];
  forceRequestRender();
  let acc = "";
  let result = null;
  try {
    const r = await fetch(`${API_BASE_URL}/api/ticket-assistant/sessions/${sessionId}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        content,
        operator_id: op.account,
        operator_name: op.userName,
        model_name: state.taActiveModel || "",
      }),
    });
    await consumeTicketAssistantSse(r, async (ev) => {
      const type = String(ev.type || "");
      if (type === "delta") {
        acc += String(ev.delta || "");
        setStreamingAssistantContent(acc);
        return;
      }
      if (type === "done") {
        const reply = String(ev.reply || acc || "").trim();
        state.taMessages = (state.taMessages || [])
          .filter((m) => !(m.role === "assistant" && m.streaming))
          .concat(reply ? [{ role: "assistant", content: reply, created_at: "" }] : []);
        state.taStreamingText = "";
        result = { reply, messages: state.taMessages };
        // 若最终仍空，回拉历史兜底（避免「刷新后才有」）
        if (!reply) {
          await fetchTicketAssistantMessages(sessionId);
        }
        return;
      }
      if (type === "error") {
        throw new Error(String(ev.error || "发送失败"));
      }
    });
    if (!result) {
      const reply = acc.trim();
      state.taMessages = (state.taMessages || [])
        .filter((m) => !(m.role === "assistant" && m.streaming))
        .concat(reply ? [{ role: "assistant", content: reply, created_at: "" }] : []);
      if (!reply) await fetchTicketAssistantMessages(sessionId);
      result = { reply, messages: state.taMessages };
    }
    return result;
  } catch (e) {
    state.taChatError = String(e?.message || e);
    state.taMessages = (state.taMessages || []).filter((m) => !(m.role === "assistant" && m.streaming));
    // 失败时也尝试拉一次历史：网关超时但九问已答完的情况
    try {
      await fetchTicketAssistantMessages(sessionId);
    } catch (_) {
      /* ignore */
    }
    return null;
  } finally {
    state.taChatLoading = false;
    state.taStreamingText = "";
    state.taMessages = (state.taMessages || []).map((m) => {
      if (!m || !m.streaming) return m;
      const { streaming, ...rest } = m;
      return rest;
    });
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

function renderComposerHtml({ disabled, placeholder }) {
  const busy = !!disabled;
  const ph = placeholder || "继续描述问题…（Enter 发送，Shift+Enter 换行）";
  return `<div class="ta-composer-wrap">
    <div class="ta-composer ${busy ? "disabled" : ""}">
      <textarea class="ta-composer-input" id="ta-input" rows="1" placeholder="${escapeAttr(ph)}" ${busy ? "disabled" : ""}></textarea>
      <div class="ta-composer-toolbar">
        <div class="ta-composer-toolbar-left"></div>
        <div class="ta-composer-actions">
          ${renderModelSelectorHtml({ disabled: busy })}
          <button type="button" class="ta-send-btn" id="ta-send-btn" title="发送" ${busy ? "disabled" : ""} aria-label="发送">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6" />
            </svg>
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
      if (role === "user") {
        return `<div class="ta-msg ta-msg-user"><div class="ta-msg-bubble">${escapeHtml(content)}</div></div>`;
      }
      const body = content
        ? renderAssistantMarkdown(content)
        : streaming
          ? '<span class="ta-msg-thinking-text">正在思考…</span>'
          : "";
      const streamAttr = streaming ? ' id="ta-stream-bubble"' : "";
      return `<div class="ta-msg ta-msg-assistant${streaming ? " ta-msg-streaming" : ""}"><div class="ta-msg-bubble ta-msg-md"${streamAttr}>${body}</div></div>`;
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
        <div class="ta-messages" id="ta-messages">${messagesHtml}${
          loading && !hasStreamingAssistant
            ? '<div class="ta-msg ta-msg-assistant ta-msg-thinking"><div class="ta-msg-bubble">正在思考…</div></div>'
            : ""
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
