let _renderFn = null;

function registerRender(fn) {
  _renderFn = fn;
}

function requestRender() {
  if (typeof _renderFn === "function") {
    _renderFn();
  }
}

export { registerRender, requestRender };
