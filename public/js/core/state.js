/**
 * core/state.js
 * Shared application state and constants.
 * Loaded before map.js. Attaches to window.Mahp.state.
 *
 * Phase-1 note: map.js still keeps local closed-over variables for zero
 * behavior change. New modules should read/write Mahp.state instead.
 * Later extractions will migrate locals onto this object.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  /** LocalStorage keys */
  var LS = {
    SAVED: 'mahp_saved_views',
    RECENTS: 'mahp_recents',
    CONTRIBUTIONS: 'mahp_contributions',
    USER_ID: 'mahp_user_id',
    USER_NAME: 'mahp_user_name'
  };

  /** Layer opacity is stored 0–0.8; UI shows 0–80. */
  var MAX_LAYER_OPACITY = 0.8;
  var DEFAULT_LAYER_OPACITY = 0.8;

  var HISTORY_MAX = 50;

  /** Satellite tiles stop here; labels force-show 2 zooms before. */
  var SAT_MAX_ZOOM = 17;
  var LABEL_FORCE_ZOOM = SAT_MAX_ZOOM - 2;

  var DRAW_TEMP_SOURCE_ID = 'user-draw-temp';

  var TRAIL_LOCAL_SRC = 'trail-local-src';
  var TRAIL_REMOTE_SRC = 'trail-remote-src';

  /**
   * Mutable runtime state.
   * map.js still owns parallel locals during the transition; keep this in sync
   * when extracting modules so mobile UI can share one source of truth.
   */
  var state = {
    // MapLibre instance (set after bootstrap)
    map: null,

    // Config / style metadata from /api/config + /api/style
    iconsConfig: {},
    searchPinConfig: {
      color: '#2563eb',
      size: 32,
      borderColor: '#ffffff',
      borderWidth: 3
    },
    poiIconsConfig: null,

    // Search / POI
    searchMarker: null,
    poiMarkers: [],

    // Mark area
    markedAreas: [],
    markedAreaColors: ['#e11d48', '#2563eb', '#16a34a'],
    maxMarkedAreas: 3,

    // User layers
    userLayers: [],
    activeLayerId: null,
    labelsOnTop: true,
    expandedLayers: null, // Set — created below

    // Drawing
    currentTool: null, // 'freehand' | 'polyline' | 'polygon' | 'text' | 'fence' | 'barricade' | null
    drawCoords: [],
    isDrawing: false,
    selectedItemIds: null, // Set
    activeColor: '#1a73e8',
    clickMarker: null,
    pendingTextLngLat: null,
    textMarkers: [],
    fenceIconsReady: false,

    // Measure
    measureMode: false,
    measurePoints: [],
    measureMarkers: [],
    measureLine: null,

    // Undo / redo
    historyStack: [],
    historyIndex: -1,

    // Transform (move / resize)
    isMovingItems: false,
    moveStartLngLat: null,
    moveSnapshot: null,
    isResizingItems: false,
    resizeStartLngLat: null,
    resizeCentroid: null,
    resizeSnapshot: null,

    // Nav panel
    activeNavAction: null,

    // Share screen (session-level flags; full AV state still in map.js until extracted)
    shareScreenMode: false,
    shareScreenCoords: [],
    activeShareScreen: null,
    shareScreenFullscreen: false,

    // Movement trail
    trail: {
      status: 'idle', // 'idle' | 'confirming' | 'tracking' | 'paused'
      coords: [],
      watchId: null,
      confirmMarker: null,
      pinMarker: null,
      lastAccuracy: null,
      shareMode: false,
      minStepM: 6
    },
    remoteTrails: {}
  };

  state.expandedLayers = new Set();
  state.selectedItemIds = new Set();

  Mahp.LS = LS;
  Mahp.MAX_LAYER_OPACITY = MAX_LAYER_OPACITY;
  Mahp.DEFAULT_LAYER_OPACITY = DEFAULT_LAYER_OPACITY;
  Mahp.HISTORY_MAX = HISTORY_MAX;
  Mahp.SAT_MAX_ZOOM = SAT_MAX_ZOOM;
  Mahp.LABEL_FORCE_ZOOM = LABEL_FORCE_ZOOM;
  Mahp.DRAW_TEMP_SOURCE_ID = DRAW_TEMP_SOURCE_ID;
  Mahp.TRAIL_LOCAL_SRC = TRAIL_LOCAL_SRC;
  Mahp.TRAIL_REMOTE_SRC = TRAIL_REMOTE_SRC;
  Mahp.state = state;
})(typeof window !== 'undefined' ? window : globalThis);
