/**
 * Serves the scoring methodology straight out of the code.
 *
 * The previous UI had the formulas typed by hand into the React component, and
 * they had already drifted out of sync with the engine - the panel claimed
 * `min(Flights/100,1)*50` while the code computed `min(Flights/500,1)*60`.
 * Documentation that can lie is worse than no documentation, so the panel now
 * reads from the same module the engine does.
 */

import { NextResponse } from 'next/server';
import { ASSUMPTIONS, DEFAULT_WEIGHTS, WEIGHT_RATIONALE, KNOWN_LIMITATIONS } from '@/core/assumptions';
import { DATASET_META } from '@/data';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    weights: DEFAULT_WEIGHTS,
    weightRationale: WEIGHT_RATIONALE,
    assumptions: ASSUMPTIONS,
    limitations: KNOWN_LIMITATIONS,
    dataset: DATASET_META,
    tiers: [
      { tier: 'A', name: 'AviationStack', role: 'Live departures, destinations, carrier mix, delays and cancellations - one call per airport', freshness: 'Today, quota permitting' },
      { tier: 'A+', name: 'OpenSky Network', role: 'Week-on-week traffic momentum. Requires free credentials; its historical endpoints reject anonymous callers', freshness: 'Previous day, batch processed' },
      { tier: 'B', name: 'OurAirports', role: 'Airport identity, geography, runway capacity. Bundled in the repo so the product always has a floor', freshness: DATASET_META.snapshotDate },
    ],
  });
}
