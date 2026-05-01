(function(exports, AppModules) {
  'use strict';

  var state = null;

  function initState(initialState) {
    if (state !== null) {
      console.warn('State already initialized');
      return state;
    }
    state = initialState;
    return state;
  }

  function getState() {
    return state;
  }

  function setState(newState) {
    state = newState;
    return state;
  }

  function resetState() {
    state = null;
    return state;
  }

  exports.initState = initState;
  exports.getState = getState;
  exports.setState = setState;
  exports.resetState = resetState;

})(typeof window !== 'undefined' ? window : this, window.AppModules || {});