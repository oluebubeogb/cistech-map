/**
 * ui/desktop/sidebar.js — left rail + expandable panels (API surface).
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.ui = Mahp.ui || {};
  Mahp.ui.desktop = Mahp.ui.desktop || {};
  Mahp.ui.desktop.sidebar = {
    setup: null,
    openPanel: null,
    closePanel: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
