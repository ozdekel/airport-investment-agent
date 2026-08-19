/**
 * Turns a sentence into a structured, deterministic query.
 *
 * SEPARATION OF POWERS: this is the ONLY place the LLM touches the input path,
 * and it is allowed to produce exactly one thing - a structured intent. It does
 * not fetch, score, weight or rank. Everything downstream is deterministic.
 *
 * Every LLM output is then validated against the bundled airport dataset, so a
 * hallucinated code cannot enter the pipeline. And when the LLM is unavailable
 * we fall through to a rule-based extractor that still resolves codes and place
 * names - a dead LLM degrades the conversation, it does not end it.
 */

import { chat, extractJson } from './client';
import { getByIata, findByPlace, byCountry, byContinent } from '@/data';
import { findRegion } from '@/data/regions';
import { ScoringWeights, AirportProfile } from '@/core/types';

export type IntentAction = 'analyze' | 'compare' | 'rank' | 'explain' | 'adjust_weights' | 'smalltalk';

export interface AnalystIntent {
  action: IntentAction;
  /** Explicit IATA codes mentioned. */
  airportCodes: string[];
  /** A place reference - country, continent, city or region. */
  place: string | null;
  /** A specific metric the analyst asked about, if any. */
  focus: 'delays' | 'longhaul' | 'destinations' | 'carriers' | 'capacity' | 'growth' | null;
  /** Weight adjustments requested in natural language. */
  weightAdjustments: Partial<ScoringWeights> | null;
  /** True when the question depends on what was already on screen. */
  refersToPrevious: boolean;
  /** How the intent was obtained - surfaced in the trace. */
  source: 'llm' | 'rules';
}

const SYSTEM = `You are an intent parser for an aviation investment analytics platform. You do not answer questions and you do not analyse anything. You only classify.

Return ONLY a raw JSON object, no markdown fences and no commentary, with exactly this shape:
{
  "action": "analyze" | "compare" | "rank" | "explain" | "adjust_weights" | "smalltalk",
  "airportCodes": string[],
  "place": string | null,
  "focus": "delays" | "longhaul" | "destinations" | "carriers" | "capacity" | "growth" | null,
  "weightAdjustments": { "demandPressure"?: number, "networkGravity"?: number, "revenueQuality"?: number, "growthMomentum"?: number } | null,
  "refersToPrevious": boolean
}

Rules:
- airportCodes: 3-letter IATA codes for airports or cities named explicitly. "Ben Gurion" -> ["TLV"], "Heathrow" -> ["LHR"]. Empty array if none.
- place: a country, continent or region name if one is mentioned ("Europe", "Israel", "New England"). Leave airportCodes empty in that case and let the platform resolve it.
- action "rank" for "which are the best/top candidates", "compare" for head-to-head, "explain" for questions about methodology or why a score is what it is, "adjust_weights" when the user wants to change scoring priorities.
- weightAdjustments: values are relative weights 0..1. "care more about congestion" -> {"demandPressure": 0.55}. Null otherwise.
- refersToPrevious: true for follow-ups like "and the delays there?", "what about the second one", "why is that".

Examples:
"compare LHR and DXB" -> {"action":"compare","airportCodes":["LHR","DXB"],"place":null,"focus":null,"weightAdjustments":null,"refersToPrevious":false}
"which airports in Israel are worth expanding?" -> {"action":"rank","airportCodes":[],"place":"Israel","focus":null,"weightAdjustments":null,"refersToPrevious":false}
"what about the delays there?" -> {"action":"analyze","airportCodes":[],"place":null,"focus":"delays","weightAdjustments":null,"refersToPrevious":true}
"stop caring so much about growth" -> {"action":"adjust_weights","airportCodes":[],"place":null,"focus":null,"weightAdjustments":{"growthMomentum":0.05},"refersToPrevious":true}`;

/** Deterministic extractor. Runs when the LLM is unavailable, and validates it when it is not. */
export function rulesIntent(query: string): AnalystIntent {
  const upper = query.toUpperCase();

  // Bare 3-letter tokens that resolve against the dataset. Requiring a dataset
  // hit is what stops "THE", "AND" and "TOP" from becoming airport codes.
  const candidates = upper.match(/\b[A-Z]{3}\b/g) ?? [];
  const codes = [...new Set(candidates)].filter((c) => getByIata(c) !== null);

  const lower = query.toLowerCase();
  const focus: AnalystIntent['focus'] =
    /delay|late|on.?time|congest/.test(lower) ? 'delays'
    : /long.?haul|intercontinental|wide.?body/.test(lower) ? 'longhaul'
    : /destination|route|network|connect/.test(lower) ? 'destinations'
    : /airline|carrier|concentrat/.test(lower) ? 'carriers'
    : /capacity|runway|slot|saturat/.test(lower) ? 'capacity'
    : /growth|trend|momentum|rising|increas/.test(lower) ? 'growth'
    : null;

  const action: IntentAction =
    /\bcompare\b|\bvs\b|\bversus\b/.test(lower) ? 'compare'
    : /\btop\b|\bbest\b|\brank\b|\bcandidates?\b|which airports/.test(lower) ? 'rank'
    : /\bwhy\b|\bhow do you\b|methodolog|explain/.test(lower) ? 'explain'
    : codes.length > 0 ? 'analyze'
    : 'analyze';

  // Try to spot a place name only when no explicit codes were found.
  let place: string | null = null;
  if (codes.length === 0) {
    // Named markets are checked against the whole query first, since they are
    // multi-word and would otherwise be broken up by the token scan below.
    for (const candidate of [query, query.replace(/[^A-Za-z ]/g, ' ')]) {
      const words = candidate.split(/\s+/).filter(Boolean);
      for (let n = Math.min(3, words.length); n >= 2 && !place; n--) {
        for (let i = 0; i + n <= words.length; i++) {
          if (findRegion(words.slice(i, i + n).join(' '))) { place = words.slice(i, i + n).join(' '); break; }
        }
      }
      if (place) break;
    }

    const stopwords = new Set(['what', 'which', 'where', 'the', 'and', 'for', 'are', 'best', 'top', 'airports', 'airport', 'about', 'compare', 'invest', 'expansion']);
    const words = query.split(/[^A-Za-z ]+/).join(' ').split(/\s+/).filter((w) => w.length > 2 && !stopwords.has(w.toLowerCase()));
    for (let n = Math.min(3, words.length); n >= 1 && !place; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const phrase = words.slice(i, i + n).join(' ');
        if (findByPlace(phrase, 1).length > 0) { place = phrase; break; }
      }
    }
  }

  return {
    action,
    airportCodes: codes,
    place,
    focus,
    weightAdjustments: null,
    refersToPrevious: codes.length === 0 && place === null,
    source: 'rules',
  };
}

export async function parseIntent(query: string, history: Array<{ role: string; content: string }>): Promise<AnalystIntent> {
  const recent = history.slice(-6).map((h) => `${h.role}: ${h.content}`).join('\n');
  const userPrompt = recent
    ? `Recent conversation:\n${recent}\n\nClassify this new message:\n"${query}"`
    : `Classify this message:\n"${query}"`;

  const res = await chat({ role: 'fast', system: SYSTEM, user: userPrompt, temperature: 0, maxTokens: 300, label: 'llm:intent' });

  if (!res.ok) {
    console.warn(`[intent] LLM unavailable (${res.reason}) - using the rule-based extractor`);
    return rulesIntent(query);
  }

  const parsed = extractJson(res.text) as Partial<AnalystIntent> | null;
  if (!parsed || typeof parsed !== 'object') {
    console.warn('[intent] LLM returned unparseable JSON - using the rule-based extractor');
    return rulesIntent(query);
  }

  // VALIDATE. The model is not trusted to produce real airport codes.
  const rawCodes = Array.isArray(parsed.airportCodes) ? parsed.airportCodes : [];
  const validCodes = [...new Set(rawCodes.map((c) => String(c).toUpperCase()))].filter((c) => getByIata(c) !== null);
  const rejected = rawCodes.filter((c) => !validCodes.includes(String(c).toUpperCase()));
  if (rejected.length) console.warn(`[intent] rejected unknown codes from LLM: ${rejected.join(', ')}`);

  const allowedActions: IntentAction[] = ['analyze', 'compare', 'rank', 'explain', 'adjust_weights', 'smalltalk'];
  const action = allowedActions.includes(parsed.action as IntentAction) ? (parsed.action as IntentAction) : 'analyze';

  return {
    action,
    airportCodes: validCodes,
    place: typeof parsed.place === 'string' && parsed.place.trim() ? parsed.place.trim() : null,
    focus: (parsed.focus ?? null) as AnalystIntent['focus'],
    weightAdjustments: parsed.weightAdjustments && typeof parsed.weightAdjustments === 'object' ? parsed.weightAdjustments : null,
    refersToPrevious: Boolean(parsed.refersToPrevious),
    source: 'llm',
  };
}

/** Deterministic resolution of an intent to a concrete airport set. No LLM. */
export function resolveAirports(intent: AnalystIntent, limit = 6): { airports: AirportProfile[]; note: string | null } {
  if (intent.airportCodes.length > 0) {
    const airports = intent.airportCodes.map(getByIata).filter((a): a is AirportProfile => a !== null);
    return { airports: airports.slice(0, limit), note: null };
  }

  if (intent.place) {
    // Named markets first. "New England" is neither a country nor a continent,
    // but it is exactly how an analyst frames the question.
    const region = findRegion(intent.place);
    if (region) {
      const airports = region.airports.map(getByIata).filter((a): a is AirportProfile => a !== null).slice(0, limit);
      if (airports.length) {
        return { airports, note: `Resolved "${intent.place}" to the ${region.name} market: ${airports.map((a) => a.iata).join(', ')}. ${region.definition}` };
      }
    }

    const byC = byCountry(intent.place, limit);
    if (byC.length) return { airports: byC, note: `Resolved "${intent.place}" to the ${byC.length} largest commercial airports in that country.` };

    const byCont = byContinent(intent.place, limit);
    if (byCont.length) return { airports: byCont, note: `Resolved "${intent.place}" to the ${byCont.length} largest commercial airports on that continent.` };

    const fuzzy = findByPlace(intent.place, limit);
    if (fuzzy.length) return { airports: fuzzy, note: `Matched "${intent.place}" to ${fuzzy.length} airports by name and city.` };

    return { airports: [], note: `No airports in the dataset matched "${intent.place}".` };
  }

  return { airports: [], note: null };
}
