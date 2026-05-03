import { getStoredUiTheme, applyUiTheme, applyPageBackgroundFromStorage } from "../ui/theme.js";
import { syncActiveKeyFromPath, syncTicketsFromServer } from "./ticket-core.js";
import { bindGlobalFallbackClicks } from "./ticket-page.js";
import { ensureAdminData } from "./admin-page.js";
import { requestRender } from "../core/scheduler.js";
import { state } from "../state/state.js";
import { tabIndicatorMetrics } from "../utils/format.js";

export function bootstrap() {
  applyUiTheme(getStoredUiTheme());
  applyPageBackgroundFromStorage();
  syncActiveKeyFromPath(window.location.pathname);
  bindGlobalFallbackClicks();
  ensureAdminData();
  requestRender();
  syncTicketsFromServer().then(() => requestRender());
  window.addEventListener("popstate", () => {
    syncActiveKeyFromPath(window.location.pathname);
    requestRender();
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
