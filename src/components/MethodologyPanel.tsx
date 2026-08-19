'use client';

import { useEffect, useState } from 'react';

/**
 * THE PROJECT DOCUMENT — architecture, data method, scoring methodology,
 * tradeoffs and AI usage, rendered in the product rather than shipped beside it.
 *
 * Weights, assumptions and tiers come from /api/methodology, which
 * reads the same modules the scoring engine does, so the documentation cannot
 * drift from the implementation.
 */

interface Assumption { value: number; unit: string; reasoning: string; uncertainty: string }
interface Methodology {
  weights: Record<string, number>;
  weightRationale: Record<string, string>;
  assumptions: Record<string, Assumption>;
  limitations: string[];
  dataset: { source: string; snapshotDate: string; airportCount: number; filter: string };
  tiers: Array<{ tier: string; name: string; role: string; freshness: string }>;
}

const SECTIONS = [
  { id: 'thesis', label: 'Thesis' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'data', label: 'Data' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'ai', label: 'AI & safety' },
  { id: 'tradeoffs', label: 'Tradeoffs' },
  { id: 'limits', label: 'Limits' },
] as const;

const PILLARS: Record<string, { label: string; colour: string; question: string; formula: string }> = {
  demandPressure: {
    label: 'Demand Pressure',
    colour: 'bg-blue-500',
    question: 'Is there demand this airport already cannot serve?',
    formula: '0.6 × norm(departures ÷ (runways × 160), 0, 0.85) + 0.4 × norm(delayed% + cancelled%, 0, 0.25)',
  },
  networkGravity: {
    label: 'Network Gravity',
    colour: 'bg-purple-500',
    question: 'Is it a hub, so added capacity compounds?',
    formula: '0.5 × logNorm(destinations, 150) + 0.3 × norm(longHaul%, 0, 0.25) + 0.2 × (continents ÷ 6)',
  },
  revenueQuality: {
    label: 'Revenue Quality',
    colour: 'bg-emerald-500',
    question: 'Does that traffic become durable revenue?',
    formula: '0.6 × ((1 − carrierHHI) ÷ 0.9) + 0.4 × norm(longHaul%, 0, 0.25)',
  },
  growthMomentum: {
    label: 'Growth Momentum',
    colour: 'bg-amber-500',
    question: 'Is the gap widening or closing?',
    formula: 'norm(trafficΔ week-on-week, −0.10, +0.20)',
  },
};

export function MethodologyPanel() {
  const [data, setData] = useState<Methodology | null>(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<string>('thesis');

  useEffect(() => {
    fetch('/api/methodology').then((r) => r.json()).then(setData).catch(() => setError(true));
  }, []);

  const go = (id: string) => {
    setActive(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (error) return <Shell nav={null}><p className="text-slate-500 text-sm">Could not load the methodology.</p></Shell>;
  if (!data) return <Shell nav={null}><p className="text-slate-400 text-sm animate-pulse">Loading…</p></Shell>;

  const nav = (
    <nav className="flex gap-1 overflow-x-auto">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          onClick={() => go(s.id)}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
            active === s.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );

  return (
    <Shell nav={nav}>
      {/* ── 1 · THESIS ─────────────────────────────────────────────── */}
      <section id="sec-thesis" className="scroll-mt-4">
        <p className="text-[22px] leading-snug font-semibold text-slate-900 max-w-3xl">
          Everyone knows Heathrow is a good airport. The analyst&apos;s job is to take
          the dry operating numbers and turn them into a view on{' '}
          <span className="text-blue-600">where the potential actually is</span>.
        </p>

        <div className="mt-5 rounded-2xl bg-slate-900 text-slate-100 px-5 py-5">
          <p className="font-mono text-[15px] mb-4">
            Investment Score = demand gap × asset strength ÷ counterparty risk
          </p>
          <div className="grid sm:grid-cols-3 gap-4 pt-4 border-t border-slate-700">
            <FormulaTerm
              term="demand gap"
              plain="Traffic the runways already cannot absorb."
              pillars="Demand Pressure"
            />
            <FormulaTerm
              term="asset strength"
              plain="Whether this airport is worth building at — a real hub, whose traffic turns into stable revenue."
              pillars="Network Gravity + Revenue Quality"
            />
            <FormulaTerm
              term="counterparty risk"
              plain="How much of that revenue depends on one airline, one route, one runway."
              pillars="Risk multiplier"
            />
          </div>
        </div>

      </section>

      {/* ── 2 · ARCHITECTURE ───────────────────────────────────────── */}
      <Section id="architecture" n="2" title="Architecture">
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          {/* Root */}
          <div className="px-6 py-4 bg-slate-900 text-white">
            <p className="font-bold text-sm">Investment Score Pipeline</p>
            <p className="text-xs text-slate-300 mt-1">Analyst question → structured query → scoring → analyst brief</p>
          </div>

          {/* Level 1 branches */}
          <div className="border-t border-slate-200 px-6 py-4 bg-slate-50">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Input */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-2">Input</p>
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-900">ai/intent</p>
                  <p className="text-[11px] text-slate-600 mt-1">Sentence to structured query. Temperature 0, schema validated, codes checked against dataset.</p>
                </div>
              </div>

              {/* Scoring engine */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">Engine</p>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold text-slate-900">core/</p>
                  <p className="text-[11px] text-slate-600 mt-1">Pure functions, no network. Four pillars, risk multiplier. <strong>HHI:</strong> carrier concentration. <strong>Chao1:</strong> destination diversity.</p>
                </div>
              </div>

              {/* Data layer */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">Data</p>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs font-semibold text-slate-900">data/</p>
                  <p className="text-[11px] text-slate-600 mt-1">Three tiers ranked by quality. Deduplication, caching, typed results. Degrades a tier at a time.</p>
                </div>
              </div>

              {/* Output */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-2">Output</p>
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-900">ai/narrator + guardrails</p>
                  <p className="text-[11px] text-slate-600 mt-1">Numbers to analyst brief. Forbidden to compute. Every figure checked against the input.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed max-w-3xl mt-4">
          <strong className="text-slate-900">Why split this way:</strong> nothing an
          analyst can act on comes from a language model — the model understands
          the question and writes the answer, and touches the pipeline nowhere else.
        </p>
      </Section>

      {/* ── 3 · DATA ───────────────────────────────────────────────── */}
      <Section id="data" n="3" title="Where the numbers come from">
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 bg-slate-900 text-white">
            <p className="font-bold text-sm">Acquisition ladder</p>
            <p className="text-[11px] text-slate-300 mt-0.5">Each tier is tried in order. A failure drops one rung, never the answer.</p>
          </div>

          <div className="px-5 py-4 bg-slate-50 space-y-0">
            {data.tiers.map((t, i) => (
              <div key={t.tier} className="relative pl-8 pb-4 last:pb-0">
                {i < data.tiers.length - 1 && (
                  <span className="absolute left-[11px] top-6 bottom-0 w-px bg-slate-300" aria-hidden />
                )}
                <span className={`absolute left-0 top-0.5 w-[23px] h-[23px] rounded-full flex items-center justify-center font-mono text-[10px] font-bold ${
                  i === 0 ? 'bg-blue-600 text-white' : i === 1 ? 'bg-slate-400 text-white' : 'bg-slate-900 text-white'
                }`}>
                  {t.tier}
                </span>

                <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-xs font-bold text-slate-900">{t.name}</p>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex-none">
                      {i === 0 ? 'primary' : i === 1 ? 'optional' : 'never fails'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed mt-1">{t.role}</p>
                  <p className="text-[10px] text-slate-400 mt-1.5">{t.freshness}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          <Stat value={data.dataset.airportCount.toLocaleString()} label="airports committed to the repo — the floor no outage removes" />
          <Stat value="4×" label="inflation removed by filtering codeshare listings" />
          <Stat value="100" label="API requests per month — the constraint that shaped the design" />
        </div>

        <p className="text-sm text-slate-600 leading-relaxed max-w-3xl mt-4">
          The free tier gives no dated queries, an empty delay field and a 100-record
          page. Volume, punctuality and destination counts are reconstructed from
          what it does return. Above 250% of modelled runway capacity the engine
          stops believing its own input and says so.
        </p>
      </Section>

      {/* ── 4 · SCORING ────────────────────────────────────────────── */}
      <Section id="scoring" n="4" title="Scoring methodology">
        <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
          An expansion case needs four things true at once. Each pillar answers one
          of them, and the weights say which one an investor should care about most.
        </p>

        <div className="rounded-xl border border-slate-200 overflow-hidden mt-4">
          {/* Root */}
          <div className="px-5 py-3 bg-slate-900 text-white">
            <p className="font-bold text-sm">Investment Score</p>
            <p className="text-[11px] text-slate-300 mt-0.5">Add up four pillars, then subtract for risk.</p>
          </div>

          {/* Composition bar */}
          <div className="px-5 pt-3.5 bg-slate-50">
            <p className="font-mono text-[10px] font-bold text-slate-500 mb-2">Step 1 · the four pillars, by weight</p>
            <div className="flex h-2 rounded-full overflow-hidden">
              {Object.entries(data.weights).map(([key, w]) => {
                const p = PILLARS[key];
                if (!p) return null;
                return <span key={key} className={p.colour} style={{ width: `${w * 100}%` }} />;
              })}
            </div>
          </div>

          {/* Pillar children */}
          <div className="px-5 pt-3 pb-4 bg-slate-50 space-y-2">
            {Object.entries(data.weights).map(([key, w]) => {
              const p = PILLARS[key];
              if (!p) return null;
              return (
                <div key={key} className="relative pl-5">
                  <span className={`absolute left-0 top-[13px] w-2.5 h-2.5 rounded-full ${p.colour}`} aria-hidden />
                  <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5">
                    <div className="flex items-baseline gap-3">
                      <h4 className="text-xs font-bold text-slate-900 flex-1">{p.label}</h4>
                      <span className="text-xs font-bold text-slate-900 tabular-nums flex-none">{(w * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-[11px] text-slate-700 mt-1">{p.question}</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed mt-1">{data.weightRationale[key]}</p>
                    <details className="mt-1.5">
                      <summary className="text-[9px] font-semibold uppercase tracking-wider text-blue-600 cursor-pointer list-none hover:text-blue-700">Formula</summary>
                      <pre className="text-[10px] font-mono text-emerald-700 bg-emerald-50/60 border border-emerald-100 rounded-lg px-3 py-2 mt-1.5 whitespace-pre-wrap leading-relaxed">{p.formula}</pre>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Risk leaf */}
          <div className="px-5 py-3.5 border-t border-slate-200 bg-white">
            <div className="flex items-baseline gap-2.5">
              <span className="font-mono text-xs font-bold text-rose-600 flex-none">Step 2 · × risk</span>
              <p className="text-xs font-bold text-slate-900">A penalty, applied after the four pillars are added up.</p>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed mt-1.5">
              Three things trigger it: one airline carrying most of the traffic, too
              few destinations, or a physical limit on the site. The penalty is capped
              at 20%, so the worst case turns a score of 80 into 64 — never into
              nothing. A risky opportunity stays visible and the analyst judges it,
              rather than quietly dropping down the ranking.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3 mt-4">
          <Rule
            title="Missing data is excluded, not neutralised"
            body="An unmeasurable pillar has its weight redistributed. Scoring it 50 drags every airport to the middle exactly when data is scarcest."
          />
          <Rule
            title="Confidence ships with the score"
            body="Every value carries its provenance — observed, derived, estimated — so the analyst sees which numbers to trust."
          />
        </div>

        <details className="mt-4 rounded-xl border border-slate-200">
          <summary className="px-4 py-2.5 cursor-pointer text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-xl">
            All {Object.keys(data.assumptions).length} modelling assumptions, with their uncertainty
          </summary>
          <div className="px-3 pb-3 space-y-1.5">
            {Object.entries(data.assumptions).map(([key, a]) => (
              <details key={key} className="rounded-lg bg-slate-50 border border-slate-100">
                <summary className="px-3 py-2 cursor-pointer flex justify-between items-baseline gap-3 list-none">
                  <span className="text-[11px] font-mono text-slate-700">{key}</span>
                  <span className="text-[11px] font-mono font-bold text-slate-900 flex-none tabular-nums">
                    {a.value} <span className="text-slate-400 font-normal">{a.unit}</span>
                  </span>
                </summary>
                <div className="px-3 pb-2.5 space-y-1.5">
                  <p className="text-[11px] text-slate-600 leading-relaxed">{a.reasoning}</p>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    <span className="font-bold uppercase tracking-wider text-[9px]">Uncertainty · </span>{a.uncertainty}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </details>
      </Section>

      {/* ── 5 · AI & SAFETY ────────────────────────────────────────── */}
      <Section id="ai" n="5" title="Where AI is used, and how it is contained">
        <div className="rounded-xl bg-slate-900 text-slate-100 px-5 py-4 font-mono text-[13px] leading-relaxed">
          The model understands the question and writes the answer.<br />
          It never decides, computes, weights or ranks.
        </div>

        {/* Containment flow — the model bookends the pipeline, never enters it */}
        <div className="rounded-xl border border-slate-200 overflow-hidden mt-4">
          <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-4 text-[9px] font-bold uppercase tracking-wider">
            <span className="flex items-center gap-1.5 text-blue-600">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> Probabilistic
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-2 h-2 rounded-full bg-slate-400" /> Deterministic
            </span>
          </div>

          <div className="px-5 py-4 flex flex-col md:flex-row md:items-stretch gap-2">
            <FlowNode tone="plain" label="Question" note="Free text from the analyst" />
            <FlowArrow />
            <FlowNode tone="ai" tag="Touchpoint 1" label="Intent" note="Sentence → structured query. Temperature 0, fixed schema, codes validated against the dataset." />
            <FlowArrow />
            <FlowNode tone="engine" label="Engine" note="Every number an analyst can act on is computed here. No model involved." />
            <FlowArrow />
            <FlowNode tone="ai" tag="Touchpoint 2" label="Narration" note="Finished numbers → brief. Receives only what it may quote, forbidden to do arithmetic." />
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-2">Two calls. That is the complete list — there is no third.</p>

        <SubHead>Four containment mechanisms</SubHead>
        <div className="grid md:grid-cols-2 gap-3">
          <Mechanism
            title="Structured output"
            problem="Free-text answers cannot be checked."
            solution="A fixed JSON schema, validated field by field. Anything outside it — an unknown code, an invented action — is dropped before the engine sees it."
          />
          <Mechanism
            title="Guardrails"
            problem="A fluent model invents plausible numbers."
            solution="Every figure is checked against the payload the model received. A violation swaps in the deterministic brief and leaves a badge — never an error, never a fabricated number."
          />
          <Mechanism
            title="Filler messages"
            problem="A five-second silence reads as a broken product."
            solution="The pipeline streams its real stages. The dashboard fills before the prose exists, because the scores do not depend on the model."
          />
          <Mechanism
            title="Graceful degradation"
            problem="Every external dependency will fail."
            solution="Each failure drops one tier and says so, rather than crashing or guessing. The ladder is below."
          />
        </div>

        <SubHead>Degradation ladder</SubHead>
        <p className="text-xs text-slate-500 leading-relaxed max-w-3xl -mt-1 mb-3">
          Everything below is a failure the product survives. They are ordered from
          the mildest at the top to total loss of the live data at the bottom — and
          even there, the last rung still answers.
        </p>
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          {[
            ['Live flight data fails', 'A structural estimate, labelled Estimated, at reduced confidence'],
            ['The growth signal is missing', 'That pillar is excluded and its weight redistributed'],
            ['Punctuality data is missing', 'Demand scored on utilisation alone, stated in the brief'],
            ['The language model fails', 'The same four-section brief, generated from the engine'],
            ['Guardrail validation fails', 'The deterministic brief, plus a badge saying why'],
            ['Everything fails at once', `${data.dataset.airportCount.toLocaleString()} airports of committed structural data — the product still answers`],
          ].map(([when, gets], i, arr) => {
            const last = i === arr.length - 1;
            return (
              <div key={when} className={`flex gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-slate-100' : ''} ${last ? 'bg-slate-900' : 'bg-white'}`}>
                <span className={`font-mono text-[10px] font-bold flex-none w-4 pt-0.5 ${last ? 'text-slate-500' : 'text-slate-300'}`}>
                  {i + 1}
                </span>
                <div className="flex-1 grid sm:grid-cols-2 gap-x-4 gap-y-0.5">
                  <p className={`text-xs font-semibold ${last ? 'text-white' : 'text-slate-800'}`}>{when}</p>
                  <p className={`text-[11px] leading-relaxed ${last ? 'text-slate-300' : 'text-slate-600'}`}>
                    <span className="sm:hidden font-semibold">→ </span>{gets}
                  </p>
                </div>
                {last && (
                  <span className="flex-none text-[9px] font-bold uppercase tracking-wider text-slate-500 pt-0.5">The floor</span>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-slate-500 leading-relaxed mt-4 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 max-w-3xl">
          <strong className="text-slate-800">Why all of this exists:</strong> the
          previous build pinned a model id that did not exist. Every call returned
          400, the error was swallowed, and the agent answered &ldquo;I couldn&apos;t
          identify any airport&rdquo; to every question ever asked — with nothing
          surfaced anywhere.
        </p>
      </Section>

      {/* ── 6 · TRADEOFFS ──────────────────────────────────────────── */}
      <Section id="tradeoffs" n="6" title="Decisions, and what they cost"
        lede="Nine choices that could have gone the other way. Each one bought something and gave something up.">
        {TRADEOFF_GROUPS.map((group) => (
          <div key={group}>
            <SubHead>{group}</SubHead>
            <div className="space-y-2.5">
              {TRADEOFFS.filter((t) => t.group === group).map((t) => (
                <div key={t.title} className="rounded-2xl border border-slate-200 px-4 py-3.5">
                  <div className="flex items-baseline gap-2.5 mb-2">
                    <span className="text-[10px] font-mono text-slate-300 font-bold">
                      {String(TRADEOFFS.indexOf(t) + 1).padStart(2, '0')}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900">{t.title}</h4>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-5 gap-y-1.5 pl-6">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      <span className="font-semibold text-emerald-700">Chose · </span>{t.chose}
                    </p>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      <span className="font-semibold text-rose-700">Cost · </span>{t.cost}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* ── 7 · LIMITS ─────────────────────────────────────────────── */}
      <Section id="limits" n="7" title="What this cannot tell you"
        lede="Not choices. These are the edges of what the data supports, and no decision on our side moves them.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            ['Not a return figure', 'A score of 72 means "ranks well on four pillars against this comparison set", not 72% IRR.'],
            ['No cost side', 'Land, construction, regulation, political risk and concession terms are all outside the model.'],
            ['No passengers', 'Departures are the demand proxy. Twenty turboprops count the same as twenty widebodies.'],
            ['No suppressed demand', 'We see flights delayed or cancelled, not flights never scheduled because no slot existed.'],
            ['No commercial revenue', 'Retail, parking and real estate are often the majority of an airport’s profit and are invisible here.'],
            ['Not backtested', 'The methodology is defensible but unvalidated. Testing it against announced expansion programmes is the next step.'],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs font-bold text-slate-900 mb-1">{t}</p>
              <p className="text-[11px] text-slate-500 leading-relaxed">{b}</p>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-slate-400 mt-5 pt-4 border-t border-slate-100 leading-relaxed">
          Weights, assumptions and tiers on this page are served from{' '}
          <code className="font-mono">/api/methodology</code>, which reads the same
          modules the engine uses — so this document cannot drift from the code.
          Structural data: {data.dataset.airportCount.toLocaleString()} airports,
          snapshot {new Date(data.dataset.snapshotDate).toISOString().slice(0, 10)}.
        </p>
      </Section>
    </Shell>
  );
}

const TRADEOFF_GROUPS = ['What the product is', 'How it measures', 'How it is built'] as const;

/** Ordered by how much the decision shapes the product, not by engineering interest. */
const TRADEOFFS = [
  {
    title: 'Score the demand gap, not airport quality',
    group: 'What the product is',
    chose: 'Rank airports by how much more traffic they have than they can handle. Congestion and delay read as opportunity.',
    cost: 'The output is counter-intuitive to anyone expecting "best airport" — it needs the thesis explained before the number means anything.',
  },
  {
    title: 'Build for the analyst, not the operator',
    group: 'What the product is',
    chose: 'Every output is a position an analyst can argue with: a recommendation, the reasoning, the counter-argument, and what would change the view.',
    cost: 'Nothing here is useful to an airport running its own operation — different customer, different product.',
  },
  {
    title: 'Departures as the demand proxy',
    group: 'How it measures',
    chose: 'Free passenger data does not exist at airport granularity with useful frequency, so departures stand in for demand.',
    cost: 'Aircraft size and load factor are invisible. This is the single largest source of error and it is stated as assumption one rather than buried.',
  },
  {
    title: 'Exclude a missing pillar rather than neutralise it',
    group: 'How it measures',
    chose: 'Redistribute its weight, so the score reflects only what was observed.',
    cost: 'A three-pillar score is not strictly the same quantity as a four-pillar one, so the exclusion is surfaced on every result.',
  },
  {
    title: 'Cap the risk penalty at 20%',
    group: 'How it measures',
    chose: 'Risk adjusts a thesis rather than replacing it — a flagged opportunity stays visible.',
    cost: 'A genuinely dangerous asset can still rank highly. The judgement is handed to the analyst, deliberately.',
  },
  {
    title: 'Curate market regions instead of asking the model',
    group: 'How it is built',
    chose: 'A hand-written, auditable table maps New England, the Gulf, DACH and others to airport codes.',
    cost: 'Only ten regions are covered. But a probabilistic mapping would change the answer set between runs, with one wrong code flowing straight into a score.',
  },
  {
    title: 'Commit the structural dataset',
    group: 'How it is built',
    chose: 'The full structural dataset lives in the repository, so the product has a floor no outage can remove — and something to validate model output against.',
    cost: 'It goes stale between rebuilds. The snapshot date is shown rather than implied.',
  },
  {
    title: 'Measure the APIs instead of trusting their docs',
    group: 'How it is built',
    chose: 'OpenSky looked strictly better on paper; measured, it returns 403 to anonymous callers and contributes nothing. AviationStack ships instead.',
    cost: 'A day spent on a data layer that was replaced. The diagnostic script that found it now ships with the repo.',
  },
  {
    title: 'Spend on the engine, not the model',
    group: 'How it is built',
    chose: 'The cheapest model tier for both AI touchpoints, since neither produces a number.',
    cost: 'Some fluency. The guardrails catch invented figures regardless of model quality.',
  },
];

/* ─────────────────────────────────────────────────────────── layout */

function Shell({ children, nav }: { children: React.ReactNode; nav: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {nav && (
        <div className="flex-none px-5 py-2.5 border-b border-slate-200 bg-white sticky top-0 z-10">{nav}</div>
      )}
      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-7 space-y-11 scroll-smooth">{children}</div>
    </div>
  );
}

function Section({ id, n, title, lede, children }: { id: string; n: string; title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section id={`sec-${id}`} className="scroll-mt-4">
      <h3 className={`text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600 pb-2 border-b border-slate-100 ${lede ? 'mb-3' : 'mb-4'}`}>
        {n} · {title}
      </h3>
      {lede && <p className="text-sm text-slate-600 leading-relaxed max-w-3xl mb-4">{lede}</p>}
      {children}
    </section>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 mt-6 mb-3">{children}</h4>;
}




function FlowNode({ tone, tag, label, note }: { tone: 'plain' | 'ai' | 'engine'; tag?: string; label: string; note: string }) {
  const skin =
    tone === 'ai' ? 'border-blue-200 bg-blue-50' :
    tone === 'engine' ? 'border-slate-300 bg-white ring-1 ring-slate-200' :
    'border-slate-200 bg-slate-50';
  return (
    <div className={`flex-1 rounded-lg border px-3 py-2.5 ${skin}`}>
      {tag && <p className="text-[9px] font-bold uppercase tracking-wider text-blue-600 mb-0.5">{tag}</p>}
      <p className="text-xs font-bold text-slate-900">{label}</p>
      <p className="text-[10px] text-slate-600 leading-relaxed mt-1">{note}</p>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex-none flex items-center justify-center text-slate-300 font-bold text-sm md:px-0.5" aria-hidden>
      <span className="md:hidden">↓</span>
      <span className="hidden md:inline">→</span>
    </div>
  );
}

function FormulaTerm({ term, plain, pillars }: { term: string; plain: string; pillars: string }) {
  return (
    <div>
      <p className="font-mono text-xs text-blue-300 mb-1.5">{term}</p>
      <p className="text-[11px] text-slate-300 leading-relaxed">{plain}</p>
      <p className="text-[10px] text-slate-500 mt-1.5">{pillars}</p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{value}</p>
      <p className="text-[11px] text-slate-500 leading-relaxed mt-1.5">{label}</p>
    </div>
  );
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
      <p className="text-xs font-bold text-slate-900 mb-1">{title}</p>
      <p className="text-[11px] text-slate-500 leading-relaxed">{body}</p>
    </div>
  );
}

function Mechanism({ title, problem, solution }: { title: string; problem: string; solution: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 px-4 py-3.5">
      <p className="text-sm font-bold text-slate-900">{title}</p>
      <p className="text-[11px] text-rose-700 leading-relaxed mt-1">{problem}</p>
      <p className="text-xs text-slate-600 leading-relaxed mt-1.5">{solution}</p>
    </div>
  );
}
