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

    <main class="center">
      <div class="head">
        <h1>Work Order</h1>
        <div class="tabs">
          <button class="tab active">My Pending (12)</button>
          <button class="tab">All Tickets</button>
          <button class="tab">My Created</button>
          <button class="tab">Others</button>
        </div>
      </div>

      <div class="toolbar">
        <div class="filters">
          <input class="search" placeholder="Search" />
          <input class="date-range" placeholder="时间范围筛选（开始 - 结束）" />
        </div>
        <div class="actions">
          <button class="action">Pull Group</button>
          <button class="action primary">+ Create</button>
          <button class="action">Export</button>
          <button class="action danger">Delete</button>
        </div>
      </div>

      <section class="table-wrap">
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

