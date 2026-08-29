/**
 * layers/panel.js — layers list UI surface (implemented in layers/render.js install).
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.layers = Mahp.layers || {};
  Mahp.layers.panel = {
    setup: function () {
      return Mahp.layers.setupLayers && Mahp.layers.setupLayers();
    },
    render: function () {
      return Mahp.layers.renderLayersList && Mahp.layers.renderLayersList();
    },
    exportLayers: function () {
      return Mahp.layers.exportLayers && Mahp.layers.exportLayers();
    },
    importLayers: function (file) {
      return Mahp.layers.importLayers && Mahp.layers.importLayers(file);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
