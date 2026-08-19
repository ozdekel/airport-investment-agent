#!/usr/bin/env node
/**
 * Connectivity diagnostic. Run with:  npm run diagnose
 *
 * Checks each data tier independently and prints exactly what came back, so a
 * degraded demo can be traced to a specific provider in seconds instead of
 * being guessed at from the UI.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env.local loader - no dotenv dependency needed for a script.
try {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { console.log('(no .env.local found)\n'); }

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;

const HOUR = 3600;
const end = Math.floor(Date.now() / 1000) - 26 * HOUR;
const begin = end - 24 * HOUR;

console.log('AeroInvest connectivity diagnostic');
console.log('='.repeat(60));
console.log(`Sampling window: ${new Date(begin * 1000).toISOString()} -> ${new Date(end * 1000).toISOString()}\n`);

// ---------- Tier A: OpenSky ------------------------------------------------
console.log('TIER A - OpenSky Network');

let token = null;
if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET) {
  try {
    const r = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.OPENSKY_CLIENT_ID,
        client_secret: process.env.OPENSKY_CLIENT_SECRET,
      }),
    });
    if (r.ok) { token = (await r.json()).access_token; console.log(`  auth:            ${ok('OK - authenticated (4000 credits/day)')}`); }
    else console.log(`  auth:            ${bad(`FAILED HTTP ${r.status}`)} - falling back to anonymous`);
  } catch (e) { console.log(`  auth:            ${bad(String(e.message))}`); }
} else {
  console.log(`  auth:            ${warn('anonymous (no credentials set - 400 credits/day)')}`);
}

for (const [iata, icao] of [['TLV', 'LLBG'], ['LHR', 'EGLL'], ['JFK', 'KJFK'], ['DXB', 'OMDB']]) {
  const url = `https://opensky-network.org/api/flights/departure?airport=${icao}&begin=${begin}&end=${end}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const ms = Date.now() - t0;
    const body = await res.text();

    if (!res.ok) {
      console.log(`  ${iata}/${icao}:      ${bad(`HTTP ${res.status}`)} in ${ms}ms  ${body.slice(0, 120)}`);
      continue;
    }
    if (!body.trim()) { console.log(`  ${iata}/${icao}:      ${warn('empty body')} in ${ms}ms - no coverage in this window`); continue; }

    const flights = JSON.parse(body);
    const dests = new Set(flights.map((f) => f.estArrivalAirport).filter(Boolean));
    const carriers = new Set(flights.map((f) => (f.callsign || '').trim().slice(0, 3)).filter(Boolean));
    console.log(`  ${iata}/${icao}:      ${ok(`${flights.length} departures`)} in ${ms}ms, ${dests.size} resolvable destinations, ${carriers.size} carriers`);
  } catch (e) {
    console.log(`  ${iata}/${icao}:      ${bad(String(e.message))}`);
  }
}

// ---------- Tier A: AviationStack -----------------------------------------
console.log('\nTIER A - AviationStack');
if (!process.env.AVIATION_API_KEY) {
  console.log(`  ${bad('no AVIATION_API_KEY - every metric falls back to a class-based estimate')}`);
} else {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

  for (const iata of ['TLV', 'LHR', 'BOS']) {
    for (const date of [yesterday, null]) {
      const label = date ? `${iata} @ ${date}` : `${iata} undated  `;
      const url = `http://api.aviationstack.com/v1/flights?access_key=${process.env.AVIATION_API_KEY}&dep_iata=${iata}&limit=100${date ? `&flight_date=${date}` : ''}`;
      try {
        const j = await (await fetch(url)).json();
        if (j.error) { console.log(`  ${label}: ${bad(j.error.message || j.error.info || j.error.code)}`); continue; }

        const raw = j.data || [];
        // Physical departures only: the provider emits one record per marketing
        // carrier, so a single aeroplane can appear four or five times.
        const flights = raw.filter((f) => f.flight?.codeshared == null);
        const operatingShare = raw.length ? flights.length / raw.length : 0;
        const total = j.pagination?.total ?? 0;
        const statuses = {};
        const dates = new Set();
        let withDelay = 0;
        for (const f of flights) {
          statuses[f.flight_status || 'null'] = (statuses[f.flight_status || 'null'] || 0) + 1;
          if (f.flight_date) dates.add(f.flight_date);
          if (typeof f.departure?.delay === 'number') withDelay++;
        }
        // The figure the engine now uses: departures per day inferred from the
        // sample's own time span, rather than the provider's unusable total.
        const times = flights.map((f) => Date.parse(f.departure?.scheduled)).filter(Number.isFinite).sort((a, b) => a - b);
        const spanH = times.length > 1 ? (times[times.length - 1] - times[0]) / 3600000 : 0;
        const rate = spanH >= 0.75 && spanH <= 24 && times.length >= 10
          ? Math.round(((times.length - 1) / spanH) * 24)
          : null;
        const timed = flights.filter((f) => f.departure?.scheduled && (f.departure?.actual || f.departure?.estimated)).length;

        const statusStr = Object.entries(statuses).map(([k, v]) => `${k}:${v}`).join(' ');
        const pad = ' '.repeat(label.length);
        console.log(`  ${label}: providerRecords=${total} sample=${raw.length} operating=${flights.length} (${(operatingShare * 100).toFixed(0)}%) dates=${dates.size} timed=${timed} [${statusStr}]`);
        console.log(`  ${pad}  floor (sample density, ${spanH.toFixed(1)}h span): ${rate === null ? bad('UNKNOWN') : `${rate}/day`}`);

        // The figure the engine actually uses: one extra request for the LAST
        // record tells us how many days pagination.total covers.
        const firstDate = [...dates].sort()[0];
        if (total > flights.length * 2 && firstDate) {
          const probeUrl = `http://api.aviationstack.com/v1/flights?access_key=${process.env.AVIATION_API_KEY}&dep_iata=${iata}&limit=1&offset=${total - 1}`;
          try {
            const pj = await (await fetch(probeUrl)).json();
            const lastDate = pj.data?.[0]?.flight_date;
            if (!lastDate) {
              console.log(`  ${pad}  window probe: ${bad('no dated record returned')}`);
            } else {
              const days = Math.abs(Date.parse(lastDate) - Date.parse(firstDate)) / 86400000 + 1;
              const physical = Math.round(total * operatingShare);
              const daily = Math.round(physical / days);
              console.log(`  ${pad}  window probe: ${firstDate} -> ${lastDate} = ${days.toFixed(0)} days`);
              console.log(`  ${pad}  ${total} records x ${(operatingShare * 100).toFixed(0)}% operating = ${physical} physical flights / ${days.toFixed(0)}d`);
              console.log(`  ${pad}  ENGINE USES:  ${ok(`${daily} departures/day`)}`);
            }
          } catch (e) {
            console.log(`  ${pad}  window probe: ${bad(String(e.message))}`);
          }
        }
      } catch (e) {
        console.log(`  ${label}: ${bad(String(e.message))}`);
      }
    }
  }
  console.log(warn('\n  Sanity-check the ENGINE USES line against reality:'));
  console.log(warn('    LHR ~650/day   BOS ~600/day   TLV ~250/day'));
  console.log(warn('  The "floor" line is the sample-density estimate, kept only as a fallback -'));
  console.log(warn('  it under-counts busy airports because the 100-record page is a thinned'));
  console.log(warn('  slice of its window rather than a complete one.'));
  console.log(warn('  "operating" excludes codeshare listings - the provider emits one record'));
  console.log(warn('  per marketing carrier, so one aeroplane can appear four or five times.'));
  console.log(warn('  "timed" is how many records carry both scheduled and actual times; that is'));
  console.log(warn('  the punctuality sample, since the provider delay field itself is empty.'));
  console.log(warn('  NOTE: this run spends ~9 of your 100 monthly AviationStack requests.'));
}

// ---------- LLM: OpenRouter ------------------------------------------------
console.log('\nLLM - OpenRouter');
if (!process.env.OPENROUTER_API_KEY) {
  console.log(`  ${bad('no OPENROUTER_API_KEY - intent falls back to rules, narration to templates')}`);
} else {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    const ids = new Set((await r.json()).data.map((m) => m.id));
    for (const id of ['google/gemini-3.7-flash', 'google/gemini-3.6-flash', 'google/gemini-3.5-flash-lite', 'openai/gpt-5.6-luna']) {
      console.log(`  ${id.padEnd(30)} ${ids.has(id) ? ok('available') : bad('NOT SERVED')}`);
    }

    const t0 = Date.now();
    const c = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL_REASONING || 'google/gemini-3.7-flash',
        messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
        max_tokens: 2000,
      }),
    });
    const cj = await c.json();
    if (cj.error) console.log(`  live call:                     ${bad(cj.error.message)}`);
    else {
      const text = cj.choices?.[0]?.message?.content?.trim();
      const finish = cj.choices?.[0]?.finish_reason;
      console.log(`  live call:                     ${text ? ok(`"${text}"`) : bad('empty completion')} in ${Date.now() - t0}ms, finish_reason=${finish}`);
      console.log(`  tokens:                        prompt=${cj.usage?.prompt_tokens} completion=${cj.usage?.completion_tokens}${cj.usage?.completion_tokens_details?.reasoning_tokens ? ` (reasoning=${cj.usage.completion_tokens_details.reasoning_tokens})` : ''}`);
    }
  } catch (e) { console.log(`  ${bad(String(e.message))}`); }
}

console.log('\n' + '='.repeat(60));
console.log('Tier A (AviationStack) is the primary live source. Tier A+ (OpenSky)');
console.log('only supplies growth momentum and needs free credentials - without');
console.log('them that pillar is excluded and its weight redistributed.');
