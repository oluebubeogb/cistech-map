/**
 * core/storage.js
 * localStorage helpers. Prefer Mahp.LS keys from state.js.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  Mahp.loadJSON = loadJSON;
  Mahp.saveJSON = saveJSON;
})(typeof window !== 'undefined' ? window : globalThis);
