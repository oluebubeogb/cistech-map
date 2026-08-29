/**
 * analysis/measure.js
 * Distance measure mode: click two points, draw line, call /api/distance.
 *
 * Optional deps (set via configure) for persisting onto user layers:
 *   showInfo, getActiveLayer, commitDraw, getActiveColor
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  var measureMode = false;
  var measurePoints = [];
  var measureMarkers = [];
  var measureLine = null;
  var clickBound = false;

  var deps = {
    showInfo: null,
    getActiveLayer: null,
    commitDraw: null,
    getActiveColor: null
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
    return measureMode;
  }

  function setActive(on) {
    measureMode = !!on;
    var btn = document.getElementById('btn-measure');
    if (btn) btn.classList.toggle('active', measureMode);
    if (!measureMode) clear();
    syncState();
  }

  function clear() {
    var map = getMap();
    measureMarkers.forEach(function (m) {
      try {
        m.remove();
      } catch (_) {}
    });
    measureMarkers = [];
    measurePoints = [];
    if (measureLine && map) {
      try {
        if (map.getLayer('measure-line')) map.removeLayer('measure-line');
        if (map.getSource('measure-line')) map.removeSource('measure-line');
      } catch (_) {}
      measureLine = null;
    }
    syncState();
  }

  function drawLine() {
    var map = getMap();
    if (!map || measurePoints.length < 2) return;
    var data = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: measurePoints }
    };
    if (map.getSource('measure-line')) {
      map.getSource('measure-line').setData(data);
    } else {
      map.addSource('measure-line', { type: 'geojson', data: data });
      map.addLayer({
        id: 'measure-line',
        type: 'line',
        source: 'measure-line',
        paint: {
          'line-color': '#1a73e8',
          'line-width': 3,
          'line-dasharray': [2, 1]
        }
      });
    }
    measureLine = true;
  }

  function calcDistance() {
    if (measurePoints.length < 2) return Promise.resolve();
    var a = measurePoints[0];
    var b = measurePoints[1];
    var key = Mahp.getApiKey ? Mahp.getApiKey() : '';
    var url =
      '/api/distance?lat1=' +
      a[1] +
      '&lon1=' +
      a[0] +
      '&lat2=' +
      b[1] +
      '&lon2=' +
      b[0] +
      '&api_key=' +
      encodeURIComponent(key);

    return fetch(url)
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var color =
          (deps.getActiveColor && deps.getActiveColor()) ||
          (Mahp.state && Mahp.state.activeColor) ||
          '#1a73e8';
        var html =
          '<strong>Distance</strong><p style="margin-top:8px;font-size:1.25rem;font-weight:600;color:' +
          color +
          '">' +
          data.distance_km +
          ' km</p><p style="font-size:0.85rem;color:#5f6368">' +
          data.distance_m +
          ' meters</p>';
        if (deps.showInfo) deps.showInfo(html);
        else if (Mahp.showInfo) Mahp.showInfo(html);

        var layer = deps.getActiveLayer ? deps.getActiveLayer() : null;
        if (layer && !layer.locked && measurePoints.length >= 2 && deps.commitDraw) {
          deps.commitDraw(
            'measure',
            {
              type: 'LineString',
              coordinates: measurePoints.slice()
            },
            {
              color: color,
              name: 'Measure ' + data.distance_km + ' km',
              distance_km: data.distance_km,
              distance_m: data.distance_m
            }
          );
        }
      })
      .catch(function (err) {
        console.error(err);
      });
  }

  function onMapClick(e) {
    if (!measureMode) return;
    var map = getMap();
    if (!map) return;

    measurePoints.push([e.lngLat.lng, e.lngLat.lat]);
    var el = document.createElement('div');
    el.style.cssText =
      'width:12px;height:12px;background:#1a73e8;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.3)';
    measureMarkers.push(
      new maplibregl.Marker({ element: el }).setLngLat(e.lngLat).addTo(map)
    );

    if (measurePoints.length === 2) {
      drawLine();
      calcDistance();
    } else if (measurePoints.length > 2) {
      clear();
      measurePoints = [[e.lngLat.lng, e.lngLat.lat]];
      measureMarkers.push(
        new maplibregl.Marker({ element: el }).setLngLat(e.lngLat).addTo(map)
      );
    }
    syncState();
  }

  function setup() {
    var btn = document.getElementById('btn-measure');
    if (btn) {
      btn.addEventListener('click', function () {
        setActive(!measureMode);
        if (measureMode) {
          var msg =
            '<strong>Measure mode</strong><p style="margin-top:6px;font-size:0.9rem;color:#5f6368">Click two points on the map.</p>';
          if (deps.showInfo) deps.showInfo(msg);
          else if (Mahp.showInfo) Mahp.showInfo(msg);
        }
      });
    }

    // Defer map listener until map exists (same timing as legacy setTimeout 800)
    setTimeout(function () {
      var map = getMap();
      if (!map || clickBound) return;
      clickBound = true;
      map.on('click', onMapClick);
    }, 800);
  }

  function syncState() {
    if (!Mahp.state) return;
    Mahp.state.measureMode = measureMode;
    Mahp.state.measurePoints = measurePoints;
    Mahp.state.measureMarkers = measureMarkers;
    Mahp.state.measureLine = measureLine;
  }

  Mahp.measure = {
    configure: configure,
    setup: setup,
    setupMeasure: setup,
    clear: clear,
    clearMeasure: clear,
    isActive: isActive,
    setActive: setActive,
    /** Legacy-compatible read used by map.js guards */
    get measureMode() {
      return measureMode;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
