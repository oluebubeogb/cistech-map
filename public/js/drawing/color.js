/**
 * drawing/color.js — active draw color + palette (API surface).
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.drawing = Mahp.drawing || {};
  Mahp.drawing.color = {
    setup: null,
    getActiveColor: function () {
      return (Mahp.state && Mahp.state.activeColor) || '#1a73e8';
    },
    setActiveColor: function (c) {
      if (Mahp.state) Mahp.state.activeColor = c;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
