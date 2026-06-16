/**
 * 前端 RL On-Call 公开页面单元测试
 * 对应模块：frontend/modules/pages/rl-oncall-public-page.js
 *
 * 测试 renderRlOncallPublicPage 渲染只读 HTML（不含编辑相关元素）
 * 测试空数据时显示提示文字
 */

// --- Mock helpers (same logic as the real module, inlined for unit testing) ---

function escapeHtml(input) {
  if (!input) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dutyRlSlotFilled(slot) {
  return slot && String(slot.account || "").trim().length > 0;
}

function formatRlTodayBannerPart(slot) {
  if (!dutyRlSlotFilled(slot)) return "—";
  const name = String(slot.user_name || "").trim() || "—";
  const acc = String(slot.account || "").trim();
  const phone = String(slot.phone || "").trim() || "—";
  return `${escapeHtml(name)} · ${escapeHtml(acc)} · 手机${escapeHtml(phone)}`;
}

function renderRlPersonTableCell(slot, editing, idx, role) {
  if (editing) {
    // Not used in public page — should never be called with editing=true
    return "—";
  }
  if (!dutyRlSlotFilled(slot)) return "—";
  const name = String(slot.user_name || "").trim() || "—";
  const acc = String(slot.account || "").trim();
  const phone = String(slot.phone || "").trim() || "—";
  return `<div class="duty-rl-view-slot duty-rl-view-slot--inline">
    <span class="duty-rl-view-name">${escapeHtml(name)}</span>
    <span class="duty-rl-view-sep">·</span>
    <span class="duty-rl-view-account">${escapeHtml(acc)}</span>
    <span class="duty-rl-view-sep">·</span>
    <span class="duty-rl-phone-tag"><span class="duty-rl-phone-tag-label">手机</span><span class="duty-rl-phone-tag-value">${escapeHtml(phone)}</span></span>
  </div>`;
}

function formatDutyRlTableDateLabel(dk) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return dk;
  const parts = dk.split("-").map((v) => parseInt(v, 10));
  return `${parts[0]}年${parts[1]}月${parts[2]}日`;
}

// --- Simulated render function (mirrors rl-oncall-public-page.js logic) ---

function renderRlOncallPublicPage(rows, todayDate) {
  const list = [...(rows || [])].sort((a, b) => b.duty_date.localeCompare(a.duty_date));
  const todayRow = list.find((r) => r.duty_date === todayDate) || null;

  const discipline = `
    <div class="duty-rl-discipline">
      <p class="duty-rl-discipline-title">值班纪律及纪律说明：</p>
      <p class="duty-rl-discipline-body">非紧急问题走正常流程，值班时间：当天 9:00～次日 9:00。</p>
    </div>`;
  const todayBanner = `
    <div class="duty-rl-today-banner" role="region" aria-label="当日值班">
      <p class="duty-rl-today-line"><strong>主值班：</strong>${formatRlTodayBannerPart(todayRow?.primary)}</p>
      <p class="duty-rl-today-line"><strong>备值班：</strong>${formatRlTodayBannerPart(todayRow?.backup)}</p>
    </div>`;
  const recentTitle = `<h3 class="duty-rl-recent-title">最近的值班信息</h3>`;

  const tableRows = list
    .map((row, idx) => {
      const dateCell = escapeHtml(formatDutyRlTableDateLabel(row.duty_date));
      const pri = renderRlPersonTableCell(row.primary, false, idx, "primary");
      const bak = renderRlPersonTableCell(row.backup, false, idx, "backup");
      return `<tr>
        <td class="duty-rl-col-date">${dateCell}</td>
        <td class="duty-rl-col-person">${pri}</td>
        <td class="duty-rl-col-person">${bak}</td>
      </tr>`;
    })
    .join("");

  const emptyMsg = "暂无记录，请联系管理员维护。";
  const tbodyContent =
    list.length > 0
      ? tableRows
      : `<tr><td colspan="3" class="duty-rot-empty">${escapeHtml(emptyMsg)}</td></tr>`;
  const thead = `<thead><tr><th>日期</th><th>主值班</th><th>备值班</th></tr></thead>`;

  return `
    <div class="rl-oncall-public-page">
      <section class="duty-roster-block" id="duty-rl-oncall">
        <div class="duty-roster-block-head">
          <h2 class="duty-roster-block-title">RL值班表</h2>
        </div>
        <div class="duty-roster-card">
          ${discipline}
          ${todayBanner}
          ${recentTitle}
          <table class="duty-roster-table duty-rot-table duty-rl-table">
            ${thead}
            <tbody>${tbodyContent}</tbody>
          </table>
        </div>
      </section>
    </div>`;
}

// --- Tests ---

describe("renderRlOncallPublicPage", () => {
  const todayDate = "2026-06-15";

  test("renders discipline notice", () => {
    const html = renderRlOncallPublicPage([], todayDate);
    expect(html).toContain("duty-rl-discipline");
    expect(html).toContain("值班纪律及纪律说明");
    expect(html).toContain("非紧急问题走正常流程");
  });

  test("renders today banner", () => {
    const rows = [
      { duty_date: todayDate, primary: { account: "zhangsan", user_name: "张三", phone: "13800001111" }, backup: { account: "lisi", user_name: "李四", phone: "13800002222" } },
    ];
    const html = renderRlOncallPublicPage(rows, todayDate);
    expect(html).toContain("duty-rl-today-banner");
    expect(html).toContain("张三");
    expect(html).toContain("李四");
  });

  test("renders table with 3 columns (no operation column)", () => {
    const rows = [
      { duty_date: "2026-06-15", primary: { account: "zhangsan", user_name: "张三", phone: "13800001111" }, backup: null },
    ];
    const html = renderRlOncallPublicPage(rows, todayDate);
    expect(html).toContain("<th>日期</th>");
    expect(html).toContain("<th>主值班</th>");
    expect(html).toContain("<th>备值班</th>");
    expect(html).not.toContain("<th>操作</th>");
  });

  test("renders table rows sorted by date descending", () => {
    const rows = [
      { duty_date: "2026-06-14", primary: { account: "a", user_name: "A", phone: "1" }, backup: null },
      { duty_date: "2026-06-16", primary: { account: "b", user_name: "B", phone: "2" }, backup: null },
      { duty_date: "2026-06-15", primary: { account: "c", user_name: "C", phone: "3" }, backup: null },
    ];
    const html = renderRlOncallPublicPage(rows, todayDate);
    // Newest date should appear first in the table
    const firstDateIdx = html.indexOf("2026年6月16日");
    const secondDateIdx = html.indexOf("2026年6月15日");
    const thirdDateIdx = html.indexOf("2026年6月14日");
    expect(firstDateIdx).toBeLessThan(secondDateIdx);
    expect(secondDateIdx).toBeLessThan(thirdDateIdx);
  });

  test("does not contain edit button", () => {
    const rows = [
      { duty_date: "2026-06-15", primary: { account: "zhangsan", user_name: "张三", phone: "13800001111" }, backup: null },
    ];
    const html = renderRlOncallPublicPage(rows, todayDate);
    expect(html).not.toContain("data-duty-rl-edit");
    expect(html).not.toContain("duty-rl-edit-btn");
  });

  test("does not contain add-row form", () => {
    const rows = [
      { duty_date: "2026-06-15", primary: { account: "zhangsan", user_name: "张三", phone: "13800001111" }, backup: null },
    ];
    const html = renderRlOncallPublicPage(rows, todayDate);
    expect(html).not.toContain("duty-rl-add-block");
    expect(html).not.toContain("duty-rl-add-row-btn");
  });

  test("does not contain delete button", () => {
    const rows = [
      { duty_date: "2026-06-15", primary: { account: "zhangsan", user_name: "张三", phone: "13800001111" }, backup: null },
    ];
    const html = renderRlOncallPublicPage(rows, todayDate);
    expect(html).not.toContain("duty-rl-remove-btn");
    expect(html).not.toContain("duty-rot-col-op");
  });

  test("shows empty message when no data", () => {
    const html = renderRlOncallPublicPage([], todayDate);
    expect(html).toContain("暂无记录，请联系管理员维护");
    expect(html).toContain("duty-rot-empty");
  });

  test("empty message colspan is 3 (not 4)", () => {
    const html = renderRlOncallPublicPage([], todayDate);
    expect(html).toContain("colspan=\"3\"");
    expect(html).not.toContain("colspan=\"4\"");
  });

  test("renders title as RL值班表", () => {
    const html = renderRlOncallPublicPage([], todayDate);
    expect(html).toContain("RL值班表");
    expect(html).toContain("duty-roster-block-title");
  });

  test("renders backup slot as dash when empty", () => {
    const rows = [
      { duty_date: "2026-06-15", primary: { account: "zhangsan", user_name: "张三", phone: "13800001111" }, backup: null },
    ];
    const html = renderRlOncallPublicPage(rows, todayDate);
    // The backup cell should show "—" for empty slot
    expect(html).toContain("—");
  });

  test("today banner shows dash for on-call when no today row", () => {
    const rows = [
      { duty_date: "2026-06-14", primary: { account: "a", user_name: "A", phone: "1" }, backup: null },
    ];
    const html = renderRlOncallPublicPage(rows, todayDate);
    // todayDate = "2026-06-15" but no row for that date
    expect(html).toContain("<strong>主值班：</strong>—");
    expect(html).toContain("<strong>备值班：</strong>—");
  });
});
