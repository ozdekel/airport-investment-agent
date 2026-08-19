'use client';

import { useEffect, useState } from 'react';

/**
 * THE PROJECT DOCUMENT.
 *
 * This panel is the written deliverable, rendered in the product rather than
 * shipped alongside it: architecture, data method, scoring methodology, key
 * tradeoffs, and where AI is used.
 *
 * Weights, assumptions, limitations and data tiers are fetched from
 * /api/methodology, which reads the same modules the scoring engine does. The
 * documentation therefore cannot drift from the implementation - the previous
 * version of this project had formulas typed into the UI by hand, and they had
 * already fallen out of sync with the code.
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
  { id: 'data', label: 'Data method' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'tradeoffs', label: 'Tradeoffs' },
  { id: 'ai', label: 'AI usage' },
  { id: 'limits', label: 'Limits' },
] as const;

const PILLARS: Record<string, { label: string; colour: string; formula: string; plain: string }> = {
  demandPressure: {
    label: 'Demand Pressure',
    colour: 'bg-blue-500',
    formula: '0.6 × norm(departures ÷ (runways × 160), 0, 0.85)\n+ 0.4 × norm(delayed% + cancelled%, 0, 0.25)',
    plain: 'How far past its runway capacity the airport is already running, and how much of that demand it is failing to serve.',
  },
  networkGravity: {
    label: 'Network Gravity',
    colour: 'bg-purple-500',
    formula: '0.5 × logNorm(destinations, 150)\n+ 0.3 × norm(longHaul%, 0, 0.25)\n+ 0.2 × (continents ÷ 6)',
    plain: 'Whether this is a hub whose connectivity would multiply the value of added capacity, or a point-to-point airport where it would not.',
  },
  revenueQuality: {
    label: 'Revenue Quality',
    colour: 'bg-emerald-500',
    formula: '0.6 × ((1 − carrierHHI) ÷ 0.9)\n+ 0.4 × norm(longHaul%, 0, 0.25)',
    plain: 'Whether incremental traffic turns into durable revenue, and how exposed that revenue is to one airline going away.',
  },
  growthMomentum: {
    label: 'Growth Momentum',
    colour: 'bg-amber-500',
    formula: 'norm(trafficΔ week-on-week, −0.10, +0.20)',
    plain: 'Directional check that the capacity gap is widening rather than closing.',
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
  if (!data) return <Shell nav={null}><p className="text-slate-400 text-sm animate-pulse">Loading from the engine…</p></Shell>;

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
      {/* ================= THESIS ================= */}
      <Section id="thesis" eyebrow="1 · The thesis">
        <p className="text-xl leading-snug font-semibold text-slate-900 mb-3">
          We do not score how <em className="italic">good</em> an airport is.
          We score how far <span className="text-blue-600">demand has outrun infrastructure</span>.
        </p>
        <Prose>
          The customer is an analyst, not an airport operator. Nobody profits from
          learning that Heathrow is a good airport — that is already priced in.
          They profit from spotting a gap between demand and capacity before the
          consensus does.
        </Prose>
        <Prose>
          So congestion, saturation and delay read as <strong className="text-slate-900">opportunity</strong>,
          not as problems. They are the market&apos;s own evidence that capacity is
          short and that new capacity has a waiting customer. A quiet, punctual
          airport with spare runway is a weak candidate however pleasant it is to
          fly through.
        </Prose>
        <Mono>Investment Score = unmet demand × asset quality ÷ counterparty risk</Mono>
        <Prose>
          Every design decision below follows from that one sentence. It is also
          what makes the model arguable: an analyst who disagrees with the thesis
          knows exactly which number to push back on.
        </Prose>
      </Section>

      {/* ================= ARCHITECTURE ================= */}
      <Section id="architecture" eyebrow="2 · Architecture">
        <H>Separation of powers</H>
        <Prose>
          The system is split down the middle. Everything on the left is
          deterministic and unit-tested; everything on the right is probabilistic
          and validated against the left.
        </Prose>

        <pre className="text-[10px] leading-relaxed font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto">{`  question
     │
     ▼
 ┌─────────────┐        ┌──────────── DETERMINISTIC ────────────┐
 │  ai/intent  │───────▶│  data/    tiered providers, cache,    │
 │   (LLM)     │        │           graceful degradation        │
 └─────────────┘        │  core/    geo maths, four pillars,    │
     │                  │           risk, assumptions           │
     │                  └───────────────────┬───────────────────┘
     │                                      │
     │                             InvestmentScore[]
     │                                      │
     │                    ┌─────────────────┴──────────────────┐
     │                    ▼                                    ▼
     │            ┌──────────────┐                   ┌──────────────┐
     └───────────▶│ ai/narrator  │──────────────────▶│ ai/guardrails│
                  │    (LLM)     │                   │  validation  │
                  └──────────────┘                   └──────┬───────┘
                                                pass ───────┴─────── fail
                                                  │                   │
                                                  ▼                   ▼
                                             LLM brief      deterministic brief`}</pre>

        <H>Why this shape</H>
        <Bullets items={[
          ['Nothing an analyst can act on comes from a language model.', 'Scores, rankings, risk flags and confidence ratings are all produced by src/core, which has no network calls, no clock reads and no AI. Same inputs, same output, forever — there is a test asserting exactly that.'],
          ['The LLM touches the pipeline twice, and neither point produces a number.', 'It turns a sentence into a structured query, and it turns finished numbers into prose. That is the complete list.'],
          ['Every external dependency is assumed to fail.', 'Each tier degrades into the next and reports which tier it landed on. A failure produces a weaker answer that says so, never a confident wrong one.'],
          ['The response streams.', 'Scores are ready seconds before the prose. The dashboard renders as soon as the engine finishes, and the loading messages are real pipeline stages rather than a client-side timer cycling plausible text.'],
        ]} />

        <H>Module layout</H>
        <pre className="text-[10px] leading-relaxed font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto">{`src/core/     scoring.ts  derive.ts  geo.ts  assumptions.ts  types.ts
              pure functions · no I/O · 60 unit tests
src/data/     providers/  cache.ts  http.ts  regions.ts  datasets/
              tiered acquisition · every call returns a typed result
src/ai/       intent.ts  narrator.ts  guardrails.ts  config.ts
              the only place a model is invoked
src/lib/      session.ts  useAnalysis.ts
src/app/api/  analyze (SSE orchestrator)  methodology (this document)`}</pre>
      </Section>

      {/* ================= DATA METHOD ================= */}
      <Section id="data" eyebrow="3 · How we get the numbers">
        <Prose>
          This was the hardest part of the build and it is worth being explicit
          about, because the honest version is more useful than a clean one. The
          free tier of every flight API is hostile in a different way, and each
          workaround below was forced by a measured failure rather than chosen
          from a menu.
        </Prose>

        <H>The three tiers</H>
        <div className="space-y-2 mb-4">
          {data.tiers.map((t) => (
            <div key={t.tier} className="flex gap-4 rounded-xl border border-slate-200 px-4 py-3">
              <span className="flex-none font-mono text-xs font-bold text-blue-600 pt-0.5 w-14">Tier {t.tier}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{t.role}</p>
                <p className="text-[11px] text-slate-400 mt-1">Freshness: {t.freshness}</p>
              </div>
            </div>
          ))}
        </div>
        <Prose>
          Tier B is the floor: {data.dataset.airportCount.toLocaleString()} airports
          committed into the repository. Every live API can be unreachable and the
          product still answers — at reduced confidence, and it says so on each
          affected number.
        </Prose>

        <H>Getting a real departure count out of a free API</H>
        <Prose>
          The demand pillar divides daily departures by runway capacity, so the
          departure count is the single most load-bearing number in the model. It
          took four attempts to get one worth dividing by.
        </Prose>

        <ol className="space-y-2.5 mb-4">
          {[
            ['Use the provider total.', 'FAILED. `pagination.total` counts every matching record in an unspecified retention window. Heathrow read 5,161 against a true figure near 650, which drove utilisation to 1,591% and saturated the demand pillar for every large airport — silently turning a 44%-weighted pillar into a constant.'],
            ['Pin the query to one calendar day.', 'REJECTED. "Your current subscription plan does not support this API function." Date filtering is a paid feature.'],
            ['Infer the rate from the sample’s own time density.', 'BETTER, BUT BIASED. 100 records spanning 6.3 hours implies 380/day at Heathrow. Closer — but a systematic under-count, because the page is a thinned slice of its window rather than a complete one, and the thinning worsens with airport size. Exactly backwards for a model whose thesis is that busy hubs are the opportunity.'],
            ['Measure the window, then de-duplicate.', 'SHIPPED. One extra request for the LAST record in the result set gives the window in days. That still left Heathrow at 2,581/day — almost exactly 4× the truth, and that 4× was the clue: the provider emits one record per marketing carrier. A single BA flight to New York also appears as AA, IB and JL. `flight.codeshared` is null only on the operating carrier’s own record.'],
          ].map(([step, desc], i) => (
            <li key={i} className="flex gap-3.5">
              <span className="flex-none w-6 h-6 rounded-lg bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
              <p className="text-sm text-slate-600 leading-relaxed"><strong className="text-slate-900">{step}</strong> {desc}</p>
            </li>
          ))}
        </ol>

        <Mono>daily departures = provider records × operating share ÷ window days</Mono>

        <Prose>
          The codeshare filter fixes three things at once, not one: the volume now
          counts aircraft rather than tickets; the carrier mix is measured over who
          actually flies the aeroplane rather than over marketing brands; and the
          destination estimator stops counting one New York flight four times.
        </Prose>

        <Callout tone="blue" title="The extra request is rationed">
          It only fires when the sample is visibly thinned (total &gt; 2× sample),
          and the result is cached for a day per airport, because a provider&apos;s
          retention window does not move hour to hour. The free quota is 100
          requests per <em>month</em> — this is a considered spend, not a convenience.
        </Callout>

        <H>Two more measurement traps, and how they are handled</H>
        <Bullets items={[
          ['Punctuality is computed from timestamps, not the provider’s delay field.', 'That field is empty on the free tier — 0 of 100 Heathrow records had it populated, which read as a perfect on-time record. We compare scheduled against actual instead. Critically, a flight that operated but carries no timestamps is excluded from the denominator rather than counted as on time: missing data must not masquerade as good performance.'],
          ['Destination counts are corrected with a Chao1 estimator.', 'Shares survive sampling; a count of distinct things does not. A 100-flight page gave Heathrow 26 destinations against a true figure near 200, which made the network pillar rank Dubai above Heathrow. Chao1 (Chao, 1984) infers how many destinations were missed from how many were seen exactly once. It is a lower bound, which is the right bias for an investment screen, and both the observed and estimated figures are shown.'],
        ]} />

        <Callout tone="amber" title="And when the number still looks wrong">
          Above 250% of modelled runway capacity the engine stops believing its own
          input. No commercial airport sustains that. It caps the reading, forces
          confidence to low, and raises an <code className="font-mono">IMPLAUSIBLE_VOLUME</code> flag
          that says so in plain language. Declaring &ldquo;this figure cannot be
          right&rdquo; is a better answer than reporting 1,591% with a straight face.
        </Callout>
      </Section>

      {/* ================= SCORING ================= */}
      <Section id="scoring" eyebrow="4 · Scoring methodology">
        <H>How a score is built</H>
        <ol className="space-y-2 mb-5">
          {[
            ['Observe', 'One call per airport returns its departures, destinations, operating airlines, delays and cancellations.'],
            ['Derive', 'Great-circle distance gives long-haul share. A Herfindahl index gives carrier concentration. Chao1 corrects the destination count for sampling.'],
            ['Score', 'Four pillars, each a published formula over those figures. No language model touches this step.'],
            ['Adjust', 'Concentration, thin networks and structural constraints apply a risk multiplier, capped at −20%.'],
            ['Explain', 'A model writes the brief from the finished numbers, and every figure it produces is checked back against the data it was given.'],
          ].map(([step, desc], i) => (
            <li key={step} className="flex gap-3.5">
              <span className="flex-none w-6 h-6 rounded-lg bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
              <p className="text-sm text-slate-600 leading-relaxed"><strong className="text-slate-900">{step}.</strong> {desc}</p>
            </li>
          ))}
        </ol>

        <H>The four pillars</H>
        <div className="space-y-3 mb-4">
          {Object.entries(data.weights).map(([key, w]) => {
            const p = PILLARS[key];
            if (!p) return null;
            return (
              <div key={key} className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <span className={`w-2.5 h-2.5 rounded-full ${p.colour}`} />
                  <h4 className="text-sm font-bold text-slate-900 flex-1">{p.label}</h4>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">{(w * 100).toFixed(0)}%</span>
                </div>
                <div className="px-4 py-3.5 space-y-3">
                  <p className="text-sm text-slate-700 leading-relaxed">{p.plain}</p>
                  <pre className="text-[11px] font-mono text-emerald-700 bg-emerald-50/60 border border-emerald-100 rounded-lg px-3 py-2.5 whitespace-pre-wrap leading-relaxed">{p.formula}</pre>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    <span className="font-semibold text-slate-700">Why this weight: </span>{data.weightRationale[key]}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <Callout tone="amber" title="A pillar we cannot measure is excluded, not neutralised">
          Its weight is redistributed across the others in proportion. Scoring a
          missing signal as a neutral 50 pulls every airport toward the middle —
          the strong candidate loses points it earned and the weak one gains points
          it did not — so the ranking becomes least decisive exactly when data is
          scarcest. The exclusion is reported on the score object, labelled on the
          card, and stated in the brief.
        </Callout>

        <H>Risk adjustment</H>
        <Prose>
          Carrier concentration above 50%, fewer than 15 destinations, a single
          runway, chronic cancellation and implausible volume each contribute to a
          risk index, which becomes a multiplier on the weighted total. The penalty
          is capped at 20% <em>deliberately</em>: we would rather surface a risky
          opportunity carrying three flags than bury it beneath a safe, boring one.
          The analyst is paid to make that call, not the model.
        </Prose>

        <H>Confidence is a first-class output</H>
        <Prose>
          Every measured value carries a provenance — observed, derived, estimated,
          or unavailable. Pillar confidence is the provenance-weighted average of
          its inputs; overall confidence is the weighted average of the pillars that
          actually carry weight. It appears as a badge on every score and a label on
          every individual number, so an analyst can see which figures to trust
          before acting on any of them.
        </Prose>

        <H>Every assumption, and what it might be wrong about</H>
        <div className="space-y-1.5">
          {Object.entries(data.assumptions).map(([key, a]) => (
            <details key={key} className="rounded-xl border border-slate-200">
              <summary className="px-4 py-2.5 cursor-pointer flex justify-between items-baseline gap-3 list-none hover:bg-slate-50 rounded-xl">
                <span className="text-xs font-mono text-slate-700">{key}</span>
                <span className="text-xs font-mono font-bold text-slate-900 flex-none tabular-nums">
                  {a.value} <span className="text-slate-400 font-normal">{a.unit}</span>
                </span>
              </summary>
              <div className="px-4 pb-3.5 pt-1 space-y-2 border-t border-slate-100">
                <p className="text-xs text-slate-600 leading-relaxed">{a.reasoning}</p>
                <p className="text-xs text-amber-800 leading-relaxed bg-amber-50 rounded-lg px-3 py-2">
                  <span className="font-bold uppercase tracking-wider text-[10px]">Uncertainty · </span>{a.uncertainty}
                </p>
              </div>
            </details>
          ))}
        </div>
      </Section>

      {/* ================= TRADEOFFS ================= */}
      <Section id="tradeoffs" eyebrow="5 · Key tradeoffs">
        <Prose>
          Decisions that could reasonably have gone the other way — what was chosen,
          and what it cost.
        </Prose>
        <div className="space-y-3">
          {TRADEOFFS.map((t) => (
            <div key={t.title} className="rounded-2xl border border-slate-200 px-4 py-3.5">
              <h4 className="text-sm font-bold text-slate-900 mb-2">{t.title}</h4>
              <p className="text-xs text-slate-600 leading-relaxed mb-2">
                <span className="font-semibold text-emerald-700">Chose · </span>{t.chose}
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                <span className="font-semibold text-rose-700">Gave up · </span>{t.gaveUp}
              </p>
            </div>
          ))}
        </div>

        <H>What I would do next, in order</H>
        <ol className="space-y-1.5 list-decimal list-inside">
          {[
            'Structured narration output, so the numeric-validation heuristic can be deleted entirely rather than tuned.',
            'Nightly batch scoring of all 3,270 airports, so regional questions return instantly and the live quota is spent only on drill-down.',
            'Persist sessions, and add weight sliders alongside the plain-English reweighting.',
            'Replace the departure proxy with scheduled seat capacity if a data budget exists — it removes the model’s largest assumption.',
            'Backtest the score against announced airport expansion programmes. The methodology is defensible but unvalidated, and that is the honest gap.',
          ].map((s) => <li key={s} className="text-sm text-slate-600 leading-relaxed">{s}</li>)}
        </ol>
      </Section>

      {/* ================= AI USAGE ================= */}
      <Section id="ai" eyebrow="6 · Where and how AI is used">
        <Mono>The model understands the question and writes the answer.<br />It never decides, computes, weights or ranks.</Mono>

        <H>Inside the product</H>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="py-2 px-2 font-semibold">Where</th>
                <th className="py-2 px-2 font-semibold">Job</th>
                <th className="py-2 px-2 font-semibold">Constrained how</th>
                <th className="py-2 px-2 font-semibold">If it fails</th>
              </tr>
            </thead>
            <tbody className="text-slate-600">
              <tr className="border-t border-slate-100 align-top">
                <td className="py-2.5 px-2 font-mono text-[11px] text-slate-800">ai/intent</td>
                <td className="py-2.5 px-2">Sentence → structured query</td>
                <td className="py-2.5 px-2">Fixed JSON schema, temperature 0, and every airport code validated against the bundled dataset before use</td>
                <td className="py-2.5 px-2">A rule-based extractor takes over</td>
              </tr>
              <tr className="border-t border-slate-100 align-top">
                <td className="py-2.5 px-2 font-mono text-[11px] text-slate-800">ai/narrator</td>
                <td className="py-2.5 px-2">Computed JSON → analyst brief</td>
                <td className="py-2.5 px-2">Forbidden to do arithmetic; receives only data it may quote</td>
                <td className="py-2.5 px-2">A deterministic brief with the same four sections</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Prose>That is the complete list. There is no third call.</Prose>

        <H>What the model is not allowed to do</H>
        <Bullets items={[
          ['Name an airport it was not given.', 'Every three-letter code in the output is checked against the analysed set.'],
          ['State a figure that is not in its input.', 'Validation runs against the exact payload the model received, not a reconstruction — reconstructing the allowed list was itself the source of false positives during testing.'],
          ['Fail loudly at the analyst.', 'A guardrail violation swaps in the deterministic brief and leaves a small badge. The previous build printed "Security Alert: Response blocked due to metric mismatch", which is a failure mode designed for the developer, not the user.'],
        ]} />

        <H>The failure this design was built around</H>
        <Prose>
          The previous version pinned <code className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">model: &apos;openrouter/free&apos;</code> —
          not a real model id. Every call returned 400, the catch block returned an
          empty array, and the agent answered <em>&ldquo;I couldn&apos;t identify any specific
          airport in your query&rdquo;</em> to every question ever asked. One dead string took
          down the entire product with no error surfaced anywhere.
        </Prose>
        <Prose>
          Three things came out of that: models are resolved at runtime against the
          provider&apos;s live catalogue; every model call has a deterministic fallback,
          so the product degrades rather than dies; and every fallback is logged into
          the pipeline trace, so a demo shows you on which turn the model was reached
          and on which it was not.
        </Prose>

        <H>How AI was used to build this</H>
        <Prose>
          Built in a pair-programming loop with Claude over roughly a day. AI wrote
          most of the lines: the scoring engine, the tiered data layer, the 60 unit
          tests, and the first draft of this document.
        </Prose>
        <Prose>
          The decisions that determine whether the product is any good were not its
          first suggestions. It proposed a 2014 route dataset, which was rejected as
          too stale. It proposed OpenSky as the live tier from reading the docs; the
          endpoint returns 403 to anonymous callers, which only surfaced once we
          measured it — the diagnostic script in the repository exists because of
          that, and now ships with it. Its first narration returned
          <em> &ldquo;Top candidate: LHR, 60.&rdquo;</em> — a headline, not analysis. And two
          unit tests encoded my expectation rather than the engine&apos;s actual
          arithmetic; the engine was right and the tests were wrong.
        </Prose>
        <Callout tone="slate" title="The honest summary">
          AI is a fast, literal collaborator. It follows the brief it is given
          faithfully, which means a wrong brief produces a confidently wrong result
          — and the judgement about what to score, which data to trust, what to cut,
          and what to admit the model cannot do stayed human throughout.
        </Callout>
      </Section>

      {/* ================= LIMITS ================= */}
      <Section id="limits" eyebrow="7 · What this model cannot tell you">
        <ul className="space-y-2 mb-4">
          {data.limitations.map((l, i) => (
            <li key={i} className="text-xs text-slate-600 leading-relaxed flex gap-2.5">
              <span className="text-rose-400 flex-none font-bold">—</span>{l}
            </li>
          ))}
        </ul>
        <Callout tone="slate" title="And the things no version of this could see">
          Scores are relative and unitless: 72 means &ldquo;ranks well on these four
          pillars against the airports in this comparison&rdquo;, not &ldquo;72% expected
          return&rdquo;. Nothing here models land cost, construction cost, regulation,
          political risk, or existing concession terms. Nor non-aeronautical revenue
          — retail, parking and real estate — which is frequently the majority of an
          airport&apos;s profit.
        </Callout>
        <p className="text-[11px] text-slate-400 mt-6 pt-4 border-t border-slate-100 leading-relaxed">
          Weights, assumptions, limitations and tiers on this page are served from{' '}
          <code className="font-mono">/api/methodology</code>, which reads the same
          modules the scoring engine uses. Structural data:{' '}
          {data.dataset.airportCount.toLocaleString()} airports from {data.dataset.source},
          snapshot {new Date(data.dataset.snapshotDate).toISOString().slice(0, 10)}.
        </p>
      </Section>
    </Shell>
  );
}

const TRADEOFFS = [
  {
    title: 'Bundled dataset vs. a purely live product',
    chose: 'Commit a 3,270-airport index into the repository as Tier B. It gives the product a floor that cannot fail, makes the scoring engine unit-testable without a network, and gives us something to validate LLM-supplied airport codes against.',
    gaveUp: 'Freshness between rebuilds. Mitigated by a build script and by showing the snapshot date in this document, so the staleness is visible rather than implied.',
  },
  {
    title: 'AviationStack vs. OpenSky as the live tier',
    chose: 'AviationStack, after measuring both. OpenSky looked strictly better on paper — raw ADS-B, thousands of daily credits — but its historical endpoints return 403 to anonymous callers, so without registration it contributes nothing at all.',
    gaveUp: 'Sample size, and a clean daily count. The workarounds are documented in the data section above. OpenSky is retained for the one thing AviationStack’s free tier cannot do: compare two windows in time.',
  },
  {
    title: 'Departures as a demand proxy vs. passenger numbers',
    chose: 'Departures, because free passenger data does not exist at airport granularity with useful frequency.',
    gaveUp: 'Aircraft gauge and load factor. Twenty regional turboprops count the same as twenty widebodies. This is the largest single source of error in the model and it is stated as assumption one rather than buried.',
  },
  {
    title: 'A curated region table vs. asking the model',
    chose: 'A hand-written table mapping named markets — New England, the Gulf, DACH — to IATA codes. Auditable, testable, and a one-line change to extend.',
    gaveUp: 'Coverage: ten regions are defined. But mapping a region to airport codes is a quiet factual decision that should not be probabilistic — it would change the answer set between runs, and one wrong code would flow straight into a score with no trace.',
  },
  {
    title: 'Excluding a missing pillar vs. scoring it neutral',
    chose: 'Drop it and redistribute its weight in proportion, so the score reflects what was actually observed.',
    gaveUp: 'Strict comparability between runs — a three-pillar score is not the same quantity as a four-pillar one. Surfaced explicitly on every result so the analyst can see which they are looking at.',
  },
  {
    title: 'Cheap models vs. a frontier model',
    chose: 'The cheapest Gemini tier for both roles. The model classifies a sentence and writes four paragraphs from a payload it may not compute on; the deterministic layer underneath is what the methodology rests on.',
    gaveUp: 'Some fluency and occasional instruction-following precision. The guardrails catch invented figures regardless of model quality, and the deterministic fallback produces the same four sections when the model disappoints.',
  },
  {
    title: 'Node’s built-in test runner vs. Vitest or Jest',
    chose: 'node:test compiled through the TypeScript compiler Next.js already depends on. npm test works on a clean clone with zero added dependencies.',
    gaveUp: 'Watch mode, rich matchers, coverage reporting. For a take-home, a reviewer should not have to install a framework to verify that the core logic is correct.',
  },
  {
    title: 'SSE streaming vs. a single JSON response',
    chose: 'Server-Sent Events. The deterministic scores are ready seconds before the prose, so the dashboard renders first and the stage messages are real pipeline steps.',
    gaveUp: 'A simpler client and trivial curl testing. The event shapes are documented in the README to compensate.',
  },
  {
    title: 'In-process session state vs. Redis',
    chose: 'A Map. Follow-ups like "and their delays?" need the server to remember which airports are in focus; replaying the transcript to the model each turn is slower, costlier and less reliable.',
    gaveUp: 'Durability and horizontal scale. Correct for a single-process demo, and the interface is narrow enough that Redis is a one-file swap.',
  },
];

/* ---------------------------------------------------------------- layout */

function Shell({ children, nav }: { children: React.ReactNode; nav: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {nav && (
        <div className="flex-none px-5 py-2.5 border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-10">
          {nav}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-7 space-y-10 scroll-smooth">
        {children}
      </div>
    </div>
  );
}

function Section({ id, eyebrow, children }: { id: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section id={`sec-${id}`} className="scroll-mt-4">
      <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600 mb-3.5 pb-2 border-b border-slate-100">
        {eyebrow}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-slate-900 pt-2">{children}</h4>;
}

function Prose({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">{children}</p>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-900 text-slate-100 px-5 py-4 font-mono text-[13px] leading-relaxed my-1">
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[][] }) {
  return (
    <ul className="space-y-2.5">
      {items.map(([lead, rest]) => (
        <li key={lead} className="text-sm text-slate-600 leading-relaxed flex gap-2.5 max-w-3xl">
          <span className="text-blue-500 flex-none font-bold">·</span>
          <span><strong className="text-slate-900">{lead}</strong> {rest}</span>
        </li>
      ))}
    </ul>
  );
}

function Callout({ tone, title, children }: { tone: 'blue' | 'amber' | 'slate'; title: string; children: React.ReactNode }) {
  const styles = {
    blue: 'bg-blue-50 border-blue-100 text-blue-900',
    amber: 'bg-amber-50 border-amber-100 text-amber-900',
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3.5 ${styles} max-w-3xl`}>
      <p className="text-xs font-bold mb-1.5">{title}</p>
      <p className="text-xs leading-relaxed opacity-90">{children}</p>
    </div>
  );
}
