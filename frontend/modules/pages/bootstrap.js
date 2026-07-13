import { getStoredUiTheme, applyUiTheme, applyPageBackgroundFromStorage } from "../ui/theme.js";
import {
  syncActiveKeyFromPath,
  syncBootstrapTickets,
  prepareListPageEnter,
  runNavigationTicketSyncAndRender,
} from "./ticket-core.js";
import { bindGlobalFallbackClicks, prepareTicketDetailEnter, preloadTicketDetailContent } from "./ticket-page.js";
import { syncLeaveDetailFromQuery } from "./leave-page.js";
import { ensureAdminData } from "./admin-page.js";
import { requestRender } from "../core/scheduler.js";
import { state } from "../state/state.js";
import { tabIndicatorMetrics } from "../utils/format.js";
import { fetchRlOncallPublicData } from "./rl-oncall-public-page.js";

export function bootstrap() {
  applyUiTheme(getStoredUiTheme());
  applyPageBackgroundFromStorage();
  const bootPrevKey = state.activeKey;
  syncActiveKeyFromPath(window.location.pathname);
  if (typeof state.activeKey === "string" && state.activeKey.startsWith("ticket:")) {
    prepareTicketDetailEnter(state.activeKey.slice("ticket:".length));
  }
  prepareListPageEnter(bootPrevKey, state.activeKey);
  syncLeaveDetailFromQuery();
  bindGlobalFallbackClicks();
  ensureAdminData();
  requestRender();
  if (state.activeKey === "rl:oncall") {
    void fetchRlOncallPublicData();
  } else {
    // [OPT-BOOTSTRAP] 并行化启动异步链，减少串行 RTT 堆积；QI 页面跳过工单同步
    // 回退：恢复为 await ensureAdminData(); await syncBootstrapTickets(); 去掉 if/else 分支
    void (async () => {
      const isQi = state.activeKey === "qi:manage" || state.activeKey === "req:manage" || (typeof state.activeKey === "string" && state.activeKey.startsWith("qi-detail:"));
      if (isQi) {
        // QI/需求页面不需要工单列表，只确保 admin 数据即可
        await ensureAdminData();
      } else {
        // 其他页面：admin 数据和工单同步并行拉取
        await Promise.all([ensureAdminData(), syncBootstrapTickets()]);
      }
      if (typeof state.activeKey === "string" && state.activeKey.startsWith("ticket:")) {
        const orderId = state.activeKey.slice("ticket:".length);
        if (state.ticketDetailHydratingOrderId === orderId) {
          await preloadTicketDetailContent(orderId);
          state.ticketDetailHydratingOrderId = "";
        }
      }
      requestRender();
    })();
  }
  window.addEventListener("popstate", () => {
    const prevKey = state.activeKey;
    syncActiveKeyFromPath(window.location.pathname);
    syncLeaveDetailFromQuery();
    // 从公开页面跳转到认证页面时补加载 admin 数据
    if (prevKey === "rl:oncall" && state.activeKey !== "rl:oncall" && !state.adminLoaded) {
      ensureAdminData();
    }
    if (typeof state.activeKey === "string" && state.activeKey.startsWith("ticket:")) {
      prepareTicketDetailEnter(state.activeKey.slice("ticket:".length));
    }
    runNavigationTicketSyncAndRender(prevKey, state.activeKey, requestRender);
  });
  window.addEventListener("hashchange", () => {
    if (!/\/params\/version\/?$/.test(window.location.pathname)) return;
    const h = String(window.location.hash || "").replace(/^#/, "");
    if (h === "hotfix" || h === "baseline") {
      state.versionSubTab = h;
      requestRender();
    }
  });
  window.addEventListener("resize", () => {
    const tabsWrap = document.querySelector(".tabs");
    const target = document.querySelector(".tabs .tab.active");
    if (!tabsWrap || !target) return;
    const m = tabIndicatorMetrics(tabsWrap, target);
    tabsWrap.style.setProperty("--indicator-x", `${m.x}px`);
    tabsWrap.style.setProperty("--indicator-y", `${m.y}px`);
    tabsWrap.style.setProperty("--indicator-w", `${m.w}px`);
    tabsWrap.style.setProperty("--indicator-h", `${m.h}px`);
  });
}
