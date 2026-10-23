# From events to decisions, and keeping the data trustworthy

Rules below come from the cited pages, read on 2026-10-20. Items marked *not verified* rest on secondary summaries only.

## Contents

1. Metric frameworks: choosing what matters
2. Metric trees: from the decision down to events
3. HEART for a single feature
4. Writing a metric definition
5. Measuring a feature without an experiment
6. Difference-in-differences and other quasi-experiments
7. Writing the decision rule first
8. Reporting a conclusion honestly
9. Data quality: before release
10. Data quality: in production
11. Traps that lead to wrong decisions
12. Sources

## 1. Metric frameworks: choosing what matters

- **North Star + inputs** (from a product-analytics vendor's North Star playbook): a North Star "captures the value customers get"; it expresses customer value, represents strategy and is a *leading* indicator. Revenue and ARPU are lagging; DAU and registered users make poor North Stars. Pair it with 3–5 input metrics covering breadth, depth, frequency and efficiency — inputs are what teams can move and what experiments target.
- **AARRR** (McClure's "Startup Metrics for Pirates" deck): Acquisition, Activation, Retention, Referral, Revenue; track only 5–10 conversion steps and give each metric an owner.
- **HEART** (Rodden, Hutchinson, Fu, CHI 2010): Happiness, Engagement, Adoption, Retention, Task success, worked through Goals → Signals → Metrics (section 3).
- **One Metric That Matters** (Croll and Yoskovitz, *Lean Analytics*): good metrics are comparative, understandable, a ratio or rate, and change behaviour — *not verified*; the book was not read, only summaries.

Use a framework to pick the few metrics a decision rides on; the tracking plan follows from those, not from the framework itself.

## 2. Metric trees: from the decision down to events

Method: define the North Star, break it into a tree, then derive only the events and properties the tree needs. Two kinds of link:
- **Components** — exact arithmetic (new customers = leads × win rate).
- **Influences** — probable drivers (speed to lead → win rate). Influences are hypotheses; experiments test them.

For each leaf, the tracking plan names the event, the properties used to filter and segment, and the emitting system. A leaf with no event is a gap to instrument; an event with no leaf needs a reason to exist.

## 3. HEART for a single feature

From the CHI 2010 paper:
- Not every category applies, but the framework "helps to make an explicit decision about including or excluding a particular category".
- Signals should be "sensitive and specific to the goal – they should move only when the user experience is better or worse".
- Failure is often easier to detect than success: undo, abandonment, retries, error screens. Instrument those explicitly.
- At the Signals step ask whether the action is "currently being logged, or could [it] be?" — that question is where the tracking plan comes from.
- Normalise: "Raw counts will go up as your user base grows... ratios, percentages, or averages per user are often more useful."

Example for a new "AI summary" feature:

| Category | Goal | Signal (event) | Metric |
|---|---|---|---|
| Adoption | eligible users try it | `Summary Generated` | % of eligible users with ≥1 summary in 14 days of first eligibility |
| Task success | summaries are useful | `Summary Copied`, `Summary Regenerated`, `Summary Dismissed` | copy rate; regenerate rate per summary (lower is better) |
| Retention | it brings people back | `Summary Generated` by week since first use | week-4 return rate of adopters, by acquisition cohort |
| Happiness | users rate it well | `Summary Rated { rating }` | share rated helpful, with response rate shown |

Eligibility (`Summary Eligible`, or a property of the screen view) is what makes adoption a rate rather than a count.

## 4. Writing a metric definition

- Numerator and denominator, each with its own filter, applied to each side separately.
- Unit: per user, account, session, order. In experiments the randomization unit must be at least as coarse as this unit; a finer metric unit needs the delta method.
- Window: "within 7 days of first exposure", "calendar week, Monday start". Cohorts whose window has not closed are left out, or the metric is reported as provisional.
- Retention type stated: "returned on day N", "returned on or after day N" and "returned within a bracket of days" give very different numbers for the same data.
- Time zone stated. Tools usually store UTC and convert on output; a project time-zone setting can shift daily numbers without any change in the data.
- Exclusions: internal and test users, bots, refunds, duplicates.
- Owner and one written definition, reused by every dashboard and analysis.

## 5. Measuring a feature without an experiment

- **Adopters vs non-adopters is correlation.** Even analytics vendors' own impact-analysis features say "correlation doesn't imply causation" and point to experiments for causality. A vendor's example: community members retained 95% vs 55% at week 2 — and that still does not show the community caused retention. Users who adopt a feature are already more engaged; the comparison measures who chooses the feature, not what it does.
- **Immortal-time bias**: a user can only adopt a feature by coming back, so "ever used it" users are retained by construction. Classify adoption within a fixed early window (for example the first 7 days after eligibility), then measure retention only after that window, for both groups.
- **Check the arithmetic for consistency**: if adopters are a share *s* of users and truly retain *k* times better, overall retention should rise by about *s*·(*k* − 1). When the observed overall change is far smaller, most of the adopter gap is selection.
- **Before vs after launch is confounded** by seasonality, marketing, pricing, other launches and the changing mix of users.
- **New adopters need a lookback window**: count a user as newly adopting only with no prior use in a lookback window (vendors use roughly 90 to 360 days depending on grain).
- **Cohorts, not aggregates**: Ries — cohort metrics are "the best kind of per-customer metrics", and "Metrics are people, too": aggregates hide mix shifts.
- **Long-running holdout** for cumulative impact: commonly 1–2% held back. For something already launched, putting a random slice back without the feature is the cheapest causal answer — but it measures the effect of *removing* the feature from people used to it, which can differ from the effect of adding it.

When the question is "did this feature cause X" and the decision is expensive (team size, pricing, a big launch), randomisation is the honest answer; observational data gives leads, not verdicts.

## 6. Difference-in-differences and other quasi-experiments

- DiD compares the change over time in a treated group with the change in an untreated group. It holds only under **parallel trends** — both groups would have moved the same way without the change (Cunningham, *Causal Inference: The Mixtape*, ch. 9). It also needs: no anticipation (users did not change behaviour before launch because they knew it was coming), no spillover into the comparison group, and stable group composition over the period.
- An event-study plot of pre-period trends is the standard check, but a passed pre-trend test is weak evidence: such tests often have little power to detect a violation. Say the assumption is supported, not proven.
- Staged rollouts (by region, platform or random account batches) are staggered adoption. The classic two-way fixed-effects DiD regression is biased when the effect differs across groups or over time; use an estimator built for staggered timing (for example Callaway and Sant'Anna's), or randomize the rollout order. Record the rollout schedule: which group got the feature when. (This point comes from the econometrics literature — Goodman-Bacon; Callaway and Sant'Anna; Roth on pre-trend tests — not from the pages read for this file.)
- A geo holdout with only a few regions needs a method designed for few units (synthetic control), not a standard per-user confidence interval.
- Tracking needs: the eligibility or rollout group as a property or a joinable table, events stable across the whole pre and post period, and the same definitions on both sides.
- State the assumptions in the conclusion, and which were checked.

## 7. Writing the decision rule first

- Microsoft: "the hypothesis should be falsifiable or provable by the set of metrics considered"; split complex changes into simple hypotheses; run a power calculation first.
- Spotify's ship rule: significantly better on at least one success metric, significantly non-inferior on all guardrails, no evidence of deterioration, no quality test invalidating the run — with the false-positive rate split across success metrics — and "the decision rule must be explicit".
- Build the tracking plan before instrumenting code, so analysts, product managers and engineers work from one schema, recording why each event is collected and which source sends it.
- Instrumentation as part of "done": GitLab found "only 50% of our premium features are currently instrumented", and separately that only about 6 of roughly 30 features shipped per milestone were instrumented; it added a per-feature instrumentation status to every release (added / planned for milestone X / not planned / other).

A decision rule written after looking at the data is a story, not a test.

## 8. Reporting a conclusion honestly

Lead with the answer to the question asked, then:
1. **What the data shows** — the number, its definition, the population, the period.
2. **The evidence rung** — descriptive, correlational, quasi-experimental or randomized, and why.
3. **What it cannot show** — named confounders or failed assumptions, and data quality caveats (missing events, SRM, short window).
4. **What is defensible to say now** — for example "users who adopted the AI summary retain better; we don't yet know whether the feature causes it".
5. **What would settle it** — the cheapest design that reaches the needed rung, and the events it requires.
6. **The recommended decision at today's evidence** — including "decide later, after the holdout reads out in N weeks".

## 9. Data quality: before release

- Validate events against the plan in development and CI. Plan-validation tools flag events not in the plan, events from an unexpected source, type mismatches, unexpected properties, required properties that are sometimes missing, and out-of-range values; a CI step fails when a planned event isn't implemented.
- Unit tests assert analytics calls through a fake tracker: the exact events, once each, with no personal data.
- Check live in a dev project before release; never in production with test accounts.
- Reconcile a known number: place three test orders, see exactly three `Order Completed` events with the right amounts and currency.

## 10. Data quality: in production

- **Volume monitoring** per event × platform × app version, compared with the same weekday last week; alert after every release. The common data-observability pillars: freshness, quality (or distribution), volume, schema, lineage.
- **Schema enforcement at ingest**, with the quarantine or failed-event queue watched, not ignored.
- **Warehouse tests**: unique `event_id`; non-null user or account id and event time; enum columns only hold accepted values; order events reference existing orders; source freshness checked at least twice as often as the tightest freshness target; failures alert someone.
- **Dedup**: count events per `event_id`; any count above 1 after dedup is a pipeline bug. Tool-side dedup usually covers only a window of days and one device or identity.
- **Bots**: client SDKs filter only a short list of known crawlers by default; detect others (user agent, behaviour, data-center IPs) and mark or drop them consistently. Kohavi et al. Pitfall 5, "Neglecting to filter robots": bots that consistently land in one variant bias results.
- **Internal and test users**: a separate dev project, plus a consistent exclusion (`is_internal` property, email-domain or IP rule) applied in every metric. IP-based filters stop working if IP collection is turned off.
- **Reconcile** revenue and orders with billing and the database on a schedule; a widening gap is an instrumentation regression. Count records that fail to link across systems (a billing customer with no `account_id`, an order with no user) and alert when the count is not zero.
- **Unknown bucket**: keep "unknown/other" values visible; growth there is a finding about tracking.
- Microsoft: watch error rates, join rates and data loss rates, and check data quality before reading any result.

## 11. Traps that lead to wrong decisions

| Trap | What goes wrong | Guard |
|---|---|---|
| Vanity metrics | totals that only rise; Ries: "they don't offer clear guidance for what to do" | rates per user, cohorts, decision-linked metrics |
| Selection bias | adopters differ from non-adopters before the feature | randomise, or compare like-for-like cohorts and say it is correlational |
| Simpson's paradox | pooling groups or periods with different mixes reverses the effect (Kohavi et al. Pitfall 4: 99/1 then 50/50 allocation) | analyse within constant mix; report segment results |
| Goodhart's law | "When a measure becomes a target, it ceases to be a good measure" (Strathern's phrasing) | guardrails beside every target; metrics hard to game |
| Multiple comparisons | many metrics or segments → some "win" by chance | one primary metric; secondary metrics for learning; corrections |
| Peeking | stopping when the number looks good | fixed horizon or sequential methods |
| Novelty | early lift fades | results by day since exposure; run past the novelty window |
| Survivorship | aggregate retention dominated by long-lived users — *not verified* as a sourced rule | acquisition cohorts with cohort sizes |
| Partial data | a release dropped an event; offline events still arriving | volume alerts; aggregate by event time; mark incomplete periods |
| Unvalidated variance | wrong confidence intervals (Kohavi et al. Pitfall 3) | A/A tests; delta method for ratio metrics |

## 12. Sources

- https://amplitude.com/blog/product-north-star-metric
- https://www.slideshare.net/slideshow/startup-metrics-for-pirates-long-version/89026
- https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/
- https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/36299.pdf
- https://mixpanel.com/blog/build-event-tracking-scheme-business-metrics/
- https://docs.getdbt.com/docs/build/ratio
- https://docs.mixpanel.com/docs/orgs-and-projects/managing-projects
- https://amplitude.com/docs/analytics/charts/impact-analysis/impact-analysis-track
- https://amplitude.com/blog/causation-correlation
- https://tim.blog/2009/05/19/vanity-metrics-vs-actionable-metrics/
- https://docs.statsig.com/experiments/holdouts-introduction
- https://mixtape.scunning.com/09-difference_in_differences
- https://www.microsoft.com/en-us/research/group/experimentation-platform-exp/articles/patterns-of-trustworthy-experimentation-pre-experiment-stage/
- https://www.microsoft.com/en-us/research/group/experimentation-platform-exp/articles/patterns-of-trustworthy-experimentation-during-experiment-stage/
- https://engineering.atspotify.com/2024/03/risk-aware-product-decisions-in-a-b-tests-with-multiple-metrics
- https://amplitude.com/docs/data/create-tracking-plan
- https://gitlab.com/gitlab-org/gitlab/-/issues/461533
- https://www.avo.app/docs/inspector/issue-types-in-inspector
- https://www.avo.app/docs/workflow/validate
- https://amplitude.com/docs/data/validate-events
- https://montecarlo.ai/blog-what-is-data-observability
- https://docs.getdbt.com/docs/build/data-tests
- https://docs.getdbt.com/docs/deploy/source-freshness
- https://docs.greatexpectations.io/docs/core/introduction/gx_overview
- https://amplitude.com/docs/apis/analytics/http-v2
- https://docs.mixpanel.com/docs/tracking-best-practices/bot-traffic
- https://ai.stanford.edu/~ronnyk/2009-ExPpitfalls.pdf
- https://amplitude.com/docs/faq/block-and-filter-internal-users
- https://en.wikipedia.org/wiki/Goodhart%27s_law
