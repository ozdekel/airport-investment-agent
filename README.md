# AeroInvest — Airport Expansion Screening Agent

> ## Demo video
> **▶ [Watch the 5-minute walkthrough](PASTE_YOUR_LOOM_LINK_HERE)**
>
> _Replace this link before submitting._

A conversational agent that helps infrastructure analysts screen airports for
expansion investment. It combines a **deterministic scoring engine** with an LLM
that is confined to two narrow jobs: understanding the question, and writing the
answer. The LLM never computes, weights or ranks anything.

```
"Which airports in Israel are worth expanding?"
   → TLV  71/100  · high confidence
     Operating at 94.2% of modelled slot capacity — effectively saturated.
```

---

## 1. The thesis (and why it shapes everything else)

The customer is an **analyst**, not an airport operator. An analyst does not
profit from learning that Heathrow is a good airport — everyone knows that. They
profit from spotting a **gap between demand and infrastructure** before the
consensus does.

So the product does not score "how good is this airport". It scores:

```
Investment Score  =  unmet demand  ×  asset quality  ÷  counterparty risk
```

This single decision explains most of the design:

| Consequence | Why |
|---|---|
| Congestion and saturation are **positive** signals | They are the market's own evidence that infrastructure is short |
| Traffic is measured **relative to runway capacity**, never in absolute terms | 300 departures across 2 runways is pressure; across 6 runways it is comfort |
| Growth is weighted **lowest** of the four pillars | Our observation window is short and therefore noisy — see [Methodology](docs/METHODOLOGY.md) |
| Every score ships with a **confidence rating** | An analyst needs to know which numbers to trust before they act on them |

Full breakdown: **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)**

---

## 2. Architecture

### Separation of powers

The system is split down the middle. Everything on the left is deterministic and
testable; everything on the right is probabilistic and validated.

```
                    ┌──────────────── DETERMINISTIC ────────────────┐
   user question    │                                               │
        │           │   src/core/     scoring engine, geo maths,    │
        ▼           │                 assumptions, derivations      │
  ┌───────────┐     │                                               │
  │ ai/intent │────▶│   src/data/     tiered providers, cache,      │
  │  (LLM)    │     │                 graceful degradation          │
  └───────────┘     │                                               │
        │           │   3,270-airport dataset bundled in the repo   │
        ▼           └───────────────────────┬───────────────────────┘
   airport set                              │
        │                                   ▼
        │                            InvestmentScore[]
        │                                   │
        │                    ┌──────────────┴─────────────┐
        │                    ▼                            ▼
        │            ┌──────────────┐            ┌────────────────┐
        └───────────▶│ ai/narrator  │───────────▶│ ai/guardrails  │
                     │    (LLM)     │            │  validation    │
                     └──────────────┘            └───────┬────────┘
                                                         │
                                        pass ────────────┤──────── fail
                                          │                        │
                                          ▼                        ▼
                                     LLM prose          deterministic summary
```

**The LLM touches the pipeline in exactly two places**, and neither is allowed
to produce a number:

1. `src/ai/intent.ts` — natural language → a structured query. Every airport
   code it returns is validated against the bundled dataset before use, so a
   hallucinated code cannot enter the pipeline. If the LLM is down, a rule-based
   extractor takes over and the conversation continues.
2. `src/ai/narrator.ts` — computed JSON → analyst prose. Its output is then
   checked by `src/ai/guardrails.ts`, which rejects any figure or airport code
   that was not in the input data.

### Data tiers and graceful degradation

Every external dependency is assumed to fail. The system degrades a tier at a
time and **says which tier it landed on** rather than silently guessing.

| Tier | Source | Provides | Failure behaviour |
|---|---|---|---|
| **A** | [AviationStack](https://aviationstack.com) | Departures, destinations, carrier mix, delays, cancellations — **one call per airport** | Falls through to Tier B, marked `Estimated`, confidence drops |
| **A+** | [OpenSky Network](https://opensky-network.org) *(optional)* | Week-on-week traffic momentum | Growth pillar is **excluded** and its weight redistributed |
| **B** | [OurAirports](https://ourairports.com/data/) *(bundled)* | Airport identity, geography, runway capacity | Cannot fail — it is committed to the repo |

Tier B is the floor. The agent can answer with zero access to any flight API; it
just answers with lower confidence and says so on every affected metric.

**Why AviationStack and not OpenSky as the primary tier.** OpenSky was the first
choice — raw ADS-B, generous limits. Its historical endpoints turn out to reject
anonymous callers outright (`HTTP 403 "You cannot access historical flights"`,
verified against LLBG, EGLL, KJFK and OMDB), so without registration it
contributes nothing. AviationStack works on its free tier today and returns the
arrival airport, operating airline and departure delay for every flight — enough
to derive every operational metric from a single HTTP call. OpenSky is retained
for the one thing AviationStack's free tier cannot do: compare two windows in
time. See [docs/TRADEOFFS.md](docs/TRADEOFFS.md).

**When a signal is missing we exclude it rather than neutralise it.** If the
growth pillar has no data, its weight is redistributed across the other three in
proportion. Scoring it as a neutral 50 would pull every airport toward the middle
exactly when data is scarce, making the ranking least useful when it matters
most. The exclusion is reported in `redistributedFrom` and shown on the card.

### Latency and the user experience

The deterministic scores are ready several seconds before the LLM finishes
writing. Holding them back would mean staring at a spinner while data we already
have sits in memory. So `/api/analyze` streams **Server-Sent Events**:

```
stage     → real pipeline step, not a client-side timer
trace     → each data-source decision, fallback and guardrail verdict
scores    → the dashboard renders HERE, before any prose exists
narration → the written summary arrives last
done      → total elapsed ms
```

The **Pipeline Trace** tab in the UI shows the `trace` stream verbatim, so the
reasoning behind every answer is inspectable during a live demo.

---

## 3. API contract

### `POST /api/analyze`

**Request**

```json
{
  "userQuery": "compare LHR and DXB",
  "sessionId": "session-1739e"
}
```

`sessionId` carries the conversation. The server holds the airports currently in
focus and the active scoring weights, which is what makes follow-ups like
*"and the delays there?"* or *"stop caring so much about growth"* resolve
correctly.

**Response** — `text/event-stream`

```
event: stage
data: {"stage":"intent","message":"Reading the question..."}

event: trace
data: {"line":"OpenSky: 431 departures observed over 24h; 87% of destinations resolved."}

event: scores
data: {"scores":[{ ... InvestmentScore ... }],"weights":{"demandPressure":0.35, ...}}

event: narration
data: {"text":"Top candidate: ...","origin":"llm","guardrail":{"passed":true,"violations":[]}}

event: done
data: {"elapsedMs":4120}
```

**A single `InvestmentScore`** (abridged)

```json
{
  "airport": { "iata": "LHR", "icao": "EGLL", "name": "London Heathrow Airport",
               "country": "United Kingdom", "runways": { "count": 2, "maxLengthFt": 12799 } },
  "finalScore": 74,
  "rawScore": 78.1,
  "confidence": "high",
  "thesis": "Strong candidate (74/100). Led by Demand Pressure at 100; held back by Growth Momentum at 41.",
  "pillars": [{
    "key": "demandPressure",
    "label": "Demand Pressure",
    "score": 100,
    "weight": 0.35,
    "contribution": 35,
    "formula": "0.65 x norm(departures / (runways x 160), 0, 0.85) + 0.35 x norm(delayShare, 0, 0.25)",
    "inputs": { "dailyDepartures": 431, "runways": 2, "theoreticalDailyCapacity": 320, "utilisation": "134.7%" },
    "rationale": "Operating at 134.7% of modelled slot capacity - effectively saturated.",
    "confidence": "high"
  }],
  "risk": { "index": 0.12, "multiplier": 0.976,
            "flags": [{ "code": "CARRIER_CONCENTRATION", "severity": "medium", "message": "..." }] },
  "dataSources": ["live", "derived", "enriched"]
}
```

Every pillar carries the **formula that produced it** and the **inputs that went
in**, so any number on screen can be traced back to its arithmetic.

### `GET /api/methodology`

Returns the weights, assumptions, uncertainty notes, data tiers and known
limitations — read directly from `src/core/assumptions.ts`. The UI's methodology
tab is rendered from this endpoint, so the documentation cannot drift from the
implementation.

---

## 4. Quickstart

```bash
git clone <this-repo> && cd airport-investment-agent
npm install
cp .env.example .env.local     # add your OpenRouter key
npm run dev                    # http://localhost:3000
```

**Two keys matter**: `OPENROUTER_API_KEY` ([get one](https://openrouter.ai/keys))
for the language layer, and `AVIATION_API_KEY`
([free tier](https://aviationstack.com/product)) for live flight data.

| Variable | Required | Effect if missing |
|---|---|---|
| `OPENROUTER_API_KEY` | **yes** | Falls back to the rule-based extractor and deterministic summaries — the scores still work, the prose does not |
| `AVIATION_API_KEY` | strongly recommended | Without it every metric falls back to a class-based **estimate** and scores across airports look similar |
| `OPENSKY_CLIENT_ID` / `_SECRET` | no | Growth pillar is excluded and its 20% weight redistributed across the other three |

```bash
npm test        # 43 unit tests over the deterministic core, the guardrails and the region table
npm run typecheck
npm run build:data   # rebuild the airport index from OurAirports
npm run diagnose     # check every data tier and print exactly what came back
```

If scores look suspiciously similar and every metric on the cards reads
`ESTIMATED`, the live tier is not returning data. `npm run diagnose` says which
provider is failing and why.

The test suite uses Node's built-in test runner and the TypeScript compiler that
Next.js already depends on — **no test framework was added to the dependency
tree.**

---

## 5. Try these

The four questions from the assignment brief, in order:

| Question | What it demonstrates |
|---|---|
| `Which airports in New England are the strongest candidates for terminal expansion?` | Named-market resolution — "New England" is neither a country nor a continent, so it comes from a curated, auditable table rather than an LLM guess |
| `Compare LHR and DXB on congestion` | Head-to-head on utilisation and unmet demand, with risk flags |
| `What share of departures from TLV are long-haul?` | Computed from great-circle distance to every observed destination, not a constant |
| `What percentage of demand goes unmet at BOS?` | Delayed-beyond-15-minutes plus cancelled, as a single reported figure |

Plus two that show the conversational and HITL layers:

| Question | What it demonstrates |
|---|---|
| `And what about their carrier concentration?` | Conversational memory — "their" resolves server-side against the airports already in focus |
| `Care more about congestion, less about growth` | Human-in-the-loop reweighting in plain English, applied to the current selection |

---

## 6. Documentation

| Document | Contents |
|---|---|
| **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)** | The four pillars, every formula, every assumption, and what the model explicitly cannot tell you |
| **[docs/TRADEOFFS.md](docs/TRADEOFFS.md)** | The decisions that went the other way, and what would change at production scale |
| **[docs/AI_USAGE.md](docs/AI_USAGE.md)** | Where AI sits in the product, and how AI was used to build it |

### What an answer looks like

The agent does not restate the dashboard. It returns a four-part brief:

> **Recommendation**
> Ben Gurion (TLV) scores 55/100 - keep it on the watchlist rather than committing. Treat this as medium-confidence: live flight coverage was unavailable, so its traffic figures are class-based estimates.
>
> **Why**
> Three runways absorbing an estimated 264 departures a day leaves real headroom before queueing starts, so the capacity-shortage case is weak on current evidence...
>
> **The counter-argument**
> ...
>
> **What would change this view**
> A live traffic observation. Everything above rests on an estimate from airport class and runway count.

The same structure is produced by the deterministic fallback, so an analyst
cannot tell from the shape of the answer whether the LLM was reachable - only
from the badge underneath it.

---

## 7. Project layout

```
src/
├── core/            deterministic engine — no network, no LLM, no clock
│   ├── assumptions.ts   every constant, with reasoning and uncertainty
│   ├── scoring.ts       the four pillars and the risk multiplier
│   ├── derive.ts        observed flights → metrics (pure, injectable)
│   ├── geo.ts           haversine, Herfindahl, normalisation
│   └── types.ts         domain model
├── data/            tiered providers with graceful degradation
│   ├── datasets/        3,270-airport index, committed
│   ├── regions.ts       curated named markets (New England, Gulf, DACH...)
│   ├── providers/       aviationstack.ts (Tier A), opensky.ts (Tier A+)
│   ├── http.ts          hardened fetch — never throws at callers
│   └── cache.ts         TTL cache protecting small external quotas
├── ai/              probabilistic layer, tightly fenced
│   ├── intent.ts        NL → structured query, validated + rule fallback
│   ├── narrator.ts      computed JSON → prose
│   ├── guardrails.ts    factual grounding, deterministic fallback
│   └── config.ts        runtime model resolution
├── lib/session.ts   server-side conversation state
├── components/      ScoreCard, MethodologyPanel
└── app/
    ├── api/analyze/     SSE orchestrator
    └── api/methodology/ machine-readable methodology
tests/               43 unit tests over src/core, src/ai/guardrails, src/data/regions
scripts/             dataset build script
```

---

## Data sources and licensing

- **OurAirports** — public domain. Rebuilt nightly; the bundled snapshot's date is in the index metadata.
- **OpenSky Network** — free for non-commercial use. Crowd-sourced ADS-B.
- **AviationStack** — free tier, 100 requests/month.
