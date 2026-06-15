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

export { registerRender, requestRender };
