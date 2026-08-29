// Local admin-boundary lookup, sourced from HDX/OCHA's Nigeria COD-AB dataset
// (data.humdata.org). Lets "Mark Area" resolve countries, states, senatorial
// districts, LGAs, wards, and named settlements straight from disk — no
// external geocoder, no rate limits, no dependence on Nominatim not
// soft-blocking our server's IP.
//
// Drop-in support for more levels: export the layer to
// data/boundaries/<file>.geojson with at least { name, geometry } properties
// (plus pcode/state/lga where relevant), add it to LAYER_FILES below, and
// optionally give it a friendly label in LEVEL_LABELS. Nothing else needs to
// change — search and lookup-by-id both walk LAYER_FILES generically.

const fs = require('fs');
const path = require('path');

const BOUNDARIES_DIR = path.join(__dirname, '../../data/boundaries');

// Order matters for tie-breaking: earlier entries win when a query matches
// more than one layer equally well — e.g. "Federal Capital Territory" is the
// exact name of both the state and the one senatorial district covering it;
// the broader level should win that tie. Files that don't exist yet (e.g.
// nationwide wards) are just skipped, no error.
const LAYER_FILES = [
  { file: 'country.geojson', level: 'country' },
  { file: 'states.geojson', level: 'state' },
  { file: 'senatorial-districts.geojson', level: 'senatorial_district' },
  { file: 'lgas.geojson', level: 'lga' },
  { file: 'wards.geojson', level: 'ward' },
  { file: 'settlements.geojson', level: 'settlement' } // points — cities/towns, not areas
];

// Friendly labels for the "Name — Level" suggestion UI. Anything not listed
// here just falls back to a capitalized version of its level string, so new
// levels (e.g. a future "estate" layer) work without a code change.
const LEVEL_LABELS = {
  country: 'Country',
  state: 'State',
  senatorial_district: 'Senatorial District',
  lga: 'LGA',
  ward: 'Ward',
  settlement: 'City'
};

function labelFor(level) {
  return LEVEL_LABELS[level] || (level.charAt(0).toUpperCase() + level.slice(1)).replace(/_/g, ' ');
}

let cache = null; // [{ id, name, nameLower, pcode, level, state, lga, geometry }]

function normalize(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadAll() {
  if (cache) return cache;

  const features = [];
  for (const { file, level } of LAYER_FILES) {
    const filePath = path.join(BOUNDARIES_DIR, file);
    if (!fs.existsSync(filePath)) continue; // not uploaded yet — fine, skip

    try {
      const fc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      (fc.features || []).forEach(f => {
        const p = f.properties || {};
        if (!p.name || !f.geometry) return;
        features.push({
          id: String(features.length), // stable for this process's lifetime; re-assigned on reload
          name: p.name,
          nameLower: normalize(p.name),
          pcode: p.pcode || null,
          level: p.level || level,
          state: p.state || null,
          lga: p.lga || null,
          geometry: f.geometry
        });
      });
    } catch (e) {
      console.error(`[localBoundaries] Failed to load ${file}:`, e.message);
    }
  }

  cache = features;
  return cache;
}

// Clears the in-memory cache so newly-added boundary files (e.g. after
// uploading LGAs/wards) are picked up without a server restart.
function reloadLocalBoundaries() {
  cache = null;
  return loadAll();
}

// Finds the single best match for a free-text query (used by the legacy
// /area-search direct-hit endpoint). Exact name match wins; else the
// shortest name that starts with the query; else the shortest name
// containing it. Preferring shorter names keeps e.g. "Lagos" resolving to
// the state rather than accidentally matching a longer, unrelated name that
// contains it.
function findLocalBoundary(query) {
  const q = normalize(query);
  if (!q) return null;

  const all = loadAll();

  const exact = all.find(f => f.nameLower === q);
  if (exact) return exact;

  const startsWith = all
    .filter(f => f.nameLower.startsWith(q))
    .sort((a, b) => a.name.length - b.name.length);
  if (startsWith.length) return startsWith[0];

  const contains = all
    .filter(f => f.nameLower.includes(q))
    .sort((a, b) => a.name.length - b.name.length);
  if (contains.length) return contains[0];

  return null;
}

// Returns up to `limit` matches across every level, for the Mark Area
// autocomplete dropdown — deliberately does NOT dedupe by name, so a query
// like "Ikeja" can surface the LGA and the settlement (city) as separate,
// clearly-labeled suggestions for the user to pick between. Ranked by
// exact > starts-with > contains, then shorter names first within each tier.
function searchLocalBoundaries(query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];

  const all = loadAll();
  const scored = [];
  for (const f of all) {
    if (f.nameLower === q) scored.push({ f, rank: 0 });
    else if (f.nameLower.startsWith(q)) scored.push({ f, rank: 1 });
    else if (f.nameLower.includes(q)) scored.push({ f, rank: 2 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.f.name.length - b.f.name.length);

  return scored.slice(0, limit).map(({ f }) => ({
    id: f.id,
    name: f.name,
    level: f.level,
    levelLabel: labelFor(f.level),
    state: f.state,
    lga: f.lga
  }));
}

// Fetches the full record (including geometry) for a specific suggestion,
// once the user has actually clicked it.
function getLocalBoundaryById(id) {
  const all = loadAll();
  const f = all.find(x => x.id === String(id));
  if (!f) return null;
  return {
    id: f.id,
    name: f.name,
    level: f.level,
    levelLabel: labelFor(f.level),
    state: f.state,
    lga: f.lga,
    geometry: f.geometry
  };
}

module.exports = {
  findLocalBoundary,
  searchLocalBoundaries,
  getLocalBoundaryById,
  reloadLocalBoundaries,
  LEVEL_LABELS
};
