/**
 * drawing/select.js — select / move / resize map items (API surface).
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.drawing = Mahp.drawing || {};
  Mahp.drawing.select = {
    setup: null,
    clearSelection: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
