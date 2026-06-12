/** 问题详情 log 抽屉挂到 body，fixed 定位，避免被 detail-card overflow 等裁切。 */

const LAYER_Z_INDEX = 10060;

/** @type {(() => void) | null} */
let unbindLayerListeners = null;

/**
 * @param {HTMLElement} drawer
 */
export function positionTicketLogDrawer(drawer) {
  const margin = 8;
  const vh = window.innerHeight;
  const workspace = document.querySelector(".detail-workspace");
  const card = document.querySelector(".detail-card.detail-card-inline");
  const ref = workspace || card;

  drawer.style.position = "fixed";
  drawer.style.right = "0";
  drawer.style.zIndex = String(LAYER_Z_INDEX);

  if (ref instanceof HTMLElement) {
    const r = ref.getBoundingClientRect();
    const top = Math.max(margin, r.top);
    const height = Math.min(vh - margin - top, r.height);
    drawer.style.top = `${top}px`;
    drawer.style.height = `${Math.max(160, height)}px`;
  } else {
    drawer.style.top = `${margin}px`;
    drawer.style.height = `${vh - margin * 2}px`;
  }
}

/**
 * @param {HTMLElement} drawer
 */
function bindTicketLogDrawerLayerListeners(drawer) {
  unbindTicketLogDrawerLayerListeners();
  const reposition = () => positionTicketLogDrawer(drawer);
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  unbindLayerListeners = () => {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    unbindLayerListeners = null;
  };
}

export function unbindTicketLogDrawerLayerListeners() {
  unbindLayerListeners?.();
}

/** 整页重绘前移除已挂到 body 的 log 抽屉 */
export function detachTicketLogDrawerFromBody() {
  unbindTicketLogDrawerLayerListeners();
  document.querySelectorAll("body > .oplog-drawer.oplog-drawer--layer").forEach((el) => el.remove());
}

/** 将打开中的 log 抽屉挂到 body 并定位 */
export function ensureTicketLogDrawerOnBody() {
  const drawer = document.querySelector(".oplog-drawer.open");
  if (!drawer) return;

  drawer.classList.add("oplog-drawer--layer");
  if (drawer.parentNode !== document.body) {
    document.body.appendChild(drawer);
  }
  positionTicketLogDrawer(drawer);
  bindTicketLogDrawerLayerListeners(drawer);
}

/** log 抽屉交互区域（挂 body 后仍视为内部） */
export function isTicketLogDrawerInteraction(target) {
  return target instanceof Element && target.closest(".oplog-drawer") != null;
}
