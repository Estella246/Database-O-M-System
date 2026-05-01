(function(global) {
  'use strict';

  var AppModules = {
    _modules: {},
    _loadedOrder: [],

    register: function(name, module) {
      if (this._modules[name]) {
        console.warn('Module "' + name + '" already registered, overwriting.');
      }
      this._modules[name] = module;
      this._loadedOrder.push(name);
      return module;
    },

    get: function(name) {
      return this._modules[name] || null;
    },

    has: function(name) {
      return !!this._modules[name];
    },

    list: function() {
      return this._loadedOrder.slice();
    },

    init: function() {
      var main = this.get('main');
      if (main && typeof main.init === 'function') {
        main.init();
      }
    }
  };

  global.AppModules = AppModules;

  function defineModule(name, factory) {
    var exports = {};
    factory(exports, AppModules);
    return AppModules.register(name, exports);
  }

  global.defineModule = defineModule;

})(typeof window !== 'undefined' ? window : this);