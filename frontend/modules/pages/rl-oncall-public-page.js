import { DUTY_RL_ONCALL_STORAGE_KEY } from "../constants/duty.js";
import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { normalizeDutyRlOnCallRows } from "../utils/normalize.js";
import { formatDutyRlNowZh, formatDutyRlTableDateLabel, formatRlTodayBannerPart } from "../utils/format.js";
import { dutyRlEffectiveDateKey } from "../utils/date.js";
import { API_BASE_URL } from "../services/api.js";
import { requestRender } from "../core/scheduler.js";
import { renderRlPersonTableCell } from "./duty.js";

export function ensureRlOncallPublicTab() {
  const key = "rl:oncall";
  if (!state.openTabs.some((tab) => tab.key === key)) {
    state.openTabs.push({ key, label: "RL值班表", closable: false });
  }
  return key;
}

let rlOncallPublicLoaded = false;
let rlOncallPublicLoading = false;

export async function fetchRlOncallPublicData() {
  if (rlOncallPublicLoaded || rlOncallPublicLoading) return;
  rlOncallPublicLoading = true;
  try {
    const resp = await fetch(`${API_BASE_URL}/api/duty/rl-oncall`);
    if (resp.ok) {
      const jl = await resp.json();
      const rows = Array.isArray(jl.rows) ? jl.rows : [];
      if (rows.length > 0) {
        state.dutyRlOnCallRows = normalizeDutyRlOnCallRows(rows);
        try {
          window.localStorage.setItem(DUTY_RL_ONCALL_STORAGE_KEY, JSON.stringify(state.dutyRlOnCallRows));
        } catch (_) {}
      }
      rlOncallPublicLoaded = true;
    }
  } catch (_) {
    // 网络失败：使用 localStorage 缓存（state 初始化时已加载）
    rlOncallPublicLoaded = true;
  }
  rlOncallPublicLoading = false;
  requestRender();
}

export function renderRlOncallPublicPage() {
  const list = [...(state.dutyRlOnCallRows || [])].sort((a, b) => b.duty_date.localeCompare(a.duty_date));
  const todayKey = dutyRlEffectiveDateKey();
  const todayRow = list.find((r) => r.duty_date === todayKey) || null;

  const discipline = `
    <div class="duty-rl-discipline">
      <p class="duty-rl-discipline-title">值班纪律及纪律说明：</p>
      <p class="duty-rl-discipline-body">非紧急问题走正常流程，值班时间：当天 9:00～次日 9:00。</p>
    </div>`;
  const todayBanner = `
    <div class="duty-rl-today-banner" role="region" aria-label="当日值班">
      <p class="duty-rl-today-line"><strong>当前时间：</strong>${escapeHtml(formatDutyRlNowZh())}</p>
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

export function bindRlOncallPublicPage() {
  if (!rlOncallPublicLoaded) {
    void fetchRlOncallPublicData();
  }
}
