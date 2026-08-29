const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Serve the dev config page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/dev.html'));
});

// Get current style
router.get('/api/style', (req, res) => {
  res.json(req.app.locals.mapStyle);
});

// Update style (colors, icons, features)
router.post('/api/style', (req, res) => {
  try {
    const stylePath = path.join(__dirname, '../../data/map-style.json');
    const current = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
    const updates = req.body;

    if (updates.colors) current.colors = { ...current.colors, ...updates.colors };
    if (updates.icons) current.icons = { ...current.icons, ...updates.icons };
    if (updates.features) current.features = { ...current.features, ...updates.features };
    if (updates.roadWidths) current.roadWidths = { ...current.roadWidths, ...updates.roadWidths };
    if (updates.searchPin) current.searchPin = { ...(current.searchPin || {}), ...updates.searchPin };
    if (updates.poiIcons) current.poiIcons = { ...(current.poiIcons || {}), ...updates.poiIcons };
    if (updates.markedAreas) current.markedAreas = { ...(current.markedAreas || {}), ...updates.markedAreas };
    if (updates.name) current.name = updates.name;

    fs.writeFileSync(stylePath, JSON.stringify(current, null, 2));
    req.app.locals.reloadStyle();
    res.json({ success: true, style: current });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const {
  FEATURE_GROUPS,
  ALL_FEATURE_IDS,
  DEFAULT_FEATURES,
  TIER_PRESETS,
  TIER_ORDER,
  getTierFeatures,
  detectTier,
  normalizeFeatures
} = require('../lib/featureCatalog');

function keysPath() {
  return path.join(__dirname, '../../data/api-keys.json');
}

function writeKeys(data) {
  fs.writeFileSync(keysPath(), JSON.stringify(data, null, 2));
}

// Feature catalog for UI (now includes tier presets)
router.get('/api/feature-catalog', (req, res) => {
  res.json({
    groups: FEATURE_GROUPS,
    allIds: ALL_FEATURE_IDS,
    defaults: DEFAULT_FEATURES,
    tiers: TIER_ORDER.filter(t => t !== 'custom').map(t => ({
      id: t,
      features: TIER_PRESETS[t]
    }))
  });
});

// List API keys
router.get('/api/keys', (req, res) => {
  const data = req.app.locals.reloadKeys();
  const safe = data.keys.map(k => {
    const features = normalizeFeatures(k.features || k.permissions || DEFAULT_FEATURES);
    return {
      ...k,
      features,
      permissions: features, // backward compat
      tier: k.tier || detectTier(features),
      keyPreview: k.key.slice(0, 12) + '...' + k.key.slice(-6),
      featureCount: features.length
    };
  });
  res.json({ keys: safe, catalog: FEATURE_GROUPS, defaults: DEFAULT_FEATURES, tiers: TIER_ORDER });
});

// Single key (full, for edit)
router.get('/api/keys/:id', (req, res) => {
  const data = req.app.locals.reloadKeys();
  const k = data.keys.find(x => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'Key not found' });
  const features = normalizeFeatures(k.features || k.permissions || DEFAULT_FEATURES);
  res.json({
    key: {
      ...k,
      features,
      permissions: features,
      tier: k.tier || detectTier(features)
    }
  });
});

/**
 * Resolve the feature list + tier label to store for a key from a request
 * body. If `tier` is one of the presets, that preset's features win
 * (ignoring any hand-picked `features` sent alongside it). Pass
 * `tier: 'custom'` (or omit tier) with an explicit `features` array to
 * hand-pick per key.
 */
function resolveFeaturesAndTier(body, fallbackFeatures) {
  const tier = body.tier;
  if (tier && tier !== 'custom' && TIER_PRESETS[tier]) {
    return { features: getTierFeatures(tier), tier };
  }
  const featureList = normalizeFeatures(body.features || body.permissions || fallbackFeatures);
  return { features: featureList, tier: 'custom' };
}

// Create new API key
router.post('/api/keys', (req, res) => {
  try {
    const { name, rateLimit, allowedOrigins, active } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const data = req.app.locals.reloadKeys();
    const { features, tier } = resolveFeaturesAndTier(req.body, DEFAULT_FEATURES);
    const newKey = {
      id: uuidv4().slice(0, 8),
      key: 'mahp_live_' + uuidv4().replace(/-/g, '').slice(0, 24),
      name: String(name).slice(0, 120),
      createdAt: new Date().toISOString(),
      active: active !== false,
      tier,
      features,
      permissions: features,
      rateLimit: rateLimit || 1000,
      usage: 0,
      allowedOrigins: Array.isArray(allowedOrigins) ? allowedOrigins : ['*']
    };
    data.keys.push(newKey);
    writeKeys(data);
    res.json({ success: true, key: newKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update key (name, active, features, tier)
router.patch('/api/keys/:id', (req, res) => {
  try {
    const data = req.app.locals.reloadKeys();
    const idx = data.keys.findIndex(k => k.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Key not found' });

    if (typeof req.body.active === 'boolean') {
      data.keys[idx].active = req.body.active;
    }
    if (req.body.name) data.keys[idx].name = String(req.body.name).slice(0, 120);
    if (req.body.tier || req.body.features || req.body.permissions) {
      const current = data.keys[idx].features || data.keys[idx].permissions || DEFAULT_FEATURES;
      const { features, tier } = resolveFeaturesAndTier(req.body, current);
      data.keys[idx].features = features;
      data.keys[idx].permissions = features;
      data.keys[idx].tier = tier;
    }
    if (req.body.rateLimit != null) {
      data.keys[idx].rateLimit = Number(req.body.rateLimit) || 1000;
    }
    if (Array.isArray(req.body.allowedOrigins)) {
      data.keys[idx].allowedOrigins = req.body.allowedOrigins;
    }

    writeKeys(data);
    res.json({ success: true, key: data.keys[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/keys/:id', (req, res) => {
  try {
    const data = req.app.locals.reloadKeys();
    data.keys = data.keys.filter(k => k.id !== req.params.id);
    writeKeys(data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get / update app config (including secret path)
router.get('/api/config', (req, res) => {
  res.json(req.app.locals.appConfig);
});

router.post('/api/config', (req, res) => {
  try {
    const configPath = path.join(__dirname, '../../config/app.json');
    const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const allowed = [
      'devPath', 'mapTitle', 'defaultZoom', 'supportEmail', 'appName',
      'attributionHtml', 'attributionText', 'siteIconUrl', 'features'
    ];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        if (k === 'features' && typeof req.body[k] === 'object' && req.body[k]) {
          current.features = { ...(current.features || {}), ...req.body.features };
        } else {
          current[k] = req.body[k];
        }
      }
    }
    fs.writeFileSync(configPath, JSON.stringify(current, null, 2));
    // Keep in-memory config in sync
    Object.assign(req.app.locals.appConfig, current);
    if (current.features) req.app.locals.appConfig.features = current.features;
    res.json({
      success: true,
      config: current,
      note: 'Changing devPath requires a server restart to apply the new route. Attribution and site icon apply on map refresh.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Place category friendly labels (used by Nearest landmark panel + API)
const categoryLabelsPath = path.join(__dirname, '../../data/place-category-labels.json');
const placesPaths = [
  path.join(__dirname, '../../data/places.json'),
  path.join(__dirname, '../../data/placess.json')
];

function loadPlaceTypesFromDisk() {
  for (const p of placesPaths) {
    try {
      if (!fs.existsSync(p)) continue;
      const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!Array.isArray(arr)) continue;
      const counts = {};
      arr.forEach(x => {
        const t = String((x && x.type) || 'place');
        counts[t] = (counts[t] || 0) + 1;
      });
      return counts;
    } catch (_) {}
  }
  return {};
}

router.get('/api/place-categories', (req, res) => {
  let labels = {};
  try {
    if (fs.existsSync(categoryLabelsPath)) {
      labels = JSON.parse(fs.readFileSync(categoryLabelsPath, 'utf8'));
    }
  } catch (_) {}
  const counts = loadPlaceTypesFromDisk();
  const categories = Object.keys(counts).sort().map(id => ({
    id,
    label: labels[id] || id.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    count: counts[id],
    custom: !!labels[id]
  }));
  res.json({ categories, labels });
});

router.post('/api/place-categories', (req, res) => {
  try {
    const labels = (req.body && req.body.labels) || {};
    if (typeof labels !== 'object' || Array.isArray(labels)) {
      return res.status(400).json({ error: 'labels object required' });
    }
    // Keep only string values
    const clean = {};
    Object.keys(labels).forEach(k => {
      const v = labels[k];
      if (v != null && String(v).trim()) clean[String(k)] = String(v).trim().slice(0, 80);
    });
    fs.writeFileSync(categoryLabelsPath, JSON.stringify(clean, null, 2));
    res.json({ success: true, labels: clean });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
