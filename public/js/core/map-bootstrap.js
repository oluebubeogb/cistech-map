/**
 * core/map-bootstrap.js
 * Creates the MapLibre map instance and standard controls.
 * Loaded after features.js + state.js, before map.js.
 *
 * Does not register app-specific event handlers (search, draw, etc.) —
 * those stay in map.js until their modules are extracted.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  /**
   * @param {object} options
   * @param {object} options.style - MapLibre style JSON
   * @param {number[]} [options.center]
   * @param {number} [options.zoom]
   * @param {string} [options.container='map']
   * @returns {maplibregl.Map}
   */
  function createMap(options) {
    options = options || {};
    var hasFeature = Mahp.hasFeature;
    var map = new maplibregl.Map({
      container: options.container || 'map',
      style: options.style,
      center: options.center || [7.4896, 5.5263],
      zoom: options.zoom != null ? options.zoom : 13,
      attributionControl: false
    });

    if (hasFeature('zoom')) {
      map.addControl(
        new maplibregl.NavigationControl({ visualizePitch: true }),
        'bottom-right'
      );
    }
    if (hasFeature('geolocate')) {
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true
        }),
        'bottom-right'
      );
    }
    if (hasFeature('scale')) {
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-left');
    }

    if (Mahp.state) {
      Mahp.state.map = map;
    }

    return map;
  }

  /**
   * Fetch /api/config, /api/maplibre-style, /api/style for the active key.
   * @returns {Promise<{config: object, style: object, styleMeta: object}>}
   */
  function fetchMapBootstrap() {
    var key = Mahp.getApiKey();
    var q = 'api_key=' + encodeURIComponent(key);
    return Promise.all([
      fetch('/api/config?' + q),
      fetch('/api/maplibre-style?' + q),
      fetch('/api/style?' + q)
    ]).then(function (results) {
      var configRes = results[0];
      var styleRes = results[1];
      var styleMetaRes = results[2];
      if (!configRes.ok) {
        return configRes.json().catch(function () {
          return {};
        }).then(function (err) {
          var e = new Error((err && err.error) || 'This map link is not authorized.');
          e.status = configRes.status;
          e.body = err;
          throw e;
        });
      }
      return Promise.all([configRes.json(), styleRes.json(), styleMetaRes.json()]).then(
        function (parsed) {
          return {
            config: parsed[0],
            style: parsed[1],
            styleMeta: parsed[2]
          };
        }
      );
    });
  }

  /**
   * Apply config-driven style metadata into Mahp.state (and return values for
   * callers that still use local variables during the transition).
   */
  function applyStyleMeta(config, styleMeta) {
    var S = Mahp.state;
    if (!S) return;

    S.iconsConfig = (config && config.icons) || (styleMeta && styleMeta.icons) || {};
    if (styleMeta && styleMeta.searchPin) {
      S.searchPinConfig = Object.assign({}, S.searchPinConfig, styleMeta.searchPin);
    }
    S.poiIconsConfig = (styleMeta && styleMeta.poiIcons) || null;
    if (config && config.markedAreas) {
      if (config.markedAreas.colors) S.markedAreaColors = config.markedAreas.colors;
      if (config.markedAreas.maxAreas) S.maxMarkedAreas = config.markedAreas.maxAreas;
    }
  }

  /**
   * Show the invalid-key screen and end boot.
   */
  function showInvalidKeyScreen(message) {
    document.documentElement.classList.remove('mahp-booting');
    document.body.innerHTML =
      '<div style="font-family:system-ui;padding:40px;max-width:480px;margin:auto">' +
      '<h2>Invalid API key</h2><p>' +
      (message || 'This map link is not authorized.') +
      '</p></div>';
  }

  /**
   * Reveal the app shell after feature flags have been applied.
   */
  function endBoot() {
    document.documentElement.classList.remove('mahp-booting');
  }

  Mahp.createMap = createMap;
  Mahp.fetchMapBootstrap = fetchMapBootstrap;
  Mahp.applyStyleMeta = applyStyleMeta;
  Mahp.showInvalidKeyScreen = showInvalidKeyScreen;
  Mahp.endBoot = endBoot;
})(typeof window !== 'undefined' ? window : globalThis);
