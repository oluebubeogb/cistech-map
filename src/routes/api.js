const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const {
  validateApiKey,
  resolveKeyFeatures,
  requireKeyFeature,
  keyWasProvided
} = require('../lib/apiKeys');

// Public style endpoint (used by frontend)
router.get('/style', validateApiKey, requireKeyFeature(['map', 'api_style']), (req, res) => {
  const style = req.app.locals.mapStyle;
  res.json(style);
});

// ---------- Mark Area (frontend "mark an area" tool) ----------
// Looks up a named area's boundary on demand so end users can outline places
// like "Lagos West" themselves from the map UI. Checks the local HDX/OCHA
// boundary data first (states, senatorial districts — same auth as /search
// and /distance) and only falls back to Nominatim for names not covered
// locally, since Nominatim's public instance can silently return zero
// results for server-side callers.
const { findLocalBoundary, searchLocalBoundaries, getLocalBoundaryById } = require('../lib/localBoundaries');

// Autocomplete suggestions as the user types in the Mark Area box — local
// data only (no Nominatim call per keystroke). Deliberately returns multiple
// matches across levels so e.g. "Ikeja" can show both the LGA and the city.
router.get('/area-suggest', validateApiKey, requireKeyFeature(['mark_area', 'api_search']), (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  const limit = Math.min(parseInt(req.query.limit, 10) || 8, 20);
  res.json(searchLocalBoundaries(q, limit));
});

// Fetches the full boundary (with geometry) for a specific suggestion once
// the user clicks it — suggestions themselves stay lightweight (no geometry)
// so typing feels instant.
router.get('/area-boundary/:id', validateApiKey, requireKeyFeature(['mark_area', 'api_search']), (req, res) => {
  const item = getLocalBoundaryById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

const areaSearchCache = new Map(); // lowercase query -> { name, display_name, geojson }
const AREA_SEARCH_CACHE_MAX = 200;
const NOMINATIM_USER_AGENT = 'MahpMapFrontend/1.0 (admin@collab.name.ng)';

router.get('/area-search', validateApiKey, requireKeyFeature(['mark_area', 'api_search']), async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'q (place name) is required' });
    }

    const local = findLocalBoundary(q);
    if (local) {
      return res.json({ name: local.name, display_name: local.name, geojson: local.geometry, source: 'local', level: local.level });
    }

    const cacheKey = q.toLowerCase();
    if (areaSearchCache.has(cacheKey)) {
      return res.json(areaSearchCache.get(cacheKey));
    }

    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=1` +
      `&email=admin%40collab.name.ng&q=${encodeURIComponent(q)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' }
    });

    const rawBody = await resp.text();
    if (!resp.ok) {
      console.error(`[area-search] Nominatim ${resp.status} for "${q}":`, rawBody.slice(0, 300));
      throw new Error(`Nominatim ${resp.status}`);
    }

    let results;
    try {
      results = JSON.parse(rawBody);
    } catch (parseErr) {
      console.error(`[area-search] Non-JSON response for "${q}":`, rawBody.slice(0, 300));
      throw new Error('Nominatim returned an unexpected response');
    }

    if (!results.length) {
      // Log the raw body too: a genuine "no match" and a silent block/rate-limit
      // both show up as an empty array here, so this is the only way to tell
      // them apart after the fact — check server logs if well-known places
      // like this keep coming back empty.
      console.warn(`[area-search] 0 results for "${q}". Raw response:`, rawBody.slice(0, 300));
      return res.status(404).json({ error: `No place found for "${q}". Try adding a state/country, e.g. "Ikeja, Lagos, Nigeria".` });
    }

    const match = results[0];
    if (!match.geojson || (match.geojson.type !== 'Polygon' && match.geojson.type !== 'MultiPolygon')) {
      return res.status(422).json({ error: `"${match.display_name}" doesn't have an area boundary available (it may only be a point). Try a more specific query.` });
    }

    const result = { name: match.display_name, display_name: match.display_name, geojson: match.geojson, source: 'nominatim' };

    if (areaSearchCache.size >= AREA_SEARCH_CACHE_MAX) {
      areaSearchCache.delete(areaSearchCache.keys().next().value); // evict oldest
    }
    areaSearchCache.set(cacheKey, result);

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generate MapLibre-compatible style (simplified for demo using free tiles)
router.get('/maplibre-style', validateApiKey, requireKeyFeature(['map', 'api_style']), (req, res) => {
  const s = req.app.locals.mapStyle;
  const colors = s.colors;

  // A practical MapLibre style based on OpenFreeMap / Protomaps free tiles
  // Using a known free vector tile source for demo
  const style = {
    version: 8,
    name: s.name || 'Mahp Modern',
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'openmaptiles': {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet'
      }
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': colors.background }
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': colors.water }
      },
      {
        id: 'landcover-forest',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', 'class', 'forest'],
        paint: { 'fill-color': colors.forest, 'fill-opacity': 0.55 }
      },
      {
        id: 'landcover-grass',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', 'class', 'grass', 'park'],
        paint: { 'fill-color': colors.park, 'fill-opacity': 0.5 }
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        paint: { 'fill-color': colors.land, 'fill-opacity': 0.35 }
      },
      // Buildings
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-color': colors.building,
          'fill-opacity': 0.75,
          'fill-outline-color': colors.building_outline
        }
      },
      // Roads - thicker modern look
      {
        id: 'road-path',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'path', 'track', 'footway'],
        paint: {
          'line-color': colors.road_path,
          'line-width': { base: 1.2, stops: [[13, 1], [18, 3]] }
        }
      },
      {
        id: 'road-street-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'minor', 'service', 'street'],
        paint: {
          'line-color': colors.road_street_casing,
          'line-width': {
            base: 1.4,
            stops: [[12, 2], [14, 5], [16, 9], [18, 16]]
          },
          'line-opacity': 0.9
        }
      },
      {
        id: 'road-street',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'minor', 'service', 'street'],
        paint: {
          'line-color': colors.road_street,
          'line-width': {
            base: 1.3,
            stops: [[12, 1], [14, 3], [16, 6], [18, 12]]
          }
        }
      },
      {
        id: 'road-secondary-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'secondary', 'tertiary'],
        paint: {
          'line-color': colors.road_secondary_casing,
          'line-width': {
            base: 1.4,
            stops: [[10, 2], [13, 5], [16, 12], [18, 20]]
          }
        }
      },
      {
        id: 'road-secondary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'secondary', 'tertiary'],
        paint: {
          'line-color': colors.road_secondary,
          'line-width': {
            base: 1.3,
            stops: [[10, 1.2], [13, 3.5], [16, 9], [18, 16]]
          }
        }
      },
      {
        id: 'road-primary-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'primary', 'trunk', 'motorway'],
        paint: {
          'line-color': colors.road_major_casing,
          'line-width': {
            base: 1.5,
            stops: [[8, 2], [12, 6], [15, 14], [18, 26]]
          }
        }
      },
      {
        id: 'road-primary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'primary', 'trunk', 'motorway'],
        paint: {
          'line-color': colors.road_major,
          'line-width': {
            base: 1.4,
            stops: [[8, 1.5], [12, 4], [15, 10], [18, 20]]
          }
        }
      },
      // Labels
      {
        id: 'place-labels',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': { stops: [[10, 12], [14, 16]] },
          'text-font': ['Noto Sans Regular']
        },
        paint: {
          'text-color': colors.label_text,
          'text-halo-color': colors.label_halo,
          'text-halo-width': 1.5
        }
      },
      {
        id: 'road-labels',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'symbol-placement': 'line',
          'text-font': ['Noto Sans Regular']
        },
        paint: {
          'text-color': colors.label_text,
          'text-halo-color': colors.label_halo,
          'text-halo-width': 1.2
        }
      }
    ]
  };

  res.json(style);
});

// Config for frontend (center, features etc.)
// Pass ?api_key= to receive enabledFeatures for that key (enforced UI).
// Any explicit key (including empty / whitespace / unknown) must be valid —
// never silently fall through to unrestricted or free-tier features.
router.get('/config', (req, res) => {
  const cfg = req.app.locals.appConfig;
  const style = req.app.locals.mapStyle;
  const appFeatures = cfg.features || {};
  const resolved = resolveKeyFeatures(req);

  if (keyWasProvided(req) && !resolved.valid) {
    return res.status(403).json({ error: 'Invalid or inactive API key' });
  }

  res.json({
    center: cfg.defaultCenter,
    zoom: cfg.defaultZoom,
    title: cfg.mapTitle,
    appName: cfg.appName,
    icons: style.icons,
    features: style.features,
    appFeatures: {
      locationSharing: !!appFeatures.locationSharing
    },
    // null = unrestricted (no api_key on request). Array = allow-list for this key.
    enabledFeatures: resolved.valid ? resolved.features : null,
    apiKey: resolved.valid
      ? { id: resolved.keyMeta.id, name: resolved.keyMeta.name, tier: resolved.keyMeta.tier || resolved.tier }
      : null,
    tier: resolved.valid ? (resolved.tier || resolved.keyMeta.tier || null) : null,
    searchPin: style.searchPin || { color: '#2563eb', size: 28 },
    markedAreas: style.markedAreas || { colors: ['#e11d48', '#2563eb', '#16a34a'], maxAreas: 3 },
    attributionHtml: cfg.attributionHtml || null,
    attributionText: cfg.attributionText || null,
    siteIconUrl: cfg.siteIconUrl || null
  });
});

// ---------- Places index ----------
const placesPaths = [
  path.join(__dirname, '../../data/places.json'),
  path.join(__dirname, '../../data/placess.json')
];
const categoryLabelsPath = path.join(__dirname, '../../data/place-category-labels.json');
let placesCache = null;
let categoryLabelsCache = null;

function loadPlaces() {
  if (!placesCache) {
    placesCache = [];
    for (const p of placesPaths) {
      try {
        if (fs.existsSync(p)) {
          placesCache = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (!Array.isArray(placesCache)) placesCache = [];
          console.log('Loaded places index:', placesCache.length, 'from', path.basename(p));
          break;
        }
      } catch (e) {
        console.warn('places load failed', p, e.message);
      }
    }
  }
  return placesCache;
}

function loadCategoryLabels() {
  if (categoryLabelsCache) return categoryLabelsCache;
  try {
    if (fs.existsSync(categoryLabelsPath)) {
      categoryLabelsCache = JSON.parse(fs.readFileSync(categoryLabelsPath, 'utf8'));
    } else {
      categoryLabelsCache = {};
    }
  } catch (_) {
    categoryLabelsCache = {};
  }
  return categoryLabelsCache;
}

function saveCategoryLabels(obj) {
  categoryLabelsCache = obj || {};
  fs.writeFileSync(categoryLabelsPath, JSON.stringify(categoryLabelsCache, null, 2));
}

function friendlyCategory(type, labels) {
  const t = String(type || 'place');
  if (labels && labels[t]) return labels[t];
  // Title-case fallback: hospital → Hospital, fuel → Fuel
  return t.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Walking ~5 km/h → minutes */
function walkMinutes(km) {
  return Math.max(1, Math.round((km / 5) * 60));
}

// Search using places index
router.get('/search', validateApiKey, requireKeyFeature(['search', 'api_search']), (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q || q.length < 2) return res.json({ query: q, results: [] });

  const places = loadPlaces();
  const results = places
    .filter(p => {
      const name = (p.name || '').toLowerCase();
      const display = (p.display_name || '').toLowerCase();
      return name.includes(q) || display.includes(q);
    })
    .slice(0, 12)
    .map(p => ({
      name: p.display_name || p.name,
      type: p.type || 'place',
      lat: p.lat,
      lon: p.lon
    }));

  res.json({ query: q, results });
});

// GeoJSON of places for map label overlay
router.get('/places-geojson', validateApiKey, requireKeyFeature(['poi_markers', 'api_style']), (req, res) => {
  const places = loadPlaces();
  // Limit payload size for browser performance
  const features = places.slice(0, 50000).map(p => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: {
      name: p.name,
      type: p.type || 'place',
      display_name: p.display_name || p.name
    }
  }));
  res.json({ type: 'FeatureCollection', features });
});

// Distance calculation (Haversine)
router.get('/distance', validateApiKey, requireKeyFeature(['measure', 'api_distance']), (req, res) => {
  const { lat1, lon1, lat2, lon2 } = req.query;
  if (!lat1 || !lon1 || !lat2 || !lon2) {
    return res.status(400).json({ error: 'lat1, lon1, lat2, lon2 required' });
  }
  const km = haversineKm(+lat1, +lon1, +lat2, +lon2);
  res.json({
    distance_km: Math.round(km * 100) / 100,
    distance_m: Math.round(km * 1000),
    from: { lat: +lat1, lon: +lon1 },
    to: { lat: +lat2, lon: +lon2 }
  });
});

/**
 * Trail API — independent endpoint for apps that record GPS points.
 * POST body: { points: [[lon,lat],...] | [{lon,lat}|{lng,lat}], min_step_m?: number }
 * Returns simplified trail, distance, and estimated walk duration.
 */
router.post('/trail', validateApiKey, requireKeyFeature(['trail', 'api_trail']), (req, res) => {
  const raw = (req.body && req.body.points) || [];
  if (!Array.isArray(raw) || raw.length < 1) {
    return res.status(400).json({ error: 'points array required ([[lon,lat], ...] or [{lat,lon}])' });
  }
  const minStepM = Math.max(1, Number(req.body.min_step_m) || 6);
  const normalized = [];
  raw.forEach(p => {
    let lon, lat;
    if (Array.isArray(p) && p.length >= 2) {
      lon = Number(p[0]); lat = Number(p[1]);
    } else if (p && typeof p === 'object') {
      lon = Number(p.lon != null ? p.lon : p.lng);
      lat = Number(p.lat);
    }
    if (isNaN(lon) || isNaN(lat)) return;
    normalized.push([lon, lat]);
  });
  const coords = [];
  normalized.forEach(pt => {
    if (!coords.length) {
      coords.push(pt);
      return;
    }
    const prev = coords[coords.length - 1];
    const dKm = haversineKm(prev[1], prev[0], pt[1], pt[0]);
    if (dKm * 1000 >= minStepM) coords.push(pt);
  });
  let distKm = 0;
  for (let i = 1; i < coords.length; i++) {
    distKm += haversineKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  res.json({
    coordinates: coords,
    point_count: coords.length,
    distance_km: Math.round(distKm * 1000) / 1000,
    distance_m: Math.round(distKm * 1000),
    duration_min_walk: walkMinutes(distKm),
    min_step_m: minStepM
  });
});

/** List place categories found in the index (+ friendly labels). */
router.get('/landmarks/categories', validateApiKey, requireKeyFeature(['nearest_landmark', 'api_landmarks', 'api_search']), (req, res) => {
  const places = loadPlaces();
  const labels = loadCategoryLabels();
  const counts = {};
  places.forEach(p => {
    const t = String(p.type || 'place');
    counts[t] = (counts[t] || 0) + 1;
  });
  const categories = Object.keys(counts).sort().map(id => ({
    id,
    label: friendlyCategory(id, labels),
    count: counts[id]
  }));
  res.json({ categories, labels });
});

/**
 * Nearest landmarks from places index.
 * Query: lat, lon required; category (optional, default all); q (optional search);
 * limit (default 25, max 25).
 */
router.get('/landmarks/nearest', validateApiKey, requireKeyFeature(['nearest_landmark', 'api_landmarks']), (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon required' });
  }
  const category = (req.query.category || req.query.type || 'all').toLowerCase().trim();
  const q = (req.query.q || '').toLowerCase().trim();
  let limit = parseInt(req.query.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 25;
  limit = Math.min(25, limit);

  const places = loadPlaces();
  const labels = loadCategoryLabels();
  const scored = [];
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    if (p.lat == null || p.lon == null) continue;
    const type = String(p.type || 'place');
    if (category && category !== 'all' && type.toLowerCase() !== category) continue;
    if (q) {
      const name = (p.name || '').toLowerCase();
      const display = (p.display_name || '').toLowerCase();
      if (!name.includes(q) && !display.includes(q) && !type.toLowerCase().includes(q)) continue;
    }
    const km = haversineKm(lat, lon, +p.lat, +p.lon);
    scored.push({
      name: p.name,
      display_name: p.display_name || p.name,
      type,
      type_label: friendlyCategory(type, labels),
      lat: +p.lat,
      lon: +p.lon,
      distance_km: Math.round(km * 1000) / 1000,
      distance_m: Math.round(km * 1000),
      duration_min_walk: walkMinutes(km),
      state: p.state || null,
      city: p.city || null
    });
  }
  scored.sort((a, b) => a.distance_km - b.distance_km);
  res.json({
    from: { lat, lon },
    category: category || 'all',
    query: q || null,
    count: Math.min(limit, scored.length),
    results: scored.slice(0, limit)
  });
});

// Real route via public OSRM (fallback to straight line if OSRM unreachable)
router.get('/route', validateApiKey, requireKeyFeature(['route', 'api_route']), async (req, res) => {
  const { from_lat, from_lon, to_lat, to_lon } = req.query;
  if (!from_lat || !from_lon || !to_lat || !to_lon) {
    return res.status(400).json({ error: 'from_lat, from_lon, to_lat, to_lon required' });
  }
  const aLon = +from_lon, aLat = +from_lat, bLon = +to_lon, bLat = +to_lat;
  const straight = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[aLon, aLat], [bLon, bLat]] },
    properties: { distance_km: null, duration_min: null, note: 'Straight-line fallback' }
  };
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${aLon},${aLat};${bLon},${bLat}?overview=full&geometries=geojson`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mahp-Maps/1.0' } });
    clearTimeout(timer);
    if (!resp.ok) return res.json(straight);
    const data = await resp.json();
    const route = data.routes && data.routes[0];
    if (!route || !route.geometry) return res.json(straight);
    const distance_km = Math.round((route.distance / 1000) * 100) / 100;
    const duration_min = Math.round((route.duration / 60) * 10) / 10;
    res.json({
      type: 'Feature',
      geometry: route.geometry,
      coordinates: route.geometry.coordinates,
      properties: { distance_km, duration_min, note: 'OSRM driving route' },
      distance_km,
      duration_min
    });
  } catch (e) {
    res.json(straight);
  }
});

// ---------- User submissions (missing place / business / map edit) ----------
const submissionsPath = path.join(__dirname, '../../data/submissions.json');

function readSubmissions() {
  try {
    const raw = fs.readFileSync(submissionsPath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function writeSubmissions(list) {
  fs.writeFileSync(submissionsPath, JSON.stringify(list, null, 2));
}

// Submit a missing place / business / edit — requires a key with the matching
// contribution feature. Which specific feature is required depends on the
// submission type so a key can allow e.g. "report a missing place" without
// allowing full map edits.
const SUBMISSION_TYPE_FEATURE = {
  missing_place: 'missing_place',
  business: 'business',
  map_edit: 'map_edit'
};
router.post('/submissions', validateApiKey, (req, res, next) => {
  const type = (req.body && req.body.type) || 'missing_place';
  const feature = SUBMISSION_TYPE_FEATURE[type] || 'missing_place';
  return requireKeyFeature(feature)(req, res, next);
}, (req, res) => {
  const body = req.body || {};
  if (!body.name || typeof body.name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  const list = readSubmissions();
  const entry = {
    id: body.id || uuidv4(),
    type: body.type || 'missing_place',
    name: String(body.name).trim(),
    description: String(body.description || '').trim(),
    category: String(body.category || 'general'),
    lat: body.lat != null ? Number(body.lat) : null,
    lon: body.lon != null ? Number(body.lon) : null,
    status: 'pending',
    userId: body.userId || null,
    ts: body.ts || Date.now(),
    reviewedAt: null,
    reviewedBy: null
  };
  list.unshift(entry);
  writeSubmissions(list.slice(0, 500));
  res.status(201).json(entry);
});

// List submissions (optional filter by userId or status)
router.get('/submissions', (req, res) => {
  let list = readSubmissions();
  if (req.query.userId) list = list.filter(s => s.userId === req.query.userId);
  if (req.query.status) list = list.filter(s => s.status === req.query.status);
  res.json({ submissions: list, total: list.length });
});

// Admin: approve / reject
router.patch('/submissions/:id', (req, res) => {
  const list = readSubmissions();
  const idx = list.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const status = (req.body && req.body.status) || '';
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved, rejected, or pending' });
  }
  list[idx].status = status;
  list[idx].reviewedAt = Date.now();
  list[idx].reviewedBy = (req.body && req.body.reviewedBy) || 'admin';
  writeSubmissions(list);
  res.json(list[idx]);
});

// ---------- Share Screen (collaborative region; state shared with WebSocket hub) ----------
const shareHub = require('../lib/shareScreenHub');

// Create requires enterprise feature share_screen_create.
// Optional seedItems: pre-drawn features inside the region go into the durable bucket.
router.post('/share-screen', validateApiKey, requireKeyFeature('share_screen_create'), (req, res) => {
  const { name, geometry, ownerId, seedItems } = req.body || {};
  if (!name || !geometry || geometry.type !== 'Polygon') {
    return res.status(400).json({ error: 'name and Polygon geometry required' });
  }
  const { screen, conf } = shareHub.createScreen(
    { name, geometry, ownerId, seedItems: Array.isArray(seedItems) ? seedItems : [] },
    req.app.locals.appConfig
  );
  res.json({
    id: screen.id,
    name: screen.name,
    geometry: screen.geometry,
    expiresAt: screen.expiresAt,
    passcode: screen.passcode,
    items: [...screen.items.values()],
    config: conf
  });
});

// Join by passcode (3 digits + 3 letters). Available to any tier with share_screen.
router.post('/share-screen/join-by-code', validateApiKey, requireKeyFeature(['share_screen', 'share_screen_create']), (req, res) => {
  const nums = String((req.body && req.body.nums) || '').trim();
  const letters = String((req.body && req.body.letters) || '').trim();
  const combined = (req.body && req.body.passcode) || (nums + ' ' + letters);
  const got = shareHub.findByPasscode(combined, req.app.locals.appConfig);
  if (!got) return res.status(404).json({ error: 'No active share screen for that code' });
  res.json(shareHub.snapshot(got.screen, got.conf));
});

router.get('/share-screen/:id', (req, res) => {
  const got = shareHub.getScreen(req.params.id, req.app.locals.appConfig);
  if (!got) return res.status(404).json({ error: 'Share screen not found or expired' });
  // Owner may request passcode via ?include_pass=1
  const includePass = req.query.include_pass === '1' || req.query.include_pass === 'true';
  res.json(shareHub.snapshot(got.screen, got.conf, { includePasscode: includePass }));
});

router.post('/share-screen/:id/presence', (req, res) => {
  const got = shareHub.getScreen(req.params.id, req.app.locals.appConfig);
  if (!got) return res.status(410).json({ error: 'Share screen expired' });
  const { userId, lat, lon, name, trail } = req.body || {};
  if (!userId || lat == null || lon == null) {
    return res.status(400).json({ error: 'userId, lat, lon required' });
  }
  // Presence only — does not mutate the content bucket
  shareHub.applyPresence(got.screen, { userId, lat, lon, name, trail });
  shareHub.broadcast(got.screen, shareHub.snapshot(got.screen, got.conf));
  res.json({ ok: true });
});

// Upsert items into the durable session bucket
router.post('/share-screen/:id/content', (req, res) => {
  const got = shareHub.getScreen(req.params.id, req.app.locals.appConfig);
  if (!got) return res.status(410).json({ error: 'Share screen expired' });
  const { userId, items } = req.body || {};
  if (!userId || !Array.isArray(items)) {
    return res.status(400).json({ error: 'userId and items[] required' });
  }
  shareHub.upsertItems(got.screen, userId, items);
  shareHub.broadcast(got.screen, shareHub.snapshot(got.screen, got.conf));
  res.json({ ok: true, items: [...got.screen.items.values()] });
});

// Delete own items from the bucket
router.post('/share-screen/:id/content/delete', (req, res) => {
  const got = shareHub.getScreen(req.params.id, req.app.locals.appConfig);
  if (!got) return res.status(410).json({ error: 'Share screen expired' });
  const { userId, itemIds } = req.body || {};
  if (!userId || !Array.isArray(itemIds)) {
    return res.status(400).json({ error: 'userId and itemIds[] required' });
  }
  shareHub.deleteItems(got.screen, userId, itemIds);
  shareHub.broadcast(got.screen, shareHub.snapshot(got.screen, got.conf));
  res.json({ ok: true, items: [...got.screen.items.values()] });
});

router.post('/share-screen/:id/extend', (req, res) => {
  const got = shareHub.getScreen(req.params.id, req.app.locals.appConfig);
  if (!got) return res.status(404).json({ error: 'Not found' });
  const ownerId = (req.body && req.body.ownerId) || null;
  const expiresAt = shareHub.extendScreen(got.screen, ownerId, req.app.locals.appConfig);
  if (expiresAt == null) return res.status(403).json({ error: 'Only the sharer can extend' });
  shareHub.broadcast(got.screen, shareHub.snapshot(got.screen, got.conf));
  res.json({ expiresAt });
});

// Docs
router.get('/docs', (req, res) => {
  res.json({
    name: 'Mahp Map API',
    version: '1.0',
    authentication: 'Header: X-API-Key  or  Query: ?api_key=YOUR_KEY',
    endpoints: {
      'GET /api/config': 'Public map configuration',
      'GET /api/style': 'Current style colors & icons',
      'GET /api/maplibre-style': 'Full MapLibre style JSON',
      'GET /api/search?q=...': 'Search places (requires key)',
      'GET /api/distance?lat1=&lon1=&lat2=&lon2=': 'Haversine distance (requires key)',
      'GET /api/route?from_lat=&from_lon=&to_lat=&to_lon=': 'Simple route (requires key)',
      'POST /api/submissions': 'Submit missing place / business / edit',
      'GET /api/submissions': 'List submissions',
      'PATCH /api/submissions/:id': 'Approve or reject submission',
      'POST /api/share-screen': 'Create a share screen (name + Polygon geometry)',
      'GET /api/share-screen/:id': 'Join / poll a share screen',
      'POST /api/share-screen/:id/presence': 'Update location + items in screen',
      'POST /api/share-screen/:id/extend': 'Extend expiry (owner)',
      'POST /api/trail': 'Simplify GPS points into a trail (distance, walk mins)',
      'GET /api/landmarks/categories': 'Place categories + friendly labels',
      'GET /api/landmarks/nearest?lat=&lon=&category=&q=&limit=25': 'Nearest landmarks (max 25)',
      'GET /embed?api_key=&features=...': 'Embeddable map'
    },
    features_param: 'search,zoom,routes,menu,measure,fullscreen (comma separated). Omit for full UI.',
    example: 'curl -H "X-API-Key: mahp_live_demo_abc123xyz789" "http://localhost:3847/api/search?q=umuahia"'
  });
});

module.exports = router;
