# AeroInvest — Airport Investment Agent

A conversational analyst tool that ranks airports by **infrastructure gap** — how far
demand has already outrun what the airport can physically serve — rather than by how
"good" the airport is.

Ask a question in plain language, get a scored dashboard with per-factor breakdowns,
confidence levels and source provenance on every number, followed by a written brief.

**The design constraint that shaped everything:** every number an analyst can act on is
computed by a deterministic engine. The language model touches the pipeline at exactly
two points — it parses the question on the way in, and writes prose on the way out. It
never computes, weights or ranks.

---

## Table of contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Environment variables — API keys](#environment-variables--api-keys)
- [Running with no keys at all](#running-with-no-keys-at-all)
- [Available scripts](#available-scripts)
- [Project structure](#project-structure)
- [API routes](#api-routes)
- [Regenerating the airport dataset](#regenerating-the-airport-dataset)
- [Troubleshooting](#troubleshooting)

---

## Requirements

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | 18.17 or newer (20 LTS recommended) | Next.js App Router minimum |
| **npm** | 9+ | ships with Node; `pnpm` / `yarn` also work |
| **Python** | 3.9+ | **only** if you want to rebuild the airport dataset |
| **git** | any | only for the clone path |

Check what you have:

```bash
node --version    # must print v18.17.0 or higher
npm --version
```

If Node is too old, install via [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 20
nvm use 20
```

---

## Quick start

### Path A — cloning from git

```bash
git clone <REPO_URL> airport-investment-agent
cd airport-investment-agent

npm install

cp .env.example .env.local     # then edit .env.local — see the next section
npm run dev
```

Open **http://localhost:3000**.

### Path B — received as a ZIP

```bash
unzip airport-investment-agent.zip
cd airport-investment-agent

# If the zip was made from a working directory it may contain stale build output.
# Remove it before installing — this is safe, everything here is regenerated:
rm -rf node_modules .next

npm install

cp .env.example .env.local     # then edit .env.local — see the next section
npm run dev
```

Open **http://localhost:3000**.

> **If there is no `.env.example` in the archive**, create `.env.local` by hand and paste
> the block from the next section into it.

### Verifying the install worked

Three checks, in order of how much they prove:

```bash
# 1. The deterministic layer is alive and reading the engine's own modules.
curl http://localhost:3000/api/methodology | head -c 400
# Expect JSON containing "weights", "assumptions", "dataset", "tiers".

# 2. The committed dataset loaded.
curl -s http://localhost:3000/api/methodology | grep -o '"airportCount":[0-9]*'
# Expect "airportCount":3270

# 3. End to end — ask a real question in the UI:
#    "Which airports in Israel are worth expanding?"
#    The dashboard should fill in BEFORE the prose appears. That ordering is
#    the product demonstrating that scores do not depend on the model.
```

---

## Environment variables — API keys

Everything goes in **`.env.local`** at the repository root. This file is gitignored and
must never be committed.

```bash
# ───────────────────────────────────────────────────────────────
# TIER A — live flight data (AviationStack)
# The primary source. Departures, destinations, carriers, delays.
# One call per airport.
# ───────────────────────────────────────────────────────────────
AVIATIONSTACK_API_KEY=your_key_here

# ───────────────────────────────────────────────────────────────
# LANGUAGE MODEL — question parsing + brief writing only.
# Set exactly ONE provider block.
# ───────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...

# ───────────────────────────────────────────────────────────────
# TIER A+ — OpenSky Network (OPTIONAL, see the warning below)
# Week-on-week growth signal only. Leave blank and the growth
# pillar is excluded and its weight redistributed.
# ───────────────────────────────────────────────────────────────
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=
```

> **Cross-check the names against `.env.example` in your copy of the repo.** That file is
> the authority — if a name differs there, the repo wins.

### Where each key comes from

#### 1. AviationStack — `AVIATIONSTACK_API_KEY` (the one that matters)

1. Sign up at **https://aviationstack.com/signup/free**
2. The key appears on the dashboard immediately — no card required.
3. Paste it into `.env.local`.

**Free tier limits you need to know about, because they shaped the architecture:**

| Limit | Consequence in this codebase |
|---|---|
| **100 requests / month** | Aggressive caching; all operational metrics derived from **one call per airport** |
| No dated queries | Growth must come from a second source (Tier A+) or be excluded |
| Empty `delay` field | Punctuality is reconstructed from what the response *does* return |
| 100-record page cap | Volume is reconstructed, and sanity-checked — above **250%** of modelled runway capacity the engine stops believing its own input and says so |

100 calls per month is genuinely tight. **Cache aggressively, and do not clear the cache
casually during a demo.**

#### 2. Language model — `ANTHROPIC_API_KEY` *or* `OPENAI_API_KEY`

- Anthropic: https://console.anthropic.com/settings/keys
- OpenAI: https://platform.openai.com/api-keys

The cheapest model tier is the deliberate choice here — neither touchpoint produces a
number, and the guardrail layer catches invented figures regardless of model quality.

> ⚠️ **Pin a model id that actually exists.** A previous build pinned a nonexistent id.
> Every call returned 400, the error was swallowed, and the agent answered *"I couldn't
> identify any airport"* to every question ever asked, with nothing surfaced anywhere.
> Every degradation path in this codebase exists because of that bug. If you change the
> model id, verify it against the provider's current model list first.

#### 3. OpenSky Network — `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` (optional)

Register at https://opensky-network.org — then create an API client under your account.

> ⚠️ **Measured, not assumed:** OpenSky looks strictly better on paper (raw ADS-B). In
> practice it returns **HTTP 403 to anonymous callers** on historical time-point queries.
> Verified against LLBG, EGLL, KJFK and OMDB — same result on all four. The diagnostic
> script that found this ships with the repo.
>
> **Leave these blank if you don't have credentials.** The growth pillar is excluded, its
> weight is redistributed across the other three, and the exclusion is stated on every
> affected result. Nothing breaks.

### Restart after editing

Next.js reads `.env.local` at server start. After any edit:

```bash
# Ctrl-C to stop the dev server, then:
npm run dev
```

---

## Running with no keys at all

The product is built on the assumption that every external dependency will fail. It runs
with an empty `.env.local` — at reduced confidence, and saying so out loud.

**Degradation ladder**, mildest first:

| # | When this fails | You still get |
|---|---|---|
| 1 | Live flight data | A structural estimate, labelled *Estimated*, at reduced confidence |
| 2 | The growth signal | That pillar excluded, its weight redistributed |
| 3 | Punctuality data | Demand scored on utilisation alone, stated in the brief |
| 4 | The language model | The same four-section brief, generated from the engine |
| 5 | Guardrail validation | The deterministic brief, plus a badge saying why |
| 6 | **Everything at once** | **3,270 airports of committed structural data — the product still answers** |

Row 6 is the floor. It cannot fail, because it depends on no external service: the full
structural dataset is committed to the repository.

Open the **process tab** in the UI to watch which rung any given answer landed on.

---

## Available scripts

```bash
npm run dev        # dev server with hot reload — http://localhost:3000
npm run build      # production build
npm start          # serve the production build (run `npm run build` first)
npm run lint       # eslint
```

Run on a different port:

```bash
npm run dev -- -p 3005
```

---

## Project structure

The directory layout *is* the answer to "where is the AI allowed to touch":

```
src/
├── core/          Scoring engine. Pure functions. No network, no clock, no model.
│                  Every number an analyst can act on is computed here.
├── data/          Three-tier fetching, with caching and controlled degradation.
├── ai/            Exactly two files — one parses the question, one writes the
│                  answer — plus the guardrail validation layer beside them.
├── app/           Next.js App Router pages and API routes.
└── components/    UI, including MethodologyPanel.tsx (the in-product document).
```

The methodology shown inside the product is served from `/api/methodology`, which reads
**the same modules the scoring engine uses**. The documentation cannot drift from the
implementation — change a weight in the code and it changes on screen.

---

## API routes

| Route | Purpose |
|---|---|
| `GET /api/methodology` | Weights, assumptions, limitations, dataset metadata and tier definitions — read live from the engine's own modules |

`/api/methodology` needs no keys, which makes it the fastest way to confirm the
deterministic half of the system is healthy.

---

## Regenerating the airport dataset

`airports.index.json` is committed on purpose — it is the floor no outage removes. It
goes stale between rebuilds, so the snapshot date is displayed rather than implied.

Current snapshot: **3,270 airports**, from
[OurAirports](https://ourairports.com/data/) (public domain).

Filter applied: `type in (large_airport, medium_airport) AND scheduled_service = yes AND valid IATA code`

To rebuild:

```bash
git clone https://github.com/davidmegginson/ourairports-data /tmp/oa
python3 scripts/gen.py
```

The script aggregates `runways.csv` per airport (count, max length, total length, paved,
lighted), joins `countries.csv` for country and continent, and stamps the output with the
OurAirports git commit date as the snapshot date.

---

## Troubleshooting

**`npm install` fails with an engine warning**
Node is below 18.17. `nvm install 20 && nvm use 20`, then delete `node_modules` and
`package-lock.json` and install again.

**Port 3000 already in use**

```bash
lsof -ti:3000 | xargs kill -9     # macOS / Linux
# or just run on another port:
npm run dev -- -p 3005
```

**Every question answers "I couldn't identify any airport"**
This is the exact signature of the original bug. The model id is wrong or the API key is
missing/invalid. Check the server console — the failure is surfaced now, not swallowed.
Then verify your model id against the provider's current model list.

**Scores appear but the written brief never does**
The engine is fine and the model call is failing. That's the intended split — the
dashboard does not wait on the model. Check the LLM key and the server console.

**`airportCount` is 0, or airports aren't recognised**
`airports.index.json` didn't load. Confirm it exists at the path the data layer expects
and that it's valid JSON: `python3 -m json.tool airports.index.json > /dev/null`.

**AviationStack returns 429 or an empty payload**
The 100 requests/month quota is spent. The product degrades to structural estimates and
labels them — it will keep answering. The quota resets monthly.

**OpenSky returns 403**
Expected, and documented above. Leave the OpenSky variables blank.

**Stale behaviour after changing `.env.local`**
Restart the dev server. Next.js only reads env files at start.

---

## What this product deliberately cannot tell you

Stated here for the same reason it is stated inside the product:

- The score is **not a return**. There is no cost side — land, construction, regulation,
  political risk and concession terms are all outside the model.
- **Flights, not passengers.** Departures are the demand proxy, because free
  airport-level passenger data at a useful frequency does not exist. Aircraft size and
  load factor are therefore invisible — twenty turboprops count like twenty widebodies.
  **This is the largest single source of error in the model**, which is why it appears as
  assumption number one rather than a footnote.
- **No commercial revenue** — parking, retail and real estate, which are often the
  majority of an airport's profit.
- **Not backtested.** The methodology is defensible but unvalidated. Testing it against
  announced expansion programmes is the next step.

Every constant in the engine is written as an explicit assumption with its uncertainty
range. The claim is not that the numbers are precise — it's that every one of them is
auditable and arguable.
