/**
 * core/utils.js
 * Small shared DOM / string helpers used by search, markers, panels.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** White FA icon inside a colored circle with white border */
  function makeCircleIconEl(bgColor, faClass, size, borderWidth, borderColor) {
    size = size || 28;
    borderWidth = borderWidth || 3;
    borderColor = borderColor || '#ffffff';
    var iconSize = Math.round(size * 0.45);

    var el = document.createElement('div');
    el.style.cssText =
      'width:' + size + 'px;height:' + size + 'px;' +
      'background:' + bgColor + ';' +
      'border:' + borderWidth + 'px solid ' + borderColor + ';' +
      'border-radius:50%;' +
      'display:flex;align-items:center;justify-content:center;' +
      'box-shadow:0 2px 6px rgba(0,0,0,0.3);' +
      'cursor:pointer;';
    el.innerHTML =
      '<i class="fa-solid ' + faClass + '" style="color:#fff;font-size:' +
      iconSize + 'px;line-height:1"></i>';
    return el;
  }

  function showInfo(html) {
    var panel = document.getElementById('info-panel');
    var content = document.getElementById('info-content');
    if (!panel || !content) return;
    content.innerHTML = html;
    panel.style.display = 'block';
  }

  function hideInfo() {
    var panel = document.getElementById('info-panel');
    if (panel) panel.style.display = 'none';
  }

  Mahp.escapeHtml = escapeHtml;
  Mahp.makeCircleIconEl = makeCircleIconEl;
  Mahp.showInfo = showInfo;
  Mahp.hideInfo = hideInfo;
})(typeof window !== 'undefined' ? window : globalThis);
