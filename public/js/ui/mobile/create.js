/**
 * ui/mobile/create.js
 * Create menu + rich contextual toolbar (color, width, undo, done)
 * + measure / route guidance sheets.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.ui = Mahp.ui || {};
  Mahp.ui.mobile = Mahp.ui.mobile || {};

  var COLORS = [
    '#1a73e8', '#e11d48', '#16a34a', '#f59e0b',
    '#8b5cf6', '#06b6d4', '#ec4899', '#5d4037', '#202124'
  ];
  var WIDTHS = [2, 3, 5, 8];

  var barEl = null;
  var pollTimer = null;
  var lastMode = '';

  function isMobile() {
    return document.documentElement.classList.contains('mahp-mobile');
  }

  function hasFeature(id) {
    return Mahp.hasFeature ? Mahp.hasFeature(id) : true;
  }

  function getColor() {
    if (Mahp.getActiveColor) return Mahp.getActiveColor();
    return (Mahp.state && Mahp.state.activeColor) || '#1a73e8';
  }

  function getWidth() {
    return (Mahp.state && Mahp.state.lineWidth != null) ? Number(Mahp.state.lineWidth) : 3;
  }

  function setWidth(w) {
    if (!Mahp.state) Mahp.state = {};
    Mahp.state.lineWidth = Number(w) || 3;
  }

  function ensureBar() {
    if (barEl) return barEl;
    barEl = document.createElement('div');
    barEl.id = 'm-context-bar';
    barEl.className = 'm-context-bar m-context-bar-rich';
    barEl.innerHTML =
      '<div class="m-ctx-row m-ctx-row-main m-ctx-one-line">' +
      '<button type="button" class="m-ctx-btn m-ctx-toggle" data-ctx="toggle-style" title="Colors & size" aria-expanded="false"><i class="fa-solid fa-palette"></i></button>' +
      '<button type="button" class="m-ctx-btn" data-ctx="undo" title="Undo"><i class="fa-solid fa-rotate-left"></i></button>' +
      '<span class="m-ctx-label" id="m-ctx-label">Tool</span>' +
      '<button type="button" class="m-ctx-btn m-ctx-done" data-ctx="done">Done</button>' +
      '</div>' +
      '<div class="m-ctx-row m-ctx-row-style m-ctx-style-collapsed" id="m-ctx-style">' +
      '<div class="m-ctx-colors" id="m-ctx-colors"></div>' +
      '<div class="m-ctx-widths" id="m-ctx-widths"></div>' +
      '</div>' +
      '<div class="m-ctx-hint" id="m-ctx-hint"></div>';
    document.body.appendChild(barEl);

    var colors = document.getElementById('m-ctx-colors');
    COLORS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-ctx-swatch';
      b.style.background = c;
      b.setAttribute('data-color', c);
      b.title = c;
      colors.appendChild(b);
    });

    var widths = document.getElementById('m-ctx-widths');
    WIDTHS.forEach(function (w) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-ctx-width';
      b.setAttribute('data-width', w);
      b.title = 'Width ' + w;
      b.innerHTML = '<span class="m-ctx-width-line" style="height:' + Math.min(8, w) + 'px"></span>';
      widths.appendChild(b);
    });

    barEl.addEventListener('click', function (e) {
      var sw = e.target.closest('[data-color]');
      if (sw) {
        var col = sw.getAttribute('data-color');
        if (Mahp.setActiveColor) Mahp.setActiveColor(col);
        else if (Mahp.state) Mahp.state.activeColor = col;
        syncStyleUi();
        return;
      }
      var ww = e.target.closest('[data-width]');
      if (ww) {
        setWidth(ww.getAttribute('data-width'));
        syncStyleUi();
        return;
      }
      var btn = e.target.closest('[data-ctx]');
      if (!btn) return;
      var act = btn.getAttribute('data-ctx');
      if (act === 'undo') {
        if (Mahp.history && Mahp.history.undo) Mahp.history.undo();
      } else if (act === 'done') {
        finishActiveMode();
      } else if (act === 'toggle-style') {
        var style = document.getElementById('m-ctx-style');
        var toggle = barEl.querySelector('[data-ctx="toggle-style"]');
        if (style) {
          var open = style.classList.toggle('m-ctx-style-collapsed') === false;
          // classList.toggle returns true if class is now present
          var collapsed = style.classList.contains('m-ctx-style-collapsed');
          if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
          barEl.classList.toggle('m-ctx-expanded', !collapsed);
        }
      }
    });
    return barEl;
  }

  function finishActiveMode() {
    // Commit in-progress polyline/polygon before clearing tool
    if (Mahp.drawing && Mahp.drawing.tools && Mahp.drawing.tools.finishActiveDrawing) {
      try { Mahp.drawing.tools.finishActiveDrawing(); } catch (_) {}
    }
    if (Mahp.drawing && Mahp.drawing.tools && Mahp.drawing.tools.setActiveTool) {
      Mahp.drawing.tools.setActiveTool(null);
    }
    if (Mahp.measure && Mahp.measure.isActive && Mahp.measure.isActive()) {
      if (Mahp.measure.setActive) Mahp.measure.setActive(false);
      else if (Mahp.measure.clear) Mahp.measure.clear();
    }
    if (Mahp.route && Mahp.route.clear) Mahp.route.clear();
    hideBar();
    lastMode = '';
    if (Mahp.ui.mobile.sheets && Mahp.ui.mobile.sheets.isOpen && Mahp.ui.mobile.sheets.isOpen()) {
      var t = document.getElementById('m-sheet-title');
      if (t && (t.textContent === 'Measure' || t.textContent === 'Route')) {
        Mahp.ui.mobile.sheets.close();
      }
    }
  }

  function syncStyleUi() {
    var color = getColor();
    var width = getWidth();
    if (!barEl) return;
    barEl.querySelectorAll('.m-ctx-swatch').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-color') === color);
    });
    barEl.querySelectorAll('.m-ctx-width').forEach(function (el) {
      el.classList.toggle('active', +el.getAttribute('data-width') === width);
    });
  }

  function toolLabel(tool) {
    var map = {
      freehand: 'Freehand',
      polyline: 'Line',
      polygon: 'Polygon',
      text: 'Text',
      fence: 'Fence',
      barricade: 'Barricade'
    };
    return map[tool] || tool || 'Tool';
  }

  function hintFor(mode, tool) {
    if (mode === 'measure') return 'Tap two points on the map';
    if (mode === 'route') return 'Tap start, then destination';
    if (tool === 'text') return 'Tap the map, then type';
    if (tool === 'polygon' || tool === 'polyline') return 'Tap corners · double-tap or Done to finish';
    if (tool === 'freehand' || tool === 'fence' || tool === 'barricade') return 'Sketch on the board · tap Done to place';
    return '';
  }

  function showBar(label, mode, tool) {
    if (!isMobile()) return;
    var bar = ensureBar();
    var lab = document.getElementById('m-ctx-label');
    if (lab) lab.textContent = label || 'Tool';
    var hint = document.getElementById('m-ctx-hint');
    if (hint) hint.textContent = hintFor(mode, tool);
    var style = document.getElementById('m-ctx-style');
    // Hide width for text; show color for drawing tools
    var showStyle = mode === 'draw' && tool !== 'text';
    var showColorOnly = tool === 'text';
    if (style) {
      style.style.display = showStyle || showColorOnly ? 'flex' : 'none';
      var widths = document.getElementById('m-ctx-widths');
      if (widths) widths.style.display = showStyle ? 'flex' : 'none';
    }
    syncStyleUi();
    bar.classList.add('visible');
  }

  function hideBar() {
    if (barEl) barEl.classList.remove('visible');
  }

  function openGuidanceSheet(title, html) {
    if (!Mahp.ui.mobile.sheets) return;
    Mahp.ui.mobile.sheets.open({
      title: title,
      height: 'peek',
      html: html,
      closeOnBackdrop: false
    });
  }

  function showMeasureSheet() {
    openGuidanceSheet(
      'Measure',
      '<div class="m-guide">' +
        '<p>Tap <strong>two points</strong> on the map to measure distance.</p>' +
        '<p class="m-guide-muted">Result appears when the second point is set. Use <strong>Done</strong> to exit.</p>' +
        '</div>'
    );
  }

  function showRouteSheet() {
    openGuidanceSheet(
      'Route',
      '<div class="m-guide">' +
        '<p>Tap the <strong>start</strong> point, then the <strong>destination</strong>.</p>' +
        '<p class="m-guide-muted">The route is saved to your active layer. Use <strong>Done</strong> to exit.</p>' +
        '</div>'
    );
  }

  function refresh() {
    if (!isMobile()) {
      hideBar();
      return;
    }
    var tool =
      Mahp.drawing && Mahp.drawing.tools && Mahp.drawing.tools.getCurrentTool
        ? Mahp.drawing.tools.getCurrentTool()
        : null;
    var measuring = Mahp.measure && Mahp.measure.isActive && Mahp.measure.isActive();
    var routing = Mahp.route && Mahp.route.isActive && Mahp.route.isActive();

    var mode = tool ? 'draw' : measuring ? 'measure' : routing ? 'route' : '';
    if (mode === 'draw') {
      showBar(toolLabel(tool), 'draw', tool);
    } else if (mode === 'measure') {
      showBar('Measure', 'measure');
      if (lastMode !== 'measure') showMeasureSheet();
    } else if (mode === 'route') {
      showBar('Route', 'route');
      if (lastMode !== 'route') showRouteSheet();
    } else {
      hideBar();
    }
    lastMode = mode;
  }

  function openMenu() {
    if (!Mahp.ui.mobile.sheets) return;
    var tools = [
      { id: 'btn-freehand', feat: 'freehand', icon: 'fa-pencil', label: 'Freehand' },
      { id: 'btn-polyline', feat: 'polyline', icon: 'fa-minus', label: 'Line' },
      { id: 'btn-polygon', feat: 'polygon', icon: 'fa-vector-square', label: 'Polygon' },
      { id: 'btn-text', feat: 'text', icon: 'fa-font', label: 'Text' },
      { id: 'btn-fence', feat: 'fence', icon: 'fa-border-all', label: 'Fence' },
      { id: 'btn-barricade', feat: 'barricade', icon: 'fa-road-barrier', label: 'Barricade' },
      { id: 'btn-measure', feat: 'measure', icon: 'fa-ruler', label: 'Measure' },
      { id: 'btn-route', feat: 'route', icon: 'fa-route', label: 'Route' },
      { id: 'btn-mark-area', feat: 'mark_area', icon: 'fa-draw-polygon', label: 'Mark area' }
    ];
    var html = '<div class="m-create-grid">';
    tools.forEach(function (t) {
      if (!hasFeature(t.feat)) return;
      var el = document.getElementById(t.id);
      if (el && el.style.display === 'none') return;
      html +=
        '<button type="button" class="m-create-item" data-tool-btn="' +
        t.id +
        '"><i class="fa-solid ' +
        t.icon +
        '"></i><span>' +
        t.label +
        '</span></button>';
    });
    html += '</div>';
    if (html.indexOf('m-create-item') === -1) {
      html = '<p class="m-empty">No tools available for this key.</p>';
    }
    Mahp.ui.mobile.sheets.open({
      title: 'Create',
      height: 'half',
      html: html,
      onOpen: function (body) {
        body.querySelectorAll('[data-tool-btn]').forEach(function (item) {
          item.addEventListener('click', function () {
            var id = item.getAttribute('data-tool-btn');
            Mahp.ui.mobile.sheets.close();
            setTimeout(function () {
              var btn = document.getElementById(id);
              if (btn) btn.click();
              setTimeout(refresh, 120);
            }, 40);
          });
        });
      }
    });
  }

  function setup() {
    ensureBar();
    if (Mahp.state && Mahp.state.lineWidth == null) Mahp.state.lineWidth = 3;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 350);
    refresh();
  }

  Mahp.ui.mobile.create = {
    setup: setup,
    openMenu: openMenu,
    startTool: function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.click();
      refresh();
    },
    refresh: refresh,
    finish: finishActiveMode
  };
})(typeof window !== 'undefined' ? window : globalThis);
