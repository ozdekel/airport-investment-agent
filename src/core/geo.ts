import { ASSUMPTIONS } from './assumptions';

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface LatLon { lat: number; lon: number }

/**
 * Great-circle distance in kilometres.
 * Uses the haversine formula, which is numerically stable for the short
 * distances where the spherical law of cosines loses precision.
 */
export function greatCircleKm(from: LatLon, to: LatLon): number {
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Is this sector long-haul under our stated threshold? */
export function isLongHaul(from: LatLon, to: LatLon): boolean {
  return greatCircleKm(from, to) >= ASSUMPTIONS.LONG_HAUL_THRESHOLD_KM.value;
}

/**
 * Herfindahl-Hirschman Index over a distribution of counts, normalised to 0..1.
 * 1 = a single actor holds everything. ~1/n = n evenly-sized actors.
 * Returns 0 for an empty distribution so that "no data" never looks like
 * "perfectly diversified".
 */
export function herfindahl(counts: number[]): number {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total <= 0) return 0;
  return counts.reduce((s, c) => s + (c / total) ** 2, 0);
}

/** Clamp helper used across the scoring engine. */
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/**
 * Linear normalisation of `v` from [lo, hi] onto [0, 1], clamped at both ends.
 * Returns 0 when the band is degenerate rather than dividing by zero.
 */
export function normalise(v: number, lo: number, hi: number): number {
  if (hi === lo) return 0;
  return clamp((v - lo) / (hi - lo));
}

/**
 * Logarithmic normalisation, saturating at `ceiling`.
 * Used where early increments matter far more than late ones, e.g. an airport
 * going from 10 to 30 destinations versus 150 to 170.
 */
export function logNormalise(v: number, ceiling: number): number {
  if (v <= 0 || ceiling <= 1) return 0;
  return clamp(Math.log1p(v) / Math.log1p(ceiling));
}
