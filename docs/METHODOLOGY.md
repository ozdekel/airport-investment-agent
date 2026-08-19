# Scoring Methodology

Every constant referenced here lives in [`src/core/assumptions.ts`](../src/core/assumptions.ts)
with its reasoning and its uncertainty attached. `GET /api/methodology` serves
that file, and the UI renders it — so this document, the code and the interface
cannot disagree with each other.

---

## The question we are actually answering

Not *"which is the best airport?"* — that is a question with a boring, already
priced-in answer. The question is:

> **Where has demand outrun infrastructure by enough to justify capital, and how
> confident are we in that reading?**

That reframing is why saturation and congestion score **positively** here. A
quiet, punctual airport with spare runway capacity is a weak candidate however
pleasant it is to use.

---

## The four pillars

### 1. Demand Pressure — weight 35%

```
utilisation      = dailyDepartures / (runwayCount × 160)
unmetDemand      = delayedShare + cancelledShare        ← capped at 1

utilisationScore = norm(utilisation, 0, 0.85)  × 100
unmetScore       = norm(unmetDemand, 0, 0.25)  × 100

DemandPressure   = 0.6 × utilisationScore + 0.4 × unmetScore
```

If no observed flight data is available the pillar becomes `utilisationScore`
alone and the confidence rating drops. It does **not** substitute a made-up
delay figure.

**`unmetDemand` is the direct answer to "what share of demand went unmet".** It
is a *service delivery* measure: departures the airport failed to operate on
time or at all. It deliberately does **not** claim to capture *suppressed*
demand — flights that were never scheduled because no slot existed — which is
invisible in every open dataset. Conflating the two would overstate what we can
actually see.

**Why it leads.** Our customer is an investor. The investable signal is demand
the current infrastructure cannot serve — that is what an expansion thesis is
built on.

**Why utilisation and not volume.** 300 departures a day across two runways is
saturation; the same 300 across six is comfort. Scoring raw traffic would just
rank airports by size, which the analyst already knows.

**The load-bearing assumption.** `160 departures per runway per day` ≈ 40
movements/hour over a 16-hour operating day, halved for departures. This is the
single most challengeable number in the model. Real capacity depends on runway
geometry, taxiway layout, gate count and curfews; parallel runways closer than
1,035 m cannot be used independently. Treat it as ±30%.

### 2. Network Gravity — weight 25%

```
NetworkGravity = 0.5 × logNorm(uniqueDestinations, 150) × 100
               + 0.3 × norm(longHaulShare, 0, 0.25)      × 100
               + 0.2 × (continentsServed / 6)            × 100
```

**Why logarithmic.** An airport going from 10 to 30 destinations is transformed.
One going from 150 to 170 is not. A linear curve would overstate the second.

**Why it qualifies pillar 1.** A capacity gap is only worth closing where the
network already has relevance. Gravity is the qualifier on demand pressure.

**Long-haul is computed, not assumed.** Great-circle distance from the origin to
each observed arrival airport, against a 4,000 km threshold. The previous
version of this project hardcoded `longHaulPercentage: 0.35` for every airport
on earth, which made this pillar constant and therefore meaningless.

### 3. Revenue Quality — weight 20%

```
diversification = ((1 − carrierHHI) / 0.9)          × 100
premiumMix      = norm(longHaulShare, 0, 0.25)      × 100

RevenueQuality  = 0.6 × diversification + 0.4 × premiumMix
```

`carrierHHI` is the Herfindahl-Hirschman Index over observed carriers, derived
from ICAO callsign prefixes. 1.0 is a monopoly; 0.10 is roughly ten evenly-sized
carriers and scores full marks.

**Why diversification rather than dominance.** A single dominant flag carrier is
not automatically bad — it can mean guaranteed base traffic. We treat it as
**volatility**, not as low quality, which is why it also appears as a risk flag
rather than only as a score deduction.

### 4. Growth Momentum — weight 20%

```
GrowthMomentum = norm(trafficDelta, −0.10, +0.20) × 100
```

`trafficDelta` compares the sampling window against the same window seven days
earlier, so day-of-week effects cancel out. It requires two windows in time,
which on the free tiers available means OpenSky credentials.

**Why it is weighted lowest.** Two 24-hour windows one week apart is a momentum
indicator, not a trend. It does not control for seasonality, holidays or one-off
events.

**When the signal is unavailable the pillar is excluded outright** and its weight
is redistributed across the other three in proportion — not held at a neutral
value. This matters more than it sounds:

> Scoring a missing pillar as 50 pulls *every* airport toward the middle. The
> strong candidate loses points it earned and the weak one gains points it did
> not, so the ranking is least discriminating exactly when data is scarcest —
> which is when the analyst most needs it to be decisive.

The exclusion is not silent. It appears in `redistributedFrom` on the score
object, as an `excluded` label on the pillar bar, and as a line in the brief.
There is a test asserting that the gap between a strong and a weak airport stays
wide when the signal is missing.

---

## Risk adjustment

```
finalScore = weightedPillarSum × (1 − riskIndex × 0.20)
```

| Flag | Trigger | Contribution |
|---|---|---|
| `CARRIER_CONCENTRATION` | Dominant carrier > 50% of departures | up to 0.5 |
| `THIN_NETWORK` | Fewer than 15 destinations observed | 0.3 |
| `SINGLE_RUNWAY` | One runway — no redundancy, expansion needs land | 0.2 |
| `HIGH_CANCELLATION` | More than 5% of departures cancelled | 0.2 |
| `NO_LIVE_COVERAGE` | No departures observed at all | 0.3 |

**The penalty is capped at 20% deliberately.** Risk should adjust a thesis, not
replace it. We would rather surface a risky opportunity with three flags on it
than bury it below a safe, boring one — the analyst is paid to make that call,
not the model.

---

## Confidence, and why it is a first-class output

Every measured input carries a `provenance`:

| Provenance | Meaning | Weight in confidence |
|---|---|---|
| `live` | Observed this run from AviationStack | 1.0 |
| `derived` | Computed from live observations | 0.6 |
| `structural` | **Estimated** from airport class and runway count | 0.6 |
| `unavailable` | Not obtained; pillar reweighted or held neutral | 0.0 |

Pillar confidence is the provenance-weighted average of its inputs; overall
confidence is the weight-weighted average of the pillars. It surfaces as a badge
on every score card and as a per-metric label on every number.

Only pillars that actually carry weight contribute to confidence — an excluded
pillar cannot drag the rating down for a measurement we chose not to make.

This is the mechanism that lets the system fail honestly. When live coverage is
missing for an airport, the answer is not silence and not a confident guess — it
is a structural estimate, labelled `Estimated` on screen, at reduced confidence,
with a `NO_LIVE_COVERAGE` flag attached.

---

## Working assumptions

1. **Departures are a valid proxy for demand.** We have no passenger counts, so
   aircraft gauge and load factor are invisible to the model.
2. **Runway count is a valid proxy for capacity.** Terminal, gate, apron and
   airspace constraints are not modelled.
3. **A 100-flight sample represents the day.** Volume comes from the provider's
   reported total, so it is exact. Shares come from the sample, which is
   statistically fine. The unique-destination **count** is bounded by the sample
   and therefore under-reports large hubs.
4. **The operating airline code identifies the commercial carrier.** Codeshare
   and wet-lease flying may be attributed to the operator rather than the
   marketing airline.
5. **Named market regions are correct.** Groupings such as New England are a
   curated table, and the airports in the grouping are shown to the analyst
   every time one is used.

## Uncertainty bounds

| Quantity | Confidence | Why |
|---|---|---|
| Airport identity, geography, runways | **High** | OurAirports, nightly, public domain |
| Destination count | Medium-Low | Bounded by the 100-flight sample; under-reports large hubs |
| Long-haul share | Medium | Computed only over geolocatable destinations; the resolved share is reported |
| Carrier concentration | Medium | Sample-derived; codeshare attribution as noted |
| Departures per day | **High** | Provider-reported total, not a sample count |
| Delay and cancellation share | Medium | 100-flight sample of the day |
| Growth momentum | **Low**, or excluded | Two 24-hour windows one week apart, and only with credentials |

## What this model explicitly cannot tell you

- **Expected return.** Scores are relative and unitless. 72 means "ranks well on
  our four pillars", not "72% IRR".
- **Anything about cost.** Land prices, construction cost, regulatory risk,
  political risk and existing concession terms are all outside the model.
- **Whether expansion is physically possible.** A saturated single-runway airport
  hemmed in by a city scores as high pressure. Whether there is anywhere to put
  the concrete is not something we can see.
- **Non-aeronautical revenue.** Retail, parking and real estate are frequently
  the majority of an airport's profit, and are entirely invisible here.
