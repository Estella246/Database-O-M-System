import { getStoredUiTheme, applyUiTheme, applyPageBackgroundFromStorage } from "../ui/theme.js";
import {
  syncActiveKeyFromPath,
  syncBootstrapTickets,
  prepareListPageEnter,
  runNavigationTicketSyncAndRender,
} from "./ticket-core.js";
import { bindGlobalFallbackClicks } from "./ticket-page.js";
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
  prepareListPageEnter(bootPrevKey, state.activeKey);
  syncLeaveDetailFromQuery();
  bindGlobalFallbackClicks();
  ensureAdminData();
  requestRender();
  if (state.activeKey === "rl:oncall") {
    void fetchRlOncallPublicData();
  } else {
    void (async () => {
      await ensureAdminData();
      await syncBootstrapTickets();
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
