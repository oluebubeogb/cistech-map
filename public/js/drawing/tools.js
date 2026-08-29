/**
 * drawing/tools.js
 * Freehand / fence / barricade: temporary whiteboard overlay (reliable on touch).
 * Polyline / polygon / text: map taps as before.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  var currentTool = null;
  var drawCoords = []; // geo [lng,lat] for polyline/polygon OR whiteboard strokes
  var isDrawing = false;
  var pendingTextLngLat = null;
  var drawTempSourceId = Mahp.DRAW_TEMP_SOURCE_ID || 'user-draw-temp';
  var eventsBound = false;

  // Whiteboard (mobile only — freehand / fence / barricade)
  var boardEl = null;
  var boardCanvas = null;
  var boardCtx = null;
  var boardActive = false;
  var boardStrokes = []; // array of { points: [[lng,lat], ...] }
  var boardCurrent = null; // pixel points while stroking, also geo
  var boardDrawing = false;

  // Desktop stroke drawing (direct on map, no overlay)
  var desktopStrokeActive = false;
  var desktopStrokeCoords = [];

  var deps = {
    getActiveLayer: null,
    commitDraw: null,
    getActiveColor: null
  };

  function isMobileUi() {
    return document.documentElement.classList.contains('mahp-mobile');
  }

  function getMap() {
    return (Mahp.state && Mahp.state.map) || null;
  }

  function configure(opts) {
    opts = opts || {};
    Object.keys(deps).forEach(function (k) {
      if (typeof opts[k] === 'function') deps[k] = opts[k];
    });
  }

  function getCurrentTool() {
    return currentTool;
  }

  function getIsDrawing() {
    return isDrawing || boardDrawing;
  }

  function isStrokeTool(tool) {
    return tool === 'freehand' || tool === 'fence' || tool === 'barricade';
  }

  function activeColor() {
    return (
      (deps.getActiveColor && deps.getActiveColor()) ||
      (Mahp.state && Mahp.state.activeColor) ||
      '#1a73e8'
    );
  }

  function lineWidth() {
    return (Mahp.state && Mahp.state.lineWidth != null) ? Number(Mahp.state.lineWidth) : 3;
  }

  // ---------- Whiteboard ----------
  function ensureBoard() {
    if (boardEl) return boardEl;
    var host = document.getElementById('map-container') || document.getElementById('map') || document.body;
    boardEl = document.createElement('div');
    boardEl.id = 'mahp-draw-board';
    boardEl.innerHTML =
      '<div class="mahp-draw-bg"></div>' +
      '<div class="mahp-draw-hint" id="mahp-draw-hint">Draw here · Done to place on map</div>' +
      '<canvas></canvas>';
    host.appendChild(boardEl);
    boardCanvas = boardEl.querySelector('canvas');
    boardCtx = boardCanvas.getContext('2d');

    function posFromEvent(ev) {
      var rect = boardCanvas.getBoundingClientRect();
      var t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]) || ev;
      return {
        x: t.clientX - rect.left,
        y: t.clientY - rect.top
      };
    }

    function pixelToLngLat(x, y) {
      var map = getMap();
      if (!map) return null;
      try {
        var ll = map.unproject([x, y]);
        return [ll.lng, ll.lat];
      } catch (_) {
        return null;
      }
    }

    function startStroke(ev) {
      if (!boardActive || !isStrokeTool(currentTool)) return;
      ev.preventDefault();
      var p = posFromEvent(ev);
      var geo = pixelToLngLat(p.x, p.y);
      boardDrawing = true;
      isDrawing = true;
      boardCurrent = {
        pixels: [[p.x, p.y]],
        geos: geo ? [geo] : []
      };
      resizeBoard();
      boardCtx.strokeStyle = activeColor();
      boardCtx.lineWidth = Math.max(2, lineWidth());
      boardCtx.lineCap = 'round';
      boardCtx.lineJoin = 'round';
      boardCtx.beginPath();
      boardCtx.moveTo(p.x, p.y);
      syncState();
    }

    function moveStroke(ev) {
      if (!boardDrawing || !boardCurrent) return;
      ev.preventDefault();
      var p = posFromEvent(ev);
      var geo = pixelToLngLat(p.x, p.y);
      boardCurrent.pixels.push([p.x, p.y]);
      if (geo) boardCurrent.geos.push(geo);
      boardCtx.lineTo(p.x, p.y);
      boardCtx.stroke();
      boardCtx.beginPath();
      boardCtx.moveTo(p.x, p.y);
    }

    function endStroke(ev) {
      if (!boardDrawing || !boardCurrent) return;
      if (ev) ev.preventDefault();
      boardDrawing = false;
      isDrawing = false;
      if (boardCurrent.geos.length >= 2) {
        boardStrokes.push(boardCurrent.geos.slice());
      }
      boardCurrent = null;
      syncState();
    }

    boardCanvas.addEventListener('mousedown', startStroke);
    boardCanvas.addEventListener('mousemove', function (ev) {
      if (boardDrawing) moveStroke(ev);
    });
    boardCanvas.addEventListener('mouseup', endStroke);
    boardCanvas.addEventListener('mouseleave', function () {
      if (boardDrawing) endStroke();
    });
    boardCanvas.addEventListener('touchstart', startStroke, { passive: false });
    boardCanvas.addEventListener('touchmove', moveStroke, { passive: false });
    boardCanvas.addEventListener('touchend', endStroke, { passive: false });
    boardCanvas.addEventListener('touchcancel', endStroke, { passive: false });

    window.addEventListener('resize', function () {
      if (boardActive) resizeBoard(true);
    });

    return boardEl;
  }

  function resizeBoard(redraw) {
    if (!boardCanvas) return;
    var host = boardEl.parentElement || document.getElementById('map-container');
    var w = host.clientWidth || window.innerWidth;
    var h = host.clientHeight || window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    boardCanvas.width = Math.max(1, Math.floor(w * dpr));
    boardCanvas.height = Math.max(1, Math.floor(h * dpr));
    boardCanvas.style.width = w + 'px';
    boardCanvas.style.height = h + 'px';
    boardCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boardCtx.lineCap = 'round';
    boardCtx.lineJoin = 'round';
    if (redraw) redrawBoardFromStrokes();
  }

  function redrawBoardFromStrokes() {
    if (!boardCtx || !boardCanvas) return;
    var w = boardCanvas.width;
    var h = boardCanvas.height;
    boardCtx.save();
    boardCtx.setTransform(1, 0, 0, 1, 0, 0);
    boardCtx.clearRect(0, 0, w, h);
    boardCtx.restore();
    var map = getMap();
    if (!map) return;
    boardCtx.strokeStyle = activeColor();
    boardCtx.lineWidth = Math.max(2, lineWidth());
    boardCtx.lineCap = 'round';
    boardCtx.lineJoin = 'round';
    boardStrokes.forEach(function (geos) {
      if (!geos || geos.length < 2) return;
      boardCtx.beginPath();
      geos.forEach(function (g, i) {
        try {
          var pt = map.project(g);
          if (i === 0) boardCtx.moveTo(pt.x, pt.y);
          else boardCtx.lineTo(pt.x, pt.y);
        } catch (_) {}
      });
      boardCtx.stroke();
    });
  }

  function openBoard() {
    ensureBoard();
    boardStrokes = [];
    boardCurrent = null;
    boardDrawing = false;
    boardActive = true;
    resizeBoard();
    boardEl.classList.add('active');
    var hint = document.getElementById('mahp-draw-hint');
    var labels = { freehand: 'Freehand', fence: 'Fence', barricade: 'Barricade' };
    if (hint) {
      hint.textContent =
        (labels[currentTool] || 'Draw') + ' · sketch on the board · Done places it on the map';
    }
    // Freeze map under the board so projection stays stable
    var map = getMap();
    if (map) {
      try {
        map.dragPan.disable();
        map.scrollZoom.disable();
        map.touchZoomRotate.disable();
        if (map.touchPitch) map.touchPitch.disable();
        map.dragRotate.disable();
        map.doubleClickZoom.disable();
      } catch (_) {}
    }
  }

  function closeBoard(restoreMap) {
    boardActive = false;
    boardDrawing = false;
    boardCurrent = null;
    if (boardEl) boardEl.classList.remove('active');
    if (boardCtx && boardCanvas) {
      boardCtx.save();
      boardCtx.setTransform(1, 0, 0, 1, 0, 0);
      boardCtx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
      boardCtx.restore();
    }
    boardStrokes = [];
    if (restoreMap !== false) {
      var map = getMap();
      if (map) {
        try {
          map.dragPan.enable();
          map.scrollZoom.enable();
          map.touchZoomRotate.enable();
          if (map.touchPitch) map.touchPitch.enable();
          map.dragRotate.enable();
          map.doubleClickZoom.enable();
        } catch (_) {}
      }
    }
  }

  /** Commit whiteboard strokes to the active layer, then close board */
  function commitBoardStrokes() {
    if (!isStrokeTool(currentTool)) {
      closeBoard(true);
      return false;
    }
    // Include in-progress stroke
    if (boardCurrent && boardCurrent.geos && boardCurrent.geos.length >= 2) {
      boardStrokes.push(boardCurrent.geos.slice());
    }
    boardCurrent = null;
    boardDrawing = false;

    var committed = 0;
    boardStrokes.forEach(function (geos) {
      if (!geos || geos.length < 2) return;
      // Simplify very dense points slightly
      var coords = simplifyCoords(geos, 0.00002);
      if (coords.length < 2) return;
      if (deps.commitDraw) {
        deps.commitDraw(currentTool, {
          type: 'LineString',
          coordinates: coords
        });
        committed++;
      }
    });
    closeBoard(true);
    return committed > 0;
  }

  function simplifyCoords(coords, minDeg) {
    if (!coords || coords.length < 3) return coords || [];
    var out = [coords[0]];
    for (var i = 1; i < coords.length - 1; i++) {
      var prev = out[out.length - 1];
      var cur = coords[i];
      if (
        Math.abs(cur[0] - prev[0]) >= minDeg ||
        Math.abs(cur[1] - prev[1]) >= minDeg
      ) {
        out.push(cur);
      }
    }
    out.push(coords[coords.length - 1]);
    return out;
  }

  // ---------- Tool activation ----------
  function setActiveTool(tool) {
    var map = getMap();
    // Leaving a stroke tool: discard board / desktop stroke unless finish was called first
    if (isStrokeTool(currentTool) && tool !== currentTool) {
      closeBoard(true);
      cancelDesktopStroke();
    }

    currentTool = tool;
    drawCoords = [];
    isDrawing = false;
    boardDrawing = false;
    desktopStrokeActive = false;
    desktopStrokeCoords = [];
    updateTempDraw();
    syncState();

    document.querySelectorAll('.tool-btn').forEach(function (b) {
      if (b.id === 'btn-satellite' || b.id === 'btn-3d') return;
      b.classList.remove('active');
    });

    if (tool) {
      var btn = document.getElementById('btn-' + tool);
      if (btn) btn.classList.add('active');
      if (map) map.getCanvas().classList.add('map-drawing');
      // Whiteboard overlay only on mobile (better UX for touch); desktop draws on map
      if (isStrokeTool(tool) && isMobileUi()) {
        openBoard();
      } else {
        closeBoard(true);
      }
    } else {
      if (map) map.getCanvas().classList.remove('map-drawing');
      closeBoard(true);
      cancelDesktopStroke();
    }
  }

  function cancelDesktopStroke() {
    desktopStrokeActive = false;
    desktopStrokeCoords = [];
    isDrawing = false;
    drawCoords = [];
    var map = getMap();
    if (map) {
      try {
        map.dragPan.enable();
      } catch (_) {}
    }
    updateTempDraw();
    syncState();
  }

  function commitDesktopStroke() {
    if (!isStrokeTool(currentTool) || desktopStrokeCoords.length < 2) {
      cancelDesktopStroke();
      return false;
    }
    var coords = simplifyCoords(desktopStrokeCoords, 0.00002);
    if (coords.length < 2) {
      cancelDesktopStroke();
      return false;
    }
    if (deps.commitDraw) {
      deps.commitDraw(currentTool, {
        type: 'LineString',
        coordinates: coords
      });
    }
    desktopStrokeActive = false;
    desktopStrokeCoords = [];
    isDrawing = false;
    drawCoords = [];
    updateTempDraw();
    syncState();
    return true;
  }

  function updateTempDraw(previewPoint) {
    var map = getMap();
    if (!map || !map.getSource(drawTempSourceId)) return;
    var coords = drawCoords.slice();
    if (previewPoint && previewPoint.length) {
      var p = previewPoint[0] || previewPoint;
      if (Array.isArray(p) && typeof p[0] === 'number') coords.push(p);
    }
    var features = [];
    if (coords.length >= 2) {
      if (currentTool === 'polygon' && coords.length >= 3) {
        var ring = coords.slice();
        ring.push(ring[0]);
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {}
        });
      } else {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {}
        });
      }
    }
    map.getSource(drawTempSourceId).setData({ type: 'FeatureCollection', features: features });
  }

  function finishPolygonOrLine() {
    if (currentTool === 'polygon' && drawCoords.length >= 3) {
      var ring = drawCoords.slice();
      ring.push(ring[0]);
      if (deps.commitDraw) {
        deps.commitDraw(
          'polygon',
          { type: 'Polygon', coordinates: [ring] },
          { color: activeColor() }
        );
      }
      drawCoords = [];
      updateTempDraw();
      syncState();
      return true;
    }
    if (currentTool === 'polyline' && drawCoords.length >= 2) {
      if (deps.commitDraw) {
        deps.commitDraw('polyline', {
          type: 'LineString',
          coordinates: drawCoords.slice()
        });
      }
      drawCoords = [];
      updateTempDraw();
      syncState();
      return true;
    }
    return false;
  }

  /** Done button / external finish */
  function finishActiveDrawing() {
    if (isStrokeTool(currentTool) && boardActive) {
      return commitBoardStrokes();
    }
    if (isStrokeTool(currentTool) && desktopStrokeCoords.length >= 2) {
      return commitDesktopStroke();
    }
    if (currentTool === 'polyline' || currentTool === 'polygon') {
      return finishPolygonOrLine();
    }
    return false;
  }

  // ---------- Map taps for polyline / polygon / text ----------
  var lastTapTime = 0;
  var lastTapPoint = null;
  var CLOSE_RING_PX = 28;

  function pointPxDistance(map, a, b) {
    try {
      var pa = map.project(a);
      var pb = map.project(b);
      var dx = pa.x - pb.x;
      var dy = pa.y - pb.y;
      return Math.sqrt(dx * dx + dy * dy);
    } catch (_) {
      return 9999;
    }
  }

  // ---------- Desktop freehand / fence / barricade (no whiteboard) ----------
  function onDesktopStrokeDown(e) {
    if (!currentTool || !isStrokeTool(currentTool) || boardActive || isMobileUi()) return;
    var layer = deps.getActiveLayer && deps.getActiveLayer();
    if (layer && layer.locked) return;
    if (e.originalEvent && e.originalEvent.button != null && e.originalEvent.button !== 0) return;
    desktopStrokeActive = true;
    isDrawing = true;
    desktopStrokeCoords = [[e.lngLat.lng, e.lngLat.lat]];
    drawCoords = desktopStrokeCoords.slice();
    updateTempDraw();
    syncState();
    var map = getMap();
    if (map) {
      try {
        map.dragPan.disable();
      } catch (_) {}
    }
    try {
      e.preventDefault();
    } catch (_) {}
  }

  function onDesktopStrokeMove(e) {
    if (!desktopStrokeActive || !isStrokeTool(currentTool) || boardActive) return;
    desktopStrokeCoords.push([e.lngLat.lng, e.lngLat.lat]);
    drawCoords = desktopStrokeCoords.slice();
    updateTempDraw();
    syncState();
  }

  function onDesktopStrokeUp(e) {
    if (!desktopStrokeActive) return;
    if (e && e.lngLat) {
      desktopStrokeCoords.push([e.lngLat.lng, e.lngLat.lat]);
    }
    var map = getMap();
    if (map) {
      try {
        map.dragPan.enable();
      } catch (_) {}
    }
    commitDesktopStroke();
  }

  function onDrawClick(e) {
    if (!currentTool || isStrokeTool(currentTool) || boardActive) return;
    var layer = deps.getActiveLayer && deps.getActiveLayer();
    if (layer && layer.locked) return;
    var map = getMap();
    if (!map) return;

    if (currentTool === 'text') {
      pendingTextLngLat = e.lngLat;
      var box = document.getElementById('inline-text-box');
      var input = document.getElementById('inline-text-input');
      if (!box || !input) return;
      var point = map.project(e.lngLat);
      box.style.display = 'block';
      box.style.left = point.x + 'px';
      box.style.top = point.y - 14 + 'px';
      input.value = '';
      var color = activeColor();
      input.style.color = color;
      input.focus();
      var finished = false;
      function finish(cancel) {
        if (finished) return;
        finished = true;
        var val = input.value.trim();
        var ll = pendingTextLngLat;
        box.style.display = 'none';
        pendingTextLngLat = null;
        input.removeEventListener('keydown', onKey);
        input.removeEventListener('blur', onBlur);
        if (!cancel && val && ll && deps.commitDraw) {
          deps.commitDraw(
            'text',
            { type: 'Point', coordinates: [ll.lng, ll.lat] },
            { text: val, color: color, name: val }
          );
        }
        setActiveTool(null);
      }
      function onKey(ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          finish(false);
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(true);
        }
      }
      function onBlur() {
        setTimeout(function () {
          finish(false);
        }, 150);
      }
      input.addEventListener('keydown', onKey);
      input.addEventListener('blur', onBlur);
      return;
    }

    if (currentTool === 'polyline' || currentTool === 'polygon') {
      var now = Date.now();
      if (
        lastTapTime &&
        now - lastTapTime < 350 &&
        lastTapPoint &&
        Math.hypot(e.point.x - lastTapPoint.x, e.point.y - lastTapPoint.y) < 30
      ) {
        lastTapTime = 0;
        lastTapPoint = null;
        if (finishPolygonOrLine()) return;
      }
      lastTapTime = now;
      lastTapPoint = { x: e.point.x, y: e.point.y };

      if (
        currentTool === 'polygon' &&
        drawCoords.length >= 3 &&
        pointPxDistance(map, drawCoords[0], [e.lngLat.lng, e.lngLat.lat]) < CLOSE_RING_PX
      ) {
        finishPolygonOrLine();
        return;
      }

      drawCoords.push([e.lngLat.lng, e.lngLat.lat]);
      updateTempDraw();
      syncState();
    }
  }

  function onDrawDblClick(e) {
    if (!currentTool || (currentTool !== 'polyline' && currentTool !== 'polygon')) return;
    if (boardActive) return;
    try {
      e.preventDefault();
    } catch (_) {}
    finishPolygonOrLine();
  }

  function onDrawMouseMove(e) {
    if (boardActive) return;
    if (desktopStrokeActive) {
      onDesktopStrokeMove(e);
      return;
    }
    if (!currentTool || (currentTool !== 'polyline' && currentTool !== 'polygon')) return;
    if (!drawCoords.length) return;
    updateTempDraw([[e.lngLat.lng, e.lngLat.lat]]);
  }

  function ensureTempSource() {
    var map = getMap();
    if (!map || map.getSource(drawTempSourceId)) return;
    map.addSource(drawTempSourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
      id: drawTempSourceId + '-line',
      type: 'line',
      source: drawTempSourceId,
      paint: { 'line-color': '#1a73e8', 'line-width': 2.5, 'line-dasharray': [1, 1] }
    });
    map.addLayer({
      id: drawTempSourceId + '-fill',
      type: 'fill',
      source: drawTempSourceId,
      paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.15 }
    });
  }

  function bindMapEvents() {
    var map = getMap();
    if (!map || eventsBound) return;
    eventsBound = true;
    if (typeof map.loaded === 'function' && map.loaded()) ensureTempSource();
    else map.on('load', ensureTempSource);
    map.on('click', onDrawClick);
    map.on('dblclick', onDrawDblClick);
    map.on('mousemove', onDrawMouseMove);
    map.on('mousedown', onDesktopStrokeDown);
    map.on('mouseup', onDesktopStrokeUp);
    // Also end stroke if pointer leaves the map canvas
    map.on('mouseout', function () {
      if (desktopStrokeActive) commitDesktopStroke();
    });
  }

  function setup() {
    var tools = [
      { id: 'btn-freehand', tool: 'freehand' },
      { id: 'btn-polyline', tool: 'polyline' },
      { id: 'btn-polygon', tool: 'polygon' },
      { id: 'btn-text', tool: 'text' },
      { id: 'btn-fence', tool: 'fence' },
      { id: 'btn-barricade', tool: 'barricade' }
    ];
    tools.forEach(function (t) {
      var btn = document.getElementById(t.id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        setActiveTool(currentTool === t.tool ? null : t.tool);
      });
    });
    ['btn-measure', 'btn-mark-area'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener(
          'click',
          function () {
            setActiveTool(null);
          },
          true
        );
      }
    });
    bindMapEvents();
    setTimeout(bindMapEvents, 800);
  }

  function syncState() {
    if (!Mahp.state) return;
    Mahp.state.currentTool = currentTool;
    Mahp.state.drawCoords = drawCoords;
    Mahp.state.isDrawing = isDrawing || boardDrawing;
  }

  Mahp.drawing = Mahp.drawing || {};
  Mahp.drawing.tools = {
    configure: configure,
    setup: setup,
    setupDrawingTools: setup,
    setActiveTool: setActiveTool,
    getCurrentTool: getCurrentTool,
    getIsDrawing: getIsDrawing,
    finishActiveDrawing: finishActiveDrawing,
    isBoardActive: function () {
      return boardActive;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
