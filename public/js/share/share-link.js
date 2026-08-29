/**
 * share/share-link.js — share / embed URLs (API surface).
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.share = Mahp.share || {};
  Mahp.share.link = {
    setup: null,
    buildUrls: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
