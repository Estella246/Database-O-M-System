let _renderFn = null;
let _renderScheduled = false;

function registerRender(fn) {
  _renderFn = fn;
}

function requestRender() {
  if (typeof _renderFn !== "function") return;
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(() => {
    _renderScheduled = false;
    if (typeof _renderFn === "function") _renderFn();
  });
}

/** 数据异步就绪后须再绘一帧时调用（避免与 ensureAdminData 等合并 requestRender 被吞掉）。 */
function forceRequestRender() {
  _renderScheduled = false;
  requestRender();
}

export { registerRender, requestRender, forceRequestRender };
