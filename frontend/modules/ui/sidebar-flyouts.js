/**
 * 将「值班表 / 参数配置」侧栏子菜单挂到 #sidebar-flyout-portal，避免被 nav.menu 的 overflow-y:auto 裁切，
 * 并保证 fixed 定位与高层级，浮在工作台主区之上。
 */
export function bindSidebarFlyouts(rootEl, { signal } = {}) {
  const portal = rootEl.querySelector("#sidebar-flyout-portal");
  if (!portal) return;

  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, { ...opts, signal });
  };

  /** @type {{ position: () => void; submenu: Element; clearHideTimer: () => void }[]} */
  const entries = [];

  rootEl.querySelectorAll(".menu-item-wrap--duty, .menu-item-wrap--params, .menu-item-wrap--report, .menu-item-wrap--quality").forEach((wrap) => {
    const submenu = wrap.querySelector(".menu-submenu");
    const trigger = wrap.querySelector(".menu-item");
    if (!submenu || !trigger) return;

    portal.appendChild(submenu);
    submenu.classList.add("menu-submenu--ported");

    let hideTimer = 0;
    const clearHideTimer = () => {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = 0;
      }
    };

    const position = () => {
      const r = trigger.getBoundingClientRect();
      const gap = 6;
      let left = r.right + gap;
      let top = r.top;
      submenu.style.left = `${left}px`;
      submenu.style.top = `${top}px`;
      const br = submenu.getBoundingClientRect();
      const pad = 6;
      if (br.right > window.innerWidth - pad) {
        left = Math.max(pad, r.left - br.width - gap);
        submenu.style.left = `${left}px`;
      }
      if (br.bottom > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - br.height - pad);
        submenu.style.top = `${top}px`;
      }
    };

    const open = () => {
      clearHideTimer();
      submenu.classList.add("menu-submenu--open");
      position();
    };

    const scheduleClose = () => {
      clearHideTimer();
      hideTimer = window.setTimeout(() => {
        hideTimer = 0;
        submenu.classList.remove("menu-submenu--open");
      }, 160);
    };

    on(wrap, "mouseenter", open);
    on(wrap, "mouseleave", scheduleClose);
    on(submenu, "mouseenter", () => {
      clearHideTimer();
      submenu.classList.add("menu-submenu--open");
      position();
    });
    on(submenu, "mouseleave", scheduleClose);

    on(trigger, "focusin", open);
    on(trigger, "focusout", (ev) => {
      const next = ev.relatedTarget;
      if (next && submenu.contains(next)) return;
      scheduleClose();
    });
    on(submenu, "focusout", (ev) => {
      const next = ev.relatedTarget;
      if (next && (wrap.contains(next) || submenu.contains(next))) return;
      scheduleClose();
    });

    entries.push({ submenu, position, clearHideTimer });
  });

  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        entries.forEach((e) => e.clearHideTimer());
      },
      { once: true }
    );
  }

  const repositionOpen = () => {
    entries.forEach(({ submenu, position }) => {
      if (submenu.classList.contains("menu-submenu--open")) position();
    });
  };

  const menuEl = rootEl.querySelector("nav.menu");
  if (menuEl) on(menuEl, "scroll", repositionOpen, { passive: true });
  on(window, "resize", repositionOpen, { passive: true });

  const leftEl = rootEl.querySelector(".left");
  if (leftEl && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(repositionOpen);
    ro.observe(leftEl);
    const disconnect = () => ro.disconnect();
    if (signal) signal.addEventListener("abort", disconnect, { once: true });
  }
}
