/**
 * share/share-screen-av.js — WebRTC AV for share screen (API surface).
 */
(function (global) {
  'use strict';
  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.share = Mahp.share || {};
  Mahp.share.av = {
    setup: null,
    joinCall: null,
    leaveCall: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
