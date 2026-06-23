import { escapeHtml } from "../utils/escape.js";
import { state } from "../state/state.js";
import { requestRender } from "../core/scheduler.js";
import { formatPersonCopyText, parsePersonDisplay } from "../utils/person-display.js";

export { parsePersonDisplay, formatPersonCopyText };

/**
 * @param {string} personDisplay
 */
export function openProblemFillReviewerModal(personDisplay) {
  const display = String(personDisplay || "").trim();
  if (!display) return;
  const { name, account } = parsePersonDisplay(display);
  state.problemFillReviewerModalOpen = true;
  state.problemFillReviewerName = name;
  state.problemFillReviewerAccount = account;
  requestRender();
}

export function closeProblemFillReviewerModal() {
  state.problemFillReviewerModalOpen = false;
  state.problemFillReviewerName = "";
  state.problemFillReviewerAccount = "";
  requestRender();
}

export function renderProblemFillReviewerModalHtml() {
  if (!state.problemFillReviewerModalOpen) return "";
  const name = String(state.problemFillReviewerName || "").trim();
  const account = String(state.problemFillReviewerAccount || "").trim();
  const nameText = name || "—";
  const accountText = account || "—";
  return `<div class="perm-modal-mask problem-fill-reviewer-modal-mask" role="presentation">
    <div class="perm-modal problem-fill-reviewer-modal" role="dialog" aria-modal="true" aria-labelledby="problem-fill-reviewer-modal-title">
      <div class="perm-modal-head problem-fill-reviewer-modal-head">
        <h3 id="problem-fill-reviewer-modal-title">问题审核人</h3>
        <button type="button" class="create-ticket-modal-close" id="close-problem-fill-reviewer-btn" aria-label="关闭">×</button>
      </div>
      <div class="perm-modal-body problem-fill-reviewer-modal-body">
        <div class="problem-fill-reviewer-row">
          <div class="problem-fill-reviewer-info">
            <span class="problem-fill-reviewer-field"><span class="problem-fill-reviewer-label">姓名</span>${escapeHtml(nameText)}</span>
            <span class="problem-fill-reviewer-field"><span class="problem-fill-reviewer-label">工号</span>${escapeHtml(accountText)}</span>
          </div>
          <button type="button" class="action problem-fill-reviewer-copy-btn" id="copy-problem-fill-reviewer-btn">复制</button>
        </div>
      </div>
    </div>
  </div>`;
}

export function bindProblemFillReviewerModal() {
  if (!state.problemFillReviewerModalOpen) return;
  const mask = document.querySelector(".problem-fill-reviewer-modal-mask");
  const closeBtn = document.getElementById("close-problem-fill-reviewer-btn");
  const copyBtn = document.getElementById("copy-problem-fill-reviewer-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeProblemFillReviewerModal());
  }
  if (mask) {
    mask.addEventListener("click", (ev) => {
      if (ev.target === mask) closeProblemFillReviewerModal();
    });
  }
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = formatPersonCopyText({
        name: state.problemFillReviewerName,
        account: state.problemFillReviewerAccount,
      });
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "已复制";
        setTimeout(() => {
          if (copyBtn.isConnected) copyBtn.textContent = "复制";
        }, 1200);
      } catch (_err) {
        window.prompt("复制以下内容：", text);
      }
    });
  }
}
