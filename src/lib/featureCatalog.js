/**
 * Canonical feature groups for API keys & embed privileges.
 * Selecting a group selects all features in it; individuals can be toggled.
 */
const FEATURE_GROUPS = [
  {
    id: 'basemap',
    name: 'Basemap & view',
    description: 'Map display, satellite, 3D, labels',
    features: [
      { id: 'map', label: 'Base map' },
      { id: 'satellite', label: 'Satellite toggle' },
      { id: 'view_3d', label: '3D view' },
      { id: 'zoom', label: 'Zoom controls' },
      { id: 'geolocate', label: 'My location' },
      { id: 'scale', label: 'Scale bar' },
      { id: 'labels', label: 'Place & street labels' },
      { id: 'poi_markers', label: 'POI markers' }
    ]
  },
  {
    id: 'search_nav',
    name: 'Search & navigation',
    description: 'Find places and return to views',
    features: [
      { id: 'search', label: 'Search' },
      { id: 'recents', label: 'Recents' },
      { id: 'saved_views', label: 'Saved views' },
      { id: 'trail', label: 'Movement trail' },
      { id: 'nearest_landmark', label: 'Nearest landmarks' }
    ]
  },
  {
    id: 'drawing',
    name: 'Drawing tools',
    description: 'Annotate the map',
    features: [
      { id: 'freehand', label: 'Freehand' },
      { id: 'polyline', label: 'Polyline' },
      { id: 'polygon', label: 'Polygon' },
      { id: 'text', label: 'Text' },
      { id: 'fence', label: 'Fence' },
      { id: 'barricade', label: 'Barricade' },
      { id: 'color_palette', label: 'Color palette' }
    ]
  },
  {
    id: 'analysis',
    name: 'Measure & analysis',
    description: 'Distance, area, routes, mark area',
    features: [
      { id: 'measure', label: 'Measure' },
      { id: 'area', label: 'Area' },
      { id: 'mark_area', label: 'Mark area' },
      { id: 'route', label: 'Route' }
    ]
  },
  {
    id: 'layers',
    name: 'Layers',
    description: 'Organize and edit drawings',
    features: [
      { id: 'layers', label: 'User layers' },
      { id: 'group', label: 'Group / ungroup' },
      { id: 'undo', label: 'Undo / redo' },
      { id: 'import_export', label: 'Import / export' },
      { id: 'line_edit', label: 'Straighten / curve' }
    ]
  },
  {
    id: 'share',
    name: 'Share & sessions',
    description: 'Links, embed, live share screen',
    features: [
      { id: 'share_embed', label: 'Share or embed map' },
      { id: 'share_screen', label: 'Join share screen' },
      { id: 'share_screen_create', label: 'Create share screen' },
      { id: 'share_screen_av', label: 'Share screen voice & video' }
    ]
  },
  {
    id: 'contributions',
    name: 'Contributions',
    description: 'Community submissions',
    features: [
      { id: 'missing_place', label: 'Add missing place' },
      { id: 'business', label: 'Add business' },
      { id: 'map_edit', label: 'Edit the map' }
    ]
  },
  {
    id: 'api',
    name: 'API access',
    description: 'Server endpoints for clients',
    features: [
      { id: 'api_style', label: 'Style API' },
      { id: 'api_search', label: 'Search API' },
      { id: 'api_route', label: 'Route API' },
      { id: 'api_distance', label: 'Distance API' },
      { id: 'api_trail', label: 'Trail API' },
      { id: 'api_landmarks', label: 'Nearest landmarks API' },
      { id: 'embed', label: 'Embed map' }
    ]
  }
];

const ALL_FEATURE_IDS = FEATURE_GROUPS.flatMap(g => g.features.map(f => f.id));

const DEFAULT_FEATURES = [
  'map', 'zoom', 'search', 'embed', 'api_search', 'api_route', 'api_distance', 'api_style'
];

/**
 * Tiered presets for paying clients. A key's `tier` decides its feature set;
 * `tier: 'custom'` means the feature list was hand-picked and should not be
 * overwritten by a preset.
 */
const TIER_PRESETS = {
  // Free + Pro: join share screen & AV call; only Enterprise may create
  free: [
    'map', 'zoom', 'geolocate', 'scale', 'labels', 'poi_markers',
    'search', 'recents', 'trail', 'nearest_landmark',
    'satellite',
    'route', 'api_route',
    'share_embed', 'embed',
    'share_screen', 'share_screen_av',
    'api_style', 'api_search', 'api_trail', 'api_landmarks'
  ],
  pro: ALL_FEATURE_IDS.filter(id => id !== 'share_screen_create'),
  enterprise: ALL_FEATURE_IDS.slice()
};

const TIER_ORDER = ['free', 'pro', 'enterprise', 'custom'];

function getTierFeatures(tier) {
  return TIER_PRESETS[tier] ? TIER_PRESETS[tier].slice() : null;
}

/** Given a feature list, guess which tier (if any) it matches exactly. */
function detectTier(list) {
  const set = new Set(list || []);
  for (const tier of ['enterprise', 'pro', 'free']) {
    const preset = TIER_PRESETS[tier];
    if (preset.length === set.size && preset.every(id => set.has(id))) return tier;
  }
  return 'custom';
}

function normalizeFeatures(list) {
  if (!Array.isArray(list)) return DEFAULT_FEATURES.slice();
  if (list.includes('all') || list.includes('*')) return ALL_FEATURE_IDS.slice();
  const set = new Set(list.filter(id => ALL_FEATURE_IDS.includes(id)));
  return [...set];
}

function groupHasAll(selected, group) {
  const ids = group.features.map(f => f.id);
  return ids.every(id => selected.includes(id));
}

function groupHasSome(selected, group) {
  const ids = group.features.map(f => f.id);
  return ids.some(id => selected.includes(id)) && !groupHasAll(selected, group);
}

module.exports = {
  FEATURE_GROUPS,
  ALL_FEATURE_IDS,
  DEFAULT_FEATURES,
  TIER_PRESETS,
  TIER_ORDER,
  getTierFeatures,
  detectTier,
  normalizeFeatures,
  groupHasAll,
  groupHasSome
};
