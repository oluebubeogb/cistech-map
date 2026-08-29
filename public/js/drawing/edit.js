/**
 * drawing/edit.js — straighten / curve (API surface).
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.drawing = Mahp.drawing || {};
  Mahp.drawing.edit = {
    setup: null,
    straighten: null,
    curve: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
