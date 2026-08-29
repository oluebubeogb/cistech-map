/**
 * ui/shared/toasts.js — lightweight toast / hint messages.
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.ui = Mahp.ui || {};
  Mahp.ui.shared = Mahp.ui.shared || {};
  Mahp.ui.shared.toasts = {
    show: function (/* msg, opts */) {},
    hide: function () {}
  };
})(typeof window !== 'undefined' ? window : globalThis);
