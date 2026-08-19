# Key Tradeoffs

Decisions that could reasonably have gone the other way, what we chose, and what
we gave up.

---

## 1. Bundled dataset vs. pure live API

**Chose:** commit a 3,270-airport index (~1 MB) into the repo as Tier B.

The obvious alternative was to fetch everything live. We rejected it because the
free tiers available make it impossible to build anything trustworthy:
AviationStack allows **100 requests per month** and returns a 100-row page, which
would make every airport report roughly 100 daily flights and score identically.

Committing the structural layer buys three things:

- **A floor.** Every live API can be down and the agent still answers, at reduced
  confidence, instead of failing.
- **A testable core.** The scoring engine can be unit-tested against fixtures
  because it does not need the network to produce a number.
- **A validation surface.** Airport codes returned by the LLM are checked against
  the index before entering the pipeline, so hallucinated codes cannot propagate.

**Gave up:** the index goes stale between rebuilds. Mitigated by `npm run build:data`
and by the snapshot date being surfaced in the methodology panel — the freshness
is visible, not implied.

## 2. AviationStack vs. OpenSky as the live tier

**Chose OpenSky first, and was wrong.** It looked like the better foundation:
raw ADS-B, thousands of daily credits, a real arrival airport per flight. What
the documentation does not say is that its historical endpoints reject anonymous
callers entirely:

```
GET /flights/departure?airport=LLBG&begin=...&end=...
HTTP 403  "You cannot access historical flights"
```

Verified against LLBG, EGLL, KJFK and OMDB — every one, in 70–270ms. Anonymous
OpenSky contributes literally nothing, and the whole product silently fell
through to class-based estimates. Every airport scored roughly alike, which is
the exact failure the rewrite was supposed to eliminate.

**Chose AviationStack instead**, having actually measured it: 100 flights
returned for TLV on the free tier, first try. Each record carries the arrival
airport, the operating airline and the departure delay — enough to derive
destinations, carrier concentration, long-haul share, delays and cancellations
from **one HTTP call per airport**.

**Gave up:** sample size. The free tier returns a 100-flight page. We take
*volume* from `pagination.total`, which is exact, and *shares* from the sample,
which is statistically sound at n=100. The one casualty is the unique-destination
**count**, which is bounded by the sample and under-reports large hubs. That is
recorded on the metric and shown in the UI rather than smoothed over.

**Kept OpenSky as Tier A+** for the single thing AviationStack's free tier cannot
do: compare two windows in time. With credentials it supplies growth momentum;
without them that pillar is excluded and reweighted.

**The transferable lesson:** the diagnostic script that found this
(`npm run diagnose`) took ten minutes to write and turned a wrong architectural
assumption into a measured fact. It shipped as part of the repo.

**At production scale** this flips again. Cirium or OAG give scheduled capacity,
seat counts and load factors, which would replace the departure proxy with actual
passenger demand and remove the weakest assumption in the model.

## 3. Departures as a demand proxy vs. passenger numbers

**Chose:** departures, because free passenger data does not exist at airport
granularity with useful frequency.

**Gave up:** aircraft gauge and load factor. Twenty regional turboprops and
twenty A350s count the same. This is the single largest source of error in the
model and it is stated as assumption #1 in the methodology rather than buried.

**Considered and dropped:** World Bank `IS.AIR.PSGR` for country-level passenger
growth. It is free and current, but country-level data attributed to individual
airports is a weaker signal than it looks — it would have implied a precision we
do not have. The OpenSky week-on-week delta is cruder but honest about its scope.

## 4. In-process session state vs. Redis

**Chose:** a `Map` in `src/lib/session.ts`.

Conversational follow-ups (*"and the delays there?"*) need the server to remember
which airports are in focus and what the active weights are. Replaying the whole
transcript to the LLM each turn and hoping it re-derives the context is slower,
costlier and less reliable.

**Gave up:** durability and horizontal scale. State dies on restart and does not
survive multiple instances. For a single-process demo that is the correct call,
and the interface is narrow enough that Redis is a one-file swap.

## 5. Node's built-in test runner vs. Vitest/Jest

**Chose:** `node:test` compiled through the TypeScript compiler Next.js already
depends on.

**Gave up:** watch mode, rich matchers, coverage reporting, mocking utilities.

**Gained:** `npm test` works on a clean clone with **zero added dependencies**.
For a take-home this matters more than ergonomics — the reviewer should not have
to install a test framework to verify that the core logic is correct.

## 6. SSE streaming vs. a single JSON response

**Chose:** Server-Sent Events from `/api/analyze`.

The deterministic scores are ready several seconds before the LLM finishes
writing. A single JSON response would hold them back behind the slowest
component in the pipeline. With SSE the dashboard renders as soon as the engine
finishes, and the loading messages the analyst reads are the actual pipeline
stages rather than a client-side timer cycling plausible text.

**Gave up:** a simpler client, and trivial `curl` testing. Documented the event
shapes in the README to compensate.

**Not yet done:** token-level streaming of the narration. The plumbing is
already there; it is one event type away.

## 7. Guardrails: block vs. substitute

**Chose:** when validation fails, silently swap in a deterministic summary built
from the same data.

The previous implementation replaced failed responses with
`"Security Alert: Response blocked due to metric mismatch"`. That is a failure
mode designed for the developer, not the user — an analyst sees an alarming
error and gets no answer.

**Gave up:** visibility of the failure in the main flow. Compensated by a small
badge under the message and a line in the Pipeline Trace tab, so the event is
still inspectable during a demo without derailing the conversation.

## 8. A curated region table vs. asking the LLM

**Chose:** a hand-written table in `src/data/regions.ts` mapping named markets
(New England, the Gulf, DACH, Scandinavia…) to IATA codes.

"Which airports in New England are candidates for expansion?" is a natural
analyst question, and New England is neither a country nor a continent, so no
open dataset carries it. The obvious shortcut is to let the model answer it.

**Rejected because** that is precisely the kind of quiet factual decision that
should not be probabilistic. It would silently change the answer set between
runs, and one wrong code would flow straight into a score with no trace. The
table is auditable, testable, and adding a region is a one-line change. The
grouping and its definition are shown to the analyst every time one is used.

**Gave up:** coverage. Only ten regions are defined. An unrecognised region falls
through to country, continent and then fuzzy name matching, so the failure is
graceful rather than wrong.

## 9. Numeric validation heuristics

**Chose:** validate every number ≥ 10 in the narration against the set of figures
the model was given, with a ±0.51 rounding tolerance.

**Gave up:** precision at the edges. Numbers below 10 are treated as ordinals and
skipped, so a hallucinated *"3 runways"* would pass. The right fix is structured
output — have the model emit JSON with slots rather than prose, and render the
numbers ourselves.

**Why not now:** it constrains the writing quality noticeably, and the current
check already covers the failure mode that actually matters, which is invented
scores.

## 10. Excluding a missing pillar vs. scoring it neutral

**Chose:** when a pillar has no data, drop it and redistribute its weight across
the others in proportion.

The intuitive alternative — score it 50 and move on — is quietly corrosive. It
pulls every airport toward the middle: the strong candidate loses points it
earned, the weak one gains points it did not. The ranking becomes least
discriminating exactly when data is scarce, which is when the analyst most needs
it to be decisive.

**Gave up:** comparability between runs. A score computed with three pillars is
not strictly the same quantity as one computed with four. We surface
`redistributedFrom` on every result and label the pillar `excluded` on the card
so the analyst can see which one they are looking at.

## 11. Cheap Gemini models vs. a frontier model

**Chose:** `google/gemini-3.5-flash-lite` for both the intent parser and the
narrator.

The LLM here classifies a sentence and writes four paragraphs from a JSON
payload it is forbidden to do arithmetic on. Neither job needs a frontier model,
and the deterministic layer underneath is what the methodology actually rests on.
Spending on a better model would improve the prose and change none of the
numbers.

**Gave up:** some fluency, and occasional instruction-following precision on the
brief structure. The guardrails catch the failure mode that matters — invented
figures — regardless of model quality, and the deterministic fallback produces
the same four sections when the model disappoints.

## 12. Runtime model resolution vs. a pinned model ID

**Chose:** query the provider catalogue at runtime and pick the first available
model from a preference list.

This is a direct response to a real failure in the previous version: the model
was pinned to `openrouter/free`, which is not a valid model id. Every LLM call
returned 400, the `catch` swallowed it, and the agent answered *"I couldn't
identify any specific airport"* to every question ever asked. Provider catalogues
churn constantly, and a pinned id is a time bomb with a silent fuse.

**Gave up:** one extra HTTP call on cold start, cached for 30 minutes.

## 13. Six-airport cap per query

**Chose:** cap resolution at six airports.

*"Which airports in Europe are worth expanding?"* could match hundreds. Each one
costs an AviationStack call, and the free quota is 100 requests per **month**.
Aggressive caching plus a hard cap is what keeps a live demo from exhausting the
month's budget in a single session.

**Gave up:** exhaustive regional screening. A production version would pre-compute
scores for the full index on a nightly schedule and serve ranked results from a
warm store, reserving live calls for drill-down.

---

## What I would do next, in order

1. **Structured narration output** — eliminate the numeric-validation heuristic
   entirely by having the model fill slots instead of writing free prose.
2. **Nightly batch scoring** of all 3,270 airports, so regional questions return
   instantly and live quota is spent only on drill-down.
3. **Persist sessions** to Redis and add weight sliders alongside the natural
   language weight adjustment.
4. **Replace the departure proxy** with scheduled seat capacity if a commercial
   data budget exists — it removes the model's largest assumption.
5. **Backtest the score** against announced airport expansion programmes. Right
   now the methodology is defensible but unvalidated; that is the honest gap.
