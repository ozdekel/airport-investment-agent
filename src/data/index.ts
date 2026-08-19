/**
 * The data registry: turns an airport into an OperationalSnapshot, degrading
 * tier by tier and telling the truth about which tier it ended up on.
 *
 *   Tier A   AviationStack live flights   -> provenance 'live' / 'derived'
 *   Tier A+  OpenSky historical windows   -> growth momentum, credentials only
 *   Tier B   OurAirports structural class -> provenance 'structural' (ESTIMATE)
 *
 * No single external failure can produce a crash or a confident-looking wrong
 * answer. It produces a weaker answer that says so.
 */

import { AirportProfile, OperationalSnapshot, Measured, Provenance } from '@/core/types';
import { deriveFromFlights, ObservedFlight } from '@/core/derive';
import { ASSUMPTIONS as A } from '@/core/assumptions';
import { getByIata, getByIcao } from './airports';
import { getOperations, carrierOf, isCancelled, hasOperated, departureTimes, AsFlight } from './providers/aviationstack';
import { getMomentum } from './providers/opensky';

const m = <T,>(value: T, provenance: Provenance, note?: string): Measured<T> => ({ value, provenance, note });

/** Typical slot utilisation by airport class, used ONLY for the Tier B fallback. */
const CLASS_UTILISATION = { large: 0.55, medium: 0.22 } as const;
const CLASS_LONG_HAUL = { large: 0.18, medium: 0.04 } as const;

/** Destination codes arrive as IATA from AviationStack and ICAO from OpenSky. */
const lookupAirport = (code: string): AirportProfile | null =>
  (code.length === 3 ? getByIata(code) : getByIcao(code)) ?? getByIata(code) ?? getByIcao(code);

/** Maps a provider record onto the normalised shape the core consumes. */
function normaliseFlight(f: AsFlight): ObservedFlight {
  return {
    destination: f.arrival?.iata?.trim().toUpperCase() ?? null,
    carrier: carrierOf(f),
    operated: hasOperated(f),
    cancelled: isCancelled(f),
    ...departureTimes(f),
  };
}

/** Tier B fallback: an explicitly-labelled estimate from airport class. */
function structuralEstimate(airport: AirportProfile): OperationalSnapshot {
  const util = CLASS_UTILISATION[airport.size];
  const est = Math.round(Math.max(airport.runways.count, 1) * A.DEPARTURE_SLOTS_PER_RUNWAY_PER_DAY.value * util);
  const note = 'ESTIMATE from airport class and runway count - no live observation was available.';

  return {
    dailyDepartures: m(est, 'structural', note),
    uniqueDestinations: m(Math.round(Math.sqrt(est) * (airport.size === 'large' ? 3 : 1.5)), 'structural', note),
    longHaulShare: m(CLASS_LONG_HAUL[airport.size], 'structural', note),
    carrierHHI: m(0.25, 'structural', note),
    dominantCarrierShare: m(0.3, 'structural', note),
    delayShare: m(0, 'unavailable', 'No live flight data reachable.'),
    cancelledShare: m(0, 'unavailable', 'No live flight data reachable.'),
    trafficMomentum: m(0, 'unavailable', 'No historical comparison window available.'),
    continentsServed: m(airport.size === 'large' ? 3 : 1, 'structural', note),
  };
}

export interface SnapshotResult {
  snapshot: OperationalSnapshot;
  /** Human-readable log of what happened, surfaced in the UI. */
  trace: string[];
}

export async function buildSnapshot(airport: AirportProfile): Promise<SnapshotResult> {
  const trace: string[] = [];
  console.log(`[registry] building snapshot for ${airport.iata}/${airport.icao}`);

  // Tier A and the optional Tier A+ run concurrently: the slowest call sets the
  // latency, not the sum of them.
  const [ops, momentum] = await Promise.all([
    getOperations(airport.iata),
    getMomentum(airport.icao),
  ]);

  const momentumMeasure: Measured<number> = momentum.ok
    ? m(momentum.delta, 'live', `Compared against the same window ${A.MOMENTUM_LOOKBACK_DAYS.value} days earlier (${momentum.primaryCount} vs ${momentum.comparisonCount} departures).`)
    : m(0, 'unavailable', `No historical comparison window (${momentum.reason}). This pillar is excluded and its weight redistributed.`);

  if (momentum.ok) {
    trace.push(`Momentum: ${momentum.primaryCount} vs ${momentum.comparisonCount} departures week-on-week.`);
  } else if (momentum.reason !== 'no_credentials') {
    trace.push(`Growth signal unavailable (${momentum.reason}); its weight was redistributed across the other pillars.`);
  }

  // ---- Tier B fallback --------------------------------------------------
  if (!ops.ok) {
    trace.push(`Live flight data unavailable for ${airport.iata} (${ops.reason}). Falling back to a structural estimate from airport class and runway count.`);
    const snapshot = structuralEstimate(airport);
    snapshot.trafficMomentum = momentumMeasure;
    return { snapshot, trace };
  }

  // ---- Tier A -----------------------------------------------------------
  const { totalDepartures, operatingShare, sampleSize, flights, windowDays, windowBasis } = ops.sample;
  const d = deriveFromFlights(airport, flights.map(normaliseFlight), lookupAirport);

  const sampleNote = `Derived from ${sampleSize} operating flights (codeshare listings excluded - they are the same aeroplane).`;

  // Volume, best available basis first. See providers/aviationstack.ts for why
  // the provider's raw total is never used on its own.
  let dailyDepartures: number;
  let volumeProvenance: Provenance;
  let volumeNote: string;

  if (windowDays !== null && windowDays >= 1) {
    // Records -> physical flights -> per day.
    const physicalTotal = totalDepartures * operatingShare;
    dailyDepartures = Math.round(physicalTotal / windowDays);
    volumeProvenance = 'derived';
    volumeNote =
      `${totalDepartures} provider records, of which ${(operatingShare * 100).toFixed(0)}% are operating flights ` +
      `rather than codeshare listings, giving ${Math.round(physicalTotal)} physical departures across ` +
      `${windowDays.toFixed(0)} days = ${dailyDepartures}/day. ${windowBasis}.`;
    trace.push(`AviationStack: ${volumeNote}`);
  } else if (d.departuresPerDay !== null) {
    dailyDepartures = d.departuresPerDay;
    volumeProvenance = 'derived';
    volumeNote = `${sampleSize} departures observed over ${d.observedWindowHours}h, extrapolated to ${dailyDepartures}/day. This is a FLOOR: the page is a thinned slice of its window, so busy airports are under-counted. ${windowBasis}.`;
    trace.push(`AviationStack: could not measure the provider window, so falling back to sample density - ${dailyDepartures}/day, a lower bound.`);
  } else {
    dailyDepartures = totalDepartures;
    volumeProvenance = 'unavailable';
    volumeNote = 'Neither the provider window nor the sample density could be established, so this is a raw total over an unknown period - NOT a daily rate.';
    trace.push(`AviationStack: no usable daily rate for ${airport.iata}; the demand reading here should not be relied on.`);
  }

  if (d.punctualitySample > 0) {
    trace.push(
      `Punctuality measured over the ${d.punctualitySample} flights carrying both a scheduled and an actual departure time (the provider's own delay field is empty on this tier).`,
    );
  } else {
    trace.push('No flight carried both a scheduled and an actual departure time, so punctuality could not be measured; the demand pillar falls back to utilisation alone.');
  }

  if (d.destinationsEstimated > d.destinationsObserved) {
    trace.push(
      `Destinations: ${d.destinationsObserved} seen in the sample, Chao1 estimate ${d.destinationsEstimated}. A distinct-item count does not survive sampling the way a share does, so the estimate is used and both are shown.`,
    );
  }

  const coverageNote =
    d.resolvedShare < 0.6
      ? `${sampleNote} Only ${(d.resolvedShare * 100).toFixed(0)}% of destinations could be geolocated, so this is a partial view.`
      : sampleNote;

  const snapshot: OperationalSnapshot = {
    dailyDepartures: m(dailyDepartures, volumeProvenance, volumeNote),
    uniqueDestinations: m(
      d.destinationsEstimated,
      'derived',
      `${d.destinationsObserved} distinct destinations seen in the sample; Chao1 estimator projects ${d.destinationsEstimated}. ${sampleNote}`,
    ),
    longHaulShare: m(d.longHaulShare, 'derived', `${coverageNote} Great-circle distance against a ${A.LONG_HAUL_THRESHOLD_KM.value}km threshold.`),
    carrierHHI: m(d.hhi, 'derived', `${sampleNote} Herfindahl index over operating carrier codes.`),
    dominantCarrierShare: m(d.dominantShare, 'derived', sampleNote),
    delayShare: d.punctualitySample > 0
      ? m(d.delayShare, 'live', `Computed from scheduled versus actual departure times across ${d.punctualitySample} flights. Threshold ${A.DELAY_THRESHOLD_MINUTES.value} minutes.`)
      : m(0, 'unavailable', 'No flight carried both a scheduled and an actual departure time on this data tier.'),
    cancelledShare: d.operatedCount + flights.filter(isCancelled).length > 0
      ? m(d.cancelledShare, 'live', 'Cancelled as a share of flights whose outcome is known (operated or cancelled).')
      : m(0, 'unavailable', 'No resolved flight outcomes in the sample.'),
    trafficMomentum: momentumMeasure,
    continentsServed: m(d.continents, 'derived', coverageNote),
  };

  return { snapshot, trace };
}

export { getByIata, getByIcao, findByPlace, byContinent, byCountry, allAirports, DATASET_META } from './airports';
