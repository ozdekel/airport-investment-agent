/**
 * Turns raw observed flights into the metrics the scoring engine consumes.
 *
 * Provider-agnostic on purpose: it accepts a normalised `ObservedFlight` and an
 * airport lookup, so swapping the live source (we moved from OpenSky to
 * AviationStack mid-build) does not touch this file or its tests. Pure, so it
 * is unit-testable without filesystem or network.
 */

import { AirportProfile } from './types';
import { greatCircleKm, herfindahl } from './geo';
import { ASSUMPTIONS as A } from './assumptions';

/** The normalised shape every provider is mapped into. */
export interface ObservedFlight {
  /** Destination airport code, IATA or ICAO. Null when unknown. */
  destination: string | null;
  /** Operating carrier code. Null when unknown. */
  carrier: string | null;
  /** The flight actually departed (or is airborne). */
  operated: boolean;
  /** Never departed at all. */
  cancelled: boolean;
  /** Scheduled departure, epoch ms. Null when the provider omitted it. */
  scheduledMs: number | null;
  /** Actual (or best estimated) departure, epoch ms. Null when unknown. */
  actualMs: number | null;
}

export type AirportLookup = (code: string) => AirportProfile | null;

export interface DerivedOps {
  /** Departures per day, inferred from the sample's own time span. Null when
   *  the sample carried no usable timestamps. */
  departuresPerDay: number | null;
  /** Hours between the first and last scheduled departure in the sample. */
  observedWindowHours: number;
  /** How many sampled flights had both a scheduled and an actual time. */
  punctualitySample: number;
  /** Distinct destinations actually seen in the sample. */
  destinationsObserved: number;
  /** Chao1 estimate of the true destination count. See estimateRichness. */
  destinationsEstimated: number;
  longHaulShare: number;
  hhi: number;
  dominantShare: number;
  continents: number;
  delayShare: number;
  cancelledShare: number;
  /** How many sampled flights had actually operated - the delay denominator. */
  operatedCount: number;
  /** Share of observed destinations we could geolocate. Drives the caveat text. */
  resolvedShare: number;
}

/**
 * Chao1 species-richness estimator.
 *
 * THE PROBLEM IT SOLVES: our provider returns a 100-flight page. Counting the
 * distinct destinations in that page under-reports large hubs badly - Heathrow
 * came back with 26 destinations against a true figure near 200, which made the
 * network pillar rank Dubai above Heathrow. Shares survive sampling; a COUNT of
 * distinct things does not.
 *
 * Chao1 is the standard non-parametric estimator for exactly this problem
 * (Chao, 1984). Its intuition is that the number of destinations you saw
 * exactly ONCE tells you how many you probably missed entirely: if a lot of
 * routes appeared as singletons, the sample was shallow relative to the network.
 *
 *     S_chao1 = S_obs + f1^2 / (2 * f2)          when f2 > 0
 *     S_chao1 = S_obs + f1 * (f1 - 1) / 2        when f2 = 0
 *
 * where f1 and f2 are the number of destinations observed exactly once and
 * exactly twice. It is a LOWER BOUND on true richness, which is the right bias
 * for an investment screen: we would rather understate an airport's network
 * than overstate it. Both the observed and the estimated figures are reported
 * so an analyst can see the adjustment rather than inherit it silently.
 */
/** Guards on the sample-span rate estimator. */
const MIN_FLIGHTS_FOR_RATE = 10;
const MIN_WINDOW_HOURS = 0.75;
const MAX_WINDOW_HOURS = 24;

export function estimateRichness(counts: number[]): number {
  const observed = counts.length;
  if (observed === 0) return 0;

  const f1 = counts.filter((c) => c === 1).length;
  const f2 = counts.filter((c) => c === 2).length;
  if (f1 === 0) return observed;

  const correction = f2 > 0 ? (f1 * f1) / (2 * f2) : (f1 * (f1 - 1)) / 2;
  return Math.round(observed + correction);
}

export function deriveFromFlights(
  origin: AirportProfile,
  flights: ObservedFlight[],
  lookup: AirportLookup,
): DerivedOps {
  const empty: DerivedOps = {
    departuresPerDay: null, observedWindowHours: 0, punctualitySample: 0,
    destinationsObserved: 0, destinationsEstimated: 0, longHaulShare: 0, hhi: 0,
    dominantShare: 0, continents: 0, delayShare: 0, cancelledShare: 0,
    operatedCount: 0, resolvedShare: 0,
  };
  if (flights.length === 0) return empty;

  // --- destinations -------------------------------------------------------
  const destCounts = new Map<string, number>();
  for (const f of flights) {
    if (!f.destination) continue;
    destCounts.set(f.destination, (destCounts.get(f.destination) ?? 0) + 1);
  }

  let longHaul = 0;
  let resolved = 0;
  const continents = new Set<string>();

  // Long-haul share is computed over destinations we can geolocate. Reporting
  // it over all destinations would silently understate it.
  for (const [code, n] of destCounts) {
    const dest = lookup(code);
    if (!dest) continue;
    resolved += n;
    continents.add(dest.continent);
    if (greatCircleKm(origin, dest) >= A.LONG_HAUL_THRESHOLD_KM.value) longHaul += n;
  }

  const withDestination = [...destCounts.values()].reduce((s, c) => s + c, 0);

  // --- carriers -----------------------------------------------------------
  const carrierCounts = new Map<string, number>();
  for (const f of flights) {
    if (!f.carrier) continue;
    carrierCounts.set(f.carrier, (carrierCounts.get(f.carrier) ?? 0) + 1);
  }
  const counts = [...carrierCounts.values()];
  const carrierTotal = counts.reduce((s, c) => s + c, 0);

  // --- volume -------------------------------------------------------------
  // We deliberately do NOT use the provider's reported total. On the free tier
  // it counts every matching flight in an unspecified window - at Heathrow it
  // reported 5,153 against a true daily figure near 650, which drove utilisation
  // to 1,591% and turned the 44%-weighted demand pillar into a constant. The
  // sample's own time span is self-contained and costs no extra quota: if 100
  // departures span 3.7 hours, the airport is running about 650 a day.
  const scheduledTimes = flights
    .map((f) => f.scheduledMs)
    .filter((t): t is number => t !== null && Number.isFinite(t))
    .sort((a, b) => a - b);

  let observedWindowHours = 0;
  let departuresPerDay: number | null = null;

  if (scheduledTimes.length >= MIN_FLIGHTS_FOR_RATE) {
    observedWindowHours = (scheduledTimes[scheduledTimes.length - 1] - scheduledTimes[0]) / 3_600_000;
    // Too short a window makes the extrapolation wild; longer than a day means
    // the sample is not a contiguous slice and the rate is not meaningful.
    if (observedWindowHours >= MIN_WINDOW_HOURS && observedWindowHours <= MAX_WINDOW_HOURS) {
      // n-1 intervals between n departures.
      departuresPerDay = Math.round(((scheduledTimes.length - 1) / observedWindowHours) * 24);
    }
  }

  // --- service delivery ---------------------------------------------------
  // Only flights that actually operated can be judged on punctuality. A
  // `scheduled` flight has no delay yet, and including it drags the rate to 0.
  const operated = flights.filter((f) => f.operated);
  const cancelled = flights.filter((f) => f.cancelled);
  const decided = operated.length + cancelled.length;

  // Punctuality is computed from timestamps rather than the provider's `delay`
  // field, which is empty on the free tier: Heathrow returned 0 of 100 records
  // with a populated delay, which read as a perfect on-time record.
  const timed = operated.filter((f) => f.scheduledMs !== null && f.actualMs !== null);
  const lateCount = timed.filter(
    (f) => (f.actualMs! - f.scheduledMs!) / 60_000 > A.DELAY_THRESHOLD_MINUTES.value,
  ).length;

  return {
    departuresPerDay,
    observedWindowHours: Math.round(observedWindowHours * 10) / 10,
    punctualitySample: timed.length,
    destinationsObserved: destCounts.size,
    destinationsEstimated: estimateRichness([...destCounts.values()]),
    longHaulShare: resolved > 0 ? longHaul / resolved : 0,
    hhi: herfindahl(counts),
    dominantShare: carrierTotal > 0 ? Math.max(0, ...counts) / carrierTotal : 0,
    continents: continents.size,
    delayShare: timed.length > 0 ? lateCount / timed.length : 0,
    cancelledShare: decided > 0 ? cancelled.length / decided : 0,
    operatedCount: operated.length,
    resolvedShare: withDestination > 0 ? resolved / withDestination : 0,
  };
}
