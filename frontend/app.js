const root = document.getElementById("root");

const tickets = [
  ["100000301", "Content migration errors", "Urgent", "AST34556NA", "Ranya", "Issue for error...", "2026-04-02", "50000120"],
  ["100000302", "Confirmation messages", "High", "AST34558NA", "Raniak", "--", "2026-04-03", "-"],
  ["100000307", "Averaging data", "High", "AST34556NA", "Dose", "--", "2026-04-04", "-"],
  ["100000304", "Body orientation validation", "Urgent", "AST34558NA", "Dose", "--", "2026-04-05", "-"],
];

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
        <h1>Work Order</h1>
        <div class="actions">
          <button class="action">Pull Group</button>
          <button class="action primary">+ Create</button>
          <button class="action">Export</button>
          <button class="action danger">Delete</button>
        </div>
      </div>

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
    </main>
  </div>
`;

const body = document.getElementById("table-body");
tickets.forEach((r) => {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${r[0]}</td><td>${r[1]}</td><td><span class="p ${r[2].toLowerCase()}">${r[2]}</span></td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td><td>${r[6]}</td><td>${r[7]}</td>`;
  body.appendChild(tr);
});

const layout = document.querySelector(".layout");
const collapseBtn = document.getElementById("collapse-btn");
collapseBtn.addEventListener("click", () => {
  layout.classList.toggle("left-collapsed");
  collapseBtn.textContent = layout.classList.contains("left-collapsed") ? "»" : "«";
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
const listPanel = document.getElementById("list-panel");
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    listPanel.classList.remove("tab-anim");
    void listPanel.offsetWidth;
    listPanel.classList.add("tab-anim");
  });
});

