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
        <h1>${isList ? "Work Order" : `Order ${activeTicket ? activeTicket.orderId : "Not Found"}`}</h1>
        <div class="actions">
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
    if (index >= workflow.currentStep) return "";
    const log = logsByStep.get(step);
    return `
      <details class="flow-log" open>
        <summary>
          <span>${step}</span>
          <span class="flow-log-meta">${log ? `${log.actor} · ${log.at}` : "暂无记录"}</span>
        </summary>
        <div class="flow-log-body">${log ? log.summary : "暂无处理内容。"}</div>
      </details>
    `;
  })
    .filter(Boolean)
    .join("");

  return `
    <section class="flow-wrap flow-wrap-full">
      <ol class="flow-bar">${nodeBar}</ol>
      <div class="flow-logs">
        ${logs || `<p class="flow-empty">当前还没有已走过节点。</p>`}
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

bootstrap();

