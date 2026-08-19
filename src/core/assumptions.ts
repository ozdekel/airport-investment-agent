/**
 * SINGLE SOURCE OF TRUTH for every magic number in the scoring engine.
 *
 * Every constant here is a modelling assumption an analyst is entitled to
 * challenge. Each one therefore carries: the value, the unit, the reasoning,
 * and an explicit uncertainty note. The methodology tab in the UI is rendered
 * from this object, so the documentation cannot drift from the code.
 */

export interface Assumption<T = number> {
  value: T;
  unit: string;
  reasoning: string;
  uncertainty: string;
}

const a = <T,>(value: T, unit: string, reasoning: string, uncertainty: string): Assumption<T> =>
  ({ value, unit, reasoning, uncertainty });

export const ASSUMPTIONS = {
  DEPARTURE_SLOTS_PER_RUNWAY_PER_DAY: a(
    160,
    'departures / runway / day',
    'A well-run runway sustains roughly 40 movements per hour over a ~16-hour operating day. Half of those movements are departures, giving ~320 movements or ~160 departures per runway per day.',
    'Real capacity varies with runway geometry, taxiway layout, terminal gates and curfews. Parallel runways closer than 1,035m cannot be used independently, so multi-runway airports may have less capacity than the count implies. Treat as +/- 30%.',
  ),

  SATURATION_UTILISATION: a(
    0.85,
    'ratio',
    'Airports begin to show queueing behaviour well before nominal capacity. 85% of theoretical slot capacity is the point at which we treat the asset as effectively saturated and expansion as justified.',
    'Derived from general queueing behaviour, not from airport-specific slot coordination data.',
  ),

  LONG_HAUL_THRESHOLD_KM: a(
    4000,
    'kilometres',
    'Great-circle distance beyond which a route is treated as long-haul. 4,000 km is roughly the point at which narrow-body economics give way to wide-body operations, which is what drives premium yield and terminal spend.',
    'Some narrow-bodies now fly beyond 4,000km. The threshold is a proxy for aircraft gauge and yield, not a hard operational boundary.',
  ),

  LONG_HAUL_TARGET_SHARE: a(
    0.25,
    'ratio',
    'Share of departures that are long-haul at which the network pillar is considered full marks. Major intercontinental hubs cluster in the 20-30% band.',
    'Highly geography-dependent. An island hub scores high mechanically; a dense short-haul market like intra-European scores low despite strong economics.',
  ),

  DESTINATION_SATURATION: a(
    150,
    'unique destinations',
    'Destination count is scored on a logarithmic curve saturating at 150. Going from 10 to 30 destinations transforms an airport; going from 150 to 170 does not.',
    'Observation window length biases this downward: a 24-hour sample misses weekly-frequency routes.',
  ),

  HEALTHY_CARRIER_HHI: a(
    0.10,
    'HHI (0-1)',
    'Herfindahl-Hirschman Index of the carrier mix. 0.10 corresponds to roughly ten evenly-sized carriers and is treated as a fully diversified, low-risk revenue base.',
    'Computed from observed callsign prefixes, which map to operators rather than commercial brands. Franchise and wet-lease flying may be misattributed.',
  ),

  DOMINANT_CARRIER_RISK_THRESHOLD: a(
    0.50,
    'ratio',
    'Above 50% share for a single carrier, airport revenue is structurally exposed to a single counterparty network strategy and financial health.',
    'A dominant flag carrier is not automatically bad - it can also mean guaranteed base traffic. We penalise it as volatility, not as quality.',
  ),

  DELAY_SATURATION_SHARE: a(
    0.25,
    'ratio',
    'Share of delayed departures at which the congestion signal is considered maxed out. Chronic delay is direct market evidence that demand exceeds infrastructure.',
    'Delay is also caused by weather, ATC strikes and airline scheduling padding. A single sampling window can be badly unrepresentative.',
  ),

  DELAY_THRESHOLD_MINUTES: a(
    15,
    'minutes',
    'Industry-standard on-time performance cut-off. A departure more than 15 minutes behind schedule counts as delayed.',
    'Standard and uncontroversial.',
  ),

  MOMENTUM_FLOOR: a(
    -0.10,
    'ratio',
    'Traffic change year-on-window at which growth scores zero. A 10% contraction is treated as an unambiguously negative signal.',
    'Two one-day windows are a very short baseline. Seasonality and day-of-week effects can dominate the true trend.',
  ),

  MOMENTUM_CEILING: a(
    0.20,
    'ratio',
    'Traffic change at which growth scores full marks. Sustained 20% growth is exceptional for a mature airport.',
    'See MOMENTUM_FLOOR. This pillar carries the lowest confidence of the four.',
  ),

  MAX_RISK_PENALTY: a(
    0.20,
    'ratio',
    'The risk assessment can reduce the final score by at most 20%. Risk adjusts a thesis; it does not replace it.',
    'The cap is a product decision: we would rather surface a risky opportunity with flags than bury it.',
  ),

  SAMPLING_WINDOW_HOURS: a(
    24,
    'hours',
    'Length of the live operations sampling window used to derive traffic, destinations and carrier mix.',
    'A 24-hour window under-counts destinations served less than daily and is sensitive to the day of week chosen.',
  ),

  IMPLAUSIBLE_UTILISATION: a(
    2.5,
    'ratio',
    'Above 250% of modelled slot capacity we stop believing our own input. No commercial airport operates at two and a half times its runway capacity; a reading that high means the departure count we were given is not a single-day figure. The demand pillar is capped, its confidence is forced to low, and an IMPLAUSIBLE_VOLUME flag is raised rather than reporting a confident 1,591%.',
    'The threshold is a judgement call. A genuinely extreme airport with unusually efficient parallel runway operations could in principle exceed our modelled capacity by more than this, and would be flagged unfairly.',
  ),

  MOMENTUM_LOOKBACK_DAYS: a(
    7,
    'days',
    'The comparison window sits 7 days before the primary window so that day-of-week effects cancel out.',
    'Seven days does not control for seasonality, holidays or one-off events.',
  ),
} as const;

/** Default weights. Must sum to 1. Analysts can override at request time. */
export const DEFAULT_WEIGHTS = {
  demandPressure: 0.35,
  networkGravity: 0.25,
  revenueQuality: 0.20,
  growthMomentum: 0.20,
} as const;

export const WEIGHT_RATIONALE: Record<keyof typeof DEFAULT_WEIGHTS, string> = {
  demandPressure:
    'Weighted highest because our customer is an investor, not an operator. The investable signal is demand the current infrastructure cannot serve - that is what an expansion thesis is built on.',
  networkGravity:
    'A capacity gap is only worth closing at an airport that already has network relevance. Gravity is the qualifier on demand pressure.',
  revenueQuality:
    'Determines whether incremental traffic converts into durable revenue, and how exposed that revenue is to a single counterparty.',
  growthMomentum:
    'Directional confirmation that the demand gap is widening rather than closing. Weighted lowest because our observation window is short and therefore noisy.',
};

/** Known, deliberate limitations. Rendered verbatim in the UI and the README. */
export const KNOWN_LIMITATIONS: string[] = [
  'Live flight data comes from AviationStack. The query is pinned to a single completed calendar day so the departure total is a genuine daily rate. If the provider rejects the dated query we fall back to an undated one, mark the volume as derived rather than observed, and refuse to build a confident utilisation ratio out of it.',
  'The free tier returns a 100-flight page. Volume comes from the provider total and is exact. Shares (long-haul, carrier mix, punctuality) come from the sample and are statistically sound at that size. The destination COUNT does not survive sampling, so it is corrected with a Chao1 richness estimator and both the observed and estimated figures are shown.',
  'Punctuality is measured only over sampled flights that had actually operated. Including flights still marked scheduled - which have no delay yet - drove the measured delay rate to zero at some of the busiest airports in the world.',
  'Runway count is a proxy for capacity, not a measurement of it. Terminal, gate, apron and airspace constraints are not modelled, and parallel runways closer than 1,035m cannot be used independently.',
  'We do not have passenger counts. Departures are the demand proxy throughout, which ignores aircraft gauge and load factor: twenty regional turboprops count the same as twenty widebodies.',
  '"Unmet demand" means departures delayed beyond 15 minutes or cancelled outright - demand the airport failed to serve. It does NOT capture suppressed demand: flights never scheduled because no slot existed. That is invisible in every open dataset, and conflating the two would overstate what we can see.',
  'The growth pillar needs two windows in time, which requires OpenSky credentials. Without them the pillar is excluded entirely and its weight redistributed, rather than scored as a neutral value that would pull every airport toward the middle.',
  'Carrier identity comes from the operating airline code, so codeshare and wet-lease flying may be attributed to the operator rather than the marketing carrier.',
  'Named market regions such as New England are a curated table in src/data/regions.ts, not a dataset. The grouping and its definition are shown to the analyst whenever one is used.',
  'Scores are relative and unitless. A score of 72 means "ranks well on our four pillars against the airports in this comparison", not "expected IRR of 72%".',
];
