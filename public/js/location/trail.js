/**
 * location/trail.js — movement trail tracking (API surface).
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.trail = {
    setup: null,
    start: null,
    pause: null,
    stop: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
