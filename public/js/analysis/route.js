/**
 * analysis/route.js
 * Click start + end, call /api/route, commit line to active layer.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  var routeMode = false;
  var routePoints = [];
  var routeMarkers = [];
  var routeLineId = 'user-route-line';
  var clickBound = false;

  var deps = {
    showInfo: null,
    commitDraw: null,
    getActiveColor: null,
    setActiveTool: null,
    getCurrentTool: null,
    isDrawing: null,
    isMeasureActive: null
  };

  function getMap() {
    return (Mahp.state && Mahp.state.map) || null;
  }

  function configure(opts) {
    opts = opts || {};
    Object.keys(deps).forEach(function (k) {
      if (typeof opts[k] === 'function') deps[k] = opts[k];
    });
  }

  function isActive() {
    return routeMode || routePoints.length > 0;
  }

  function clear() {
    var map = getMap();
    routePoints = [];
    routeMarkers.forEach(function (m) {
      try { m.remove(); } catch (_) {}
    });
    routeMarkers = [];
    if (map && map.getSource(routeLineId)) {
      try {
        if (map.getLayer(routeLineId)) map.removeLayer(routeLineId);
        map.removeSource(routeLineId);
      } catch (_) {}
    }
    var btn = document.getElementById('btn-route');
    if (btn) btn.classList.remove('active');
    routeMode = false;
  }

  function finishRoute() {
    if (routePoints.length < 2) return Promise.resolve();
    var a = routePoints[0];
    var b = routePoints[routePoints.length - 1];
    var coords = [a, b];
    var dist = null;
    var dur = null;
    var note = '';
    var key = Mahp.getApiKey ? Mahp.getApiKey() : '';
    var url =
      '/api/route?from_lat=' + a[1] + '&from_lon=' + a[0] +
      '&to_lat=' + b[1] + '&to_lon=' + b[0] +
      '&api_key=' + encodeURIComponent(key);

    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        coords = data.coordinates || (data.geometry && data.geometry.coordinates) || [a, b];
        dist = data.distance_km != null ? data.distance_km : (data.properties && data.properties.distance_km);
        dur = data.duration_min != null ? data.duration_min : (data.properties && data.properties.duration_min);
        note = (data.properties && data.properties.note) || '';
      })
      .catch(function () {
        coords = [a, b];
        note = 'fallback';
      })
      .then(function () {
        var color =
          (deps.getActiveColor && deps.getActiveColor()) ||
          (Mahp.state && Mahp.state.activeColor) ||
          '#1a73e8';
        var nameParts = [];
        if (dist != null) nameParts.push(Number(dist).toFixed(2) + ' km');
        if (dur != null) nameParts.push('~' + dur + ' min');
        if (deps.commitDraw) {
          deps.commitDraw(
            'route',
            { type: 'LineString', coordinates: coords },
            {
              color: color,
              name: nameParts.length ? 'Route ' + nameParts.join(' · ') : 'Route',
              distance_km: dist != null ? Number(dist) : undefined,
              duration_min: dur != null ? Number(dur) : undefined
            }
          );
        }

        routeMarkers.forEach(function (m) {
          try { m.remove(); } catch (_) {}
        });
        routeMarkers = [];
        routePoints = [];
        var map = getMap();
        if (map && map.getSource(routeLineId)) {
          try {
            if (map.getLayer(routeLineId)) map.removeLayer(routeLineId);
            map.removeSource(routeLineId);
          } catch (_) {}
        }
        var btn = document.getElementById('btn-route');
        if (btn) btn.classList.remove('active');
        routeMode = false;

        var msg = dist != null ? Number(dist).toFixed(2) + ' km' : 'Route saved to layer';
        if (dur != null) msg += ' · ~' + dur + ' min';
        if (note && String(note).indexOf('OSRM') >= 0) msg += ' (driving)';
        else if (note && String(note).indexOf('fallback') >= 0) msg += ' (straight-line fallback)';
        var html =
          '<strong>Route</strong><p style="margin-top:8px;font-size:0.9rem;color:#5f6368">' +
          msg +
          '. Change color from the palette while selected.</p>';
        if (deps.showInfo) deps.showInfo(html);
        else if (Mahp.showInfo) Mahp.showInfo(html);
      });
  }

  function onMapClick(e) {
    if (!routeMode) return;
    if (deps.getCurrentTool && deps.getCurrentTool()) return;
    if (deps.isMeasureActive && deps.isMeasureActive()) return;
    if (deps.isDrawing && deps.isDrawing()) return;

    var map = getMap();
    if (!map) return;
    var lngLat = [e.lngLat.lng, e.lngLat.lat];
    routePoints.push(lngLat);
    var m = new maplibregl.Marker({
      color: routePoints.length === 1 ? '#16a34a' : '#1a73e8'
    })
      .setLngLat(lngLat)
      .addTo(map);
    routeMarkers.push(m);
    if (routePoints.length >= 2) {
      routeMode = false;
      finishRoute();
    }
  }

  function setup() {
    var btn = document.getElementById('btn-route');
    if (btn) {
      btn.addEventListener('click', function () {
        if (deps.setActiveTool) deps.setActiveTool(null);
        if (routeMode || routePoints.length) {
          clear();
          var panel = document.getElementById('info-panel');
          if (panel) panel.style.display = 'none';
          return;
        }
        routeMode = true;
        btn.classList.add('active');
        var msg =
          '<strong>Route</strong><p style="margin-top:8px;font-size:0.9rem;color:#5f6368">Click start point, then destination on the map.</p>';
        if (deps.showInfo) deps.showInfo(msg);
        else if (Mahp.showInfo) Mahp.showInfo(msg);
      });
    }

    var map = getMap();
    if (map && !clickBound) {
      clickBound = true;
      map.on('click', onMapClick);
    } else if (!clickBound) {
      setTimeout(function () {
        var m = getMap();
        if (!m || clickBound) return;
        clickBound = true;
        m.on('click', onMapClick);
      }, 800);
    }
  }

  Mahp.route = {
    configure: configure,
    setup: setup,
    setupRoute: setup,
    clear: clear,
    clearRoute: clear,
    isActive: isActive,
    finishRoute: finishRoute
  };
})(typeof window !== 'undefined' ? window : globalThis);
