import { AirportProfile, OperationalSnapshot, Measured, Provenance } from '../src/core/types';

export const m = <T,>(value: T, provenance: Provenance = 'live'): Measured<T> => ({ value, provenance });

export function airport(over: Partial<AirportProfile> = {}): AirportProfile {
  return {
    iata: 'TST', icao: 'TSTX', name: 'Test International', city: 'Testville',
    country: 'Testland', countryCode: 'TL', continent: 'Europe',
    lat: 51.4706, lon: -0.461941, elevationFt: 83, size: 'large',
    runways: { count: 2, maxLengthFt: 12799, totalLengthFt: 24800, pavedCount: 2, lightedCount: 2 },
    ...over,
  };
}

export function snapshot(over: Partial<OperationalSnapshot> = {}): OperationalSnapshot {
  return {
    dailyDepartures: m(200),
    uniqueDestinations: m(80),
    longHaulShare: m(0.2),
    carrierHHI: m(0.15),
    dominantCarrierShare: m(0.3),
    delayShare: m(0.12, 'enriched'),
    cancelledShare: m(0.01),
    trafficMomentum: m(0.05),
    continentsServed: m(4),
    ...over,
  };
}

/** Real coordinates, used to assert the geo maths against known distances. */
export const REAL = {
  LHR: { lat: 51.4706, lon: -0.461941 },
  CDG: { lat: 49.012798, lon: 2.55 },
  JFK: { lat: 40.639801, lon: -73.7789 },
  TLV: { lat: 32.011398, lon: 34.8866 },
  SIN: { lat: 1.35019, lon: 103.994003 },
};
