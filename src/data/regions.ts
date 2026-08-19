/**
 * Named market regions.
 *
 * "Which airports in New England are candidates for terminal expansion?" is a
 * real analyst question, but "New England" is not a country, a continent or an
 * airport name - it is a market. No open dataset carries these groupings, so
 * they are curated here.
 *
 * This is a deliberately small, explicit, auditable table rather than an LLM
 * lookup. Asking a model to map a region to airport codes is exactly the kind
 * of quiet factual decision that should not be probabilistic: it would silently
 * change the answer set between runs, and a wrong code would flow straight into
 * a score. Adding a region is a one-line pull request.
 */

export interface MarketRegion {
  /** Canonical display name. */
  name: string;
  /** Lowercased strings that should resolve to this region. */
  aliases: string[];
  /** IATA codes, most significant first. */
  airports: string[];
  /** Shown to the analyst so the grouping is never a black box. */
  definition: string;
}

export const MARKET_REGIONS: MarketRegion[] = [
  {
    name: 'New England',
    aliases: ['new england', 'newengland', 'ne usa', 'northeast us', 'north east us'],
    airports: ['BOS', 'BDL', 'PVD', 'MHT', 'PWM', 'BTV'],
    definition: 'Commercial airports serving the six New England states: Massachusetts, Connecticut, Rhode Island, New Hampshire, Maine and Vermont.',
  },
  {
    name: 'US East Coast',
    aliases: ['us east coast', 'east coast', 'eastern seaboard', 'us northeast corridor'],
    airports: ['JFK', 'EWR', 'BOS', 'PHL', 'DCA', 'IAD', 'BWI', 'MIA'],
    definition: 'Primary commercial airports along the eastern seaboard of the United States.',
  },
  {
    name: 'US West Coast',
    aliases: ['us west coast', 'west coast', 'pacific coast us'],
    airports: ['LAX', 'SFO', 'SEA', 'SAN', 'PDX', 'OAK'],
    definition: 'Primary commercial airports on the Pacific coast of the United States.',
  },
  {
    name: 'Gulf',
    aliases: ['gulf', 'gcc', 'persian gulf', 'arabian gulf', 'middle east hubs', 'gulf states'],
    airports: ['DXB', 'DOH', 'AUH', 'RUH', 'JED', 'KWI', 'BAH', 'MCT'],
    definition: 'Gulf Cooperation Council hub airports.',
  },
  {
    name: 'Scandinavia',
    aliases: ['scandinavia', 'nordics', 'nordic', 'nordic countries'],
    airports: ['CPH', 'ARN', 'OSL', 'HEL', 'KEF', 'GOT', 'BGO'],
    definition: 'Primary commercial airports in Denmark, Sweden, Norway, Finland and Iceland.',
  },
  {
    name: 'Benelux',
    aliases: ['benelux', 'low countries'],
    airports: ['AMS', 'BRU', 'EIN', 'LUX', 'RTM'],
    definition: 'Primary commercial airports in Belgium, the Netherlands and Luxembourg.',
  },
  {
    name: 'DACH',
    aliases: ['dach', 'german speaking europe', 'germany austria switzerland'],
    airports: ['FRA', 'MUC', 'ZRH', 'VIE', 'DUS', 'BER', 'GVA'],
    definition: 'Primary commercial airports in Germany, Austria and Switzerland.',
  },
  {
    name: 'Iberia',
    aliases: ['iberia', 'iberian peninsula', 'spain and portugal'],
    airports: ['MAD', 'BCN', 'LIS', 'PMI', 'AGP', 'OPO'],
    definition: 'Primary commercial airports in Spain and Portugal.',
  },
  {
    name: 'Southeast Asia',
    aliases: ['southeast asia', 'south east asia', 'asean', 'sea hubs'],
    airports: ['SIN', 'BKK', 'KUL', 'CGK', 'MNL', 'HAN', 'SGN'],
    definition: 'Primary commercial hub airports across ASEAN member states.',
  },
  {
    name: 'Eastern Europe',
    aliases: ['eastern europe', 'cee', 'central and eastern europe'],
    airports: ['WAW', 'PRG', 'BUD', 'OTP', 'SOF', 'KRK', 'BEG'],
    definition: 'Primary commercial airports in Central and Eastern Europe.',
  },
];

const INDEX = new Map<string, MarketRegion>();
for (const r of MARKET_REGIONS) {
  INDEX.set(r.name.toLowerCase(), r);
  for (const a of r.aliases) INDEX.set(a, r);
}

export function findRegion(query: string): MarketRegion | null {
  const q = query.toLowerCase().trim().replace(/\s+/g, ' ');
  return INDEX.get(q) ?? null;
}
