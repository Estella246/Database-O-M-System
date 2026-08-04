import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { forceRequestRender, requestRender } from "../core/scheduler.js";
import { beginCreateTicketModal, ensureTicketTab, getUrlByKey, syncSingleTicketFromServer } from "./ticket-core.js";
import { openProblemFillReviewerModal } from "./problem-fill-reviewer-modal.js";
import { ensureAdminData } from "./admin-page.js";

const TA_MODEL_STORAGE_KEY = "ta_selected_model";

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

export function canCreateViaTicketAssistant() {
  return whitelistAllows("workbench_create", "readonly", getCurrentWhitelistSettings());
}

export function beginTicketAssistantCreateModal() {
  if (!canCreateViaTicketAssistant()) return false;
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
  if (!canCreateViaTicketAssistant()) {
    state.ticketAssistantAutoCreatePending = false;
    return false;
  }
  return beginTicketAssistantCreateModal();
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
  try {
    const r = await fetch(
      `${API_BASE_URL}/api/ticket-assistant/sessions/${sessionId}/messages?operator_id=${encodeURIComponent(op.account)}`
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      state.taMessages = [];
      state.taChatError = j.detail || "拉取历史失败";
      return;
    }
    const j = await r.json();
    state.taMessages = Array.isArray(j.items) ? j.items : [];
  } catch (e) {
    state.taMessages = [];
    state.taChatError = String(e?.message || e);
  } finally {
    state.taMessagesLoading = false;
  }
}

export async function createTicketAssistantSession(formValues) {
  const op = getCurrentOperator();
  state.taChatLoading = true;
  state.taChatError = "";
  try {
    if (!(state.taModels || []).length) {
      await fetchTicketAssistantModels();
    }
    const r = await fetch(`${API_BASE_URL}/api/ticket-assistant/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        form_values: formValues || {},
        operator_id: op.account,
        operator_name: op.userName,
        model_name: state.taActiveModel || "",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      state.taChatError = typeof j.detail === "string" ? j.detail : "创建会话失败";
      return null;
    }
    const item = j.item || {};
    state.taActiveSessionId = item.id;
    state.taActiveSession = item;
    state.taMessages = Array.isArray(j.messages) ? j.messages : [];
    await fetchTicketAssistantSessions();
    return j;
  } catch (e) {
    state.taChatError = String(e?.message || e);
    return null;
  } finally {
    state.taChatLoading = false;
  }
}

export async function sendTicketAssistantChat(sessionId, content) {
  const op = getCurrentOperator();
  state.taChatLoading = true;
  state.taChatError = "";
  const userMsg = { role: "user", content, created_at: "" };
  state.taMessages = [...(state.taMessages || []), userMsg];
  requestRender();
  try {
    const r = await fetch(`${API_BASE_URL}/api/ticket-assistant/sessions/${sessionId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        operator_id: op.account,
        operator_name: op.userName,
        model_name: state.taActiveModel || "",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      state.taChatError = typeof j.detail === "string" ? j.detail : "发送失败";
      return null;
    }
    const reply = String(j.reply || "").trim();
    if (reply) {
      state.taMessages = [...state.taMessages, { role: "assistant", content: reply, created_at: "" }];
    }
    return j;
  } catch (e) {
    state.taChatError = String(e?.message || e);
    return null;
  } finally {
    state.taChatLoading = false;
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

function railIconHistory() {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="M7 7h10M7 12h10M7 17h6"/>
    <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="3" />
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
  const canCreate = canCreateViaTicketAssistant();
  const isChatting = active && String(active.status || "") === "chatting";
  const composerDisabled = loading || transferring;
  const historyOpen = !!state.taHistoryOpen;

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

  const messagesHtml = messages
    .map((m) => {
      const role = String(m.role || "");
      const content = String(m.content || "");
      const cls = role === "user" ? "ta-msg-user" : "ta-msg-assistant";
      return `<div class="ta-msg ${cls}"><div class="ta-msg-bubble">${escapeHtml(content)}</div></div>`;
    })
    .join("");

  const chatBody = active
    ? `<div class="ta-chat-stage">
        <div class="ta-toolbar">
          <div class="ta-toolbar-title">${escapeHtml(String(active.title || "对话"))}</div>
          <div class="ta-toolbar-actions">
            ${
              isChatting
                ? `<button type="button" class="ta-transfer-btn" id="ta-transfer-btn" ${composerDisabled ? "disabled" : ""}>${transferring ? "建单中…" : "转人工"}</button>`
                : active.ticket_no
                  ? `<span class="ta-conv-meta">工单 ${escapeHtml(String(active.ticket_no))}</span>`
                  : ""
            }
          </div>
        </div>
        <div class="ta-messages" id="ta-messages">${messagesHtml}${
          loading ? '<div class="ta-msg ta-msg-assistant ta-msg-thinking"><div class="ta-msg-bubble">正在思考…</div></div>' : ""
        }</div>
        ${error ? `<div class="ta-error">${escapeHtml(error)}</div>` : ""}
        ${
          isChatting
            ? renderComposerHtml({ disabled: composerDisabled })
            : ""
        }
      </div>`
    : `<div class="ta-welcome">
        <div class="ta-welcome-hero">
          <img class="ta-welcome-logo" src="/assets/icons/jiuwen-home-banner.svg" alt="九问" decoding="async" fetchpriority="low" />
          <h1 class="ta-welcome-title">有什么运维问题想聊聊吗？</h1>
          ${
            canCreate
              ? ""
              : `<p class="ta-welcome-sub">暂无创建权限；可从左侧历史打开已有会话。</p>`
          }
        </div>
        ${error ? `<div class="ta-error ta-error-float">${escapeHtml(error)}</div>` : ""}
        <div class="ta-welcome-composer" id="ta-welcome-composer">
          ${renderComposerHtml({
            disabled: true,
            placeholder: canCreate ? "Enter发送，Shift+Enter换行" : "暂无创建权限",
          })}
        </div>
      </div>`;

  return `<section class="ta-page ${historyOpen ? "ta-history-open" : ""}" aria-label="提单助手">
    <aside class="ta-rail" aria-label="提单助手导航">
      <div class="ta-rail-brand" title="九问">
        <img class="ta-rail-logo" src="/assets/icons/jiuwen-logo.svg" alt="九问" width="32" height="32" />
      </div>
      <button type="button" class="ta-rail-btn" id="ta-new-session-btn" title="新建对话" ${canCreate ? "" : "disabled"}>
        ${railIconNewChat()}
      </button>
      <button type="button" class="ta-rail-btn ${historyOpen ? "active" : ""}" id="ta-history-toggle" title="${historyOpen ? "收起历史" : "对话历史"}" aria-pressed="${historyOpen}">
        ${railIconHistory()}
      </button>
    </aside>
    <aside class="ta-history ${historyOpen ? "open" : ""}" id="ta-history-panel" aria-hidden="${historyOpen ? "false" : "true"}">
      <div class="ta-history-head">
        <span>对话历史</span>
        <button type="button" class="ta-history-close" id="ta-history-close" title="收起" aria-label="收起历史">×</button>
      </div>
      <div class="ta-conv-list" id="ta-conv-list">${
        state.taSessionsLoading
          ? '<div class="ta-conv-meta" style="padding:12px">加载中…</div>'
          : listHtml || '<div class="ta-conv-meta" style="padding:12px">暂无会话</div>'
      }</div>
    </aside>
    <div class="ta-main">${chatBody}</div>
  </section>`;
}

function autosizeComposer(el) {
  if (!el) return;
  el.style.height = "auto";
  const max = 160;
  el.style.height = `${Math.min(max, Math.max(44, el.scrollHeight))}px`;
}

export async function bindTicketAssistantPage() {
  if (state.taNeedsRefresh) {
    state.taNeedsRefresh = false;
    state.taModelsFetched = false;
    await ensureAdminData();
    await Promise.all([fetchTicketAssistantSessions(), fetchTicketAssistantModels()]);
    if (state.taActiveSessionId) {
      await fetchTicketAssistantMessages(state.taActiveSessionId);
      const found = (state.taSessions || []).find((s) => Number(s.id) === Number(state.taActiveSessionId));
      if (found) state.taActiveSession = found;
    }
    // 打开创建弹窗时 beginCreateTicketModal 已 requestRender，勿再 force 一次造成双闪
    if (tryAutoOpenCreateModal()) return;
    forceRequestRender();
    return;
  }

  if (tryAutoOpenCreateModal()) {
    // beginCreateTicketModal 内部已 requestRender
    return;
  }

  // 仅首次未拉取时补一次；空列表也算已拉取，禁止死循环重绘
  if (!state.taModelsFetched && !state.taModelsLoading) {
    void fetchTicketAssistantModels().then((changed) => {
      if (changed) requestRender();
    });
  }

  document.getElementById("ta-new-session-btn")?.addEventListener("click", () => {
    state.taModelMenuOpen = false;
    if (beginTicketAssistantCreateModal()) forceRequestRender();
  });

  const toggleHistory = () => {
    state.taHistoryOpen = !state.taHistoryOpen;
    state.taModelMenuOpen = false;
    requestRender();
  };
  document.getElementById("ta-history-toggle")?.addEventListener("click", toggleHistory);
  document.getElementById("ta-history-close")?.addEventListener("click", () => {
    state.taHistoryOpen = false;
    requestRender();
  });

  document.getElementById("ta-welcome-composer")?.addEventListener("click", () => {
    if (!canCreateViaTicketAssistant()) return;
    state.taModelMenuOpen = false;
    if (beginTicketAssistantCreateModal()) forceRequestRender();
  });

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

  const send = async () => {
    const input = document.getElementById("ta-input");
    const text = String(input?.value || "").trim();
    if (!text || !state.taActiveSessionId || state.taChatLoading) return;
    if (input) {
      input.value = "";
      autosizeComposer(input);
    }
    state.taModelMenuOpen = false;
    await sendTicketAssistantChat(state.taActiveSessionId, text);
    requestRender();
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

  document.getElementById("ta-send-btn")?.addEventListener("click", () => {
    void send();
  });

  const input = document.getElementById("ta-input");
  if (input) {
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
    if (!state.taActiveSessionId || state.taTransferLoading) return;
    if (!window.confirm("确认转人工？将使用问题创建信息正式建单。")) return;
    state.taModelMenuOpen = false;
    await transferTicketAssistantSession(state.taActiveSessionId);
    requestRender();
  });

  requestAnimationFrame(() => {
    const box = document.getElementById("ta-messages");
    if (box) box.scrollTop = box.scrollHeight;
  });
}
