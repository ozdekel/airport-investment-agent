#!/usr/bin/env node
/**
 * Rebuilds src/data/datasets/airports.index.json from OurAirports.
 *
 * Run with:  npm run build:data
 *
 * The generated file is committed to the repo on purpose. It is the product's
 * floor: every live API can be unreachable and the agent still knows what
 * airports exist, where they are and how much runway they have. Committing it
 * also means `git clone && npm install && npm run dev` works with no network
 * dependency beyond the app itself.
 *
 * Source: https://ourairports.com/data/ (public domain, rebuilt nightly)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/datasets/airports.index.json');
const BASE = 'https://davidmegginson.github.io/ourairports-data';

const CONTINENTS = {
  AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe',
  NA: 'North America', OC: 'Oceania', SA: 'South America',
};

/** Minimal RFC-4180 CSV parser - enough for OurAirports, no dependency needed. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function fetchCsv(name) {
  process.stdout.write(`  fetching ${name}... `);
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const rows = parseCsv(await res.text());
  console.log(`${rows.length.toLocaleString()} rows`);
  return rows;
}

console.log('Rebuilding the airport index from OurAirports...');

const [airports, runways, countries] = await Promise.all([
  fetchCsv('airports.csv'),
  fetchCsv('runways.csv'),
  fetchCsv('countries.csv'),
]);

// --- aggregate runways per airport --------------------------------------
const PAVED = ['ASP', 'CON', 'PEM', 'BIT', 'TAR'];
const rw = new Map();
for (const r of runways) {
  if (r.closed === '1') continue;
  const key = r.airport_ident;
  const agg = rw.get(key) ?? { count: 0, maxLengthFt: 0, totalLengthFt: 0, pavedCount: 0, lightedCount: 0 };
  const len = Number.parseInt(r.length_ft || '0', 10) || 0;
  agg.count += 1;
  agg.maxLengthFt = Math.max(agg.maxLengthFt, len);
  agg.totalLengthFt += len;
  if (PAVED.some((p) => (r.surface || '').toUpperCase().includes(p))) agg.pavedCount += 1;
  if (r.lighted === '1') agg.lightedCount += 1;
  rw.set(key, agg);
}

const countryByCode = new Map(countries.map((c) => [c.code, c]));

// --- build the index -----------------------------------------------------
// Filter: commercial airports only. Scoring a private strip against Heathrow
// would be noise, and it keeps the bundled file around 1MB.
const index = {};
for (const a of airports) {
  if (a.type !== 'large_airport' && a.type !== 'medium_airport') continue;
  if (a.scheduled_service !== 'yes') continue;

  const iata = (a.iata_code || '').trim().toUpperCase();
  if (iata.length !== 3) continue;

  const country = countryByCode.get(a.iso_country);
  const runwayAgg = rw.get(a.ident) ?? rw.get(a.icao_code) ?? { count: 0, maxLengthFt: 0, totalLengthFt: 0, pavedCount: 0, lightedCount: 0 };

  index[iata] = {
    iata,
    icao: (a.icao_code || a.ident).trim().toUpperCase(),
    name: a.name,
    city: a.municipality || null,
    countryCode: a.iso_country,
    country: country?.name ?? a.iso_country,
    continent: CONTINENTS[country?.continent ?? a.continent] ?? 'Unknown',
    lat: Number.parseFloat(a.latitude_deg),
    lon: Number.parseFloat(a.longitude_deg),
    elevationFt: a.elevation_ft ? Number.parseInt(a.elevation_ft, 10) : null,
    size: a.type === 'large_airport' ? 'large' : 'medium',
    runways: runwayAgg,
  };
}

const payload = {
  meta: {
    source: 'OurAirports (ourairports.com) - public domain',
    snapshotDate: new Date().toISOString(),
    airportCount: Object.keys(index).length,
    filter: 'type in (large_airport, medium_airport) AND scheduled_service = yes AND valid IATA code',
  },
  airports: index,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload));

const large = Object.values(index).filter((x) => x.size === 'large').length;
console.log(`\nWrote ${Object.keys(index).length.toLocaleString()} airports (${large.toLocaleString()} large) to ${OUT}`);
