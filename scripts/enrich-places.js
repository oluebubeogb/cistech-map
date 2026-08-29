#!/usr/bin/env node
/**
 * Enrich places.json with reverse-geocoded city / state for disambiguation.
 *
 * Usage (from project root or scripts folder):
 *   node scripts/enrich-places.js [path/to/places.json]
 *
 * Respects Nominatim usage policy (~1 request / second).
 * Saves progress every 50 items so you can stop and resume.
 */

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2] || path.join(__dirname, '../data/places.json');
const OUTPUT = inputPath; // overwrite in place (backup first)

const DELAY_MS = 1100; // Nominatim: max 1 req/sec
const USER_AGENT = 'MahpMapEnricher/1.0 (admin@collab.name.ng)';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function reverseGeocode(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}` +
    `&zoom=14&addressdetails=1`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  });

  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

function buildDisplayName(place, address) {
  const parts = [];

  // Original name (street / poi / place)
  parts.push(place.name);

  // Locality hierarchy
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.suburb ||
    address.county ||
    address.city_district;

  const state = address.state || address.region;

  if (city && !place.name.toLowerCase().includes(String(city).toLowerCase())) {
    parts.push(city);
  }
  if (state && !parts.some(p => String(p).toLowerCase() === String(state).toLowerCase())) {
    parts.push(state);
  }

  parts.push('Nigeria');
  return parts.filter(Boolean).join(', ');
}

async function main() {
  if (!fs.existsSync(inputPath)) {
    console.error('File not found:', inputPath);
    process.exit(1);
  }

  // Backup
  const bak = inputPath + '.bak';
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(inputPath, bak);
    console.log('Backup written:', bak);
  }

  let places = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  console.log('Loaded', places.length, 'places');

  // Skip already enriched (have city/state-like display_name with more than "Name, Nigeria")
  let done = 0;
  let enriched = 0;
  let errors = 0;

  for (let i = 0; i < places.length; i++) {
    const p = places[i];

    // Heuristic: already enriched if display_name has 3+ comma-separated parts
    const parts = (p.display_name || '').split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      done++;
      continue;
    }

    try {
      const data = await reverseGeocode(p.lat, p.lon);
      const address = data.address || {};
      p.display_name = buildDisplayName(p, address);
      if (address.state) p.state = address.state;
      if (address.city || address.town || address.village) {
        p.city = address.city || address.town || address.village;
      }
      enriched++;
      process.stdout.write(
        `\r[${i + 1}/${places.length}] +${enriched}  ${p.display_name.slice(0, 60)}…   `
      );
    } catch (e) {
      errors++;
      if (errors <= 5) console.warn('\nError:', e.message);
      // keep original display_name
    }

    // Checkpoint every 50
    if (enriched > 0 && enriched % 50 === 0) {
      fs.writeFileSync(OUTPUT, JSON.stringify(places, null, 2));
      console.log(`\nCheckpoint saved (${enriched} new)`);
    }

    await sleep(DELAY_MS);
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(places, null, 2));
  console.log('\n\nDone.');
  console.log('Already ok :', done);
  console.log('Newly enriched:', enriched);
  console.log('Errors     :', errors);
  console.log('Output     :', OUTPUT);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
