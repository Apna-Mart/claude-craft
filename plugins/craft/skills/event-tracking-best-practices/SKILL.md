---
name: event-tracking-best-practices
description: "Designs and reviews product analytics event tracking by deciding where each event is sent from (client, backend, payment and app-store webhooks, CRM, jobs), what it carries (names, properties, ids, context) and how it is sent (identity, dedup ids, timestamps, delivery, consent), plus experiment exposure logging, data quality and what the data can prove. Use when someone adds analytics to a feature or flow, writes a tracking plan, reviews track, logEvent, capture or identify calls, sets up an analytics SDK or event pipeline, logs feature flag or A/B test exposures, or asks 'what should we track', 'what should we log for this A/B test', 'why are events duplicated or missing', 'why don't our analytics match billing', 'did this feature work'. Language-, framework- and provider-agnostic. Not for dashboard layout (dashboard-best-practices), logs, metrics or OpenTelemetry tracing, webhook code with no analytics event (backend-best-practices), or warehouse SQL (database-best-practices)."
---

# Event tracking best practices

**The job: for every piece of data, decide where it is sent from, what it contains, and how it is sent.**

| Question | What the answer fixes | Steps |
|---|---|---|
| **What** is sent | events, names, properties and shared context — derived from the decision and its metrics | 1–4 |
| **Where** it is sent from | the one system that owns each fact: client, backend, payment or app store, CRM, job | 5 |
| **How** it is sent | identity, dedup id, event time, delivery, experiment exposure, quality checks, consent | 6–10 |

Every event in a tracking plan has all three answers written down. A missing answer is a gap, and it is reported as one.

**Track backwards from the decision.** An event is worth sending only if it feeds a metric that feeds a written decision. "Track everything" yields hundreds of untrusted events and still misses the one property the decision needed.

**The instrumentation decides which conclusions are possible later.** Once a feature ships without an assignment log, a holdout or a pre-period baseline, no analysis can prove it caused anything. Choose how strong the conclusion must be (step 11) *before* the code ships, and instrument for that level.

**Scale it to the request.** For one or two new events, one line naming the decision and metric each feeds is enough; the full measurement plan is for a launch, an experiment or a new tracking plan.

## Skill chaining and references

| Invoke | When | It owns |
|---|---|---|
| `craft:dashboard-best-practices` | the tracked data must be laid out for people to watch | tiles, filters, time ranges |
| `craft:database-best-practices` | modelling event tables or writing a metric's SQL | grain, keys, partitions, query cost |
| `craft:backend-best-practices` | outbox, webhook handlers, queues, retries in services | transactions, idempotency |
| `craft:ui-state-best-practices` | the track call lives inside a UI component (render, effects, lifecycle) | effects vs event handlers |
| `craft:testing-best-practices` | tests that assert analytics calls | test shape, fakes |

`references/*.md` are files to **read**, not skills. Everything in this file and the first four references is language-, framework- and provider-neutral; facts about specific tools live only in `tool-notes.md`, to verify against that tool's current docs. Read the whole file when designing or reviewing; for a single lookup, read the sections its Contents list names.

| File | Open when |
|---|---|
| [references/taxonomy-and-naming.md](references/taxonomy-and-naming.md) | naming events and properties, shared context, value types, governance, versioning |
| [references/implementation.md](references/implementation.md) | writing track calls on any client or server; webhooks and store notifications; attribution; ids, time, delivery; identity; warehouse landing; sampling; consent; testing |
| [references/experiments.md](references/experiments.md) | an A/B test, flag rollout or holdout must give a trustworthy result |
| [references/decisions-and-quality.md](references/decisions-and-quality.md) | turning events into decisions, judging what data can prove, data quality checks, analysis traps |
| [references/tool-notes.md](references/tool-notes.md) | the stack uses a specific analytics tool, customer data platform, flag tool, payment provider, framework or platform API, and you need its field names, defaults or limits |

## How to operate

**Establish the context first.** Ask for, or infer and state: the decision and who makes it; the surfaces and systems; the pipeline (analytics tool, warehouse, flag tool); what already exists (plan, naming convention, wrapper — extend it unless it causes wrong numbers); privacy constraints.

**Designing:** walk the recipe and produce "Output: tracking plan".

**Reviewing code or a plan:** lead with what produces **wrong numbers** — duplicates, lost events, the wrong source for money, identity breaks, missing or biased exposure, personal data — before naming and style. Report each finding as *issue → why it leads to a wrong decision → the fix*, most harmful first, tagged **What**, **Where** or **How**. Then show the corrected code or plan.

**"Did X work?" or "can we conclude Y?":** answer directly first (yes, no, or only partly) using the evidence ladder in step 11. Then say what is defensible to claim today, what would settle it, and what to track from now on.

## Output: tracking plan

Adapt headings to the request; keep it tight.

```markdown
# Tracking plan: <feature or product area>

## Measurement plan
- Question: ...
- Decision rule: ship if <primary metric> improves by at least <minimum effect> and every guardrail's confidence bound stays inside its margin; otherwise <action>.
- Primary metric: <name> = <numerator> ÷ <denominator>, per <unit>, within <window>, <time zone>
- Guardrails (non-inferiority margin): ...
- Segments: ...
- Conclusion needed: descriptive | correlational | causal → design: <A/B test | holdout | staged rollout | none>
- Duration / sample: ...

## Shared context (every event)
| Property | Type | Example | Set by |
|---|---|---|---|

## Events
| Event | What: trigger (exactly when) and properties (type, allowed values) | Where: sending system | How: event_id rule, event time, transport | Feeds metric |
|---|---|---|---|---|

## Identity
- user id: ... · anonymous id: ... · account id: ... · identify when: ... · reset when: ... · passed to backend via: ...

## Experiment logging (if any)
- Experiment key: ... · unit: ... · assignment log: ... · exposure fires when: ... · counterfactual logged: ... · SRM check: ...

## Quality checks
- Before release: ...
- After release: volume alert per event × platform × version; reconcile <metric> with <source of truth>

## Open questions / assumptions
- ...
```

## The recipe

### 1. What — decision first: the measurement plan

- **Question** — "Does the one-page checkout increase purchases per visitor?"
- **Decision rule** — what the team does if the primary metric goes up, stays flat or goes down, and which guardrail result blocks launch regardless.
- **Primary metric** — one, defined as in step 2. More primary metrics means more chances of a false win.
- **Guardrails** — what must not get worse (errors, latency, refunds, cancellations, support contacts), each with a non-inferiority margin.
- **Segments** — the cuts the decision depends on; each must be a property captured at track time.
- **Conclusion strength needed** — descriptive, correlational or causal (step 11).
- **Time** — collection period, from a sample-size estimate when an experiment is involved.

If nobody can state the decision, that is the first finding: say so and propose one.

### 2. What — metrics, then the events they need

- **Numerator and denominator, each with its own filter** — "users who completed an order ÷ users exposed to checkout", never just "conversion".
- **Unit** — per user, account, session or order. In an experiment the randomization unit must be at least as coarse as the analysis unit, and every metric event carries the randomization unit's id; a finer analysis unit (per order in a per-user test) needs the delta method for its variance.
- **Window and time zone** — "within 7 days of first exposure, UTC". Leave out cohorts whose window has not closed yet; a 4-week retention number for a 3-week-old feature is not a number.
- **Exclusions** — test and internal users, bots, refunds, duplicates.
- **Source** — which system emits each event (step 5).

Prefer **outcome events** (Order Completed, Subscription Started) over interaction events (clicks): a click shows an attempt, only the outcome shows success. Track failure outcomes too (Payment Failed with a reason). Derived states (Activated, Churned, Power User) are computed in the warehouse from events, never emitted by app code. Tens of well-defined events with rich properties answer more than hundreds of narrow ones.

### 3. What — event names

- **One written convention, applied everywhere.** Default: Object + past-tense Action (`Order Completed`), one casing for events and one for properties. Some tools impose hard rules (allowed characters, casing, length); the strictest destination wins. Treat names as case-sensitive: `Order Completed` and `order completed` become two events.
- **Never build names or property keys from values.** `track('clicked_' + label)` creates an event per label and breaks every funnel; use `Button Clicked { button_name }`.
- **Generic events, specific properties** — one `Order Completed { payment_method }`, not one event per method.
- **Reuse a published standard event spec when your pipeline has one** (common for e-commerce, subscriptions, media playback); destinations then understand the events without mapping.
- **Name what happened, not the widget** — `Plan Upgraded`, not `Upgrade Modal CTA Tapped`.

### 4. What — properties and the shared context

Every event carries the same envelope, set once in the tracking wrapper:

| Field | Why |
|---|---|
| `event_id` | dedup across retries and pipeline replays |
| event time | when it happened, not when it was sent |
| `user_id` and/or `anonymous_id` | who; the analysis and randomization unit |
| `account_id` (B2B) | most B2B decisions are per account |
| `platform`, `app_version`, `build` | regressions by release; old builds send for months |
| `environment` | keeps staging and test data out of production numbers |
| `source` | client, or the emitting service |
| `schema_version` | old app builds keep sending old shapes |

Event-specific properties: ids of the business objects (`order_id`, `product_id`) so events join each other and the warehouse; closed sets as enums; units in names (`duration_ms`); large numeric ids as strings (many tools store numbers as 64-bit floats). **Money**: store integer minor units internally with an ISO 4217 `currency`; convert to the unit each destination's revenue field expects (many take major units) in one function, using the currency's minor-unit exponent — dividing by 100 is wrong for JPY and KWD. **No personal data**: no email, name, phone or free text that can hold them.

Capture acquisition context (campaign parameters, click ids, install referrer) on first open and persist it through signup, or channel questions cannot be answered later.

### 5. Where — each fact is sent by the system that owns it

| Fact | Sent from | Why |
|---|---|---|
| UI intent: views, impressions, clicks, form starts | client | only the client knows what was seen |
| State changes: signed up, order placed, invite accepted | backend, after commit | the client can be blocked, crash or lie; the database is the truth |
| Payments, refunds, renewals, disputes | the payment provider's server notifications (webhooks), handled on the server | renewals and refunds never pass through the client |
| In-app purchases and store subscriptions | the app store's server-to-server notifications | a client "purchase succeeded" is not the store's final state |
| Install and campaign attribution | mobile attribution provider or captured landing parameters | the app alone cannot see the ad click |
| Email and push delivered, opened, clicked | the messaging provider's webhooks | the provider sees the delivery |
| Sales stage, owner, company size; support tickets | CRM and support tool sync into the warehouse | those tools own them; attach as account properties |
| Scheduled and batch work | the job, with an id derived from its business key | jobs retry and run on several replicas |

- **Client-side tracking loses data** to ad blockers and browser storage limits (figures in `implementation.md` §1). Never compute revenue or a launch metric only from client events.
- **Do not send the same event name from both client and server.** Analytics tools will not collapse the two copies: their dedup keys only match within the same device or the same timestamp. The client sends the intent (`Checkout Submitted`); the server sends the outcome (`Order Completed`). Ad-platform conversion APIs designed for paired browser-plus-server sending with a shared event id are the exception.
- **Pass the client's `anonymous_id` and consent state to the backend** with each request (a header or cookie), so server events join pre-login funnels and respect consent.
- **Backend events go out only after the transaction commits** — through a transactional outbox, or the framework's after-commit hook.

### 6. How — identity

- `user_id` is the stable internal database id, never email or username — those change, and most tools cannot merge two user ids.
- Identify at signup and login; reset on logout, so the next person on a shared device is not merged into the previous one.
- Bridge anonymous and known with one event carrying both ids (`Signed Up` with `anonymous_id` and `user_id`).
- Never send `null`, `0`, `"None"` or a placeholder as an id; tools merge everyone with that id into one person. A guest has no `user_id`, not a fake one.
- B2B: `account_id` on every event, not only on a group call.

### 7. How — delivery and time

Delivery is at least once: networks retry, mobile queues replay, webhooks resend. Design for duplicates and late arrivals.

- **`event_id` is created once, with the event, and reused on every retry.** Server and job events derive it as a UUIDv5 of the business key (`order:<id>:completed`), so a retried handler produces the same id. The wrapper maps it to the tool's dedup field (`insert_id`, `$insert_id`).
- **Repeated submits are a business bug before they are a tracking bug.** A double tap or a client retry sends the intent event twice — and, if the action is not idempotent, charges or creates twice. Flag it to the action's owner (an idempotency key from client to server), not only the duplicate event.
- **Event time is when it happened.** For client events, at the action. For provider events, the provider's occurrence time — webhooks can arrive days late. Keep received time separately for lag monitoring.
- Clients: a persistent queue that survives offline periods and app kills, flushed when the page or app goes to the background (not on unload); webhooks: verify, store, return 2xx, process from a queue, dedupe by provider event id, never assume order. Details in `implementation.md` §3–§8.

### 8. How — experiments and feature flags

Full method in `references/experiments.md`. The rules that break results most often:

- **Keep an assignment log for every experiment**, even when analysing exposed users — it is the fallback analysis (intent to treat) when exposure turns out biased.
- **Log exposure when the user actually experiences the variant**, not at app start or flag prefetch — and only when that moment is reached the same way in both arms. If the treatment can change who reaches it (a slower page, a redirect, a changed earlier step), filtering to exposed users biases the result; analyse everyone assigned instead.
- **Control users always log exposure.** Suppress exposure only for a fallback served because evaluation failed or the user has no assignment.
- **Exposure carries** experiment key, variant, unit id, time, and how the assignment was made (`allocation_version`, rule vs override vs fallback), so ramps, re-salts and forced QA users can be separated.
- **Same unit id everywhere** — flag evaluation, exposure and every metric event.
- **Log the counterfactual** when only some users reach the changed code: in control, record that the user *would have* seen it, so both arms contain the same population.
- **Check sample ratio mismatch (SRM) first**, before any metric: a chi-square test on exposed counts per arm (k − 1 degrees of freedom), at a strict threshold such as Microsoft's p < 0.0005, or a sequential test when checked daily. A failed SRM invalidates the result; a passed one is necessary, not sufficient.
- **Shared resources break user-level tests.** Marketplaces, shared budgets or inventory, social features and pricing let one user's treatment affect others; randomize by cluster, market or time slot and log that id.
- **Metric events must flow before the test starts** wherever possible — sample-size estimates and variance reduction (CUPED) use pre-period data.
- **Validate the pipeline with A/A splits** after new instrumentation: many re-randomized splits of historical data should give uniform p-values; one live A/A catches only gross breaks.

### 9. How — quality and governance

- The tracking plan is the contract, in version control or a governed tool, with an owner per event.
- **One typed track function per platform**, ideally generated from the tracking plan. No raw event-name strings in feature code.
- **Instrumentation is part of "done"**: reviewed with the code, measurement plan linked from the pull request.
- **Test analytics calls** through a fake tracker; verify end to end in a dev project before release.
- **Separate dev, staging and production projects or keys** — most tools cannot delete bad data.
- **Validate in production**: schema checks at ingest, and volume alerts per event × platform × app version after every release. A release that stops sending an event looks exactly like users stopping.
- **Filter bots, test and internal users** the same way in every metric.
- **Reconcile** key numbers with their source of truth (billing totals, database counts) at build time and on a schedule; a periodic pull from the provider's API repairs missed webhooks, and records with no `user_id` or `account_id` link are counted and alerted on.
- **Land raw events in the warehouse append-only**, partitioned by event date, with dedup on `event_id` in a model on top; restate recent periods as late events arrive; flag backfills and never replay them into vendor tools blindly.
- **Control volume**: deterministic sampling by unit id for very high-volume events (impressions, scroll), with `sample_rate` on the event; never sample exposure, revenue or experiment metric events.
- **Autocapture is for discovery**; anything a metric, funnel or experiment depends on is an explicit, typed event.

### 10. How — privacy and consent

- Collect what the decision needs, not what is available.
- Initialize client analytics only after the required consent; send consent state to tools that accept it and to the backend, whose emitters drop or anonymize events without it.
- No personal data in names or properties. A hash still identifies a person; hash only where a vendor requires it for matching. Use IP for geolocation, then truncate or drop it.
- Deletion requests reach every destination: analytics tools, the warehouse and every copy.

### 11. Concluding: the evidence ladder

Say which rung the data supports, in plain words, every time a conclusion is drawn.

| Rung | Design | What it can show | What it cannot show |
|---|---|---|---|
| 0. Descriptive | counts, funnels, adoption | what happened and how often | why, or what would have happened otherwise |
| 1. Correlational | users vs non-users; before vs after | an association worth investigating | cause: adopters differ from non-adopters, users must come back to adopt at all (immortal-time bias), and before/after mixes in seasonality, marketing and other launches |
| 2. Quasi-experimental | staged rollout, difference-in-differences, geo holdout | a causal estimate under stated assumptions (parallel trends, no anticipation, no spillover, stable groups) | anything when those fail; passing a pre-trend check does not prove them |
| 3. Randomized | A/B test or holdout with assignment log, valid exposure, SRM passed, metrics fixed in advance | cause, for that population and period | long-term effects past the window, effects under interference, or at full rollout |

When the data sits on rung 0 or 1 but the decision needs rung 3, say so plainly, state what can honestly be claimed, and give the cheapest way up: a holdout, a staged rollout, or an experiment on the next iteration.
