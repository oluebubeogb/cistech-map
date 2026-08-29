/**
 * core/features.js
 * API key resolution + feature gating.
 * Loaded before map.js. Attaches to window.Mahp.
 *
 * Desktop and mobile UI both call Mahp.hasFeature(id) — never hard-code
 * a separate mobile feature list.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  var DEMO_KEY = 'mahp_live_demo_abc123xyz789';

  /**
   * Active client API key from ?api_key= / ?key=.
   * - Explicit key in URL (even if wrong) is used as-is → server rejects invalid ones.
   * - No key in URL → free-tier demo key (intentional public default).
   */
  function getApiKey() {
    try {
      var p = new URLSearchParams(window.location.search);
      var fromUrl = p.get('api_key') || p.get('key');
      if (fromUrl != null) {
        var trimmed = String(fromUrl).trim();
        // Empty ?api_key= still counts as "provided" — send empty so server 403s
        // instead of silently swapping in the demo key.
        return trimmed;
      }
      return DEMO_KEY;
    } catch (_) {
      return DEMO_KEY;
    }
  }

  /** null = unrestricted (no key privileges applied). Array = allow-list. */
  var enabledFeatures = null;

  function hasFeature(id) {
    if (!enabledFeatures) return true;
    return enabledFeatures.indexOf(id) !== -1 || enabledFeatures.indexOf('all') !== -1;
  }

  function setEnabledFeatures(list) {
    enabledFeatures = Array.isArray(list) ? list : null;
  }

  function getEnabledFeatures() {
    return enabledFeatures;
  }

  function hideEl(el) {
    if (el) el.style.display = 'none';
  }

  /**
   * Hide desktop chrome that the current API key does not allow.
   * Safe to call after DOM and config are ready. Mobile shell will add its
   * own gating later using the same hasFeature() checks.
   */
  function applyFeatureFlags(config) {
    var flags = (config && config.appFeatures) || {};
    var locBtn = document.querySelector('.sidebar-nav .nav-item[data-action="location"]');
    if (locBtn && !flags.locationSharing) {
      locBtn.style.display = 'none';
    }

    // Per-API-key allow-list
    if (!enabledFeatures) return;

    var navMap = {
      layers: 'layers',
      saved: 'saved_views',
      recents: 'recents',
      contributions: 'map_edit',
      location: 'trail',
      landmarks: 'nearest_landmark',
      share: 'share_embed',
      sharescreen: 'share_screen',
      missing: 'missing_place',
      business: 'business',
      edit: 'map_edit'
    };
    document.querySelectorAll('.sidebar-nav .nav-item[data-action]').forEach(function (btn) {
      var action = btn.getAttribute('data-action');
      if (action === 'contributions') {
        if (!hasFeature('missing_place') && !hasFeature('business') && !hasFeature('map_edit')) {
          hideEl(btn);
        }
        return;
      }
      var feat = navMap[action];
      if (feat && !hasFeature(feat)) hideEl(btn);
    });

    var toolbarMap = {
      'btn-satellite': 'satellite',
      'btn-3d': 'view_3d',
      'btn-measure': 'measure',
      'btn-area': 'area',
      'btn-mark-area': 'mark_area',
      'btn-route': 'route',
      'btn-group': 'group',
      'btn-freehand': 'freehand',
      'btn-polyline': 'polyline',
      'btn-text': 'text',
      'btn-polygon': 'polygon',
      'btn-fence': 'fence',
      'btn-barricade': 'barricade'
    };
    Object.keys(toolbarMap).forEach(function (id) {
      if (!hasFeature(toolbarMap[id])) hideEl(document.getElementById(id));
    });

    if (!hasFeature('color_palette')) hideEl(document.getElementById('color-palette'));
    if (!hasFeature('search')) {
      hideEl(
        document.getElementById('search-box') ||
          document.querySelector('.search-container') ||
          (document.getElementById('search-input') &&
            document.getElementById('search-input').closest('.search-bar, .map-search, .search-wrap'))
      );
      var si = document.getElementById('search-input');
      if (si) {
        var wrap = si.closest('div');
        if (wrap) hideEl(wrap);
      }
    }
    if (!hasFeature('import_export')) {
      hideEl(document.getElementById('btn-export-layers'));
      hideEl(document.getElementById('btn-import-layers'));
    }
    if (!hasFeature('undo')) {
      hideEl(document.getElementById('btn-undo'));
      hideEl(document.getElementById('btn-redo'));
    }
    // poi_markers / labels gated in their load paths when features restricted
  }

  Mahp.DEMO_KEY = DEMO_KEY;
  Mahp.getApiKey = getApiKey;
  Mahp.hasFeature = hasFeature;
  Mahp.setEnabledFeatures = setEnabledFeatures;
  Mahp.getEnabledFeatures = getEnabledFeatures;
  Mahp.hideEl = hideEl;
  Mahp.applyFeatureFlags = applyFeatureFlags;
})(typeof window !== 'undefined' ? window : globalThis);
