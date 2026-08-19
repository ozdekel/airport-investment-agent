/**
 * The deterministic scoring engine.
 *
 * This module is pure: same inputs -> same outputs, always. No network, no
 * clock, no LLM. Everything the analyst sees as a number originates here.
 *
 * THESIS
 * ------
 * We sell to analysts, not to airports. An analyst does not profit from
 * learning that Heathrow is a good airport - everyone knows that. They profit
 * from spotting a gap between demand and infrastructure before consensus does.
 * So the score is not "how good is this airport", it is:
 *
 *     unmet demand  x  asset quality  /  counterparty risk
 */

import {
  AirportProfile, OperationalSnapshot, PillarResult, ScoringWeights,
  InvestmentScore, RiskAssessment, Confidence, Provenance, Measured,
} from './types';
import { ASSUMPTIONS as A, DEFAULT_WEIGHTS, WEIGHT_RATIONALE } from './assumptions';
import { clamp, normalise, logNormalise } from './geo';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Confidence for a pillar, from the provenance of the inputs it consumed. */
function pillarConfidence(inputs: Array<Measured<unknown>>): Confidence {
  if (inputs.length === 0) return 'low';
  const weightOf = (p: Provenance) =>
    p === 'live' ? 1 : p === 'enriched' ? 0.8 : p === 'structural' ? 0.6 : p === 'derived' ? 0.6 : 0;
  const avg = inputs.reduce((s, i) => s + weightOf(i.provenance), 0) / inputs.length;
  return avg >= 0.9 ? 'high' : avg >= 0.55 ? 'medium' : 'low';
}

/**
 * PILLAR 1 - Demand Pressure.
 * The investable signal: traffic the current infrastructure struggles to serve.
 */
function demandPressure(airport: AirportProfile, s: OperationalSnapshot, weight: number): PillarResult {
  const runways = Math.max(airport.runways.count, 1);
  const theoreticalCapacity = runways * A.DEPARTURE_SLOTS_PER_RUNWAY_PER_DAY.value;
  const rawUtilisation = s.dailyDepartures.value / theoreticalCapacity;

  // No commercial airport runs at 250% of its runway capacity. A reading that
  // high means the departure count we were handed is not a single-day figure,
  // so we refuse to build a confident ratio out of it.
  const implausible = rawUtilisation > A.IMPLAUSIBLE_UTILISATION.value;
  const utilisation = implausible ? A.SATURATION_UTILISATION.value : rawUtilisation;

  // Saturation, not raw volume. A busy 6-runway airport is not under pressure.
  const utilisationScore = normalise(utilisation, 0, A.SATURATION_UTILISATION.value) * 100;

  // Unserved demand: departures the airport failed to deliver on schedule or at
  // all. This is the observable answer to "what share of demand went unmet".
  const unmet = unmetDemandShare(s);
  const unmetScore = normalise(unmet, 0, A.DELAY_SATURATION_SHARE.value) * 100;

  // If we have no delay observation we do not invent one - we lean entirely on
  // utilisation and let the confidence rating carry the honesty.
  const haveObserved = s.delayShare.provenance !== 'unavailable';
  const score = haveObserved
    ? 0.6 * utilisationScore + 0.4 * unmetScore
    : utilisationScore;

  return {
    key: 'demandPressure',
    label: 'Demand Pressure',
    score: r1(clamp(score, 0, 100)),
    weight,
    contribution: r1(clamp(score, 0, 100) * weight),
    formula: haveObserved
      ? '0.6 x norm(departures / (runways x 160), 0, 0.85) + 0.4 x norm(delayed% + cancelled%, 0, 0.25)'
      : 'norm(departures / (runways x 160), 0, 0.85)   [no observed delay or cancellation data]',
    inputs: {
      dailyDepartures: s.dailyDepartures.value,
      runways: airport.runways.count,
      theoreticalDailyCapacity: theoreticalCapacity,
      utilisation: implausible ? `${pct(rawUtilisation)} - IMPLAUSIBLE, capped for scoring` : pct(utilisation),
      unmetDemandShare: haveObserved ? pct(unmet) : 'unavailable',
      delayedShare: haveObserved ? pct(s.delayShare.value) : 'unavailable',
      cancelledShare: s.cancelledShare.provenance !== 'unavailable' ? pct(s.cancelledShare.value) : 'unavailable',
    },
    rationale:
      utilisation >= A.SATURATION_UTILISATION.value
        ? `Operating at ${pct(utilisation)} of modelled slot capacity - effectively saturated${haveObserved ? `, with ${pct(unmet)} of departures delayed or cancelled` : ''}. Incremental capacity has a ready-made customer.`
        : utilisation >= 0.5
        ? `Running at ${pct(utilisation)} of modelled slot capacity${haveObserved ? `, losing ${pct(unmet)} of departures to delay or cancellation` : ''}. Meaningful headroom remains before expansion is forced.`
        : `Only ${pct(utilisation)} of modelled slot capacity in use. There is no capacity-driven case for expansion here.`,
    confidence: implausible
      ? 'low'
      : pillarConfidence(haveObserved ? [s.dailyDepartures, s.delayShare] : [s.dailyDepartures]),
  };
}

/** True when the reported volume cannot be a single-day figure. */
export function hasImplausibleVolume(airport: AirportProfile, s: OperationalSnapshot): boolean {
  const capacity = Math.max(airport.runways.count, 1) * A.DEPARTURE_SLOTS_PER_RUNWAY_PER_DAY.value;
  return s.dailyDepartures.value / capacity > A.IMPLAUSIBLE_UTILISATION.value;
}

/**
 * Share of scheduled departures the airport did not serve properly - delayed
 * beyond the on-time threshold, or cancelled outright.
 *
 * This is the direct, observable answer to "what percentage of demand went
 * unmet at this airport". It is a service-delivery measure, not a measure of
 * suppressed demand (passengers who never booked because no slot existed) -
 * that is not visible in any open dataset and is stated as a limitation.
 */
export function unmetDemandShare(s: OperationalSnapshot): number {
  const delayed = s.delayShare.provenance === 'unavailable' ? 0 : s.delayShare.value;
  const cancelled = s.cancelledShare.provenance === 'unavailable' ? 0 : s.cancelledShare.value;
  return clamp(delayed + cancelled, 0, 1);
}

/**
 * PILLAR 2 - Network Gravity.
 * A capacity gap is only worth closing where the network already matters.
 */
function networkGravity(s: OperationalSnapshot, weight: number): PillarResult {
  const destScore = logNormalise(s.uniqueDestinations.value, A.DESTINATION_SATURATION.value) * 100;
  const longHaulScore = normalise(s.longHaulShare.value, 0, A.LONG_HAUL_TARGET_SHARE.value) * 100;
  const reachScore = clamp(s.continentsServed.value / 6) * 100;

  const score = 0.5 * destScore + 0.3 * longHaulScore + 0.2 * reachScore;

  return {
    key: 'networkGravity',
    label: 'Network Gravity',
    score: r1(clamp(score, 0, 100)),
    weight,
    contribution: r1(clamp(score, 0, 100) * weight),
    formula: '0.5 x logNorm(destinations, 150) + 0.3 x norm(longHaulShare, 0, 0.25) + 0.2 x (continents / 6)',
    inputs: {
      uniqueDestinations: s.uniqueDestinations.value,
      longHaulShare: pct(s.longHaulShare.value),
      continentsServed: s.continentsServed.value,
    },
    rationale:
      destScore > 70
        ? `Serves ${s.uniqueDestinations.value} destinations across ${s.continentsServed.value} continents - a genuine hub whose connectivity compounds any added capacity.`
        : `Reaches ${s.uniqueDestinations.value} destinations. Network effects are limited, so added capacity would have to be justified by point-to-point demand alone.`,
    confidence: pillarConfidence([s.uniqueDestinations, s.longHaulShare, s.continentsServed]),
  };
}

/**
 * PILLAR 3 - Revenue Quality.
 * Whether incremental traffic converts into durable, diversified revenue.
 */
function revenueQuality(s: OperationalSnapshot, weight: number): PillarResult {
  // Invert HHI: a diversified carrier base is a resilient revenue base.
  const diversification = clamp((1 - s.carrierHHI.value) / (1 - A.HEALTHY_CARRIER_HHI.value)) * 100;
  const premiumMix = normalise(s.longHaulShare.value, 0, A.LONG_HAUL_TARGET_SHARE.value) * 100;

  const score = 0.6 * diversification + 0.4 * premiumMix;

  return {
    key: 'revenueQuality',
    label: 'Revenue Quality',
    score: r1(clamp(score, 0, 100)),
    weight,
    contribution: r1(clamp(score, 0, 100) * weight),
    formula: '0.6 x ((1 - carrierHHI) / 0.9) + 0.4 x norm(longHaulShare, 0, 0.25)',
    inputs: {
      carrierHHI: r1(s.carrierHHI.value * 100) / 100,
      dominantCarrierShare: pct(s.dominantCarrierShare.value),
      longHaulShare: pct(s.longHaulShare.value),
    },
    rationale:
      s.dominantCarrierShare.value > A.DOMINANT_CARRIER_RISK_THRESHOLD.value
        ? `One carrier operates ${pct(s.dominantCarrierShare.value)} of departures. Revenue tracks that single counterparty network decisions.`
        : `Carrier base is diversified (HHI ${(s.carrierHHI.value).toFixed(2)}), so no single airline failure would strip out the traffic base.`,
    confidence: pillarConfidence([s.carrierHHI, s.longHaulShare]),
  };
}

/**
 * PILLAR 4 - Growth Momentum.
 * Directional check that the gap is widening. Deliberately the lowest weight:
 * a two-window comparison is an indicator, not a trend.
 */
function growthMomentum(s: OperationalSnapshot, weight: number): PillarResult {
  const available = s.trafficMomentum.provenance !== 'unavailable';
  const score = available
    ? normalise(s.trafficMomentum.value, A.MOMENTUM_FLOOR.value, A.MOMENTUM_CEILING.value) * 100
    : 0;

  return {
    key: 'growthMomentum',
    label: 'Growth Momentum',
    score: r1(clamp(score, 0, 100)),
    weight,
    contribution: r1(clamp(score, 0, 100) * weight),
    formula: available
      ? 'norm(trafficDelta, -0.10, +0.20)'
      : 'EXCLUDED - no comparison window available; this weight was redistributed across the other pillars',
    inputs: {
      trafficMomentum: available ? pct(s.trafficMomentum.value) : 'unavailable',
      lookbackDays: A.MOMENTUM_LOOKBACK_DAYS.value,
    },
    rationale: !available
      ? 'No historical comparison window was available on this data tier, so this pillar is excluded entirely and its weight is redistributed across the other three. Holding it at a neutral 50 would drag every airport toward the middle and make the scores less discriminating, which is worse than admitting we cannot measure it.'
      : s.trafficMomentum.value > 0.05
      ? `Departures are up ${pct(s.trafficMomentum.value)} against the same weekday last week - the capacity gap is widening.`
      : s.trafficMomentum.value < -0.05
      ? `Departures are down ${pct(Math.abs(s.trafficMomentum.value))} week-on-week, which argues against a demand-driven expansion case.`
      : 'Traffic is broadly flat week-on-week.',
    confidence: available ? pillarConfidence([s.trafficMomentum]) : 'low',
  };
}

/** Counterparty and concentration risk. Adjusts the thesis, never replaces it. */
function assessRisk(airport: AirportProfile, s: OperationalSnapshot): RiskAssessment {
  const flags: RiskAssessment['flags'] = [];
  let index = 0;

  if (s.dominantCarrierShare.value > A.DOMINANT_CARRIER_RISK_THRESHOLD.value) {
    const excess = normalise(s.dominantCarrierShare.value, 0.5, 0.9);
    index += 0.5 * excess;
    flags.push({
      code: 'CARRIER_CONCENTRATION',
      severity: excess > 0.5 ? 'high' : 'medium',
      message: `${pct(s.dominantCarrierShare.value)} of departures are operated by a single carrier. A network change or insolvency at that carrier would hit revenue directly.`,
    });
  }

  if (s.uniqueDestinations.value > 0 && s.uniqueDestinations.value < 15) {
    index += 0.3;
    flags.push({
      code: 'THIN_NETWORK',
      severity: 'medium',
      message: `Only ${s.uniqueDestinations.value} destinations observed. Traffic is exposed to a small number of routes.`,
    });
  }

  if (airport.runways.count === 1) {
    index += 0.2;
    flags.push({
      code: 'SINGLE_RUNWAY',
      severity: 'medium',
      message: 'Single runway. No operational redundancy, and expansion likely requires land acquisition rather than incremental works.',
    });
  }

  if (s.cancelledShare.provenance !== 'unavailable' && s.cancelledShare.value > 0.05) {
    index += 0.2;
    flags.push({
      code: 'HIGH_CANCELLATION',
      severity: 'medium',
      message: `${pct(s.cancelledShare.value)} of departures were cancelled outright. Chronic cancellation points at an operational or slot problem that new terminal capacity alone will not fix.`,
    });
  }

  if (hasImplausibleVolume(airport, s)) {
    index += 0.25;
    flags.push({
      code: 'IMPLAUSIBLE_VOLUME',
      severity: 'high',
      message: `The reported departure count implies more than ${(A.IMPLAUSIBLE_UTILISATION.value * 100).toFixed(0)}% of modelled runway capacity, which no commercial airport sustains. The figure is almost certainly not a single-day count, so the demand reading here is capped and should not be relied on.`,
    });
  }

  if (s.dailyDepartures.provenance === 'unavailable' || s.dailyDepartures.value === 0) {
    index += 0.3;
    flags.push({
      code: 'NO_LIVE_COVERAGE',
      severity: 'high',
      message: 'No live departures were observed. This is most likely an ADS-B coverage gap rather than an inactive airport - treat the score as indicative only.',
    });
  }

  const bounded = clamp(index);
  return {
    index: r1(bounded * 100) / 100,
    multiplier: r1((1 - bounded * A.MAX_RISK_PENALTY.value) * 1000) / 1000,
    flags,
  };
}

function overallConfidence(pillars: PillarResult[]): Confidence {
  const w = { high: 1, medium: 0.6, low: 0.2 } as const;
  const avg = pillars.reduce((s, p) => s + w[p.confidence] * p.weight, 0);
  return avg >= 0.85 ? 'high' : avg >= 0.5 ? 'medium' : 'low';
}

function buildThesis(airport: AirportProfile, pillars: PillarResult[], final: number): string {
  const byScore = [...pillars].sort((x, y) => y.contribution - x.contribution);
  const lead = byScore[0];
  const drag = byScore[byScore.length - 1];
  const verdict = final >= 70 ? 'Strong candidate' : final >= 50 ? 'Watchlist' : 'Weak candidate';
  return `${verdict} (${final}/100). Led by ${lead.label} at ${lead.score}; held back by ${drag.label} at ${drag.score}.`;
}

/** Normalises analyst-supplied weights so they always sum to 1. */
export function normaliseWeights(w?: Partial<ScoringWeights>): ScoringWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...(w ?? {}) } as ScoringWeights;
  const total = Object.values(merged).reduce((s, v) => s + v, 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return {
    demandPressure: merged.demandPressure / total,
    networkGravity: merged.networkGravity / total,
    revenueQuality: merged.revenueQuality / total,
    growthMomentum: merged.growthMomentum / total,
  };
}

/** The single public entry point of the deterministic core. */
/**
 * Redistributes the weight of any pillar we cannot measure across the pillars
 * we can, preserving their relative proportions.
 *
 * The alternative - scoring a missing signal as neutral 50 - quietly pulls every
 * airport toward the middle and makes the ranking less discriminating exactly
 * when data is scarce. Excluding it is both more honest and more useful: the
 * score reflects what we actually observed, and `redistributedFrom` records
 * what we could not.
 */
export function redistributeWeights(
  base: ScoringWeights,
  available: Record<keyof ScoringWeights, boolean>,
): { weights: ScoringWeights; excluded: string[] } {
  const excluded = (Object.keys(base) as Array<keyof ScoringWeights>).filter((k) => !available[k]);
  if (excluded.length === 0) return { weights: base, excluded: [] };

  const keptTotal = (Object.keys(base) as Array<keyof ScoringWeights>)
    .filter((k) => available[k])
    .reduce((sum, k) => sum + base[k], 0);

  // Everything is unavailable - fall back to the requested weights rather than
  // dividing by zero.
  if (keptTotal <= 0) return { weights: base, excluded };

  const out = { ...base };
  for (const k of Object.keys(base) as Array<keyof ScoringWeights>) {
    out[k] = available[k] ? base[k] / keptTotal : 0;
  }
  return { weights: out, excluded };
}

/** The single public entry point of the deterministic core. */
export function scoreAirport(
  airport: AirportProfile,
  snapshot: OperationalSnapshot,
  weights?: Partial<ScoringWeights>,
): InvestmentScore {
  const requested = normaliseWeights(weights);

  const { weights: w, excluded } = redistributeWeights(requested, {
    demandPressure: true,
    networkGravity: true,
    revenueQuality: true,
    growthMomentum: snapshot.trafficMomentum.provenance !== 'unavailable',
  });

  const pillars: PillarResult[] = [
    demandPressure(airport, snapshot, w.demandPressure),
    networkGravity(snapshot, w.networkGravity),
    revenueQuality(snapshot, w.revenueQuality),
    growthMomentum(snapshot, w.growthMomentum),
  ];

  const rawScore = r1(pillars.reduce((s, p) => s + p.contribution, 0));
  const risk = assessRisk(airport, snapshot);
  const finalScore = Math.round(clamp(rawScore * risk.multiplier, 0, 100));

  const sources = Array.from(
    new Set(Object.values(snapshot).map((m: Measured<unknown>) => m.provenance)),
  ).filter((p) => p !== 'unavailable') as Provenance[];

  // Only pillars that actually count toward the score drive confidence.
  const scoringPillars = pillars.filter((p) => p.weight > 0);

  return {
    airport,
    snapshot,
    pillars,
    risk,
    rawScore,
    finalScore,
    confidence: overallConfidence(scoringPillars),
    dataSources: sources.length ? sources : ['structural'],
    unmetDemandShare: unmetDemandShare(snapshot),
    weightsApplied: w,
    redistributedFrom: excluded,
    thesis: buildThesis(airport, scoringPillars, finalScore),
  };
}

/** Ranks a set of scored airports. Stable, deterministic tie-breaking. */
export function rankAirports(scores: InvestmentScore[]): InvestmentScore[] {
  return [...scores].sort(
    (a, b) =>
      b.finalScore - a.finalScore ||
      b.rawScore - a.rawScore ||
      a.airport.iata.localeCompare(b.airport.iata),
  );
}

export { WEIGHT_RATIONALE };
