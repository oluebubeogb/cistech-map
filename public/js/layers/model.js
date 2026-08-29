/**
 * layers/model.js — thin facade; real implementation after Mahp.layers.install().
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.layers = Mahp.layers || {};
  Mahp.layers.model = {
    uid: function () {
      return Mahp.layers.uid ? Mahp.layers.uid() : null;
    },
    ensureDefault: function () {
      return Mahp.layers.ensureDefaultLayer && Mahp.layers.ensureDefaultLayer();
    },
    getActive: function () {
      return Mahp.layers.getActiveLayer && Mahp.layers.getActiveLayer();
    },
    findItemById: function (id) {
      return Mahp.layers.findItemById && Mahp.layers.findItemById(id);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
