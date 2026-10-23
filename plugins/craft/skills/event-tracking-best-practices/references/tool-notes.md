# Tool notes: where specific tools implement or break the generic rules

The rest of this skill is tool-neutral. This file holds facts about specific tools, platforms and frameworks, as read from their docs on 2026-10-20. Use it only for the tools in the user's stack. These are facts to **verify** against the tool's current docs or the installed SDK before relying on them in code — field names, defaults and limits change between versions.

## Contents

1. Product analytics tools: Segment, Amplitude, Mixpanel, PostHog, GA4 and Firebase, Snowplow, RudderStack, Avo
2. Ad-platform conversion APIs: Meta
3. Feature flag and experiment tools: Statsig, LaunchDarkly, Optimizely, Eppo, GrowthBook, Amplitude Experiment, PostHog
4. Payment providers and app stores: Stripe, Apple, Google Play
5. Web platform and browsers: page-hide delivery, Safari tracking prevention, consent mode
6. Backend frameworks and pipelines: after-commit hooks, change data capture
7. Warehouse and data-quality tools: dbt, Great Expectations
8. UI frameworks: effects and development double-runs
9. Sources

## 1. Product analytics tools

### Segment (customer data platform)
- Naming: Object (`Blog Post`) + Action (`Read`); "Title Case for event names and snake_case for property names"; "Don't create event names dynamically"; "Don't create property keys dynamically".
- Standard specs: e-commerce v2 (`Products Searched`, `Product Viewed`, `Product Added`, `Cart Viewed`, `Checkout Started`, `Order Completed`, `Order Refunded`, `Coupon Applied`, …; `Order Completed` carries `order_id`, `total`, `revenue`, `shipping`, `tax`, `discount`, `currency`, `products[]`; `revenue` excludes shipping and tax, `total` includes them), B2B SaaS (`Account Created`, `Signed Up`, `Trial Started`, …, with `context.groupId`), video (`Video Playback Started`, …), A/B testing (`Experiment Viewed` with `experiment_id`, `experiment_name`, `variation_id`, `variation_name`).
- Context auto-collected: `context.app`, `context.device`, `context.os`, `context.page`, `context.locale`, `context.timezone`, `context.library`, `ip`. **`context.groupId` is not auto-collected.**
- Ids and time: `messageId` per message; `originalTimestamp`, `sentAt`, `receivedAt`, corrected `timestamp = receivedAt - (sentAt - originalTimestamp)`.
- Identity: `identify` at signup, login, profile change; "We do not recommend using simple email addresses or usernames as a user ID"; "There is no way to change an existing `userId`"; `reset` clears `userId` and `anonymousId`; `group()` with required `groupId`.
- Governance (Protocols): enum types and regex checks; event versions in `context.protocols.event_version`; blocked events "not forwarded to a separate Source are permanently discarded"; unplanned-event blocking "is supported for all device-mode and cloud-mode Analytics.js destinations", but property, trait and common-schema enforcement does not reach device mode.
- Typewriter generates typed clients from the plan; it is in maintenance mode ("only critical maintenance updates", non-JS SDKs "not actively maintained").
- Deletion: regulation types include `SUPPRESS_WITH_DELETE`, `DELETE_ONLY`; only destinations that support deletion receive requests; device-mode destinations are not covered.
- Kotlin SDK defaults: `flushAt` 20, `flushInterval` 30 s, `trackApplicationLifecycleEvents` false.

### Amplitude
- Naming: `[Noun] + [Past-Tense Verb]`; names case-sensitive.
- Limits: 2,000 event types, 2,000 event properties, 1,000 user properties per project, then it "stops indexing new values"; values over 1,024 characters truncated.
- Dedup: `insert_id`, ignored when repeated on the same `device_id` within 7 days — server events without a `device_id` are not deduplicated against client copies.
- HTTP API: `time` in milliseconds since epoch; retry non-200; on 429 pause 30 s; retrying 500/502/504 can duplicate, 503 is safe; batch limits depend on plan.
- Browser SDK 2 defaults: `flushQueueSize` 30, `flushIntervalMillis` 1000, `flushMaxRetries` 5; `transport` `'fetch'`, `'xhr'` or `'beacon'`; with beacon the SDK does not retry or guarantee order.
- Android Kotlin SDK: `flushQueueSize` 30, `flushIntervalMillis` 30000, `flushEventsOnClose` true; persistent `StorageProvider`; the page contradicts itself on session timeout (5 vs 30 minutes).
- Sessions: `session_id` = session start in ms; web 30-minute timeout, mobile 5 minutes in background; server events `session_id = -1`.
- Identity: "Don't assign anonymous users a user ID"; "Amplitude can't merge user IDs"; on logout set user id null and regenerate device id (note: this changes the bucketing id for device-randomized experiments).
- Consent: "Only call `amplitude.init()` after consent is captured". Recorded data "can't" be modified or deleted — use a separate dev project.
- Ampli: typed wrapper from the plan (`ampli pull`); `ampli status` fails when a planned event is not instrumented.
- Group analytics: up to five group types; "You can't un-set a user's group type".

### Mixpanel
- `$insert_id` required on import, at most 36 bytes, alphanumeric or `-`; duplicates = identical (event, time, distinct_id, $insert_id).
- Import retries: back off from 2 s doubling to 60 s with 1–5 s jitter on 429, 502, 503; don't retry 400; rejects `time` before 1971 or more than 1 hour ahead.
- Types: strings 255 bytes; numbers are 64-bit floats — "Send large numeric identifiers as strings."
- Identity (Simplified ID Merge): `.identify(<user_id>)` at signup and login, `.reset()` on logout; server side send `$device_id`, then `$device_id` and `$user_id` after login; "We recommend not setting the `distinct_id` directly"; two `$user_id`s cannot be merged.
- Groups: "All events must have the group key as an event property in order to be attributed to a group"; `.set_group()`.
- Super properties: `register`, `register_once`.
- Client-side tracking "may lose events for 30-50% of your users" (ad blockers); server-side: parse the user agent and pass the client IP yourself.
- Bots: only a short crawler list filtered by default; mark others `$ignore: true`.
- Lexicon: hide (ingestion continues), block (unrecoverable), merge (non-destructive).
- Time zone: events stored in UTC; project time zone changes only the output (projects created before 2023-01-01 differ).

### PostHog
- Naming guidance: lowercase snake_case, present tense, `category:object_action`; booleans `is_`/`has_`.
- Autocapture records clicks and changes on common elements plus `$pageview`/`$pageleave`; no form values; `autocapture: false` does not stop page views; SPAs use `capture_pageview: 'history_change'`.
- Identity: `reset()` on logout; ids like `null` or `0` merge everyone; "Backend SDKs have no concept of an anonymous session".
- Groups: up to 5 group types; ids as keys.
- Reverse proxy claim: "typically increases event capture by 10-30%" (vendor's figure).

### GA4 and Firebase Analytics
- Event names "must start with a letter. Use only letters, numbers, and underscores"; case-sensitive; reserved prefixes `_`, `firebase_`, `ga_`, `google_`, `gtag.`.
- Limits: event name 40 characters; 25 parameters per event; parameter value 100 characters; 25 user properties (name 24, value 36); 500 distinct event names per app user (app streams).
- Recommended events (`sign_up`, `login`, `purchase`, `refund`, `add_to_cart`, `begin_checkout`, …) are not sent automatically; `purchase` takes `transaction_id`, `value`, `currency` (ISO 4217; required when `value` is set).
- Measurement Protocol augments, not replaces, client collection; `client_id`/`app_instance_id` to join; `timestamp_micros` backdates up to 72 hours; up to 25 events per request; a validation server whose events don't appear in reports.
- Firebase batches about hourly; DebugView via `adb shell setprop debug.firebase.analytics.app PACKAGE_NAME` (Android) or `-FIRDebugEnabled` (iOS); debug events still reach BigQuery export. User id must not let a third party identify the person.

### Snowplow
- Self-describing events validated against schemas (Iglu URIs such as `iglu:com.snowplowanalytics.snowplow/page_view/jsonschema/1-0-0`); SchemaVer `major-minor-patch` from `1-0-0`, major = breaks validation of historical data; invalid events go to failed events.
- Ids and time: `event_id` + `event_fingerprint`; `dvce_created_tstamp`, `dvce_sent_tstamp`, `collector_tstamp`, `derived_tstamp`, `true_tstamp`.
- Snowtype code generation; Snowplow Micro for local and automated tests.

### RudderStack
- Tracking plans validate `track`, `identify`, `page`, `screen`, `group` calls and forward violation details.

### Avo
- Codegen generates type-safe wrappers for any destination; Inspector flags unplanned events, type mismatches, sometimes-missing required properties; `avo status` can fail CI when a planned event is not implemented.

## 2. Ad-platform conversion APIs: Meta

- Pixel and Conversions API are meant to run together; dedup needs Pixel `eventID` = server `event_id` and the same event name, within 48 hours.
- Hash (SHA-256 after normalizing) `em`, `ph`, `fn`, `ln`, `db`, `ge`, `ct`, `st`, `zp`, `country`; never hash `client_ip_address`, `client_user_agent`, `fbc`, `fbp`.

## 3. Feature flag and experiment tools

- **Statsig**: logs exposure automatically on gate or experiment check; `disableExposureLogging: true` plus `manuallyLogExperimentExposure` to log at the real moment; `shutdown()` before exit; `userID` vs `stableID`; null ids all hash into one group; CUPED uses 7 pre-exposure days; holdouts typically 1–2% for 3–6 months, same unit only; warehouse assignment sources need timestamp, unit id, experiment id, group id, partitioned by date then experiment id.
- **LaunchDarkly**: call `variation()` "at the exact moment the context encounters the experience", not at initialization or cached ahead; Android: where the experience is rendered, not `onCreate()`; `flush()` after `track()` before navigation.
- **Optimizely**: logs an impression even for a disabled ("off") variation; impressions within fixed 5-second intervals count once.
- **Eppo**: assignment fields `experiment`, `subject`, `variation`, `timestamp` (+ `subjectAttributes`); duplicates fine; subjects in several variants removed; entry points (qualifying events) are subject id + timestamp; sample-size calculator uses the last 10 weeks of data.
- **GrowthBook**: assignment rows `user_id, timestamp, experiment_id, variation_id`; join tables for id types; CUPED defaults to 14 pre-exposure days.
- **Amplitude Experiment**: assignment vs exposure events; exposure requires `flag_key`, optional `variant`, `experiment_key`; no exposure for fallback values when the user has no assignment; server-side local evaluation cannot see rendering; SRM check is a sequential chi-squared test with alpha .01.
- **PostHog experiments**: `$feature_flag_called` with `$feature_flag` and `$feature_flag_response`; custom exposure events carry `$feature/<flag-key>`; one exposure per user per variant; web dedups per identity, mobile per session.

## 4. Payment providers and app stores

- **Stripe** webhooks: verify `Stripe-Signature` against the raw body (libraries default to a 5-minute tolerance; the docs show `Stripe::Webhook.construct_event` in Ruby and `client.parse_event_notification` for thin events in Python); return 2xx quickly; process asynchronously; dedupe by event `id`; some duplicates arrive as two Event objects (match `data.object` id + `event.type` only for once-per-object types); no ordering guarantee — don't use `created` for order; live mode retries up to three days; frameworks with CSRF protection (Django, Rails) must exempt the webhook route. Amounts are in minor units; zero-decimal and three-decimal currencies are listed in Stripe's docs.
- **Apple App Store** and **Google Play**: server-to-server notifications (App Store Server Notifications; Play real-time developer notifications via Pub/Sub) are the source of truth for subscription state. Not read for this file — check current docs.

## 5. Web platform and browsers

- MDN: send on `visibilitychange` when `document.visibilityState === "hidden"`; `unload`, `beforeunload`, `pagehide` are unreliable, especially on mobile; `unload` breaks the back/forward cache. `navigator.sendBeacon` limit 64 KiB; `fetch` with `keepalive` shares a similar budget. `sendBeacon` returning `true` means queued, not delivered.
- WebKit tracking prevention (Safari): script-writable storage capped at 7 days without interaction; 24 hours with link decoration; third-party cookies blocked.
- Google Consent Mode v2: `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`; `gtag('consent','default',…)` before any `config` or `event`; `update` on change; `wait_for_update`.
- Server-side Google Tag Manager on a first-party domain keeps collection under your control.

## 6. Backend frameworks and pipelines

- **Django**: `transaction.on_commit()` runs only after commit, is discarded on rollback, does not roll back on failure; in tests use `captureOnCommitCallbacks()`; `get_or_create` for insert-or-find on a unique key; `csrf_exempt` for webhook views.
- **Transactional outbox**: write the event in the business transaction; a relay publishes it; consumers dedupe.
- **Debezium Outbox Event Router**: columns `id`, `aggregatetype`, `aggregateid` (Kafka key), `type`, `payload`; `id` header for dedup.

## 7. Warehouse and data-quality tools

- **dbt**: generic tests `unique`, `not_null`, `accepted_values`, `relationships`; singular SQL tests pass when they return zero rows; ratio metrics filter numerator and denominator separately; source freshness at "at least double the frequency of your lowest SLA".
- **Great Expectations**: Expectations are verifiable assertions; Checkpoints validate production data and trigger Actions (alerts).

## 8. UI frameworks

- **React**: StrictMode runs effects twice in development; an effect with no dependency array runs after every render. Track actions in event handlers and views in effects keyed on the view's identity.
- The same distinction (render/compose/build body vs event handler vs lifecycle hook) applies in Jetpack Compose, SwiftUI, Flutter, Vue and Svelte; never track from the render body.

## 9. Sources

Segment: https://www.twilio.com/docs/segment/protocols/tracking-plan/best-practices · https://www.twilio.com/docs/segment/connections/spec/ecommerce/v2 · https://www.twilio.com/docs/segment/connections/spec/b2b-saas · https://www.twilio.com/docs/segment/connections/spec/video · https://www.twilio.com/docs/segment/connections/spec/ab-testing · https://www.twilio.com/docs/segment/connections/spec/common · https://www.twilio.com/docs/segment/connections/spec/group · https://www.twilio.com/docs/segment/connections/spec/best-practices-identify · https://www.twilio.com/docs/segment/protocols/tracking-plan/create · https://www.twilio.com/docs/segment/protocols/enforce/schema-configuration · https://www.twilio.com/docs/segment/protocols/apis-and-extensions/typewriter · https://www.twilio.com/docs/segment/privacy/user-deletion-and-suppression · https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/mobile/kotlin-android

Amplitude: https://amplitude.com/docs/data/data-planning-playbook · https://amplitude.com/docs/faq/limits · https://amplitude.com/docs/apis/analytics/http-v2 · https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2 · https://amplitude.com/docs/sdks/analytics/android/android-kotlin-sdk · https://amplitude.com/docs/data/sources/instrument-track-sessions · https://amplitude.com/docs/data/sources/instrument-track-unique-users · https://amplitude.com/docs/data/privacy-and-consent-implementation · https://amplitude.com/docs/get-started/create-project · https://amplitude.com/docs/sdks/ampli · https://amplitude.com/docs/analytics/account-level-reporting · https://amplitude.com/docs/feature-experiment/under-the-hood/event-tracking · https://amplitude.com/docs/feature-experiment/troubleshooting/sample-ratio-mismatch · https://amplitude.com/docs/data/data-assistant-user-solutions/experiment-exposure-engineering

Mixpanel: https://docs.mixpanel.com/reference/import-events · https://docs.mixpanel.com/docs/data-structure/property-reference/data-type · https://docs.mixpanel.com/docs/tracking-methods/id-management/identifying-users-simplified · https://docs.mixpanel.com/docs/data-structure/group-analytics · https://docs.mixpanel.com/docs/tracking-methods/sdks/javascript · https://docs.mixpanel.com/docs/tracking-methods/choosing-the-right-method · https://docs.mixpanel.com/docs/tracking-best-practices/server-side-best-practices · https://docs.mixpanel.com/docs/tracking-best-practices/bot-traffic · https://docs.mixpanel.com/docs/data-governance/lexicon · https://docs.mixpanel.com/docs/orgs-and-projects/managing-projects

PostHog: https://posthog.com/docs/product-analytics/best-practices · https://posthog.com/docs/product-analytics/autocapture · https://posthog.com/docs/product-analytics/identify · https://posthog.com/docs/product-analytics/group-analytics · https://posthog.com/docs/advanced/proxy · https://posthog.com/docs/experiments/exposures

GA4 and Firebase: https://support.google.com/analytics/answer/13316687 · https://support.google.com/analytics/answer/9267744 · https://support.google.com/analytics/answer/9267735 · https://developers.google.com/analytics/devguides/collection/ga4/reference/events · https://developers.google.com/analytics/devguides/collection/protocol/ga4 · https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference · https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events · https://firebase.google.com/docs/analytics/debugview · https://firebase.google.com/docs/analytics/userid

Snowplow, RudderStack, Avo: https://docs.snowplow.io/docs/fundamentals/schemas/versioning/ · https://docs.snowplow.io/docs/fundamentals/schemas/ · https://docs.snowplow.io/docs/fundamentals/canonical-event/ · https://docs.snowplow.io/docs/data-product-studio/data-products/ · https://docs.snowplow.io/docs/data-product-studio/data-quality/snowplow-micro/ · https://www.rudderstack.com/docs/data-governance/tracking-plans/ · https://www.avo.app/docs/implementation/avo-codegen-overview · https://www.avo.app/docs/inspector/issue-types-in-inspector · https://www.avo.app/docs/workflow/validate

Meta: https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events · https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters

Flags and experiments: https://docs.statsig.com/server-core/node-core · https://docs.statsig.com/sdks/user · https://docs.statsig.com/experiments/statistical-methods/variance-reduction · https://docs.statsig.com/experiments/holdouts-introduction · https://docs.statsig.com/statsig-warehouse-native/configuration/assignment-sources · https://docs.statsig.com/statsig-warehouse-native/guides/best-practices · https://launchdarkly.com/docs/sdk/features/experimentation · https://docs.optimizely.com/feature-experimentation/docs/what-are-impressions-and-decisions-in-feature-experimentation · https://docs.geteppo.com/sdks/event-logging/assignment-logging/ · https://docs.geteppo.com/experiment-analysis/configuration/filter-assignments-by-entry-point · https://docs.geteppo.com/statistics/sample-size-calculator/usage/ · https://docs.growthbook.io/app/datasources · https://docs.growthbook.io/statistics/cuped

Payments: https://docs.stripe.com/webhooks

Web platform: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon · https://webkit.org/tracking-prevention/ · https://developers.google.com/tag-platform/security/guides/consent · https://developers.google.com/tag-platform/tag-manager/server-side/intro

Backend: https://docs.djangoproject.com/en/stable/topics/db/transactions/ · https://microservices.io/patterns/data/transactional-outbox.html · https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html

Warehouse: https://docs.getdbt.com/docs/build/data-tests · https://docs.getdbt.com/docs/build/ratio · https://docs.getdbt.com/docs/deploy/source-freshness · https://docs.greatexpectations.io/docs/core/introduction/gx_overview
