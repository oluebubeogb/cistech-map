/**
 * In-memory share-screen state + durable content bucket + WebSocket fan-out.
 *
 * Presence (name, lat/lon, online) is ephemeral.
 * Content items live for the lifetime of the share session and are persisted
 * under data/share-buckets/{screenId}.json so they survive disconnects and
 * short server restarts.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const shareScreens = new Map(); // id -> screen
// screen: { id, name, geometry, ownerId, expiresAt, passcode, users, items, sockets, createdAt }

const BUCKET_DIR = path.join(__dirname, '../../data/share-buckets');

function ensureBucketDir() {
  try {
    if (!fs.existsSync(BUCKET_DIR)) fs.mkdirSync(BUCKET_DIR, { recursive: true });
  } catch (_) {}
}

function bucketPath(screenId) {
  // sanitize id to filename
  const safe = String(screenId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return path.join(BUCKET_DIR, safe + '.json');
}

function persistBucket(screen) {
  if (!screen || !screen.id) return;
  ensureBucketDir();
  try {
    const payload = {
      id: screen.id,
      name: screen.name,
      ownerId: screen.ownerId,
      expiresAt: screen.expiresAt,
      passcode: screen.passcode,
      geometry: screen.geometry,
      updatedAt: Date.now(),
      items: [...screen.items.values()]
    };
    fs.writeFileSync(bucketPath(screen.id), JSON.stringify(payload, null, 2));
  } catch (e) {
    console.warn('share-bucket write failed', screen.id, e.message);
  }
}

function loadBucket(screenId) {
  try {
    const p = bucketPath(screenId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function deleteBucketFile(screenId) {
  try {
    const p = bucketPath(screenId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
}

function getConfig(appConfig) {
  const cfg = (appConfig && appConfig.shareScreen) || {};
  return {
    maxDurationMinutes: Number(cfg.maxDurationMinutes) || 120,
    extendMinutes: Number(cfg.extendMinutes) || 60,
    userIconSize: Number(cfg.userIconSize) || 28,
    pollMs: Number(cfg.pollMs) || 2500,
    presenceTtlMs: Number(cfg.presenceTtlMs) || 30000
  };
}

function removeScreen(id) {
  const s = shareScreens.get(id);
  if (s) {
    broadcast(s, { type: 'expired' });
    closeAll(s);
    shareScreens.delete(id);
  }
  deleteBucketFile(id);
}

function prune(appConfig) {
  const now = Date.now();
  for (const [id, s] of shareScreens) {
    if (s.expiresAt && s.expiresAt < now) {
      removeScreen(id);
    }
  }
}

/** Generate join pass: 3 digits + space + 3 letters (case-insensitive). e.g. "204 kjg" */
function generatePasscode() {
  const nums = String(Math.floor(100 + Math.random() * 900)); // 100–999
  const letters = Array.from({ length: 3 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
  return nums + ' ' + letters;
}

function normalizePasscode(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  const m = s.match(/^(\d{3})\s*[-\s]?([a-z]{3})$/);
  if (!m) return null;
  return m[1] + ' ' + m[2];
}

function itemKey(userId, itemId) {
  return String(userId) + ':' + String(itemId);
}

function normalizeItem(it, userId) {
  if (!it || !it.id || !it.geojson) return null;
  return {
    id: String(it.id),
    type: it.type || 'feature',
    geojson: it.geojson,
    props: it.props || {},
    userId: userId || it.userId || null,
    name: it.name || it.props?.name || null,
    updatedAt: Date.now()
  };
}

/**
 * Upsert items into the session bucket. Does NOT remove other items for this user.
 * Returns { added, updated }.
 */
function upsertItems(screen, userId, items) {
  if (!screen || !userId || !Array.isArray(items)) return { added: 0, updated: 0 };
  let added = 0;
  let updated = 0;
  items.forEach(raw => {
    const it = normalizeItem(raw, userId);
    if (!it) return;
    const key = itemKey(userId, it.id);
    if (screen.items.has(key)) updated += 1;
    else added += 1;
    screen.items.set(key, it);
  });
  if (added || updated) persistBucket(screen);
  return { added, updated };
}

/**
 * Delete specific item ids for a user. Only that user's items.
 */
function deleteItems(screen, userId, itemIds) {
  if (!screen || !userId || !Array.isArray(itemIds)) return { removed: 0 };
  let removed = 0;
  itemIds.forEach(id => {
    const key = itemKey(userId, id);
    if (screen.items.delete(key)) removed += 1;
  });
  if (removed) persistBucket(screen);
  return { removed };
}

/**
 * Seed the bucket with items already on the creator's map that fall inside
 * the share region (pre-draw before going live).
 */
function seedItems(screen, userId, items) {
  return upsertItems(screen, userId, items);
}

function createScreen({ name, geometry, ownerId, seedItems: seed }, appConfig) {
  prune(appConfig);
  const conf = getConfig(appConfig);
  const id = crypto.randomBytes(6).toString('hex');
  const expiresAt = Date.now() + conf.maxDurationMinutes * 60 * 1000;
  const passcode = generatePasscode();
  const screen = {
    id,
    name: String(name).slice(0, 120),
    geometry,
    ownerId: ownerId || null,
    expiresAt,
    passcode,
    users: new Map(),
    items: new Map(),
    sockets: new Set(),
    createdAt: Date.now()
  };
  shareScreens.set(id, screen);
  if (Array.isArray(seed) && seed.length && ownerId) {
    seedItems(screen, ownerId, seed);
  } else {
    persistBucket(screen);
  }
  return { screen, conf };
}

function findByPasscode(raw, appConfig) {
  prune(appConfig);
  const norm = normalizePasscode(raw);
  if (!norm) return null;
  for (const screen of shareScreens.values()) {
    if (screen.expiresAt < Date.now()) continue;
    if (normalizePasscode(screen.passcode) === norm) {
      return { screen, conf: getConfig(appConfig) };
    }
  }
  return null;
}

function getScreen(id, appConfig) {
  prune(appConfig);
  let screen = shareScreens.get(id);
  // Recover from disk after process restart
  if (!screen) {
    const disk = loadBucket(id);
    if (disk && disk.expiresAt > Date.now()) {
      screen = {
        id: disk.id,
        name: disk.name,
        geometry: disk.geometry,
        ownerId: disk.ownerId || null,
        expiresAt: disk.expiresAt,
        passcode: disk.passcode || null,
        users: new Map(),
        items: new Map(),
        sockets: new Set(),
        createdAt: disk.createdAt || Date.now()
      };
      (disk.items || []).forEach(it => {
        if (!it || !it.id || !it.userId) return;
        screen.items.set(itemKey(it.userId, it.id), it);
      });
      shareScreens.set(id, screen);
    }
  }
  if (!screen) return null;
  if (screen.expiresAt < Date.now()) {
    removeScreen(id);
    return null;
  }
  const conf = getConfig(appConfig);
  const now = Date.now();
  for (const [uid, u] of screen.users) {
    if (now - (u.updatedAt || 0) > conf.presenceTtlMs) screen.users.delete(uid);
  }
  return { screen, conf };
}

function snapshot(screen, conf, { includePasscode } = {}) {
  const out = {
    type: 'state',
    id: screen.id,
    name: screen.name,
    geometry: screen.geometry,
    ownerId: screen.ownerId,
    expiresAt: screen.expiresAt,
    config: conf || {},
    users: [...screen.users.values()].map(u => ({
      userId: u.userId,
      name: u.name,
      lat: u.lat,
      lon: u.lon,
      trail: Array.isArray(u.trail) ? u.trail : null,
      updatedAt: u.updatedAt
    })),
    items: [...screen.items.values()]
  };
  // Always expose join code to participants so anyone on the session can invite others
  if (screen.passcode) out.passcode = screen.passcode;
  else if (includePasscode && screen.passcode) out.passcode = screen.passcode;
  return out;
}

/** Presence only — does not touch the content bucket. Optional trail path. */
function applyPresence(screen, { userId, lat, lon, name, trail }) {
  if (!userId) return;
  const prev = screen.users.get(userId) || {};
  let trailCoords = prev.trail || null;
  if (Array.isArray(trail) && trail.length) {
    trailCoords = trail.slice(-800).map(c => {
      if (!Array.isArray(c) || c.length < 2) return null;
      return [Number(c[0]), Number(c[1])];
    }).filter(Boolean);
  }
  screen.users.set(userId, {
    userId,
    name: name || prev.name || 'User',
    lat: lat != null ? Number(lat) : (prev.lat != null ? prev.lat : null),
    lon: lon != null ? Number(lon) : (prev.lon != null ? prev.lon : null),
    trail: trailCoords,
    updatedAt: Date.now()
  });
}

function extendScreen(screen, ownerId, appConfig) {
  if (screen.ownerId && ownerId && screen.ownerId !== ownerId) return null;
  const conf = getConfig(appConfig);
  const base = Math.max(Date.now(), screen.expiresAt || Date.now());
  screen.expiresAt = base + conf.extendMinutes * 60 * 1000;
  persistBucket(screen);
  return screen.expiresAt;
}

function broadcast(screen, payload, exceptWs) {
  const data = JSON.stringify(payload);
  for (const ws of screen.sockets) {
    if (ws === exceptWs) continue;
    if (ws.readyState === 1) {
      try { ws.send(data); } catch (_) {}
    }
  }
}

function closeAll(screen) {
  for (const ws of screen.sockets) {
    try { ws.close(); } catch (_) {}
  }
  screen.sockets.clear();
}

function attachSocket(screen, ws) {
  screen.sockets.add(ws);
}

function detachSocket(screen, ws) {
  screen.sockets.delete(ws);
}

module.exports = {
  shareScreens,
  BUCKET_DIR,
  getConfig,
  prune,
  createScreen,
  getScreen,
  findByPasscode,
  generatePasscode,
  normalizePasscode,
  snapshot,
  applyPresence,
  upsertItems,
  deleteItems,
  seedItems,
  persistBucket,
  extendScreen,
  broadcast,
  attachSocket,
  detachSocket,
  removeScreen
};
