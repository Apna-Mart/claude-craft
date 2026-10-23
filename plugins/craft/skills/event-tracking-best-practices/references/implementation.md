# Implementation: where and how data is sent

Tool-neutral patterns for any language, framework and provider. Code is pseudocode: translate it to the project's language and its existing idioms. For a specific tool's field names, defaults and limits, see `tool-notes.md`.

## Contents

1. Client vs server: who owns which fact
2. One typed track function
3. Client delivery: queue, background flush, page views
4. UI components: firing exactly once
5. Mobile and desktop: offline, version skew, debugging
6. Backend: emit after commit (outbox)
7. Third-party systems: payments, app stores, messaging, support, CRM, attribution
8. Dedup ids and retries
9. Timestamps
10. Identity
11. Sessions, views and autocapture
12. Pipeline choices: data platform, warehouse landing, volume
13. Testing, QA and environments
14. Consent and personal data
15. Sources

## 1. Client vs server: who owns which fact

The client knows what the user saw and tried. The server knows what actually happened. Money is known for certain only by the payment provider or app store.

- Client-side collection loses data: ad and tracker blockers, browser storage limits that reset anonymous ids within days, crashes, and closed tabs. One analytics vendor warns client-side tracking "may lose events for 30-50% of your users". Business-critical events come from the server.
- First-party collection (a proxy or collection endpoint on your own domain) reduces blocking, but does not make the client a source of truth.

**Do not send the same event from both sides and expect the tool to merge them.** Dedup keys in analytics tools match only within the same device id, or only when the timestamp is identical too — a client copy and a server copy never qualify. Give each side its own event: the client sends intent (`Checkout Submitted`), the server sends the outcome (`Order Completed`). If a copy is unavoidable, mark it with `source` and dedupe on `event_id` in the warehouse. Ad-platform conversion APIs built for paired browser-plus-server sending with a shared id are the one common exception.

**Carry client identity and consent to the server.** Send `anonymous_id` (or device id) and the consent state with each API request, as a header or cookie, so server events join the pre-login funnel and can be dropped when consent is missing.

## 2. One typed track function

Every platform gets one function that knows every event and its properties, adds the shared context, and is the only code that talks to the SDK. Generate it from the tracking plan where tooling allows; otherwise write it by hand in the platform's type system.

```text
EVENTS = {
  "Screen Viewed":      { screen_name: string, order_id?: string },
  "Checkout Submitted": { cart_id: string, item_count: integer },
  "Payment Failed":     { cart_id: string, reason: one_of("card_declined", "insufficient_funds", "network", "other") },
  "Product Added":      { product_id: string, category: string, price_minor: integer, currency: iso4217 },
}

CONTEXT = { platform, app_version, build, environment, source: "client", schema_version }

track(name, properties):
  require name in EVENTS
  require properties match EVENTS[name]
  event = {
    name,
    properties: properties + CONTEXT,
    event_id:   new_uuid(),
    occurred_at: now_utc(),
  }
  sdk_adapter.send(event)
```

- The **name is a member of a closed set**, so dynamic names cannot compile or pass validation.
- **Properties are typed**, closed sets are enumerations, and missing required fields fail early.
- **Context is added in one place.**
- `sdk_adapter.send` maps `event_id` and `occurred_at` onto the tool's own dedup key and event-time field, so the tool dedupes and buckets on them rather than on values it creates at send time. Identity (`user_id`, `anonymous_id`) is set on the SDK at identify time.
- The adapter is the seam for a fake tracker in tests.
- Revenue and state-change events are deliberately absent from the client set: they come from the server.

## 3. Client delivery: queue, background flush, page views

- **Use a persistent queue**: events are written to durable storage first and removed only after the transport accepts them. A crash, kill or offline period then delays events instead of losing them.
- **Batch** sends (by count and by interval) and retry with backoff; reuse each event's `event_id` on every retry.
- **Flush when the page or app goes to the background**, not on unload or close: on the web, the page-visibility change to hidden is the reliable signal, and unload-type events often never fire on mobile browsers. Background-time transports (a beacon or a keep-alive request) have small size limits — send in chunks under the limit and leave the rest in the queue for the next session. "Accepted for delivery" is not "delivered"; server-side dedup on `event_id` makes a re-send safe.
- **Flush before a full navigation away** after a key event; the page may unload before the next automatic flush.
- **Single-page apps** record page views on route changes, not only on page loads.
- **Prefer the SDK's built-in queue and background flush** when it has them; configure rather than rebuild.

## 4. UI components: firing exactly once

Every UI framework separates three places code runs: the render (or build, compose, body) function, event handlers, and lifecycle or effect hooks.

- **Never track from the render function.** It runs whenever the framework decides — on every state change, sometimes twice — and each run sends another event.
- **Track user actions in event handlers.**
- **Track views in a lifecycle or effect hook keyed on what identifies the view** (screen name plus the object shown), so it fires once per view and again only when the view's identity changes. A hook with no key runs after every render.
- **Some frameworks run effects twice in development** to surface bugs. Expect duplicates in dev and dedupe by view identity; don't hide the double-run in a way that also hides real double-mounts in production.
- **Track outcomes after the result is known**, and cover every exit path:

```text
on_pay_pressed():
  if payment_in_flight:
    return
  payment_in_flight = true
  track("Checkout Submitted", { cart_id, item_count })
  try:
    result = payments_api.pay(cart, idempotency_key: cart.checkout_attempt_id)
  on error as error:
    track("Payment Failed", { cart_id, reason: failure_reason_of(error) })
    report_to_error_monitoring(error)
    show_payment_error(error)
    payment_in_flight = false
    return
  if result.ok:
    navigate_to_success(result.order_id)
  else:
    track("Payment Failed", { cart_id, reason: result.reason })

on_success_screen_shown(order_id):
  track("Screen Viewed", { screen_name: "order_success", order_id })
```

- `failure_reason_of` maps errors onto the closed set (`network` only for real connectivity failures; anything unrecognised is `other`), so the reason breakdown stays truthful.
- The handler handles the failure where the user is: it reports the error to error monitoring and shows an error state. Re-throwing from a UI event handler usually ends as an unhandled error, not as handling.
- The in-flight guard (a plain variable or ref, not render state that updates a frame later) stops a double tap from sending two intents. It is not enough on its own: the **idempotency key** sent to the server is what stops a double charge when two requests still get through (two taps in the same frame, a client retry after a timeout). A review that finds a double-submit path reports the double charge, not just the duplicate event.
- The `Order Completed` with revenue is sent by the server when the order commits, not by this screen.

## 5. Mobile and desktop: offline, version skew, debugging

- **Offline events arrive late with their real event time.** Metrics that count by "received today" drift; aggregate by event time.
- **Old builds keep sending for months**, often with old event shapes and old bugs. Put `app_version`, `build` and `schema_version` on every event, and read results per version after a release.
- **Lifecycle events** (app opened, backgrounded) are often off by default in SDKs; turn them on if sessions or retention depend on them.
- **SDK batching can be slow** (some batch for up to an hour); use the tool's debug or live view during QA, and keep debug traffic out of production exports.
- Cross-platform frameworks wrap native SDKs; the same rules apply, and the typed wrapper lives in the shared code.

## 6. Backend: emit after commit (outbox)

An event sent inside a transaction can report something that then rolls back. An event sent after commit can be lost if the process dies between commit and send. The **transactional outbox** closes both gaps: write the event to an outbox table in the same transaction as the business change; a relay publishes it afterwards (by polling or change data capture); consumers dedupe by `event_id` because the relay can publish twice.

```text
EVENT_NAMESPACE = <one fixed UUID per product, never changed>

event_id_for(business_key):
  return uuid_v5(EVENT_NAMESPACE, business_key)

complete_order(order_id):
  in transaction:
    order = lock_and_load(order_id)
    if order.is_completed:
      return
    order.mark_completed()
    save(order)
    insert outbox_event {
      event_id:     event_id_for("order:" + order.id + ":completed"),
      name:         "Order Completed",
      user_id:      order.user_id or absent,
      anonymous_id: order.anonymous_id,
      account_id:   order.account_id or absent,
      occurred_at:  now_utc(),
      properties:   { order_id: string(order.id), revenue_minor: order.revenue_minor, currency: order.currency },
    }
```

- `outbox_event.event_id` has a **unique constraint**, so a retried handler fails to insert a second copy instead of duplicating.
- The id is a **UUIDv5 of the business key**: stable across retries, replicas and replays, and in a format every tool accepts (some reject colons or anything longer than a UUID, so a raw `order:123:completed` string can fail).
- A **guest has no `user_id`** — the field is absent, never the string `"None"`, `"null"` or `"0"`.
- **Lighter option** when losing a rare event is acceptable: the framework's after-commit hook, which runs only after a successful commit and is discarded on rollback. A failing hook does not undo the commit, so failures need their own alert.
- **Server events need the client's context passed in**: user agent, the client IP for geolocation (then dropped), `anonymous_id` and consent state from the request.
- **Jobs and consumers** derive `event_id` the same way (`event_id_for("invoice:" + id + ":generated")`) so a rerun on another replica produces the same id.
- **Validate outgoing events** against the tracking plan's schema in the producer's tests, so a bad deploy fails in CI, not in the warehouse.

## 7. Third-party systems: payments, app stores, messaging, support, CRM, attribution

### Payment providers

The payment provider is the source of truth for money: renewals, refunds, disputes and failed retries never pass through your client. Handle its server notifications (webhooks) as a durable **inbox**:

```text
receive_payment_webhook(request):
  if not provider_signature_valid(request.raw_body, request.signature_header):
    respond 400
  notification = parse_json(request.raw_body)
  insert_if_absent provider_event { provider: "payments", provider_event_id: notification.id, type: notification.type, payload: notification }
  respond 200

process_inbox():
  for row in provider_event where processed_at is null:
    current = provider_api.fetch(row.payload.object_id)
    apply_state_idempotently(current)
    write_outbox_event(
      name: analytics_name_for(row.type),
      event_id: event_id_for("payments:" + row.provider_event_id),
      occurred_at: provider_occurrence_time(row.payload),
    )
    mark_processed(row)
```

- **Verify the signature on the raw body** before trusting anything; reject stale timestamps.
- **Store first, return 2xx fast, process asynchronously.** Slow handlers time out and trigger retries.
- **Dedupe by the provider's event id** (unique constraint on provider + event id). Some providers can also send two distinct notifications for one change; collapsing those by object id plus type is safe only for once-per-object types (an invoice becoming paid), never for repeatable ones (each failed payment retry, each subscription update).
- **Never assume delivery order.** Re-fetch the current object and set state from it.
- **Event time is the provider's occurrence time**, not processing time: retries can deliver days later and revenue would land on the wrong day. Keep processing time as `received_at`.
- **Web frameworks with cross-site request forgery protection** must exempt the webhook route, or every notification is rejected.
- **Repair missed notifications**: run a periodic pull from the provider's API (for example nightly, over the last few days) and compare it with stored state; webhooks can be lost when an endpoint is down past the retry window. Count provider customers or subscriptions with no link to your `account_id`, and alert on any.
- Amounts usually arrive in **minor units**; convert for destinations using the currency's ISO 4217 minor-unit exponent (0 for JPY, 2 for USD, 3 for KWD), never a fixed divide by 100.

### App stores

For in-app purchases and store subscriptions, the source of truth is each store's **server-to-server notifications** plus its server API for current state — not the client's "purchase succeeded" callback. Renewals, refunds, grace periods and billing retries happen without the app open. Process them with the same inbox pattern.

### Messaging, support and CRM

- Email and push providers report delivered, opened and clicked through their own webhooks; support tools own ticket counts; the CRM owns deal stage, owner, company size and industry.
- **Sync these into the warehouse keyed by your `user_id` or `account_id`**, and attach CRM fields as account properties. Do not re-create them as client events; the app does not own them.

### Attribution and acquisition

Capture acquisition context **once, at the first page view or app open**, and persist it through signup:
- Web: campaign parameters from the landing URL (the `utm_*` set), ad click ids, and the referrer — stored as first-touch (never overwritten) and last-touch properties, and copied onto the signup event.
- Mobile: the platform's install-referrer and ad-attribution sources, or a mobile measurement partner, plus the device's tracking-permission state as a property.

Without this, channel, cost-per-acquisition and payback decisions cannot be made from product data.

## 8. Dedup ids and retries

Delivery is at least once at every hop — client retries, queue replays, relay re-publishes, webhook redeliveries.

- **Create `event_id` once, when the event is created, and store it with the event in the queue.** An id generated per send attempt defeats every dedup mechanism.
- **Client events**: a random UUID at creation. **Server, job and provider-derived events**: a UUIDv5 of the business key.
- **Map `event_id` onto the destination's dedup key.** Learn its scope: many tools dedupe only within a window (often days) and only within the same device or identity.
- **Retry** on rate limits and transient server errors with exponential backoff and jitter; never retry validation errors (they will fail again). Retrying an ambiguous failure (a timeout or gateway error) can duplicate — which is why the id must already be on the event.
- **Dedupe again in the warehouse** on `event_id`; never rely on one hop.

## 9. Timestamps

Keep three times:

| Time | Set by | Used for |
|---|---|---|
| event time (`occurred_at`) | the system where it happened, at that moment | every metric and window |
| sent time | the client, when the batch is sent | correcting device clock skew: corrected time = received − (sent − event) |
| received time | the collector or server | lag monitoring, late-data detection |

- Store in UTC with offset; keep the user's time zone separately when local-time analysis matters.
- Aggregate metrics by event time with a declared time zone.
- Backend events use the time of the business change, not the relay's publish time. Provider-derived events use the provider's occurrence time.
- Reject or flag event times far in the future or far in the past; clock bugs produce them.

## 10. Identity

- **`user_id` is your stable internal id.** Not email or username: those change, and most tools cannot merge two user ids or change an existing one.
- **Anonymous users get only an anonymous or device id**, never a made-up user id.
- **Identify at signup and login; reset at logout**, clearing both the user id and the anonymous id, so the next person on a shared device starts fresh. Note that regenerating a device id changes the bucketing id for device-randomized experiments.
- **Bridge anonymous to known** with one event carrying both ids (signup or login), or with the tool's identify/merge call at that moment.
- **Never send placeholder ids** (`null`, `0`, `"undefined"`, `"None"`, an empty string). Tools merge everyone with that id into one person.
- **Backend events use the same ids as the client.** Server SDKs have no anonymous or session state of their own; pass the client's ids in.
- **B2B**: `account_id` on every event; users can belong to several accounts, so the event carries the account it happened in.
- **Personal identifiers stay out of ids**: the user id must not let a third party identify the person.

## 11. Sessions, views and autocapture

- Sessions are usually defined by inactivity timeouts (commonly around 30 minutes on web, a few minutes in the background on mobile). State the definition with any per-session metric, and keep server events out of client sessions unless deliberately attached.
- **Autocapture** (automatic click and page-view collection) is good for discovery and exploring unknown behaviour. It records UI elements, not business meaning, changes meaning whenever the UI changes, and usually misses form values and server outcomes. Anything a metric, funnel or experiment depends on is an explicit, typed event.

## 12. Pipeline choices: data platform, warehouse landing, volume

**Customer data platform or direct SDK.** A customer data platform gives one track call fanned out to many destinations, schema enforcement at ingest and a raw copy in the warehouse; it adds cost and one more place where data can be dropped. A direct SDK is simpler with one analytics tool. With a data platform, prefer server-side (cloud) delivery to destinations for anything a metric depends on: client-side (device-mode) destinations load the vendor's script in the browser, are exposed to blockers, and may not be covered by enforcement or deletion features.

**Warehouse landing.**
- Land raw events **append-only and immutable**, partitioned by event date, one row per received event, with `event_id`, event time, received time, `source` and `schema_version` as columns.
- Build a **deduplicated model** on top (one row per `event_id`) and compute every metric from it.
- **Late data**: offline mobile events and provider retries arrive days late, so closed periods keep changing. Restate a rolling window (for example the last 7 days) on every load, and mark recent periods provisional in reports.
- **Backfills**: flag backfilled rows (`is_backfill`), keep their original event time, and don't replay them into vendor tools without checking the tool's rules — many limit how far back events may be dated, and recorded vendor data often cannot be deleted.

**Volume and cost.** Tools bill by events or tracked users. For very high-volume, low-value events (impressions, scroll depth, heartbeats), sample **deterministically by unit id** (a hash of `user_id` modulo N) and put `sample_rate` on the event so counts can be reweighted. Never sample exposure, revenue, or any event an experiment metric uses — that biases results or breaks the SRM check.

## 13. Testing, QA and environments

- **Unit tests** inject a fake tracker and assert the exact events: names, properties, count.

```text
test "payment failure sends Checkout Submitted then one Payment Failed":
  sent = []
  tracker = fake_tracker(record_into: sent)
  submit_payment(tracker, payments_api: failing_with("card_declined"))
  assert names(sent) == ["Checkout Submitted", "Payment Failed"]
  assert sent[1].properties.reason == "card_declined"
  assert no_personal_data(sent)
```

- **Backend tests** assert the outbox row is written in the same transaction, and not written when the transaction rolls back.
- **Plan conformance in CI**: fail the build when a planned event is not implemented or an unplanned one appears.
- **Live QA before release** in a dev or staging project with the tool's debug or live view, or a local collector that records what would be sent.
- **Separate projects or keys per environment**, chosen by build configuration rather than a runtime flag someone can forget. Most tools cannot modify or delete recorded data.

## 14. Consent and personal data

- **Initialize client analytics only after the required consent**, and pass consent state to tools that accept it.
- **Consent applies to server-side emission too.** The backend receives the consent state with each request (section 1) and drops or anonymizes events without it; otherwise server tracking bypasses the user's choice, and consented and non-consented populations differ silently between client and server data.
- **Collect what you need, not what is available.**
- **No personal data in event names or properties**: internal ids only. Review free-text properties (search queries, feedback): users type emails and phone numbers into them.
- **IP addresses are personal data** in many jurisdictions: use them for geolocation at ingest, then truncate or drop them.
- **Hashing is for matching, not anonymity**: hash only where a destination requires it, after normalizing as it specifies; a hashed email still identifies a person.
- **Deletion requests reach every copy**: keep a list of every destination and warehouse table holding user-level events, and route each request to all of them. Some destinations, notably client-side ones, are not reached by a pipeline's deletion feature.

## 15. Sources

- https://docs.mixpanel.com/docs/tracking-methods/choosing-the-right-method
- https://posthog.com/docs/product-analytics/best-practices
- https://webkit.org/tracking-prevention/
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon
- https://microservices.io/patterns/data/transactional-outbox.html
- https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
- https://docs.djangoproject.com/en/stable/topics/db/transactions/
- https://docs.stripe.com/webhooks
- https://docs.mixpanel.com/docs/tracking-best-practices/server-side-best-practices
- https://amplitude.com/docs/apis/analytics/http-v2
- https://docs.mixpanel.com/reference/import-events
- https://www.twilio.com/docs/segment/connections/spec/common
- https://docs.snowplow.io/docs/fundamentals/canonical-event/
- https://www.twilio.com/docs/segment/connections/spec/best-practices-identify
- https://docs.mixpanel.com/docs/tracking-methods/id-management/identifying-users-simplified
- https://posthog.com/docs/product-analytics/identify
- https://amplitude.com/docs/data/sources/instrument-track-unique-users
- https://amplitude.com/docs/data/sources/instrument-track-sessions
- https://posthog.com/docs/product-analytics/autocapture
- https://firebase.google.com/docs/analytics/userid
- https://amplitude.com/docs/get-started/create-project
- https://amplitude.com/docs/data/privacy-and-consent-implementation
- https://www.twilio.com/docs/segment/privacy/user-deletion-and-suppression
- https://developers.google.com/tag-platform/security/guides/consent
