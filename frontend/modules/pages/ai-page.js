import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { getCurrentOperator, getCurrentRoleCode, getCurrentWhitelistSettings } from "../core/auth.js";
import { whitelistAllows, getWhitelistLevel } from "../utils/normalize.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";

export function ensureAiTab() {
  const key = "ai:assistant";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "智能助手", closable: true });
  }
  return key;
}

export async function fetchAiConversations() {
  const op = getCurrentOperator();
  state.aiConversationsLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/ai/conversations?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) { state.aiConversations = []; return; }
    const j = await r.json();
    state.aiConversations = Array.isArray(j.items) ? j.items : [];
  } catch (_) { state.aiConversations = []; }
  finally { state.aiConversationsLoading = false; }
}

export async function fetchAiMessages(convId) {
  state.aiMessagesLoading = true;
  const op = getCurrentOperator();
  try {
    const r = await fetch(`${API_BASE_URL}/api/ai/conversations/${convId}/messages?operator_id=${encodeURIComponent(op.account)}&page_size=200`);
    if (!r.ok) { state.aiMessages = []; return; }
    const j = await r.json();
    state.aiMessages = Array.isArray(j.items) ? j.items : [];
    let prompt = 0, completion = 0;
    for (const m of state.aiMessages) {
      prompt += Number(m.prompt_tokens) || 0;
      completion += Number(m.completion_tokens) || 0;
    }
    state.aiTokenStats = { prompt, completion, total: prompt + completion };
    state.aiWorkStatus = "idle";
  } catch (_) { state.aiMessages = []; }
  finally { state.aiMessagesLoading = false; }
}

export async function fetchAiQuickTemplates() {
  const op = getCurrentOperator();
  state.aiQuickTemplatesLoading = true;
  try {
    const r = await fetch(`${API_BASE_URL}/api/ai/quick-templates?operator_id=${encodeURIComponent(op.account)}`);
    if (!r.ok) { state.aiQuickTemplates = []; return; }
    const j = await r.json();
    state.aiQuickTemplates = Array.isArray(j.items) ? j.items : [];
  } catch (_) { state.aiQuickTemplates = []; }
  finally { state.aiQuickTemplatesLoading = false; }
}

export async function sendAiChat(convId, content) {
  const op = getCurrentOperator();
  state.aiChatLoading = true;
  state.aiChatError = "";
  state.aiWorkStatus = "running";
  try {
    const r = await fetch(`${API_BASE_URL}/api/ai/conversations/${convId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_id: op.account, content }),
    });
    const j = await r.json();
    if (!r.ok) {
      state.aiChatError = j.detail || "请求失败";
      state.aiWorkStatus = "error";
      return null;
    }
    if (j.prompt_tokens !== undefined) {
      state.aiTokenStats.prompt += Number(j.prompt_tokens) || 0;
      state.aiTokenStats.completion += Number(j.completion_tokens) || 0;
      state.aiTokenStats.total = state.aiTokenStats.prompt + state.aiTokenStats.completion;
    }
    state.aiWorkStatus = "idle";
    return j;
  } catch (e) {
    state.aiChatError = String(e.message || e);
    state.aiWorkStatus = "error";
    return null;
  } finally {
    state.aiChatLoading = false;
  }
}

export function renderAiAssistantPage() {
  const conversations = state.aiConversations;
  const activeConvId = state.aiActiveConvId;
  const messages = state.aiMessages;
  const loading = state.aiChatLoading;
  const error = state.aiChatError;
  const templates = state.aiQuickTemplates;

  const convListHtml = conversations.map((c) => {
    const isActive = c.id === activeConvId;
    const title = String(c.title || "新对话");
    return `<div class="ai-conv-item ${isActive ? "active" : ""}" data-ai-conv-id="${c.id}">
      <span class="ai-conv-title">${escapeHtml(title)}</span>
      <button type="button" class="ai-conv-delete" data-ai-conv-delete="${c.id}" title="删除">×</button>
    </div>`;
  }).join("");

  const presetTemplates = templates.filter((t) => t.is_preset);
  const customTemplates = templates.filter((t) => !t.is_preset);
  const canEditTemplate = whitelistAllows("ai_assistant_template_edit", "readonly");

  const templateHtml = [...presetTemplates, ...customTemplates].map((t) => {
    const isPreset = t.is_preset;
    return `<button type="button" class="ai-quick-btn" data-ai-quick-id="${t.id}" data-ai-quick-question="${escapeAttr(t.question)}" title="${escapeAttr(t.question)}">${escapeHtml(t.question.length > 20 ? t.question.slice(0, 20) + "…" : t.question)}${!isPreset && canEditTemplate ? `<span class="ai-quick-del" data-ai-quick-del="${t.id}">×</span>` : ""}</button>`;
  }).join("");

  const messagesHtml = messages.map((m) => {
    const role = String(m.role || "");
    const content = String(m.content || "");
    const sqlQuery = m.sql_query;
    const queryResult = m.query_result;

    if (role === "user") {
      return `<div class="ai-msg ai-msg-user"><div class="ai-msg-bubble">${escapeHtml(content)}</div></div>`;
    }

    let resultHtml = "";
    if (sqlQuery) {
      resultHtml += `<details class="ai-sql-details"><summary>执行的 SQL</summary><pre class="ai-sql-pre">${escapeHtml(sqlQuery)}</pre></details>`;
    }
    if (queryResult && Array.isArray(queryResult) && queryResult.length > 0) {
      const cols = Object.keys(queryResult[0]);
      const maxRows = 10;
      const displayRows = queryResult.slice(0, maxRows);
      const tableRows = displayRows.map((row) => `<tr>${cols.map((c) => `<td>${escapeHtml(String(row[c] ?? ""))}</td>`).join("")}</tr>`).join("");
      resultHtml += `<details class="ai-result-details"><summary>查询结果 (${queryResult.length} 行${queryResult.length > maxRows ? `，显示前 ${maxRows} 行` : ""})</summary><div class="ai-result-table-wrap"><table class="ai-result-table"><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div></details>`;
    }

    const renderedContent = typeof marked !== "undefined" ? marked.parse(content) : content.replace(/\n/g, "<br>");
    return `<div class="ai-msg ai-msg-assistant">
      <img class="ai-msg-avatar" src="/assets/icons/jiuwen-teamleader.png" alt="九问 AI" width="32" height="32" />
      <div class="ai-msg-content">
        <div class="ai-msg-bubble">${renderedContent}</div>
        ${resultHtml}
      </div>
    </div>`;
  }).join("");

  const welcomeHtml = !activeConvId && !messages.length
    ? `<div class="ai-welcome"><div class="ai-welcome-icon">🤖</div><p>你好！我是运维智能助手，可以帮你查询和分析工单数据。</p><p>直接输入问题并发送，我会自动为你创建对话。</p></div>`
    : "";

  const chatArea = activeConvId
    ? `<div class="ai-chat-messages" id="ai-chat-messages">${messagesHtml}${loading ? '<div class="ai-msg ai-msg-assistant"><img class="ai-msg-avatar" src="/assets/icons/jiuwen-teamleader.png" alt="九问 AI" width="32" height="32" /><div class="ai-msg-content"><div class="ai-msg-bubble ai-msg-thinking">正在思考…</div></div></div>' : ""}${error ? `<div class="ai-msg ai-msg-error">❌ ${escapeHtml(error)}</div>` : ""}</div>`
    : `<div class="ai-chat-empty">${welcomeHtml}</div>`;

  const statusLabels = { idle: "空闲", running: "思考中", error: "出错" };
  const statusLabel = statusLabels[state.aiWorkStatus] || "空闲";
  const ts = state.aiTokenStats;

  const statusBarHtml = activeConvId
    ? `<div class="ai-status-bar">
        <div class="ai-status-indicator">
          <span class="ai-status-dot ${state.aiWorkStatus}"></span>
          <span class="ai-status-label">${statusLabel}</span>
        </div>
        <div class="ai-token-stats">
          <span class="ai-token-item" title="发送 Token">↑${ts.prompt}</span>
          <span class="ai-token-item" title="接收 Token">↓${ts.completion}</span>
          <span class="ai-token-item ai-token-total" title="总计 Token">Σ${ts.total}</span>
        </div>
      </div>`
    : "";

  return `
    <section class="ai-assistant-page" aria-label="智能助手">
      <div class="ai-sidebar">
        <button type="button" class="action primary ai-new-conv-btn" id="ai-new-conv-btn">+ 新对话</button>
        <div class="ai-conv-list" id="ai-conv-list">${convListHtml}</div>
      </div>
      <div class="ai-main">
        ${statusBarHtml}
        ${chatArea}
        <div class="ai-input-area">
          <div class="ai-quick-templates">${templateHtml}${canEditTemplate ? `<button type="button" class="ai-quick-btn ai-quick-add" id="ai-quick-add-btn">+ 添加</button>` : ""}${canEditTemplate && state.aiQuickAddOpen ? `<span class="ai-quick-add-inline"><input type="text" class="ai-quick-add-input" id="ai-quick-add-input" placeholder="输入快捷问题…" /><button type="button" class="ai-quick-add-ok" id="ai-quick-add-ok">✓</button><button type="button" class="ai-quick-add-cancel" id="ai-quick-add-cancel">✕</button></span>` : ""}</div>
          <div class="ai-input-row">
            <input type="text" class="ai-input" id="ai-input" placeholder="输入你的问题…" ${loading ? "disabled" : ""} />
            <button type="button" class="action primary ai-send-btn" id="ai-send-btn" ${loading ? "disabled" : ""}>发送</button>
            <button type="button" class="action ai-config-btn" id="ai-user-config-btn" title="我的模型配置">⚙️</button>
          </div>
        </div>
      </div>
    </section>
    ${state.aiUserConfigModalOpen ? renderAiUserConfigModal() : ""}
  `;
}

export function renderAiUserConfigModal() {
  const data = state.aiUserConfigData;
  const saving = state.aiUserConfigSaving;
  const msg = state.aiUserConfigMsg ? `<p class="llm-config-banner ${state.aiUserConfigMsg.includes("成功") ? "llm-config-test-ok" : "llm-config-test-fail"}">${escapeHtml(state.aiUserConfigMsg)}</p>` : "";
  const testResult = state.aiLlmConfigTestResult;
  const testHtml = testResult
    ? `<p class="llm-config-test-result ${testResult.ok ? "llm-config-test-ok" : "llm-config-test-fail"}">${escapeHtml(testResult.detail)}</p>`
    : "";

  const effective = data?.effective || {};
  const userOverride = data?.user_override || {};
  const systemDefault = data?.system_default || {};

  const fields = [
    { key: "api_base_url", label: "API 地址", type: "text", ph: systemDefault.api_base_url || "使用系统默认" },
    { key: "api_key", label: "API Key", type: "password", ph: systemDefault.api_key ? "已配置（系统默认）" : "未配置" },
    { key: "model", label: "模型名称", type: "text", ph: systemDefault.model || "使用系统默认" },
    { key: "max_tokens", label: "最大 Token", type: "number", ph: systemDefault.max_tokens || "使用系统默认" },
    { key: "temperature", label: "温度", type: "number", ph: systemDefault.temperature ?? "使用系统默认" },
    { key: "system_prompt", label: "系统提示词", type: "textarea", ph: "留空使用系统默认" },
    { key: "query_timeout", label: "查询超时(秒)", type: "number", ph: systemDefault.query_timeout || "使用系统默认" },
    { key: "max_react_rounds", label: "最大推理轮次", type: "number", ph: systemDefault.max_react_rounds || "使用系统默认" },
    { key: "max_result_rows", label: "结果行数上限", type: "number", ph: systemDefault.max_result_rows || "使用系统默认" },
    { key: "context_max_token", label: "上下文最大Token", type: "number", ph: systemDefault.context_max_token || "使用系统默认" },
  ];

  const formRows = fields.map((f) => {
    const val = userOverride[f.key] ?? "";
    let inputHtml;
    if (f.type === "textarea") {
      inputHtml = `<textarea class="llm-config-textarea" data-ai-user-key="${f.key}" rows="3" placeholder="${escapeAttr(f.ph)}">${escapeHtml(String(val))}</textarea>`;
    } else if (f.type === "password") {
      inputHtml = `<input type="password" class="llm-config-input" data-ai-user-key="${f.key}" value="${escapeAttr(String(val))}" placeholder="${escapeAttr(f.ph)}" autocomplete="off" />`;
    } else {
      inputHtml = `<input type="${f.type}" class="llm-config-input" data-ai-user-key="${f.key}" value="${escapeAttr(String(val))}" placeholder="${escapeAttr(f.ph)}" />`;
    }
    const source = val && val !== "****" ? "（你的配置）" : "（系统默认）";
    return `<tr><td class="llm-config-label">${escapeHtml(f.label)}</td><td>${inputHtml}</td><td class="llm-config-desc">${source}</td></tr>`;
  }).join("");

  return `
    <div class="perm-modal-mask" id="ai-user-config-modal">
      <div class="perm-modal ai-user-config-modal">
        <div class="perm-modal-head">
          <h3>我的模型配置</h3>
        </div>
        <div class="perm-modal-body">
          <p class="ai-user-config-hint">未配置的项将使用系统默认值</p>
          ${msg}
          ${testHtml}
          <table class="llm-config-table"><tbody>${formRows}</tbody></table>
        </div>
        <div class="perm-modal-actions">
          <button type="button" class="action" id="ai-user-config-cancel">取消</button>
          <button type="button" class="action danger" id="ai-user-config-clear">清除我的配置</button>
          <button type="button" class="action" id="ai-user-config-test">测试连通性</button>
          <button type="button" class="action primary" id="ai-user-config-save" ${saving ? "disabled" : ""}>${saving ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>
  `;
}

export async function bindAiAssistantPage() {
  const op = getCurrentOperator();

  if (state.aiNeedsRefresh) {
    state.aiNeedsRefresh = false;
    await Promise.all([fetchAiConversations(), fetchAiQuickTemplates()]);
    if (state.aiActiveConvId) {
      await fetchAiMessages(state.aiActiveConvId);
    }
    requestRender();
  }

  const newConvBtn = document.getElementById("ai-new-conv-btn");
  if (newConvBtn) {
    newConvBtn.addEventListener("click", async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account }),
        });
        if (!r.ok) { const j = await r.json(); state.aiChatError = j.detail || "创建失败"; requestRender(); return; }
        const j = await r.json();
        state.aiActiveConvId = j.item.id;
        state.aiMessages = [];
        state.aiTokenStats = { prompt: 0, completion: 0, total: 0 };
        state.aiWorkStatus = "idle";
        await fetchAiConversations();
        requestRender();
        const input = document.getElementById("ai-input");
        if (input) input.focus();
      } catch (e) { state.aiChatError = String(e.message || e); requestRender(); }
    });
  }

  document.querySelectorAll("[data-ai-conv-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-ai-conv-delete]")) return;
      const convId = parseInt(el.getAttribute("data-ai-conv-id"));
      if (convId && convId !== state.aiActiveConvId) {
        state.aiActiveConvId = convId;
        fetchAiMessages(convId).then(() => requestRender());
      }
    });
  });

  document.querySelectorAll("[data-ai-conv-delete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const convId = parseInt(btn.getAttribute("data-ai-conv-delete"));
      if (!convId) return;
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/conversations/${convId}?operator_id=${encodeURIComponent(op.account)}`, { method: "DELETE" });
        if (!r.ok) { const j = await r.json(); state.aiChatError = j.detail || "删除失败"; requestRender(); return; }
        if (state.aiActiveConvId === convId) {
          state.aiActiveConvId = null;
          state.aiMessages = [];
        }
        await fetchAiConversations();
        requestRender();
      } catch (e) { state.aiChatError = String(e.message || e); requestRender(); }
    });
  });

  const sendBtn = document.getElementById("ai-send-btn");
  const input = document.getElementById("ai-input");
  const doSend = async () => {
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    // 如果没有激活会话，先自动创建
    if (!state.aiActiveConvId) {
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account }),
        });
        if (!r.ok) {
          const j = await r.json();
          state.aiChatError = j.detail || "创建会话失败";
          requestRender();
          return;
        }
        const j = await r.json();
        state.aiActiveConvId = j.item.id;
        state.aiMessages = [];
        state.aiTokenStats = { prompt: 0, completion: 0, total: 0 };
        state.aiWorkStatus = "idle";
        await fetchAiConversations();
        requestRender();
      } catch (e) {
        state.aiChatError = String(e.message || e);
        requestRender();
        return;
      }
    }

    input.value = "";
    state.aiMessages.push({ role: "user", content: text });
    state.aiChatLoading = true;
    state.aiWorkStatus = "running";
    state.aiChatError = "";
    requestRender();
    const result = await sendAiChat(state.aiActiveConvId, text);
    if (result) {
      state.aiMessages.push(result);
    }
    await fetchAiConversations();
    requestRender();
    const msgArea = document.getElementById("ai-chat-messages");
    if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
  };

  if (sendBtn) sendBtn.addEventListener("click", doSend);
  if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });

  document.querySelectorAll("[data-ai-quick-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (e.target.closest("[data-ai-quick-del]")) return;
      const question = btn.getAttribute("data-ai-quick-question");
      if (question && input) { input.value = question; input.focus(); }
    });
  });

  document.querySelectorAll("[data-ai-quick-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const tplId = parseInt(btn.getAttribute("data-ai-quick-del"));
      if (!tplId) return;
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/quick-templates/${tplId}?operator_id=${encodeURIComponent(op.account)}`, { method: "DELETE" });
        if (!r.ok) { const j = await r.json(); state.aiChatError = j.detail || "删除失败"; requestRender(); return; }
        await fetchAiQuickTemplates();
        requestRender();
      } catch (e) { state.aiChatError = String(e.message || e); requestRender(); }
    });
  });

  const addQuickBtn = document.getElementById("ai-quick-add-btn");
  if (addQuickBtn) {
    addQuickBtn.addEventListener("click", () => {
      state.aiQuickAddOpen = true;
      requestRender();
      const inp = document.getElementById("ai-quick-add-input");
      if (inp) inp.focus();
    });
  }

  const addQuickOk = document.getElementById("ai-quick-add-ok");
  if (addQuickOk) {
    addQuickOk.addEventListener("click", async () => {
      const inp = document.getElementById("ai-quick-add-input");
      const question = (inp ? inp.value : "").trim();
      if (!question) return;
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/quick-templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, question }),
        });
        if (!r.ok) { const j = await r.json(); state.aiQuickAddOpen = false; requestRender(); return; }
        state.aiQuickAddOpen = false;
        await fetchAiQuickTemplates();
        requestRender();
      } catch (e) { state.aiQuickAddOpen = false; requestRender(); }
    });
  }

  const addQuickInput = document.getElementById("ai-quick-add-input");
  if (addQuickInput) {
    addQuickInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); document.getElementById("ai-quick-add-ok")?.click(); }
      if (e.key === "Escape") { state.aiQuickAddOpen = false; requestRender(); }
    });
  }

  const addQuickCancel = document.getElementById("ai-quick-add-cancel");
  if (addQuickCancel) {
    addQuickCancel.addEventListener("click", () => { state.aiQuickAddOpen = false; requestRender(); });
  }

  const userConfigBtn = document.getElementById("ai-user-config-btn");
  if (userConfigBtn) {
    userConfigBtn.addEventListener("click", async () => {
      state.aiUserConfigModalOpen = true;
      state.aiUserConfigLoading = true;
      state.aiUserConfigMsg = "";
      requestRender();
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/my-llm-config?operator_id=${encodeURIComponent(op.account)}`);
        if (r.ok) {
          state.aiUserConfigData = await r.json();
        }
      } catch (_) {}
      state.aiUserConfigLoading = false;
      requestRender();
    });
  }

  bindAiUserConfigModal();
  const msgArea = document.getElementById("ai-chat-messages");
  if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
}

export function bindAiUserConfigModal() {
  const op = getCurrentOperator();
  const cancelBtn = document.getElementById("ai-user-config-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      state.aiUserConfigModalOpen = false;
      state.aiUserConfigMsg = "";
      state.aiLlmConfigTestResult = null;
      requestRender();
    });
  }

  const clearBtn = document.getElementById("ai-user-config-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/my-llm-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account }),
        });
        if (!r.ok) { const j = await r.json(); state.aiUserConfigMsg = j.detail || "清除失败"; requestRender(); return; }
        state.aiUserConfigMsg = "配置已清除";
        const r2 = await fetch(`${API_BASE_URL}/api/ai/my-llm-config?operator_id=${encodeURIComponent(op.account)}`);
        if (r2.ok) state.aiUserConfigData = await r2.json();
        requestRender();
      } catch (e) { state.aiUserConfigMsg = String(e.message || e); requestRender(); }
    });
  }

  const saveBtn = document.getElementById("ai-user-config-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const fields = {};
      document.querySelectorAll("[data-ai-user-key]").forEach((el) => {
        const key = el.getAttribute("data-ai-user-key");
        const val = el.value.trim();
        if (val) {
          if (["max_tokens", "query_timeout", "max_react_rounds", "max_result_rows"].includes(key)) {
            fields[key] = parseInt(val) || null;
          } else if (key === "temperature") {
            fields[key] = parseFloat(val) || null;
          } else {
            fields[key] = val;
          }
        } else {
          fields[key] = null;
        }
      });
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/my-llm-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account, ...fields }),
        });
        if (!r.ok) { const j = await r.json(); state.aiUserConfigMsg = j.detail || "保存失败"; requestRender(); return; }
        state.aiUserConfigMsg = "保存成功";
        const r2 = await fetch(`${API_BASE_URL}/api/ai/my-llm-config?operator_id=${encodeURIComponent(op.account)}`);
        if (r2.ok) state.aiUserConfigData = await r2.json();
        requestRender();
      } catch (e) { state.aiUserConfigMsg = String(e.message || e); requestRender(); }
    });
  }

  const testBtn = document.getElementById("ai-user-config-test");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      state.aiLlmConfigTesting = true;
      state.aiLlmConfigTestResult = null;
      requestRender();
      try {
        const r = await fetch(`${API_BASE_URL}/api/ai/my-llm-config/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operator_id: op.account }),
        });
        if (r.ok) {
          state.aiLlmConfigTestResult = await r.json();
        } else {
          state.aiLlmConfigTestResult = { ok: false, detail: "测试请求失败" };
        }
      } catch (e) {
        state.aiLlmConfigTestResult = { ok: false, detail: String(e.message || e) };
      }
      state.aiLlmConfigTesting = false;
      requestRender();
    });
  }
}
