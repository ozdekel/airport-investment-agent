# How and Where AI Is Used

Two separate questions: where AI sits **inside the product**, and how AI was used
**to build it**.

---

## Part 1 — AI inside the product

### The governing rule

> The LLM understands the question and writes the answer.
> It never decides, computes, weights or ranks.

Everything an analyst could act on — scores, rankings, risk flags, confidence
ratings — is produced by `src/core/`, which contains no network calls, no clock
reads and no AI. Given the same inputs it returns the same output forever, and
there is a test asserting exactly that.

### Where the model is invoked

| # | Location | Job | Constrained how | If it fails |
|---|---|---|---|---|
| 1 | `src/ai/intent.ts` | Sentence → structured query | Must return JSON matching a fixed schema; `temperature: 0`; **every airport code is validated against the bundled dataset** before use | Rule-based extractor (regex + dataset lookup) takes over |
| 2 | `src/ai/narrator.ts` | Computed JSON → analyst prose | System prompt forbids arithmetic; only receives data it may quote; `temperature: 0.25` | Deterministic template summary built from the same scores |

That is the complete list. There is no third call.

### What the model is explicitly not allowed to do

- **Not allowed to name an airport it was not given.** `guardrails.ts` extracts
  every three-letter code from the narration and rejects any that was not in the
  analysed set.
- **Not allowed to state a figure that is not in its input.** Every number ≥ 10 in
  the output is checked against the set of values the model received, with a
  rounding tolerance. Explicit `n/100` score claims are checked strictly.
- **Not allowed to fail loudly at the user.** A guardrail violation swaps in the
  deterministic summary and logs a badge, rather than showing an error.

### The failure this design is built around

The previous version pinned `model: 'openrouter/free'` — not a real model id.
Every call 400'd, the `catch` block returned an empty array, and the agent
answered *"I couldn't identify any specific airport in your query"* to every
question. One dead string took down the entire product with no error surfaced
anywhere.

Three changes came out of that:

1. **Runtime model resolution** (`src/ai/config.ts`) — the provider is asked what
   it actually serves, and the first available model from a preference list is
   used.
2. **Every LLM call has a deterministic fallback.** Intent falls back to rules;
   narration falls back to templates. The product degrades, it does not die.
3. **Failures are logged and surfaced.** The Pipeline Trace tab shows whether the
   intent came from the model or the fallback, on every single turn.

---

## Part 2 — AI used to build this

Built with Claude in a pair-programming loop over roughly four hours. Being
specific about the division of labour, since that is the honest answer:

### What I directed

- **The core product decision** — scoring the demand/infrastructure gap rather
  than airport quality. Everything downstream follows from that reframing.
- **Rejecting the first data plan, twice.** The initial proposal used OpenFlights
  route data; I pushed back on the 2014 vintage, which forced the move to
  OurAirports (rebuilt nightly) plus OpenSky. Then OpenSky itself turned out to
  reject anonymous historical queries outright, and the live tier moved again to
  AviationStack. Neither correction came from the model volunteering it.
- **Prioritisation under a four-hour deadline** — cutting a country-level growth
  data layer in favour of finishing tests and documentation.
- **Requiring genuine conversational memory** rather than re-extracting entities
  from the previous message.
- **Rejecting the first narration.** It returned "Top candidate: LHR, 60." — a
  headline, not analysis. An analyst staring at a screen full of pillar bars does
  not need the numbers read back; they need the causal story and a recommendation
  they can argue with. That became the four-part brief.
- **Choosing cheap models deliberately.** This is a one-day build; the thing
  being evaluated is whether the logic and methodology hold up, not whether the
  prose is polished.

### What AI accelerated

- Diagnosing the dead `openrouter/free` model id and the two divergent copies of
  `services/`, by reading the codebase rather than by me bisecting it.
- Verifying data-source claims against primary sources instead of assuming:
  AviationStack's free-tier limits, OpenSky's rate limits and auth flow,
  OurAirports' update cadence, and the live OpenRouter model catalogue — which
  turned out not to contain the model the old code had been "fixed" to use either.
- Writing the scoring engine, the tiered data layer and the 26 unit tests.
- Drafting this documentation set.

### Where AI got it wrong, and I caught it

- Two unit test assertions encoded my expectation rather than the engine's actual
  arithmetic (`95.8 !== 100`). The engine was right and the tests were wrong —
  which is the correct way round for that to happen, but it needed checking
  rather than trusting.
- The first data-layer proposal would have shipped 2014 route data behind a
  "structural baseline" framing. Defensible on paper; wrong for a product that
  claims current analysis.
- The OpenSky choice was made from documentation rather than from a live call.
  It looked strictly better on paper and returned 403 on every single request in
  practice. The fix was to stop reasoning about the APIs and measure them —
  `npm run diagnose` exists because of that, and it now ships with the repo.
- The first narration prompt asked for "4–5 short sentences" and got exactly
  that. The model followed the instruction faithfully; the instruction was wrong.

### The honest summary

AI wrote most of the lines of code here. The decisions that determine whether
this product is any good — what to score, which data to trust, what to cut, and
what to admit the model cannot do — were made by a human, and the ones AI
proposed first were not always the ones we shipped.
