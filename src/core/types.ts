/**
 * Domain types for the deterministic core.
 *
 * DESIGN RULE: nothing in `src/core` may import from `src/ai` or `src/data`.
 * The core is a pure function of its inputs. That is what makes it testable,
 * auditable, and defensible to an analyst who wants to argue with a number.
 */

/** Which data tier a value came from. Drives the confidence calculation. */
export type Provenance =
  | 'live'        // Tier A - OpenSky, observed this run
  | 'structural'  // Tier B - OurAirports, nightly snapshot bundled in the repo
  | 'enriched'    // Tier C - AviationStack, opportunistic
  | 'derived'     // computed from the above
  | 'unavailable'; // could not be obtained; a documented default was used

export type Confidence = 'high' | 'medium' | 'low';

/** A single measured input, carrying where it came from. */
export interface Measured<T> {
  value: T;
  provenance: Provenance;
  /** Human-readable note shown in the UI on hover. */
  note?: string;
}

/** Static, slow-moving facts about an airport. Tier B. */
export interface AirportProfile {
  iata: string;
  icao: string;
  name: string;
  city: string | null;
  country: string;
  countryCode: string;
  continent: string;
  lat: number;
  lon: number;
  elevationFt: number | null;
  size: 'large' | 'medium';
  runways: {
    count: number;
    maxLengthFt: number;
    totalLengthFt: number;
    pavedCount: number;
    lightedCount: number;
  };
}

/** Observed operations over a sampling window. Tier A / C. */
export interface OperationalSnapshot {
  /** Departures observed in the sampling window, normalised to per-day. */
  dailyDepartures: Measured<number>;
  /** Distinct destination airports reached in the window. */
  uniqueDestinations: Measured<number>;
  /** Share of departures travelling beyond the long-haul threshold. 0..1 */
  longHaulShare: Measured<number>;
  /** Herfindahl-Hirschman Index of carrier mix. 0..1, higher = concentrated. */
  carrierHHI: Measured<number>;
  /** Share of departures operated by the single largest carrier. 0..1 */
  dominantCarrierShare: Measured<number>;
  /** Share of departures delayed beyond the threshold. 0..1 */
  delayShare: Measured<number>;
  /** Share of scheduled departures that were cancelled outright. 0..1 */
  cancelledShare: Measured<number>;
  /** Traffic change vs. the comparison window. -1..+inf, e.g. 0.12 = +12% */
  trafficMomentum: Measured<number>;
  /** Continents reachable non-stop. */
  continentsServed: Measured<number>;
}

/** Analyst-tunable weights (Human-in-the-Loop). Must sum to 1. */
export interface ScoringWeights {
  demandPressure: number;
  networkGravity: number;
  revenueQuality: number;
  growthMomentum: number;
}

/** One pillar of the score, fully self-explaining. */
export interface PillarResult {
  key: keyof ScoringWeights;
  label: string;
  score: number;          // 0..100
  weight: number;         // 0..1
  contribution: number;   // score * weight
  /** The formula actually used, rendered for the methodology tab. */
  formula: string;
  /** The concrete numbers that went in, for auditing. */
  inputs: Record<string, number | string>;
  /** One-line analyst rationale. */
  rationale: string;
  confidence: Confidence;
}

export interface RiskAssessment {
  /** 0..1, higher = riskier. */
  index: number;
  /** Multiplier applied to the weighted score. */
  multiplier: number;
  flags: Array<{ code: string; severity: 'high' | 'medium' | 'low'; message: string }>;
}

export interface InvestmentScore {
  airport: AirportProfile;
  snapshot: OperationalSnapshot;
  pillars: PillarResult[];
  risk: RiskAssessment;
  /** Weighted pillar sum before risk. 0..100 */
  rawScore: number;
  /** Final, risk-adjusted. 0..100 */
  finalScore: number;
  confidence: Confidence;
  /** Which tiers actually served this result. */
  dataSources: Provenance[];
  /** Share of departures delayed or cancelled - the direct "unmet demand" answer. */
  unmetDemandShare: number;
  /** The weights actually applied, after redistributing any unavailable pillar. */
  weightsApplied: ScoringWeights;
  /** Pillars whose signal was unavailable and whose weight was redistributed. */
  redistributedFrom: string[];
  /** Machine-readable one-liner the narrator is allowed to paraphrase. */
  thesis: string;
}
