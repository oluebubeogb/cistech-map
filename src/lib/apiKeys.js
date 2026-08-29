const path = require('path');
const fs = require('fs');
const { normalizeFeatures, DEFAULT_FEATURES } = require('./featureCatalog');

const KEYS_PATH = path.join(__dirname, '../../data/api-keys.json');

function loadKeys() {
  try {
    return JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
  } catch (e) {
    return { keys: [] };
  }
}

function saveKeys(data) {
  fs.writeFileSync(KEYS_PATH, JSON.stringify(data, null, 2));
}

function keyFromRequest(req) {
  const raw =
    req.headers['x-api-key'] ||
    req.query.api_key ||
    req.query.key ||
    null;
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
}

/** True when the client explicitly supplied a key param/header (even if empty/invalid). */
function keyWasProvided(req) {
  if (req.headers['x-api-key'] != null && String(req.headers['x-api-key']).length > 0) return true;
  if (Object.prototype.hasOwnProperty.call(req.query || {}, 'api_key')) return true;
  if (Object.prototype.hasOwnProperty.call(req.query || {}, 'key')) return true;
  return false;
}

function findActiveKey(rawKey) {
  if (!rawKey) return null;
  const data = loadKeys();
  return data.keys.find(k => k.key === rawKey && k.active) || null;
}

/** Resolve the requesting key + its normalized feature list, without side effects. */
function resolveKeyFeatures(req) {
  const key = keyFromRequest(req);
  if (!key) return { key: null, features: null, valid: false, tier: null };
  const found = findActiveKey(key);
  if (!found) return { key, features: null, valid: false, tier: null };
  const features = normalizeFeatures(found.features || found.permissions || DEFAULT_FEATURES);
  return {
    key,
    features,
    valid: true,
    tier: found.tier || null,
    keyMeta: { id: found.id, name: found.name, tier: found.tier || null }
  };
}

/** Express middleware: require a valid API key on the request. */
function validateApiKey(req, res, next) {
  const key = keyFromRequest(req);
  if (!key) {
    return res.status(401).json({
      error: 'API key required',
      message: 'Provide X-API-Key header or api_key query parameter',
      docs: '/api/docs'
    });
  }

  const data = loadKeys();
  const found = data.keys.find(k => k.key === key && k.active);
  if (!found) {
    return res.status(403).json({ error: 'Invalid or inactive API key' });
  }

  found.usage = (found.usage || 0) + 1;
  try { saveKeys(data); } catch (e) { /* ignore write errors for demo */ }

  req.apiKey = found;
  req.apiKeyFeatures = normalizeFeatures(found.features || found.permissions || DEFAULT_FEATURES);
  next();
}

/**
 * Enforce that the requesting key includes at least one of the given feature
 * ids. Pass a single id or an array (any-of match) — useful when a route is
 * reachable both as a first-party UI feature (e.g. "search") and as a raw
 * headless API feature (e.g. "api_search"), since either grant should work.
 * Only enforced when an API key is actually present on the request, so
 * server-to-server/internal calls without a key are unaffected.
 */
function requireKeyFeature(featureIds) {
  const ids = Array.isArray(featureIds) ? featureIds : [featureIds];
  return (req, res, next) => {
    const key = keyFromRequest(req);
    if (!key) return next();
    const features = req.apiKeyFeatures || resolveKeyFeatures(req).features || [];
    const ok = features.includes('all') || ids.some(id => features.includes(id));
    if (!ok) {
      return res.status(403).json({
        error: 'Feature not allowed for this API key',
        feature: ids.length === 1 ? ids[0] : ids
      });
    }
    next();
  };
}

module.exports = {
  KEYS_PATH,
  loadKeys,
  saveKeys,
  keyFromRequest,
  keyWasProvided,
  findActiveKey,
  resolveKeyFeatures,
  validateApiKey,
  requireKeyFeature
};
