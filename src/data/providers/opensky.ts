/**
 * TIER A+ - optional growth signal from the OpenSky Network.
 *
 * WHY IT IS OPTIONAL AND NOT PRIMARY
 * ----------------------------------
 * OpenSky was the original choice for the live tier. Its historical endpoints
 * turn out to reject anonymous callers outright:
 *
 *     HTTP 403  "You cannot access historical flights"
 *
 * verified against LLBG, EGLL, KJFK and OMDB - so without registration it
 * contributes nothing. AviationStack took over as Tier A because it works on
 * its free tier today.
 *
 * OpenSky is kept for the one thing AviationStack's free tier cannot do:
 * compare two windows in time. With credentials present it supplies the growth
 * momentum pillar. Without them, that pillar is excluded and its weight is
 * redistributed - see `redistributeWeights` in the scoring engine.
 */

import { fetchJson } from '../http';
import { cached, TTL } from '../cache';
import { ASSUMPTIONS as A } from '@/core/assumptions';

const BASE = process.env.OPENSKY_BASE_URL || 'https://opensky-network.org/api';
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

interface OpenSkyFlight { estArrivalAirport: string | null; callsign: string | null }

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const res = await fetchJson<{ access_token: string; expires_in: number }>(
    TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString(),
    },
    { label: 'opensky:auth', timeoutMs: 6000 },
  );

  if (!res.ok) {
    console.warn('[opensky] auth failed:', res.detail);
    return null;
  }
  // Refresh a minute early to avoid racing the expiry.
  tokenCache = { token: res.data.access_token, expiresAt: Date.now() + (res.data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

/**
 * OpenSky processes arrivals in a nightly batch, so the freshest complete data
 * is yesterday. We sample a 24h window ending 26h ago and compare against the
 * same window a week earlier, so day-of-week effects cancel out.
 */
export function samplingWindows(now = Date.now()) {
  const hour = 3600;
  const end = Math.floor(now / 1000) - 26 * hour;
  const begin = end - A.SAMPLING_WINDOW_HOURS.value * hour;
  const shift = A.MOMENTUM_LOOKBACK_DAYS.value * 24 * hour;
  return {
    primary: { begin, end },
    comparison: { begin: begin - shift, end: end - shift },
  };
}

async function countDepartures(icao: string, w: { begin: number; end: number }, token: string): Promise<number | null> {
  const res = await fetchJson<OpenSkyFlight[]>(
    `${BASE}/flights/departure?airport=${encodeURIComponent(icao)}&begin=${w.begin}&end=${w.end}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { label: `opensky:${icao}`, timeoutMs: 12000 },
  );
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data.length : 0;
}

export type MomentumResult =
  | { ok: true; delta: number; primaryCount: number; comparisonCount: number }
  | { ok: false; reason: string };

/** Week-on-week change in departures. Requires OpenSky credentials. */
export async function getMomentum(icao: string): Promise<MomentumResult> {
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: 'no_credentials' };

  const w = samplingWindows();
  return cached(`opensky:momentum:${icao}:${w.primary.begin}`, TTL.OPENSKY_WINDOW, async () => {
    const [primary, comparison] = await Promise.all([
      countDepartures(icao, w.primary, token),
      countDepartures(icao, w.comparison, token),
    ]);

    if (primary === null || comparison === null) return { ok: false as const, reason: 'request_failed' };
    if (comparison === 0) return { ok: false as const, reason: 'empty comparison window' };

    return {
      ok: true as const,
      delta: (primary - comparison) / comparison,
      primaryCount: primary,
      comparisonCount: comparison,
    };
  });
}
