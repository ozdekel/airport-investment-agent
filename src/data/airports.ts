/**
 * TIER B - the structural layer.
 *
 * A nightly snapshot of OurAirports (public domain), pre-processed into an
 * IATA-keyed index at build time. Bundled in the repo on purpose: it means the
 * product has a floor. Every live API can be down and the agent still knows
 * what airports exist, where they are, and how much runway they have.
 */

import indexJson from './datasets/airports.index.json';
import { AirportProfile } from '@/core/types';

interface IndexFile {
  meta: { source: string; snapshotDate: string; airportCount: number; filter: string };
  airports: Record<string, AirportProfile>;
}

const INDEX = indexJson as unknown as IndexFile;

export const DATASET_META = INDEX.meta;

const BY_IATA = INDEX.airports;
const BY_ICAO: Record<string, AirportProfile> = {};
for (const a of Object.values(BY_IATA)) if (a.icao) BY_ICAO[a.icao] = a;

export function getByIata(code: string): AirportProfile | null {
  return BY_IATA[code.trim().toUpperCase()] ?? null;
}

export function getByIcao(code: string): AirportProfile | null {
  return BY_ICAO[code.trim().toUpperCase()] ?? null;
}

export function allAirports(): AirportProfile[] {
  return Object.values(BY_IATA);
}

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Resolve a free-text place reference to candidate airports, largest first.
 * Used as a deterministic fallback when the LLM intent extractor fails or
 * returns codes we do not recognise - so a broken LLM degrades the answer
 * rather than emptying it.
 */
export function findByPlace(query: string, limit = 8): AirportProfile[] {
  const q = norm(query);
  if (!q) return [];

  const scored = allAirports()
    .map((a) => {
      let s = 0;
      if (norm(a.country) === q || norm(a.countryCode) === q) s = 100;
      else if (norm(a.continent) === q) s = 80;
      else if (a.city && norm(a.city) === q) s = 95;
      else if (norm(a.name).includes(q)) s = 60;
      else if (a.city && norm(a.city).includes(q)) s = 55;
      if (s === 0) return null;
      // Prefer bigger assets: an analyst asking about "Israel" means TLV first.
      return { a, s: s + (a.size === 'large' ? 10 : 0) + Math.min(a.runways.count, 4) };
    })
    .filter((x): x is { a: AirportProfile; s: number } => x !== null)
    .sort((x, y) => y.s - x.s || y.a.runways.totalLengthFt - x.a.runways.totalLengthFt);

  return scored.slice(0, limit).map((x) => x.a);
}

/** Continent membership, for "which airports in Europe..." style questions. */
export function byContinent(continent: string, limit = 10): AirportProfile[] {
  const q = norm(continent);
  return allAirports()
    .filter((a) => norm(a.continent) === q && a.size === 'large')
    .sort((a, b) => b.runways.totalLengthFt - a.runways.totalLengthFt)
    .slice(0, limit);
}

/** Country membership. */
export function byCountry(country: string, limit = 10): AirportProfile[] {
  const q = norm(country);
  return allAirports()
    .filter((a) => norm(a.country) === q || norm(a.countryCode) === q)
    .sort((a, b) => (b.size === 'large' ? 1 : 0) - (a.size === 'large' ? 1 : 0) || b.runways.totalLengthFt - a.runways.totalLengthFt)
    .slice(0, limit);
}
