# Taxonomy and naming

Tool-neutral rules. Where a specific tool forces a rule (casing, length, reserved prefixes), see `tool-notes.md`. The rules here are the common ground of the analytics vendors' own planning guides, listed in Sources.

## Contents

1. Start from questions, not from the UI
2. Event names
3. Standard event specs
4. Event, event property, user property, account property
5. Shared context on every event
6. Property values: types, enums, units, money, time
7. Cardinality and limits
8. Accounts and groups (B2B)
9. Governance, versioning and deprecation
10. Sources

## 1. Start from questions, not from the UI

Every vendor planning guide makes the same point: start with the questions and metrics, plan the most important ones first, keep a small core of events with rich properties, and add more later. Tracking "everything and anything your user can do" creates development work and data nobody uses. Tracking low-level UI elements is the most common sign of a taxonomy that will not scale — record the UI control as a property of a meaningful event instead.

Method: decisions → metrics → the events and properties each metric needs → nothing else. Each event in the plan lists the metric it feeds; an event that feeds no metric needs a reason to exist.

## 2. Event names

**Pick one convention, write it down, enforce it.** Tools and guides disagree on casing and tense; consistency matters far more than the choice.

Default when nothing exists:
- Events: **Object + past-tense Action**, from the user's or system's point of view — `Order Completed`, `Report Exported`, `Invite Sent`.
- One casing for events, one for properties (for example Title Case events with snake_case properties, or snake_case for both). If any destination restricts characters or casing, choose the convention every destination accepts.
- A short, closed list of allowed verbs (`Viewed`, `Started`, `Completed`, `Failed`, `Added`, `Removed`, `Sent`, `Exported`) keeps names predictable.

Rules that hold under every convention:
- Never build event names from values.
- Never put a value in an event name that could be a property.
- Never build property keys from values.
- Events are generic and high level; properties are specific and detailed.
- Treat names as case-sensitive: two casings become two events.

```text
bad:   track("clicked_" + button.label)
bad:   track(screen + "_viewed")
bad:   track("Paid With PayPal")

good:  track("Button Clicked",  { button_name: "add_to_cart", screen_name: "product" })
good:  track("Screen Viewed",   { screen_name: "product" })
good:  track("Order Completed", { order_id, payment_method: "paypal", revenue_minor, currency })
```

Give properties specific names (`item_type`, `payment_type`), never one generic `type` reused with different meanings across events.

## 3. Standard event specs

Many pipelines and analytics tools publish standard specs — for e-commerce (product viewed, added to cart, checkout started, order completed, refunded), subscriptions and B2B (signed up, trial started, account user added), media playback, and experiments (experiment viewed with experiment and variation ids). When the stack has one, use it: destinations understand the events without custom mapping. Copy the names and required properties; don't copy inconsistencies found in a spec's own examples. Names and fields per tool: `tool-notes.md` §1.

## 4. Event, event property, user property, account property

| Kind | Holds | Example |
|---|---|---|
| Event | something that happened, once, at a time | `Order Completed` |
| Event property | facts true at that moment | `payment_method`, `order_id`, `revenue_minor` |
| User property | facts about the person that persist until changed | `plan`, `signup_date` |
| Account property | facts about the company | `employee_count`, `industry`, `plan` |

- One event plus a property beats one event per variant: one `Order Completed { payment_method }` keeps working when a new method is added.
- Funnels need the joining key (for example `product_id`) on every step, or "same product through the funnel" cannot be computed.
- Facts that change and matter for analysis (plan, role) go on the event as well as on the user: a user property shows the *current* value, not the value at the time of an old event.

## 5. Shared context on every event

Minimum envelope, whatever the tool: `event_id`, event time, `user_id`/`anonymous_id`, `account_id` (B2B), `platform`, `app_version`, `build`, `environment`, `source`, `schema_version`. Plus, where relevant: `session_id`, `locale`, `timezone`, `os`, `device_type`, `page` or `screen`.

Set them once — in the tracking wrapper or as the tool's global properties — never by hand at each call site. Check which context the SDK collects automatically and which it does not: account or group ids are often *not* attached automatically.

## 6. Property values: types, enums, units, money, time

- **Enums** for closed sets, with the permitted values in the tracking plan; lowercase snake_case values (`credit_card`, not a mix of `Credit Card` and `credit card`) keep group-bys clean.
- **Numbers**: many tools store numbers as 64-bit floats, exact only up to 2^53 — send large numeric ids as strings.
- **Strings**: tools truncate long strings (often at a few hundred to about a thousand characters); don't put payloads or free text in properties that need to be grouped.
- **Booleans**: `is_` / `has_` prefixes read clearly in queries.
- **Units in the name**: `duration_ms`, `file_size_bytes`, `price_minor` — this prevents seconds and milliseconds, or cents and dollars, being mixed in one column.
- **Money**: integer minor units plus an ISO 4217 `currency` on every monetary event. Convert to a destination's expected unit in one function that uses the currency's minor-unit exponent (0 for JPY, 2 for USD, 3 for KWD) — never a fixed divide by 100.
- **Time**: ISO 8601 with offset, stored in UTC; time zone of the user as a separate property when local-time analysis matters.

## 7. Cardinality and limits

Every tool caps something: event name length, number of distinct event names, properties per event, property value length, number of indexed values. Past the cap, data is truncated, dropped or stops being indexed — silently. The usual cause is high-cardinality values (ids, timestamps, free text, URLs with query strings) used as event *names* or property *keys*. Values with high cardinality belong in properties, and only when someone will filter or join on them. Per-tool limits: `tool-notes.md`.

## 8. Accounts and groups (B2B)

- Send `account_id` as a property on **every** event. Many tools attribute an event to an account only if the key is on that event, and a separate "group" call alone is not enough.
- Use ids, never names, as account keys.
- Account traits owned by other systems (company size, segment, owner, deal stage) are synced from the CRM or billing system as account properties, not sent from the client.
- Account membership changes are events (`Account User Added`, `Account User Removed`); historical events keep the account they had at the time.

## 9. Governance, versioning and deprecation

- **The tracking plan is a versioned contract** with an owner per event: in version control or a governed tool, reviewed like code.
- **Typed clients generated from the plan** where tooling allows; otherwise one hand-written typed wrapper per platform. A CI check fails when a planned event is not implemented or an unplanned one appears.
- **Enforcement at ingest**: schema validation that blocks or quarantines unplanned events and invalid properties. Know where blocked data goes — some pipelines discard it permanently — and watch the quarantine.
- **Versioning**: a change that breaks validation of historical data (adding or removing a required field, changing a type) is a new major version; additive optional fields are minor. Carry `schema_version` so old and new app builds validate side by side.
- **Deprecation**: mark deprecated in the plan → stop sending from new builds → keep accepting from old builds until their traffic is negligible → hide in the analytics tool → block only when nothing depends on it. Blocking is often irreversible.

## 10. Sources

- https://www.twilio.com/docs/segment/protocols/tracking-plan/best-practices
- https://amplitude.com/docs/data/data-planning-playbook
- https://amplitude.com/blog/data-taxonomy-analytics
- https://amplitude.com/blog/analytics-tracking-practices
- https://docs.mixpanel.com/docs/tracking-best-practices/tracking-plan
- https://mixpanel.com/blog/build-event-tracking-scheme-business-metrics/
- https://posthog.com/docs/product-analytics/best-practices
- https://www.avo.app/docs/data-design/best-practices/naming-conventions
- https://docs.mixpanel.com/docs/data-structure/property-reference/data-type
- https://docs.mixpanel.com/docs/data-structure/group-analytics
- https://docs.snowplow.io/docs/fundamentals/schemas/versioning/
- https://docs.snowplow.io/docs/data-product-studio/data-products/
- https://www.twilio.com/docs/segment/protocols/enforce/schema-configuration
- https://docs.mixpanel.com/docs/data-governance/lexicon
