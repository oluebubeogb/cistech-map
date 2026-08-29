/**
 * ui/mobile/sheets.js — bottom sheet with height presets + drag resize.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.ui = Mahp.ui || {};
  Mahp.ui.mobile = Mahp.ui.mobile || {};

  var HEIGHTS = { peek: 32, half: 70, full: 88 };
  var HEIGHT_ORDER = ['peek', 'half', 'full'];
  var currentHeight = 'half'; // half = 70vh
  var openOpts = null;
  var dragState = null;

  function el(id) {
    return document.getElementById(id);
  }

  function applyHeight(name) {
    currentHeight = name;
    var sheet = el('m-sheet');
    if (!sheet) return;
    sheet.classList.remove('m-h-peek', 'm-h-half', 'm-h-full');
    sheet.classList.add('m-h-' + name);
    var vh = HEIGHTS[name] || 48;
    sheet.style.maxHeight = vh + 'vh';
    sheet.style.height = '';
  }

  function cycleHeight() {
    var idx = HEIGHT_ORDER.indexOf(currentHeight);
    var next = HEIGHT_ORDER[(idx + 1) % HEIGHT_ORDER.length];
    applyHeight(next);
  }

  function bindDrag(sheet) {
    var handle = sheet.querySelector('.m-sheet-handle') || sheet.querySelector('.m-sheet-header');
    if (!handle || handle.dataset.dragBound) return;
    handle.dataset.dragBound = '1';

    function onStart(clientY) {
      var rect = sheet.getBoundingClientRect();
      dragState = {
        startY: clientY,
        startH: rect.height,
        maxH: (window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.92
      };
      sheet.classList.add('m-sheet-dragging');
    }
    function onMove(clientY) {
      if (!dragState) return;
      var dy = dragState.startY - clientY;
      var h = Math.max(120, Math.min(dragState.maxH, dragState.startH + dy));
      sheet.style.height = h + 'px';
      sheet.style.maxHeight = h + 'px';
    }
    function onEnd() {
      if (!dragState) return;
      var h = sheet.getBoundingClientRect().height;
      var vh = (h / window.innerHeight) * 100;
      var best = 'half';
      var bestDist = Infinity;
      HEIGHT_ORDER.forEach(function (name) {
        var d = Math.abs(HEIGHTS[name] - vh);
        if (d < bestDist) {
          bestDist = d;
          best = name;
        }
      });
      sheet.classList.remove('m-sheet-dragging');
      sheet.style.height = '';
      applyHeight(best);
      dragState = null;
    }

    handle.addEventListener('click', function (e) {
      if (handle.dataset.didDrag === '1') {
        handle.dataset.didDrag = '';
        return;
      }
      // click handle cycles height
      if (e.target.closest('.m-sheet-close')) return;
      cycleHeight();
    });

    handle.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      handle.dataset.didDrag = '';
      onStart(e.touches[0].clientY);
    }, { passive: true });
    handle.addEventListener('touchmove', function (e) {
      if (!dragState || e.touches.length !== 1) return;
      handle.dataset.didDrag = '1';
      onMove(e.touches[0].clientY);
    }, { passive: true });
    handle.addEventListener('touchend', onEnd);
    handle.addEventListener('touchcancel', onEnd);

    handle.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      handle.dataset.didDrag = '';
      onStart(e.clientY);
      var move = function (ev) {
        handle.dataset.didDrag = '1';
        onMove(ev.clientY);
      };
      var up = function () {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        onEnd();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function open(opts) {
    opts = opts || {};
    openOpts = opts;
    var sheet = el('m-sheet');
    var backdrop = el('m-sheet-backdrop');
    var title = el('m-sheet-title');
    var body = el('m-sheet-body');
    if (!sheet || !body) return;

    if (title) title.textContent = opts.title || 'Menu';
    body.innerHTML = opts.html || '';
    // Always open at 70vh so content clears the soft keyboard; user can still
    // drag or tap the handle to peek / full.
    var startH = opts.height === 'full' ? 'full' : 'half';
    applyHeight(startH);
    sheet.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    bindDrag(sheet);
    if (typeof opts.onOpen === 'function') {
      try {
        opts.onOpen(body);
      } catch (e) {
        console.warn('sheet onOpen', e);
      }
    }
  }

  function close() {
    var sheet = el('m-sheet');
    var backdrop = el('m-sheet-backdrop');
    if (sheet) {
      sheet.classList.remove('open');
      sheet.style.height = '';
    }
    if (backdrop) backdrop.classList.remove('open');
    openOpts = null;
  }

  function isOpen() {
    var sheet = el('m-sheet');
    return !!(sheet && sheet.classList.contains('open'));
  }

  Mahp.ui.mobile.sheets = {
    open: open,
    close: close,
    isOpen: isOpen,
    setHeight: applyHeight,
    cycleHeight: cycleHeight
  };
})(typeof window !== 'undefined' ? window : globalThis);
