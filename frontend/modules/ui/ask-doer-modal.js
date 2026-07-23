import { escapeHtml, escapeAttr } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";

let _posAbort = null;
let _dragAbort = null;

const ASK_DOER_CONFIG = [
  {
    label: "GaussDB Doer (智能诊断系统)",
    url: "http://10.30.196.77:18140/login",
    params: "ticket_id",
  },
  {
    label: "GaussDB Doer (历史问题单检索系统)",
    url: "http://10.30.196.77:18130/#/agentViews",
    params: "ticket_id",
  }
];

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && state.askDoerModalOpen) closeAskDoerModal();
});

export function openAskDoerModal() {
  state.askDoerModalOpen = true;
  const mask = document.getElementById("ask-doer-modal-mask");
  if (mask) {
    mask.style.display = "";
    const modal = mask.querySelector(".ask-doer-modal");
    const btn = document.getElementById("ask-doer-btn");
    if (btn && modal) {
      requestAnimationFrame(() => positionModal(btn, modal));
    }
  } else {
    requestRender();
  }
}

export function closeAskDoerModal() {
  state.askDoerModalOpen = false;
  const mask = document.getElementById("ask-doer-modal-mask");
  if (mask) {
    mask.style.display = "none";
  }
}

export function renderAskDoerModalHtml(orderId) {
  const hidden = state.askDoerModalOpen ? "" : " style='display:none'";

  const buttonsHtml = ASK_DOER_CONFIG.map((item, index) => {
    let targetUrl = item.url;
    if (item.params === "ticket_id" && orderId) {
      targetUrl = `${item.url}?ticket_id=${encodeURIComponent(orderId)}`;
    }
    return `
      <button
        type="button"
        class="action ask-doer-modal-btn"
        data-url="${escapeAttr(targetUrl)}"
        data-index="${index}"
      >
        ${escapeHtml(item.label)}
      </button>
    `;
  }).join("");

  return `
    <div class="perm-modal-mask ask-doer-modal-mask" id="ask-doer-modal-mask"${hidden}
         role="dialog" aria-modal="true">
      <div class="perm-modal ask-doer-modal">
        <div class="ask-doer-modal-head">
          <h3>请选择您要咨询的服务</h3>
          <button type="button" class="create-ticket-modal-close" id="close-ask-doer-btn" aria-label="关闭">×</button>
        </div>
        <div class="perm-modal-body ask-doer-modal-body">
          <div class="ask-doer-modal-list">
            ${buttonsHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

function positionModal(btn, modal) {
  const br = btn.getBoundingClientRect();
  const gap = 6;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mw = modal.offsetWidth || 320;

  let left = br.right - mw;
  let top = br.bottom + gap;

  if (left + mw > vw - pad) {
    left = vw - mw - pad;
  }
  if (left < pad) left = pad;

  if (top + modal.offsetHeight > vh - pad) {
    const above = br.top - gap - modal.offsetHeight;
    if (above >= pad) {
      top = above;
    } else {
      top = vh - modal.offsetHeight - pad;
    }
  }

  modal.style.left = left + "px";
  modal.style.top = top + "px";
  modal.style.margin = "0";
  modal.style.position = "fixed";
}

export function bindAskDoerModal() {
  const mask = document.getElementById("ask-doer-modal-mask");
  if (!mask) return;

  const modal = mask.querySelector(".ask-doer-modal");
  const head = mask.querySelector(".ask-doer-modal-head");
  const btn = document.getElementById("ask-doer-btn");

  const closeBtn = document.getElementById("close-ask-doer-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeAskDoerModal());
  }

  mask.addEventListener("click", (ev) => {
    if (ev.target === mask) closeAskDoerModal();
  });

  mask.querySelectorAll(".ask-doer-modal-btn").forEach((btnEl) => {
    btnEl.addEventListener("click", () => {
      const url = btnEl.dataset.url;
      if (url) {
        window.open(url, "_blank");
        closeAskDoerModal();
      }
    });
  });

  if (!head || !modal) return;

  if (_posAbort) _posAbort.abort();
  const posAc = new AbortController();
  _posAbort = posAc;
  const { signal: posSignal } = posAc;

  let isDragged = false;

  function reposition() {
    if (isDragged || !btn) return;
    positionModal(btn, modal);
  }

  requestAnimationFrame(() => {
    if (btn) positionModal(btn, modal);
    else if (state.askDoerModalOpen) closeAskDoerModal();
  });
  window.addEventListener("scroll", reposition, { signal: posSignal, capture: true });
  window.addEventListener("resize", reposition, { signal: posSignal });

  if (_dragAbort) _dragAbort.abort();
  const dragAc = new AbortController();
  _dragAbort = dragAc;
  const { signal: dragSignal } = dragAc;

  let dragging = false;
  let startX, startY, origLeft, origTop;

  head.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true;
    isDragged = true;
    if (_posAbort) {
      _posAbort.abort();
      _posAbort = null;
    }
    const rect = modal.getBoundingClientRect();
    modal.style.position = "fixed";
    modal.style.left = rect.left + "px";
    modal.style.top = rect.top + "px";
    modal.style.margin = "0";
    startX = e.clientX;
    startY = e.clientY;
    origLeft = rect.left;
    origTop = rect.top;
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    modal.style.left = origLeft + (e.clientX - startX) + "px";
    modal.style.top = origTop + (e.clientY - startY) + "px";
  }, { signal: dragSignal });

  document.addEventListener("mouseup", () => {
    dragging = false;
  }, { signal: dragSignal });
}
