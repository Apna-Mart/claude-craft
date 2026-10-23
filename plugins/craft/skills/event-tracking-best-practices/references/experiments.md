# Experiments and feature flags: logging for a trustworthy result

Tool-neutral rules for any flag or experiment system, built or bought. How specific flag tools log exposure (and how to change it) is in `tool-notes.md` §3. The methodology rests on the Microsoft ExP articles, Kohavi's papers, Spotify's and Deng et al.'s work, and the experimentation vendors' docs listed in Sources, read on 2026-10-20. The book *Trustworthy Online Controlled Experiments* (Kohavi, Tang, Xu, Cambridge University Press, 2020) covers the same ground in depth, but its text was not read for this file. Points marked *(general practice)* are standard in the experimentation literature but were not taken from a page read for this file.

## Contents

1. Before launch: the experiment design note
2. Assignment vs exposure, and when filtering to exposed users is valid
3. When to log exposure
4. What assignment and exposure records contain
5. Triggering and counterfactual logging
6. Randomization unit, analysis unit and identity
7. Interference: when users affect each other
8. Sample ratio mismatch (SRM)
9. Metrics: primary, guardrail, secondary, data quality
10. Power, duration, windows and peeking
11. Pre-period data and CUPED
12. A/A tests
13. Warehouse-native tables
14. Holdouts and long-term effects
15. The ship rule
16. Sources

## 1. Before launch: the experiment design note

Write this before the flag goes live. Every line maps to something the tracking must support.

```markdown
## Experiment: <key>
- Hypothesis: <change> will increase <primary metric> because <reason>. Falsified by: <metric flat or worse>.
- Randomization unit: <user | account | device | cluster>   Analysis unit(s): ...
- Assignment logged: <where>   Exposure fires when: <exact moment, same in both arms>
- Population: <who is eligible>   Trigger: <condition, decided before treatment can act, logged in both arms>
- Primary metric: <definition>   Minimum effect worth shipping: <x%>
- Guardrails: <metric: non-inferiority margin>, ... (sample size covers these too)
- Secondary (learning only): ...
- Sample size / duration: <n per arm> → <days>, at least one full week; metric window <N days after exposure>
- Data quality checks: SRM (chi-square, p < 0.0005 or sequential), exposure count vs eligible traffic, metric event volume per arm
- Ship rule: (section 15)
```

Microsoft ExP: "the hypothesis should be falsifiable or provable by the set of metrics considered", and a power calculation "sets a lower bound on the number of randomization units".

## 2. Assignment vs exposure, and when filtering to exposed users is valid

- **Assignment**: the bucket the user is put in; it registers the unit as a participant.
- **Exposure**: the moment the user actually experiences the variant.
- Spotify logged `Config Assigned` (the device "fetched its values") and `Config Applied` (the device "has actually started using the property values"), and used `Config Applied` "as the trigger event for exposure".

Analysing exposed users instead of everyone assigned removes users who never saw the change, which makes the test more sensitive. It is valid **only when the treatment cannot change who becomes exposed**: the exposure point must be reached the same way in both arms. If the treatment is slower, redirects, crashes, or changes the step before the exposure point, the exposed groups differ in who they contain, and the comparison is biased — and an SRM check can still pass when the drop-off is similar in size but different in kind *(general practice)*.

So:
- **Always keep the assignment log**, even when the analysis uses exposure. Analysing everyone assigned (intent to treat) is the fallback that stays unbiased.
- Choose the exposure or trigger point at or before the first place the variants differ.
- When the two analyses disagree, investigate before shipping.

## 3. When to log exposure

- **Evaluate or log at the moment the user encounters the experience** — where the variant renders or the changed code path runs — not at app start, initialization, prefetch or a cached preload. Flag vendors' docs say the same in nearly identical words.
- **Know what your flag SDK logs automatically.** Many log an exposure whenever the flag is evaluated, and some log it even when the user is bucketed into an "off" variation they never see. If evaluation happens early (prefetch, server render), turn automatic exposure logging off and log manually at the real moment.
- **Fallbacks**: don't log exposure for a fallback served because evaluation failed or the user has no assignment. **Control users are assigned and always log exposure** — control is often the default value, and suppressing it produces an SRM or a one-armed comparison.
- **Server-side evaluation cannot see rendering.** Either treat server assignment as exposure knowingly (when every assigned request really runs the changed code) or send an explicit exposure from the client when the variant renders.
- **Flush before navigation or process exit**, or the exposure is lost exactly for users who leave quickly — which differs by variant if one variant is slower.

## 4. What assignment and exposure records contain

| Field | Notes |
|---|---|
| experiment key and run id | separates two runs of the same flag |
| variant | the variant actually served |
| unit id | the randomization unit's id, the same value used for bucketing |
| timestamp | when exposure happened; starts each unit's metric window |
| allocation or config version | changes on every ramp or traffic change, so constant-allocation periods can be analysed *(general practice)* |
| assignment reason | rule, override (QA allowlist, internal user forced into a variant), or fallback; overridden units are excluded from analysis *(general practice)* |
| subject attributes (optional) | platform, app version, country, plan — for segment and SRM diagnosis |

Each tool names these fields differently (`tool-notes.md` §3); the content is the same.

Dedup in analysis, not by dropping raw rows: the exposure table may hold repeated rows per unit; analysis keeps the first exposure per unit, and removes units exposed to more than one variant (the usual recommendation) or analyses them by first variant — say which. A re-salt or ramp that moves units between arms shows up here; analyse those units by first assignment or drop them, and say which.

## 5. Triggering and counterfactual logging

When only some users reach the changed code (for example, only searches with a weather intent), analyse only those users — in **both** arms.

- Microsoft: in control, "the system determines whether it would have shown the weather answer", and "it will be marked in that impression's log entry". This identifies "the exact same type of traffic from treatment and control".
- The trigger condition needs "100% recall in capturing users that were or would have been affected", and must be computed the same way in both arms (section 2).
- The trigger record (an "entry point" or "qualifying event") needs only the unit id and a timestamp; inclusion and metric windows are based on that timestamp.
- **Diluting back to the whole population**: Microsoft's shortcut — "multiply the user trigger rate (% of triggered users) by the relative delta" — is exact only when triggered users have the same control mean as everyone, and the same article notes triggered users do not reflect the overall population (heavy users trigger more). The general form is: overall relative effect = (absolute effect per triggered unit × number of triggered units) ÷ overall control total. Ratio metrics need a different method.
- Checks: "verify that the triggered scorecard has no Sample Ratio Mismatch", and the complement (non-triggered users) should look "like an A/A".
- Spotify: "the most common source of sample ratio mismatches ... is poorly designed exposure filters" — usually a trigger logged in one arm but not the other.

## 6. Randomization unit, analysis unit and identity

- Deng, Knoblich, Lu: "the randomization unit – the granularity level where sampling or randomization is performed, and the analysis unit – the aggregation level of metric". The randomization unit "cannot be more granular than the analysis unit". Per-session, per-order or click-through metrics in a user-randomized test are legitimate, but their variance must use the delta method (needed for any metric that has a numerator and a denominator); the naive per-row standard error gives intervals that are too narrow and false wins. Confidence intervals for a *relative* lift also need the delta method or Fieller's method *(general practice)*.
- Every metric event carries the randomization unit's id, so it can be aggregated to that unit.
- Randomize logged-in experiences by user id; logged-out experiences by a stable device or anonymous id — accepting that one person on two devices may see two variants.
- **Null ids**: units with a missing id all hash to the same bucket, which skews results. Pass every available identifier; exclude units with none.
- **Consistency**: the same `user_id` and device id on flag evaluation, exposure and every metric event. Re-evaluate variants when the signed-in identity changes. Regenerating the device id at logout causes SRM in device-randomized tests.
- **Bridging logged-out to logged-in**: one event (for example sign-up) carrying both ids, or a warehouse join table of user id ↔ device id. Deduplicating identities can itself bias results; check that the dedup rate is the same in each arm (a chi-square test).

## 7. Interference: when users affect each other

User-level randomization assumes one user's variant does not change another user's outcome *(general practice)*. That fails in:
- two-sided marketplaces (buyers in treatment take inventory from buyers in control),
- shared budgets, inventory or capacity (ads, delivery slots),
- social and collaborative features (a treated user's invite reaches a control user),
- B2B products where settings or pricing apply to the whole company,
- pricing, where users compare notes.

Effects measured at user level can then be badly over- or under-stated, and the launch effect at 100% (equilibrium) differs from the test. Randomize by the unit that contains the interaction — account, cluster, market or city, or time slot (switchback tests) — and log that id (`account_id`, `cluster_id`, `market_id`, `time_slot`) on assignment, exposure and metric events. Fewer, larger units mean less power; plan for it.

## 8. Sample ratio mismatch (SRM)

The observed split of exposed units differs from the configured split by more than chance.

- Frequency: "At Microsoft, a recent analysis showed that about 6% of A/B tests have an SRM." The same article reports roughly 10% for "zoomed-in" (triggered) tests at LinkedIn.
- Test: a chi-square goodness-of-fit test on unit counts per arm, with k − 1 degrees of freedom for k arms. Microsoft uses "p-value < 0.0005"; some platforms use a sequential chi-square test (for example at alpha 0.01). Re-running a fixed chi-square test every day inflates false alarms, so check daily only with a sequential test or the strict threshold. Kohavi et al.'s example: 821,588 vs 815,482 users on a 50/50 split gives p ≈ 1.8×10⁻⁶ — a split that looks even is still an SRM.
- Check it **first**. SRMs "typically invalidate the A/B test" (Microsoft, during-experiment article). A passed SRM check is necessary, not sufficient: it cannot detect exposure that is biased in kind (section 2).

Causes (Vermeer's SRM taxonomy unless noted) span assignment, execution, logging and analysis:
- Assignment bugs and carry-over from a previous experiment on the same users.
- Exposure logged at different moments per arm, or a trigger logged in only one arm.
- One variant redirects, adding a page load where users drop out before logging.
- A slower variant gives users "more time to exit the product before the logs are generated".
- Crashes or errors in one variant losing the log call.
- Client batch queues filling faster in one variant, losing events at app close.
- Bot or outlier filtering that hits one variant harder — make sure "all variants ... are impacted by the outlier filtering logic in the same way".
- Ad blockers blocking one variant's code path more.
- Telemetry added or removed in only one variant.

Diagnose by segment: "Oftentimes, an SRM root-cause is localized to a particular segment" — split the check by platform, browser, app version and country, which needs those properties on the exposure record.

## 9. Metrics: primary, guardrail, secondary, data quality

- **Primary (the OEC, overall evaluation criterion)**: "A good OEC captures the organizational long-term objectives"; "ideally a single OEC". It must be hard to game: Kohavi et al. warn against a metric "for which it is easy to beat the control by doing something clearly 'wrong'" (time on site rises when navigation gets harder).
- **Guardrails**: metrics you are trying not to hurt: errors, latency, crashes, unsubscribes, refunds, support contacts, revenue when the primary is engagement. Each guardrail is a **non-inferiority test with a stated margin**: it passes only when the confidence interval's bound excludes a loss bigger than the margin. "Not significantly worse" is not the same as "safe" — an underpowered guardrail passes by default. Size the experiment so every guardrail test has the stated power, not only the primary metric. When nobody has set a margin, propose a starting one (for example the metric's normal week-to-week variation, or a stated business tolerance) and mark it for the owner to confirm, rather than leaving it blank.
- **Secondary**: "used to learn", not to decide.
- **Data quality metrics as first-class metrics**: Microsoft — "Error Rates, Data Loss Rates, Join Rates, Sample Ratio Mismatch (SRM)", with alerts set early.
- Select the primary metric before the test, and keep only a few metrics in the decision.

Each metric must be computable per randomization unit from events that carry that unit's id and an event time after the unit's exposure time.

## 10. Power, duration, windows and peeking

- Sample size comes from the metric's baseline and variance — the minimum detectable effect is roughly (z_{α/2}+z_β)·√(2σ̂²/N)/μ̂, with σ̂ and μ̂ estimated from recent weeks of the same metric. So the metric's events should already be flowing before the experiment. For a brand-new feature whose events cannot exist yet, size the test from a close proxy metric and say so.
- Run at least one to two full weeks so every weekday is covered; with a fixed-sample test, stop at the planned horizon.
- With a fixed-sample test, no decision before the planned sample is reached. Sequential methods allow continuous monitoring; Microsoft requires "stronger statistical significance levels" for early reads.
- **Metric windows**: units exposed in the last days of the test have incomplete windows ("within 7 days of exposure" cannot be measured for someone exposed yesterday). Exclude them from that metric, or keep collecting events until every included unit's window closes *(general practice)*.
- **Novelty and primacy**: "Rapid decline of estimated treatment effect across date segments ... is an indicator of novelty effect." Read it by exposure cohort (users first exposed in week 1 vs week 2), because the mix of who arrives changes over a test — heavy users are exposed first. A growing effect can be a primacy effect (users learning a new design) *(general practice)*.
- **Simpson's paradox**: don't pool periods with different allocations (Kohavi et al.'s example: 99/1 on Friday, 50/50 on Saturday). Ramp-ups change allocation, so analyse within constant-allocation periods, using the allocation version on each record.

## 11. Pre-period data and CUPED

- CUPED-style variance reduction uses each unit's metric value from a pre-exposure window (platforms default to one to two weeks); it helps little for rare metrics or new users, who have no history.
- Microsoft's Retrospective-AA "computes the same metric for the treatment and control group in the period before the experiment start"; Spotify checks for "any difference in activity between the groups prior to the experiment starting".

Tracking implication: emit the metric events, keyed by the same unit id, before experiments use them, and keep at least the pre-period window of history. Where the metric itself is new, any pre-treatment covariate that predicts it (overall activity, sessions) can still reduce variance; a pre-period balance check on the metric itself is not possible.

## 12. A/A tests

- An A/A test confirms that exposures flow and metrics compute; run one before the first A/B test and after changing metric definitions; expect about 1 in 20 metrics significant at 5%.
- One A/A run catches gross breaks only. Metrics are correlated, so the share that come out significant varies widely between runs, and a variance that is 20% too small passes unnoticed. To validate variance and false-positive rates, run many A/A splits — for example by re-randomizing historical data offline — and check that each metric's p-values are close to uniform, with about 5% below 0.05 *(general practice)*. Kohavi et al. also use A/A tests to detect carry-over effects and warn not to assume the standard variance formulas hold (Pitfall 3).

Run A/A checks after any change to exposure logging, identity or the pipeline.

## 13. Warehouse-native tables

| Table | Columns | Source |
|---|---|---|
| Assignment / exposure | unit id, timestamp, experiment id, variant id, allocation version, assignment reason (multiple rows per unit allowed) | the shape warehouse-native experiment platforms expect |
| Metric facts | unit id (same id type, or via a join table), event time, value | |
| Entry point / trigger | unit id, timestamp | |
| Identity join | user_id ↔ device_id | |

Partition assignment tables by date, then cluster by experiment id. Metric facts must use event time, not load time, or late-arriving offline events shift between periods.

## 14. Holdouts and long-term effects

- A long-running holdout keeps a small share (commonly 1–2%) without a set of features, to measure their combined effect over months (commonly three to six), then releases it. It covers only experiments that use the same randomization unit.
- Kohavi et al.: combine experiments "with a holdout experiment to see if the long-term metrics differ".

Keep logging holdout assignment and the primary and guardrail events for the life of the holdout. For a feature already launched to everyone, putting a small random slice back without it is the cheapest causal answer — but it measures the effect of *removing* the feature from people who are used to it, which can differ from the effect of adding it.

## 15. The ship rule

Spotify (2024), quoted exactly — "Ship if and only if":
1. "The treatment is significantly superior to control on at least one success metric."
2. "The treatment is significantly non-inferior to control on all guardrail metrics."
3. "No success, guardrail, or deterioration metrics show evidence of deterioration."
4. "No quality test significantly invalidates the quality of the experiment."

The rule is valid only with its error-rate corrections. With S success metrics, G guardrails and Q quality tests, the article tests:

| Test | False-positive rate | False-negative rate |
|---|---|---|
| Success metrics (superiority) | α / S | corrected for the number of guardrails (simplified form β / (G + 1)) |
| Guardrails (non-inferiority) | α, not corrected | same β correction |
| Deterioration and quality tests | α₋ divided by the total number of such tests | — |

"the decision rule must be explicit, and the experiment must be designed and analyzed with the rule in mind." Write the rule and the number of metrics of each kind into the design note before launch; adding metrics later changes the corrections. Report results against the rule: which conditions held, which failed, and the decision that follows. The formulas sit in images on the article page; check them against the page before implementing them in code.

## 16. Sources

- https://www.microsoft.com/en-us/research/articles/diagnosing-sample-ratio-mismatch-in-a-b-testing/
- https://www.microsoft.com/en-us/research/group/experimentation-platform-exp/articles/patterns-of-trustworthy-experimentation-pre-experiment-stage/
- https://www.microsoft.com/en-us/research/group/experimentation-platform-exp/articles/patterns-of-trustworthy-experimentation-during-experiment-stage/
- https://www.microsoft.com/en-us/research/group/experimentation-platform-exp/articles/patterns-of-trustworthy-experimentation-post-experiment-stage/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7007661/
- https://ai.stanford.edu/~ronnyk/2009-ExPpitfalls.pdf
- https://arxiv.org/pdf/1803.06336
- https://www.cambridge.org/core/books/trustworthy-online-controlled-experiments/D97B26382EB0EB2DC2019A7A7B518F59 (table of contents)
- https://www.lukasvermeer.nl/srm/docs/causes/
- https://engineering.atspotify.com/2020/10/spotifys-new-experimentation-platform-part-1
- https://engineering.atspotify.com/2020/11/spotifys-new-experimentation-platform-part-2
- https://engineering.atspotify.com/2024/03/risk-aware-product-decisions-in-a-b-tests-with-multiple-metrics
- https://confidence.spotify.com/blog/trigger-analysis
- https://docs.statsig.com/server-core/node-core
- https://docs.statsig.com/sdks/user
- https://docs.statsig.com/experiments/overview
- https://docs.statsig.com/experiments/statistical-methods/variance-reduction
- https://docs.statsig.com/experiments/statistical-methods/methodologies/delta-method
- https://docs.statsig.com/experiments/holdouts-introduction
- https://docs.statsig.com/experiments/types/aa-test
- https://docs.statsig.com/statsig-warehouse-native/configuration/assignment-sources
- https://docs.statsig.com/statsig-warehouse-native/guides/best-practices
- https://docs.statsig.com/statsig-warehouse-native/features/id-resolution
- https://docs.geteppo.com/sdks/event-logging/assignment-logging/
- https://docs.geteppo.com/guides/engineering/integrating-internal-flags/
- https://docs.geteppo.com/experiment-analysis/configuration/filter-assignments-by-entry-point
- https://docs.geteppo.com/statistics/confidence-intervals/analysis-methods/
- https://docs.geteppo.com/statistics/sample-size-calculator/usage/
- https://docs.growthbook.io/app/datasources
- https://docs.growthbook.io/statistics/cuped
- https://docs.growthbook.io/using/experimenting
- https://amplitude.com/docs/feature-experiment/under-the-hood/event-tracking
- https://amplitude.com/docs/feature-experiment/troubleshooting/sample-ratio-mismatch
- https://amplitude.com/docs/data/data-assistant-user-solutions/experiment-exposure-engineering
- https://posthog.com/docs/experiments/exposures
- https://launchdarkly.com/docs/sdk/features/experimentation
- https://docs.optimizely.com/feature-experimentation/docs/what-are-impressions-and-decisions-in-feature-experimentation
- https://www.twilio.com/docs/segment/connections/spec/ab-testing
