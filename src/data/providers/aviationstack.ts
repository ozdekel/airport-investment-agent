/**
 * TIER A - live operations, from AviationStack.
 *
 * WHY THIS IS THE PRIMARY TIER AND NOT OPENSKY
 * --------------------------------------------
 * OpenSky was the first choice: raw ADS-B, generous limits. In practice its
 * historical endpoints reject anonymous callers outright -
 * `HTTP 403 "You cannot access historical flights"` - so without registration
 * it contributes nothing. AviationStack, on the same free tier, returns a full
 * flight record per departure including the ARRIVAL AIRPORT, the OPERATING
 * AIRLINE, the DEPARTURE DELAY and the FLIGHT STATUS. One call per airport is
 * enough to derive every operational metric the engine needs.
 *
 * THE DAILY-VOLUME TRAP (and how we got out of it)
 * ------------------------------------------------
 * `pagination.total` counts every matching flight in the provider's retention
 * window, NOT one day. Used naively it reported 5,159 daily departures at
 * Heathrow against a true figure near 650, driving utilisation to 1,591% and
 * saturating the demand pillar for every large airport - silently turning a
 * 44%-weighted pillar into a constant.
 *
 * Three attempts, in order:
 *   1. Pin the query with `flight_date`. REJECTED on the free tier:
 *      "Your current subscription plan does not support this API function."
 *   2. Infer the rate from the sample's own time density. Better - but a
 *      systematic UNDER-count (Heathrow 380/day, Boston 264/day against ~650
 *      and ~600), because the 100-record page is a thinned slice of its window,
 *      and the thinning worsens with airport size.
 *   3. Measure the window itself with one extra request for the LAST record,
 *      then divide the total by it. The window came back as 2 days - correct -
 *      but Heathrow still read 2,581/day, almost exactly 4x the truth.
 *   4. That 4x was the answer. The provider emits ONE RECORD PER MARKETING
 *      CARRIER: a single BA flight to New York also appears as AA, IB and JL.
 *      `flight.codeshared` is null only on the operating carrier's own record,
 *      so filtering on it counts physical aircraft movements instead of ticket
 *      listings. This also fixes the carrier mix, which was being measured over
 *      marketing brands rather than over who actually flies the aeroplane.
 *
 * Shipping: physical flights = total x operatingShare, divided by the measured
 * window. The sample-density figure is retained as a floor for when the probe
 * fails.
 */

import { fetchJson } from '../http';
import { cached, TTL } from '../cache';

export interface AsFlight {
  flight_date?: string | null;
  flight_status?: string | null;
  departure?: {
    iata?: string | null;
    delay?: number | null;
    scheduled?: string | null;
    estimated?: string | null;
    actual?: string | null;
  } | null;
  arrival?: { iata?: string | null } | null;
  airline?: { name?: string | null; iata?: string | null; icao?: string | null } | null;
  flight?: {
    number?: string | null;
    iata?: string | null;
    /** Non-null when this record is a MARKETING listing of someone else's
     *  flight. Null means this is the operating carrier's own record. */
    codeshared?: Record<string, unknown> | null;
  } | null;
}

interface AsResponse {
  pagination?: { limit?: number; offset?: number; count?: number; total?: number };
  data?: AsFlight[];
  error?: { message?: string; info?: string; code?: string };
}

export interface OpsSample {
  /** Total matching RECORDS reported by the provider, over an unknown span.
   *  Includes codeshare listings, so it is not a count of physical flights. */
  totalDepartures: number;
  /** Share of the sample that were operating flights rather than codeshare
   *  listings. Used to convert the record total into a flight total. */
  operatingShare: number;
  /** How many days that total covers, when we managed to measure it. */
  windowDays: number | null;
  /** How the window was established, for the audit trail. */
  windowBasis: string;
  /** How many flight records we actually inspected. */
  sampleSize: number;
  flights: AsFlight[];
}

export type OpsResult =
  | { ok: true; sample: OpsSample }
  | { ok: false; reason: string };

async function query(iata: string, date: string | null): Promise<AsResponse | { failed: string }> {
  const key = process.env.AVIATION_API_KEY;
  const dateParam = date ? `&flight_date=${date}` : '';
  const url = `http://api.aviationstack.com/v1/flights?access_key=${key}&dep_iata=${encodeURIComponent(iata)}&limit=100${dateParam}`;

  const res = await fetchJson<AsResponse>(url, {}, { label: `avstack:${iata}${date ? `:${date}` : ''}`, timeoutMs: 12000 });
  if (!res.ok) return { failed: `${res.reason}: ${res.detail}` };
  if (res.data.error) {
    const e = res.data.error;
    return { failed: e.message || e.info || e.code || 'api_error' };
  }
  return res.data;
}

/**
 * Establishes how many days `pagination.total` actually covers.
 *
 * WHY THIS EXISTS. The free tier refuses a date-pinned query
 * ("Your current subscription plan does not support this API function"), so the
 * reported total spans an unspecified window - 5,159 at Heathrow against a true
 * daily figure near 650. Inferring the rate from the sample's own time density
 * instead gave 380/day: better, but a systematic UNDER-count, because the
 * 100-record page is a thinned slice of its window rather than a complete one.
 * The bias grows with airport size, which is precisely backwards for a model
 * whose thesis is that busy hubs are the opportunity.
 *
 * So we spend one extra request to fetch the LAST record in the result set. The
 * gap between the first and last flight dates is the window, and
 * `total / windowDays` is a real daily rate.
 *
 * The call is rationed: it only fires when the sample is visibly thinned
 * (`total > 2x sample`), and the result is cached for a day per airport, since
 * a provider's retention window does not move hour to hour. The free quota is
 * 100 requests per MONTH - this is a considered spend, not a convenience.
 */
async function probeWindowDays(iata: string, total: number, firstDateIso: string): Promise<{ days: number | null; basis: string }> {
  return cached(`avstack:window:${iata}`, TTL.WINDOW_PROBE, async () => {
    const key = process.env.AVIATION_API_KEY;
    const url = `http://api.aviationstack.com/v1/flights?access_key=${key}&dep_iata=${encodeURIComponent(iata)}&limit=1&offset=${Math.max(0, total - 1)}`;

    const res = await fetchJson<AsResponse>(url, {}, { label: `avstack:${iata}:window`, timeoutMs: 10000 });
    if (!res.ok || res.data.error) {
      return { days: null, basis: `window probe failed (${res.ok ? res.data.error?.message : res.reason})` };
    }

    const lastDate = res.data.data?.[0]?.flight_date;
    if (!lastDate) return { days: null, basis: 'window probe returned no dated record' };

    const spanMs = Date.parse(lastDate) - Date.parse(firstDateIso);
    if (!Number.isFinite(spanMs)) return { days: null, basis: 'window probe returned an unparseable date' };

    // Inclusive day count. Guard against a result set that is not ordered by
    // date, which would make this meaningless.
    const days = Math.abs(spanMs) / 86_400_000 + 1;
    if (days < 1 || days > 60) return { days: null, basis: `window probe gave an implausible span of ${days.toFixed(1)} days` };

    return { days, basis: `provider total spans ${days.toFixed(0)} days (${firstDateIso} to ${lastDate}), measured with one extra request` };
  });
}

/** Everything we need, in one request - two when the sample is visibly thinned. */
export async function getOperations(iata: string): Promise<OpsResult> {
  if (!process.env.AVIATION_API_KEY) return { ok: false, reason: 'no_api_key' };

  return cached(`avstack:ops:${iata}`, TTL.AVIATIONSTACK, async () => {
    const body = await query(iata, null);
    if ('failed' in body) return { ok: false as const, reason: body.failed };

    const raw = body.data ?? [];
    if (raw.length === 0) return { ok: false as const, reason: 'no flights returned' };

    // Physical departures only. Codeshare listings are the same aeroplane.
    const flights = raw.filter(isOperatingFlight);
    if (flights.length === 0) return { ok: false as const, reason: 'sample contained only codeshare listings' };
    const operatingShare = flights.length / raw.length;

    const reported = body.pagination?.total;
    const totalDepartures = typeof reported === 'number' && reported >= raw.length ? reported : raw.length;

    // Only probe when the total is clearly bigger than what we can see.
    let windowDays: number | null = null;
    let windowBasis = 'provider total is close to the sample, so no window probe was needed';

    const firstDate = raw.map((f) => f.flight_date).filter((d): d is string => !!d).sort()[0];
    if (totalDepartures > raw.length * 2 && firstDate) {
      const probe = await probeWindowDays(iata, totalDepartures, firstDate);
      windowDays = probe.days;
      windowBasis = probe.basis;
    }

    console.log(
      `[avstack] ${iata}: ${totalDepartures} records, ${(operatingShare * 100).toFixed(0)}% operating (rest are codeshare listings), window ${windowDays ?? 'unknown'} days`,
    );
    return {
      ok: true as const,
      sample: { totalDepartures, operatingShare, windowDays, windowBasis, sampleSize: flights.length, flights },
    };
  });
}

/**
 * Is this the operating carrier's record, or a codeshare listing of it?
 *
 * The provider returns one record per marketing carrier, so a single physical
 * departure can appear four or five times. Counting records instead of flights
 * inflated Heathrow to 2,581 departures a day against a true figure near 650.
 */
export function isOperatingFlight(f: AsFlight): boolean {
  return f.flight?.codeshared == null;
}

/** IATA airline designator, preferring the code over the name. */
export function carrierOf(f: AsFlight): string | null {
  return f.airline?.iata?.trim().toUpperCase()
    || f.airline?.icao?.trim().toUpperCase()
    || f.airline?.name?.trim().toUpperCase()
    || null;
}

/**
 * Did this flight actually operate?
 *
 * This distinction is what fixed the second major bug. Delay was being computed
 * across the whole sample, including flights still marked `scheduled` - which
 * have `delay: null` because they have not departed yet. Heathrow duly reported
 * 0% delayed. Only operated flights belong in the denominator.
 */
export function hasOperated(f: AsFlight): boolean {
  const s = (f.flight_status ?? '').toLowerCase();
  return s === 'active' || s === 'landed' || s === 'diverted' || Boolean(f.departure?.actual);
}

export function isCancelled(f: AsFlight): boolean {
  return (f.flight_status ?? '').toLowerCase() === 'cancelled';
}

/**
 * Timestamps, in epoch milliseconds.
 *
 * The provider's own `delay` field is empty on the free tier - Heathrow
 * returned 0 of 100 records with it populated, which read as a perfect on-time
 * record. The scheduled and actual timestamps ARE present, so we compute
 * punctuality ourselves and fall back to the `delay` field only when the
 * timestamps are missing.
 */
export function departureTimes(f: AsFlight): { scheduledMs: number | null; actualMs: number | null } {
  const parse = (v: string | null | undefined): number | null => {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const scheduledMs = parse(f.departure?.scheduled);
  let actualMs = parse(f.departure?.actual) ?? parse(f.departure?.estimated);

  // Last resort: reconstruct the actual time from the reported delay minutes.
  if (actualMs === null && scheduledMs !== null && typeof f.departure?.delay === 'number') {
    actualMs = scheduledMs + f.departure.delay * 60_000;
  }
  return { scheduledMs, actualMs };
}
