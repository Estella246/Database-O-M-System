const root = document.getElementById("root");

const tickets = [
  ["100000301", "Content migration errors", "Urgent", "AST34556NA", "Ranya", "Issue for error...", "2026-04-02", "50000120"],
  ["100000302", "Confirmation messages", "High", "AST34558NA", "Raniak", "--", "2026-04-03", "-"],
  ["100000307", "Averaging data", "High", "AST34556NA", "Dose", "--", "2026-04-04", "-"],
  ["100000304", "Body orientation validation", "Urgent", "AST34558NA", "Dose", "--", "2026-04-05", "-"],
];
const ticketList = tickets.map((r) => ({
  orderId: r[0],
  subject: r[1],
  priority: r[2],
  node: r[3],
  assignee: r[4],
  description: r[5],
  sla: r[6],
  ecarePen: r[7],
}));
const WORKFLOW_NODES = ["问题填写", "问题审核", "运维分析", "开发分析", "开发闭环", "运维闭环", "审核关闭"];
const API_BASE_URL = "http://127.0.0.1:8000";
const NODE_KEY_BY_STEP = {
  问题填写: "problem_fill",
  问题审核: "problem_review",
  运维分析: "ops_analysis",
  开发分析: "dev_analysis",
  开发闭环: "dev_closure",
  运维闭环: "ops_closure",
  审核关闭: "audit_close",
};

/** 白名单里不插「空选项」的字段（处理方式：默认落在真实选项上，不出现空白行） */
const WHITELIST_NO_PLACEHOLDER_KEYS = new Set(["handle_mode"]);
const workflowByOrderId = {
  "100000301": {
    currentStep: 4,
    logs: [
      { step: "问题填写", actor: "Ranya", at: "2026-04-02 09:05", summary: "提交问题单并补充初始信息。" },
      { step: "问题审核", actor: "Ranya", at: "2026-04-02 09:20", summary: "已确认问题范围，转运维分析。" },
      { step: "运维分析", actor: "Dose", at: "2026-04-02 10:05", summary: "定位到迁移任务脚本异常，转开发分析。" },
      { step: "开发分析", actor: "Raniak", at: "2026-04-02 11:32", summary: "确认兼容性缺陷，已安排修复并进入开发闭环。" },
    ],
  },
  "100000302": {
    currentStep: 2,
    logs: [
      { step: "问题填写", actor: "Raniak", at: "2026-04-03 13:50", summary: "发起问题并填写基础信息。" },
      { step: "问题审核", actor: "Ranya", at: "2026-04-03 14:15", summary: "审核通过，流转至运维分析。" },
    ],
  },
  "100000307": {
    currentStep: 3,
    logs: [
      { step: "问题填写", actor: "Dose", at: "2026-04-04 08:45", summary: "提交问题并补充影响范围。" },
      { step: "问题审核", actor: "Dose", at: "2026-04-04 09:10", summary: "问题已受理。" },
      { step: "运维分析", actor: "Dose", at: "2026-04-04 11:20", summary: "初步排查后需要开发介入。" },
    ],
  },
  "100000304": {
    currentStep: 5,
    logs: [
      { step: "问题填写", actor: "Dose", at: "2026-04-05 08:30", summary: "提交问题单并附现场信息。" },
      { step: "问题审核", actor: "Dose", at: "2026-04-05 08:50", summary: "审核完成并进入运维分析。" },
      { step: "运维分析", actor: "Dose", at: "2026-04-05 09:40", summary: "确认与接口返回数据有关，转开发分析。" },
      { step: "开发分析", actor: "Raniak", at: "2026-04-05 10:35", summary: "修复已发布，进入开发闭环。" },
      { step: "开发闭环", actor: "Raniak", at: "2026-04-05 13:20", summary: "开发闭环完成，提交运维验证。" },
    ],
  },
};
const operationLogsByOrderId = {
  "100000301": [
    { at: "2026-04-02 09:05", actor: "Ranya", action: "提交下一节点", from: "问题填写", to: "问题审核" },
    { at: "2026-04-02 09:20", actor: "Ranya", action: "提交下一节点", from: "问题审核", to: "运维分析" },
    { at: "2026-04-02 10:05", actor: "Dose", action: "提交下一节点", from: "运维分析", to: "开发分析" },
    { at: "2026-04-02 11:32", actor: "Raniak", action: "提交下一节点", from: "开发分析", to: "开发闭环" },
  ],
  "100000302": [
    { at: "2026-04-03 13:50", actor: "Raniak", action: "提交下一节点", from: "问题填写", to: "问题审核" },
    { at: "2026-04-03 14:15", actor: "Ranya", action: "提交下一节点", from: "问题审核", to: "运维分析" },
  ],
  "100000307": [
    { at: "2026-04-04 08:45", actor: "Dose", action: "提交下一节点", from: "问题填写", to: "问题审核" },
    { at: "2026-04-04 09:10", actor: "Dose", action: "提交下一节点", from: "问题审核", to: "运维分析" },
    { at: "2026-04-04 11:20", actor: "Dose", action: "提交下一节点", from: "运维分析", to: "开发分析" },
  ],
  "100000304": [
    { at: "2026-04-05 08:30", actor: "Dose", action: "提交下一节点", from: "问题填写", to: "问题审核" },
    { at: "2026-04-05 08:50", actor: "Dose", action: "提交下一节点", from: "问题审核", to: "运维分析" },
    { at: "2026-04-05 09:40", actor: "Dose", action: "提交下一节点", from: "运维分析", to: "开发分析" },
    { at: "2026-04-05 10:35", actor: "Raniak", action: "提交下一节点", from: "开发分析", to: "开发闭环" },
    { at: "2026-04-05 13:20", actor: "Raniak", action: "提交下一节点", from: "开发闭环", to: "运维闭环" },
  ],
};

const state = {
  openTabs: [{ key: "list", label: "Work Order", closable: false }],
  activeKey: "list",
  logDrawerOpen: false,
  formsByTicket: {},
};

function getTicketById(orderId) {
  return ticketList.find((item) => item.orderId === orderId) || null;
}

function getUrlByKey(key) {
  if (key === "list") return "/";
  return `/tickets/${encodeURIComponent(key.replace("ticket:", ""))}`;
}

function getActiveTicket() {
  if (state.activeKey === "list") return null;
  return getTicketById(state.activeKey.replace("ticket:", ""));
}

function ensureTicketTab(orderId) {
  const key = `ticket:${orderId}`;
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: orderId, closable: true });
  }
  return key;
}

function syncActiveKeyFromPath(pathname) {
  const match = pathname.match(/^\/tickets\/([^/]+)$/);
  if (!match) {
    state.activeKey = "list";
    return;
  }
  const orderId = decodeURIComponent(match[1]);
  const key = ensureTicketTab(orderId);
  state.activeKey = key;
}

function render() {
  const activeTicket = getActiveTicket();
  const isList = state.activeKey === "list";
  document.title = isList ? "运维工单平台 Demo" : state.activeKey.replace("ticket:", "");

  root.innerHTML = `
  <div class="layout">
    <aside class="left">
      <div class="left-top">
        <div class="hamburger">☰</div>
        <button id="collapse-btn" class="collapse" title="收起/展开侧边栏">«</button>
      </div>
      <nav class="menu">
        <button class="menu-item active">My Tasks</button>
        <button class="menu-item">All Tickets</button>
        <button class="menu-item">Analytics</button>
        <button class="menu-item">Settings</button>
        <button class="menu-item">Storage</button>
        <button class="menu-item">Messages</button>
        <button class="menu-item">Revolution</button>
        <button class="menu-item">Help</button>
      </nav>
      <div class="menu-bottom">
        <button class="menu-item">Analytics</button>
        <button class="menu-item">Settings</button>
        <button class="menu-item">Help</button>
      </div>
    </aside>

    <main class="center center-enter">
      <div class="head">
        <h1 class="${isList ? "" : "hidden"}">${isList ? "Work Order" : `Order ${activeTicket ? activeTicket.orderId : "Not Found"}`}</h1>
        <div class="actions ${isList ? "" : "hidden"}">
          <button class="action">Pull Group</button>
          <button class="action primary">+ Create</button>
          <button class="action">Export</button>
          <button class="action danger">Delete</button>
        </div>
      </div>

      <div class="workspace-tabs" id="workspace-tabs">
        ${state.openTabs
          .map(
            (tab) => `
            <button type="button" class="workspace-tab ${tab.key === state.activeKey ? "active" : ""}" data-workspace-tab="${tab.key}">
              <span>${tab.label}</span>
              ${
                tab.closable
                  ? `<span class="workspace-tab-close" data-close-tab="${tab.key}" aria-label="关闭">×</span>`
                  : ""
              }
            </button>`
          )
          .join("")}
      </div>

      ${
        isList
          ? `
      <div class="toolbar">
        <div class="filters">
          <input class="search" placeholder="Search" />
          <div class="date-range">
            <button class="date-trigger" id="start-trigger" type="button">starttime</button>
            <input class="date-hidden" id="start-date" type="date" aria-label="starttime" />
            <span class="date-sep">--</span>
            <button class="date-trigger" id="end-trigger" type="button">endtime</button>
            <input class="date-hidden" id="end-date" type="date" aria-label="endtime" />
          </div>
          <div class="tabs" role="tablist">
            <span class="tab-indicator" aria-hidden="true"></span>
            <button type="button" class="tab active" role="tab" aria-selected="true" data-tab="pending">My Pending (12)</button>
            <button type="button" class="tab" role="tab" aria-selected="false" data-tab="all">All Tickets</button>
            <button type="button" class="tab" role="tab" aria-selected="false" data-tab="created">My Created</button>
            <button type="button" class="tab" role="tab" aria-selected="false" data-tab="others">Others</button>
          </div>
        </div>
      </div>

      <section class="table-wrap" id="list-panel" aria-live="polite">
        <div class="section-title">Work order list</div>
        <table>
          <thead>
            <tr>
              <th>Order ID</th><th>Subject</th><th>Priority</th><th>Node</th><th>Assignee</th><th>Issue Description</th><th>SLA</th><th>eCare Pen</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
      </section>
      `
          : `
      <section class="detail-card detail-card-inline">
        ${
          activeTicket
            ? `
        <div class="detail-head">
          <h2>Order ${activeTicket.orderId}</h2>
          <div class="detail-actions">
            <button class="action" id="copy-link-btn" type="button">Share Link</button>
            <button class="action action-log" id="toggle-log-drawer-btn" type="button">${state.logDrawerOpen ? "close" : "log"}</button>
          </div>
        </div>
        <div class="detail-workspace">
          <div class="flow-main">
            ${renderWorkflow(activeTicket.orderId)}
          </div>
          ${renderOperationLogs(activeTicket.orderId)}
        </div>`
            : `
        <h2>Order Not Found</h2>
        <p>未找到当前链接对应的问题单。</p>`
        }
      </section>
      `
      }
    </main>
  </div>
`;

  const layout = document.querySelector(".layout");
  const collapseBtn = document.getElementById("collapse-btn");
  collapseBtn.addEventListener("click", () => {
    layout.classList.toggle("left-collapsed");
    collapseBtn.textContent = layout.classList.contains("left-collapsed") ? "»" : "«";
  });

  document.getElementById("workspace-tabs").addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close-tab]");
    if (closeTarget) {
      event.stopPropagation();
      const key = closeTarget.getAttribute("data-close-tab");
      state.openTabs = state.openTabs.filter((tab) => tab.key !== key);
      if (state.activeKey === key) {
        state.activeKey = state.openTabs[state.openTabs.length - 1].key;
      }
      history.pushState({}, "", getUrlByKey(state.activeKey));
      render();
      return;
    }
    const tabTarget = event.target.closest("[data-workspace-tab]");
    if (!tabTarget) return;
    state.activeKey = tabTarget.getAttribute("data-workspace-tab");
    history.pushState({}, "", getUrlByKey(state.activeKey));
    render();
  });

  if (isList) {
    const body = document.getElementById("table-body");
    ticketList.forEach((ticket) => {
      const tr = document.createElement("tr");
      tr.className = "ticket-row";
      tr.dataset.orderId = ticket.orderId;
      tr.innerHTML = `<td>${ticket.orderId}</td><td>${ticket.subject}</td><td><span class="p ${ticket.priority.toLowerCase()}">${ticket.priority}</span></td><td>${ticket.node}</td><td>${ticket.assignee}</td><td>${ticket.description}</td><td>${ticket.sla}</td><td>${ticket.ecarePen}</td>`;
      tr.addEventListener("click", () => {
        state.activeKey = ensureTicketTab(ticket.orderId);
        history.pushState({}, "", getUrlByKey(state.activeKey));
        render();
      });
      body.appendChild(tr);
    });

    function bindDatePicker(triggerId, inputId, fallbackLabel) {
      const trigger = document.getElementById(triggerId);
      const input = document.getElementById(inputId);
      trigger.addEventListener("click", () => {
        if (typeof input.showPicker === "function") input.showPicker();
        else input.click();
      });
      input.addEventListener("change", () => {
        trigger.textContent = input.value || fallbackLabel;
      });
    }

    bindDatePicker("start-trigger", "start-date", "starttime");
    bindDatePicker("end-trigger", "end-date", "endtime");

    const tabButtons = document.querySelectorAll(".tabs .tab");
    const tabsWrap = document.querySelector(".tabs");
    const listPanel = document.getElementById("list-panel");
    const tableBody = document.getElementById("table-body");

    function placeTabIndicator(target) {
      if (!tabsWrap || !target) return;
      const wrapRect = tabsWrap.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      tabsWrap.style.setProperty("--indicator-x", `${targetRect.left - wrapRect.left}px`);
      tabsWrap.style.setProperty("--indicator-w", `${targetRect.width}px`);
    }

    function retrigger(node, cls) {
      node.classList.remove(cls);
      void node.offsetWidth;
      node.classList.add(cls);
    }

    const initialActive = document.querySelector(".tabs .tab.active");
    placeTabIndicator(initialActive);
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabButtons.forEach((t) => {
          t.classList.remove("active");
          t.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        placeTabIndicator(btn);
        retrigger(listPanel, "tab-anim");
        retrigger(listPanel, "sheen-anim");
        retrigger(tableBody, "row-reflow");
      });
    });

    const active = document.querySelector(".tabs .tab.active");
    placeTabIndicator(active);
  } else {
    if (activeTicket) {
      WORKFLOW_NODES.forEach((step) => {
        const nodeKey = NODE_KEY_BY_STEP[step];
        if (nodeKey) ensureNodeFormData(activeTicket.orderId, nodeKey);
      });
      bindNodeForms(activeTicket.orderId);
    }
    const toggleDrawerBtn = document.getElementById("toggle-log-drawer-btn");
    if (toggleDrawerBtn) {
      toggleDrawerBtn.addEventListener("click", () => {
        state.logDrawerOpen = !state.logDrawerOpen;
        render();
      });
    }
    const closeDrawerBtn = document.getElementById("close-log-drawer-btn");
    if (closeDrawerBtn) {
      closeDrawerBtn.addEventListener("click", () => {
        state.logDrawerOpen = false;
        render();
      });
    }
    const copyBtn = document.getElementById("copy-link-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const shareLink = window.location.href;
        try {
          await navigator.clipboard.writeText(shareLink);
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = "Share Link";
          }, 1200);
        } catch (_err) {
          window.prompt("复制以下链接分享给他人：", shareLink);
        }
      });
    }
  }
}

function getFormState(orderId, nodeKey) {
  const key = `${orderId}:${nodeKey}`;
  if (!state.formsByTicket[key]) {
    state.formsByTicket[key] = {
      loading: false,
      loaded: false,
      notFound: false,
      saving: false,
      error: "",
      success: "",
      fields: [],
      values: {},
    };
  }
  return state.formsByTicket[key];
}

function fieldVisible(field, vals) {
  const c = field.constraints || {};
  const rules = c.visible_when_all;
  if (!rules || !rules.length) return true;
  return rules.every((r) => {
    const v = vals[r.field];
    return (r.values || []).includes(v);
  });
}

function matchesRequiredIf(requiredIf, vals) {
  if (!requiredIf || typeof requiredIf !== "object") return false;
  return Object.entries(requiredIf).every(([depKey, expected]) => {
    const actual = vals[depKey];
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}

function optionalWhenAllMatches(c, vals) {
  const rules = c.optional_when_all;
  if (!rules || !rules.length) return false;
  return rules.every((r) => (r.values || []).includes(vals[r.field]));
}

function fieldEffectiveRequired(field, vals) {
  const c = field.constraints || {};
  if (!fieldVisible(field, vals)) return false;
  if (optionalWhenAllMatches(c, vals)) return false;
  if (c.required_when_visible) return true;
  if (c.required_if && Object.keys(c.required_if).length) {
    return matchesRequiredIf(c.required_if, vals);
  }
  return !!field.required;
}

function collectValuesForRules(form, fields) {
  const fd = new FormData(form);
  const vals = {};
  fields.forEach((f) => {
    const raw = fd.get(f.key);
    vals[f.key] = typeof raw === "string" ? raw.trim() : raw ? String(raw) : "";
  });
  form.querySelectorAll("[data-rich-hidden]").forEach((hid) => {
    if (hid.name) vals[hid.name] = (hid.value || "").trim();
  });
  return vals;
}

function applyNodeFieldRules(form, formState) {
  const vals = collectValuesForRules(form, formState.fields);
  formState.fields.forEach((field) => {
    const wrap = form.querySelector(`[data-field-key="${field.key}"]`);
    if (!wrap) return;
    const vis = fieldVisible(field, vals);
    const req = fieldEffectiveRequired(field, vals);
    wrap.classList.toggle("problem-field-hidden", !vis);
    wrap.querySelectorAll("input, select, textarea").forEach((el) => {
      if (el.type === "hidden" && el.closest("[data-rich-editor]")) return;
      el.disabled = !vis;
    });
    wrap.querySelectorAll(".rich-content").forEach((el) => {
      el.contentEditable = vis && !field.readonly ? "true" : "false";
    });
    wrap.querySelectorAll(".rich-toolbar button, .rich-toolbar input[type=file]").forEach((el) => {
      el.disabled = !vis || field.readonly;
    });
    const mark = wrap.querySelector(".required-mark");
    if (mark) mark.style.display = req ? "" : "none";
  });
}

function buildSubmitValues(form, formState) {
  form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
    syncRichEditorValue(editor);
  });
  const vals = collectValuesForRules(form, formState.fields);
  const out = {};
  formState.fields.forEach((field) => {
    if (!fieldVisible(field, vals)) return;
    out[field.key] = vals[field.key] ?? "";
  });
  return out;
}

async function ensureNodeFormData(orderId, nodeKey) {
  const formState = getFormState(orderId, nodeKey);
  if (formState.loading || formState.loaded) return;

  formState.loading = true;
  formState.error = "";
  render();

  try {
    const [schemaResp, dataResp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/nodes/${encodeURIComponent(nodeKey)}/schema`),
      fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/nodes/${encodeURIComponent(nodeKey)}/data`),
    ]);
    if (schemaResp.status === 404) {
      formState.notFound = true;
      formState.loaded = true;
      return;
    }
    if (!schemaResp.ok) throw new Error(`schema load failed: ${schemaResp.status}`);
    if (!dataResp.ok) throw new Error(`data load failed: ${dataResp.status}`);
    const schemaJson = await schemaResp.json();
    const dataJson = await dataResp.json();
    formState.fields = Array.isArray(schemaJson.fields)
      ? schemaJson.fields.map((f) => ({ ...f, constraints: f.constraints || {} }))
      : [];
    formState.values = dataJson.values || {};
    formState.loaded = true;
  } catch (err) {
    formState.error = err instanceof Error ? err.message : "load failed";
  } finally {
    formState.loading = false;
    render();
  }
}

function bindNodeForms(orderId) {
  const forms = document.querySelectorAll("form[data-node-form]");
  forms.forEach((form) => {
    if (form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    const nodeKey = form.getAttribute("data-node-key");
    if (!nodeKey) return;
    const formState = getFormState(orderId, nodeKey);

    form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
      bindRichEditor(editor);
    });

    const runRules = () => {
      form.querySelectorAll("[data-rich-editor]").forEach((editor) => {
        syncRichEditorValue(editor);
      });
      applyNodeFieldRules(form, formState);
    };
    runRules();
    form.addEventListener("change", runRules);
    form.addEventListener("input", runRules);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (formState.saving) return;

      const values = buildSubmitValues(form, formState);

      formState.saving = true;
      formState.error = "";
      formState.success = "";
      render();

      try {
        const resp = await fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(orderId)}/nodes/${encodeURIComponent(nodeKey)}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            values,
            operator_id: "demo_001",
            operator_name: "Demo User",
          }),
        });
        const json = await resp.json();
        if (!resp.ok) {
          const errors = json?.detail?.errors;
          throw new Error(Array.isArray(errors) ? errors.join("；") : "提交失败");
        }
        formState.values = json?.saved?.values || values;
        formState.success = "已保存";
      } catch (err) {
        formState.error = err instanceof Error ? err.message : "提交失败";
      } finally {
        formState.saving = false;
        render();
      }
    });
  });
}

function bootstrap() {
  syncActiveKeyFromPath(window.location.pathname);
  render();
  window.addEventListener("popstate", () => {
    syncActiveKeyFromPath(window.location.pathname);
    render();
  });
  window.addEventListener("resize", () => {
    const tabsWrap = document.querySelector(".tabs");
    const target = document.querySelector(".tabs .tab.active");
    if (!tabsWrap || !target) return;
    const wrapRect = tabsWrap.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    tabsWrap.style.setProperty("--indicator-x", `${targetRect.left - wrapRect.left}px`);
    tabsWrap.style.setProperty("--indicator-w", `${targetRect.width}px`);
  });
}

function renderWorkflow(orderId) {
  const workflow = workflowByOrderId[orderId] || { currentStep: 0, logs: [] };
  const logsByStep = new Map(workflow.logs.map((log) => [log.step, log]));
  const nodeBar = WORKFLOW_NODES.map((step, index) => {
    let stateClass = "upcoming";
    if (index < workflow.currentStep) stateClass = "passed";
    if (index === workflow.currentStep) stateClass = "current";
    return `<li class="flow-node ${stateClass}">
      <span class="flow-dot"></span>
      <span class="flow-label">${step}</span>
    </li>`;
  }).join("");

  const logs = WORKFLOW_NODES.map((step, index) => {
    const log = logsByStep.get(step);
    const nodeKey = NODE_KEY_BY_STEP[step];
    const formBody = nodeKey ? renderNodeForm(orderId, nodeKey) : "";
    const body = formBody || (log ? log.summary : "暂无处理内容。");
    const open = index <= workflow.currentStep ? "open" : "";
    return `
      <details class="flow-log" ${open}>
        <summary>
          <span>${step}</span>
          <span class="flow-log-meta">${log ? `${log.actor} · ${log.at}` : "暂无记录"}</span>
        </summary>
        <div class="flow-log-body">${body}</div>
      </details>
    `;
  })
    .filter(Boolean)
    .join("");

  return `
    <section class="flow-wrap flow-wrap-full">
      <ol class="flow-bar">${nodeBar}</ol>
      <div class="flow-logs">
        ${logs}
      </div>
    </section>
  `;
}

function renderOperationLogs(orderId) {
  const logs = operationLogsByOrderId[orderId] || [];
  const drawerClass = state.logDrawerOpen ? "open" : "";
  const rows = logs
    .map(
      (log) => `
      <tr>
        <td>${log.at}</td>
        <td>${log.actor}</td>
        <td>${log.action}</td>
        <td>${log.from}</td>
        <td>${log.to}</td>
      </tr>
    `
    )
    .join("");
  return `
    <aside class="oplog-drawer ${drawerClass}">
      <div class="oplog-panel">
        <div class="oplog-head">
          <div class="oplog-title">log</div>
          <button class="oplog-close" id="close-log-drawer-btn" type="button">×</button>
        </div>
        <div class="oplog-table-wrap">
        <table class="oplog-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>动作</th>
              <th>来源节点</th>
              <th>目标节点</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="5">No logs</td></tr>`}
          </tbody>
        </table>
        </div>
      </div>
    </aside>
  `;
}

function renderNodeForm(orderId, nodeKey) {
  const formState = getFormState(orderId, nodeKey);
  if (formState.notFound) return "";
  if (formState.loading && !formState.loaded) {
    return `
      <section class="problem-fill-wrap">
        <p class="problem-fill-status">正在加载字段...</p>
      </section>
    `;
  }

  if (formState.error && !formState.loaded) {
    return `
      <section class="problem-fill-wrap">
        <p class="problem-fill-status error">加载失败：${escapeHtml(formState.error)}</p>
      </section>
    `;
  }

  const fields = [...(formState.fields || [])].sort((a, b) => {
    const ar = a.type === "richtext" ? 1 : 0;
    const br = b.type === "richtext" ? 1 : 0;
    return ar - br;
  });
  const fieldRows = fields
    .map((field) => {
      const value = getInitialFieldValue(field, formState.values || {});
      const readonly = field.readonly ? "readonly" : "";
      const c = field.constraints || {};
      const showMarkSlot =
        field.required ||
        !!(
          c.required_when_visible ||
          (c.required_if && typeof c.required_if === "object" && Object.keys(c.required_if).length)
        );
      const requiredMark = showMarkSlot ? `<span class="required-mark">*</span>` : "";
      let control = `<input type="text" name="${field.key}" value="${escapeAttr(value)}" ${readonly} />`;
      const fieldCls = field.type === "richtext" ? "problem-field problem-field-rich" : "problem-field";

      if (field.type === "date") {
        control = `<input type="date" name="${field.key}" value="${escapeAttr(value)}" ${readonly} />`;
      } else if (field.type === "whitelist") {
        const options = Array.isArray(field.options) ? field.options : [];
        const usePlaceholder = !WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key);
        const placeholderOpt = usePlaceholder
          ? `<option value="" ${value === "" ? "selected" : ""}></option>`
          : "";
        const optionHtml = options
          .map((item) => `<option value="${escapeAttr(item)}" ${item === value ? "selected" : ""}>${escapeHtml(item)}</option>`)
          .join("");
        control = `<select name="${field.key}" ${readonly}>${placeholderOpt}${optionHtml}</select>`;
      } else if (field.type === "richtext") {
        const disabled = field.readonly ? "disabled" : "";
        const editorId = `rt-${orderId}-${nodeKey}-${field.key}`;
        control = `
          <div class="rich-editor" data-rich-editor data-editor-id="${editorId}" data-disabled="${field.readonly ? "1" : "0"}">
            <div class="rich-toolbar">
              <button type="button" data-cmd="bold" ${disabled}>B</button>
              <button type="button" data-cmd="italic" ${disabled}>I</button>
              <button type="button" data-cmd="underline" ${disabled}>U</button>
              <button type="button" data-cmd="insertUnorderedList" ${disabled}>• List</button>
              <button type="button" data-cmd="insertOrderedList" ${disabled}>1. List</button>
              <button type="button" data-cmd="formatBlock" data-cmd-value="h3" ${disabled}>H3</button>
              <label class="img-upload ${field.readonly ? "disabled" : ""}">
                图片
                <input type="file" accept="image/*" data-image-input ${disabled} />
              </label>
            </div>
            <div
              class="rich-content"
              id="${editorId}"
              contenteditable="${field.readonly ? "false" : "true"}"
              data-placeholder="请输入问题描述..."
            >${value || ""}</div>
            <input type="hidden" name="${field.key}" value="${escapeAttr(value)}" data-rich-hidden />
          </div>
        `;
      }

      return `
        <div class="${fieldCls}" data-field-key="${escapeAttr(field.key)}">
          <label>${escapeHtml(field.label)}${requiredMark}</label>
          ${control}
        </div>
      `;
    })
    .join("");

  const message = formState.error
    ? `<p class="problem-fill-status error">${escapeHtml(formState.error)}</p>`
    : formState.success
      ? `<p class="problem-fill-status success">${escapeHtml(formState.success)}</p>`
      : "";

  return `
    <section class="problem-fill-wrap">
      ${message}
      <form id="node-form-${orderId}-${nodeKey}" data-node-form="1" data-node-key="${nodeKey}">
        <div class="problem-fill-grid">
          ${fieldRows || `<p class="problem-fill-status">当前无字段配置</p>`}
        </div>
        <div class="problem-fill-actions">
          <button class="action primary" type="submit" ${formState.saving ? "disabled" : ""}>
            ${formState.saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </section>
  `;
}

function getInitialFieldValue(field, savedValues) {
  if (savedValues && savedValues[field.key] != null) {
    return String(savedValues[field.key]);
  }
  if (field.type === "whitelist") {
    if (WHITELIST_NO_PLACEHOLDER_KEYS.has(field.key) && Array.isArray(field.options) && field.options.length > 0) {
      return String(field.options[0]);
    }
    return "";
  }
  if (field.default_type === "today") {
    return new Date().toISOString().slice(0, 10);
  }
  if (field.default_type === "login_user") {
    return "demo_001+Demo User";
  }
  if (typeof field.default_value === "string") {
    return field.default_value;
  }
  return "";
}

function bindRichEditor(editorWrap) {
  if (!editorWrap || editorWrap.dataset.bound === "1") return;
  editorWrap.dataset.bound = "1";

  const isDisabled = editorWrap.dataset.disabled === "1";
  const content = editorWrap.querySelector(".rich-content");
  const hidden = editorWrap.querySelector("[data-rich-hidden]");
  const imageInput = editorWrap.querySelector("[data-image-input]");
  const toolbar = editorWrap.querySelector(".rich-toolbar");
  if (!content || !hidden || !toolbar) return;

  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-cmd]");
    if (!button || isDisabled) return;
    const cmd = button.getAttribute("data-cmd");
    const cmdValue = button.getAttribute("data-cmd-value");
    content.focus();
    document.execCommand(cmd, false, cmdValue || undefined);
    syncRichEditorValue(editorWrap);
  });

  if (imageInput) {
    imageInput.addEventListener("change", async () => {
      if (isDisabled) return;
      const file = imageInput.files && imageInput.files[0];
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        content.focus();
        document.execCommand("insertImage", false, dataUrl);
        syncRichEditorValue(editorWrap);
      } finally {
        imageInput.value = "";
      }
    });
  }

  content.addEventListener("input", () => {
    syncRichEditorValue(editorWrap);
  });
}

function syncRichEditorValue(editorWrap) {
  const content = editorWrap.querySelector(".rich-content");
  const hidden = editorWrap.querySelector("[data-rich-hidden]");
  if (!content || !hidden) return;
  hidden.value = content.innerHTML.trim();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("image read failed"));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(input) {
  return escapeHtml(input).replaceAll('"', "&quot;");
}

bootstrap();

