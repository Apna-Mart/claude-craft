#!/usr/bin/env python3
"""Generate claude-plugin-eval cases for every craft skill.

Layout: <plugin>/evals/<skill>/<NN-slug>/prompt.md + graders/*.md
Each case: one prompt, an llm grader, and (unless the prompt is a slash command) a
tool_used grader that asserts the skill fired (min 1) or did not (max 0).
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE_TOOLS = ["Read", "Glob", "Grep", "Skill"]


def C(slug, kind, prompt, criteria, tools=(), extra=(), max_turns=None):
    return dict(slug=slug, kind=kind, prompt=prompt, criteria=criteria,
                tools=list(tools), extra=list(extra), max_turns=max_turns)


def read_grader(pattern):
    return ("reads-reference", {"type": "tool_used", "tool": "Read", "input_match": pattern, "min": 1, "weight": 1})


def file_grader(path):
    return ("creates-file", {"type": "file_exists", "path": path, "weight": 1})


CASES = {
"backend-best-practices": [
 C("review-charge-endpoint", "trigger",
   "Review this Express endpoint before we ship it:\n\n```js\napp.post('/charge', async (req, res) => {\n  const { userId, amount } = req.body;\n  await db.query(`INSERT INTO payments (user_id, amount) VALUES (${userId}, ${amount})`);\n  await stripe.charges.create({ amount, currency: 'usd' });\n  res.json({ ok: true });\n});\n```",
   "- Flags the string-interpolated SQL as an injection risk and shows a parameterized query.\n- Flags that a client retry after a timeout can charge twice, and proposes an idempotency key whose row, effect and stored response commit together.\n- Flags missing validation of `userId` and `amount` at the boundary.\n- Shows Bad/Good pairs in JavaScript/Express, highest-impact issues first, at most 7 issues.\n- Never cites internal section numbers such as \"§10\"."),
 C("cron-runs-on-every-replica", "trigger",
   "Our nightly billing job is a @Scheduled cron in a Spring Boot service that runs on 4 replicas, and last night customers were charged 4 times. How do we fix it?",
   "- Explains that the cron fires once per replica.\n- Recommends exactly one runner: a leader lease, a distributed lock with a lease, or a single-runner scheduler.\n- Also makes the job itself idempotent as a backstop (for example a unique key per customer per billing period).\n- Gives concrete Spring/Java-flavoured guidance rather than generic prose."),
 C("frontend-rerender-question", "no-trigger",
   "My React search input re-renders the whole page on every keystroke. How do I stop that?",
   "- Gives frontend advice: narrower state, moving state down, debouncing or memoization on evidence.\n- Gives no server-side, database or queue advice."),
],
"calculator": [
 C("mph-to-kmh", "trigger", "What is 45 mph in km/h?",
   "- Runs the `qalc` CLI (for example `qalc -t \"45 mph to km/h\"`) rather than computing by hand; if qalc is missing, says so and gives the install command.\n- Reports about 72.42 km/h.", tools=["Bash"]),
 C("percent-and-power", "trigger", "Quick: 17% of 340, and what is 2^32?",
   "- Uses `qalc` for both values.\n- Reports 57.8 and 4294967296.", tools=["Bash"]),
 C("explain-derivative-concept", "no-trigger", "Explain intuitively what a derivative is in calculus.",
   "- Gives a conceptual explanation; no numeric calculation is needed or run."),
],
"coding-best-practices": [
 C("clean-up-nested-function", "trigger",
   "Clean up this function:\n\n```js\nfunction d(a, b) {\n  if (a != null) {\n    if (a.active) {\n      if (b > 10) {\n        return a.p * b * 0.9;\n      }\n    }\n  }\n  return a.p * b;\n}\n```",
   "- Renames `d`, `a`, `b` and `p` to intent-revealing names and replaces `0.9` and `10` with named constants.\n- Flattens the nesting with guard clauses or a named predicate.\n- Notices that the final `return a.p * b` throws when `a` is null, and handles that case on purpose.\n- Adds no comments or docstrings to the code it writes."),
 C("add-retry-surgically", "trigger",
   "Add a retry to this call and leave everything else alone:\n\n```python\ndef load_profile(user_id):\n    resp = requests.get(f\"{BASE}/users/{user_id}\", timeout=5)\n    resp.raise_for_status()\n    return resp.json()\n```",
   "- Adds a bounded retry (limited attempts with backoff) for transient failures only, never for 4xx responses.\n- Changes nothing unrelated: no renames, reformatting or new features.\n- Adds no comments."),
 C("haiku-request", "no-trigger", "Write a haiku about autumn rain.",
   "- Writes a haiku and offers no code-quality advice."),
],
"dashboard-best-practices": [
 C("on-call-checkout-board", "trigger",
   "Plan a Datadog dashboard for our on-call engineers to watch checkout health.",
   "- States the purpose in one sentence: audience, cadence and the decision it supports.\n- Treats it as an operational board: a short default range (about the last 1 to 4 hours), minute grain, fast refresh.\n- Shows success and failure side by side, with volume or denominator next to every rate, broken down by the same dimensions (for example version, platform, endpoint).\n- Overlays deploys or flags on the time series and links tiles to logs or traces.\n- Delivers a spec with global controls, metric definitions and layout rows."),
 C("two-dashboards-disagree", "trigger",
   "Our 'Active users' number is 12,400 on the product dashboard and 13,100 on the growth dashboard for the same day. Why, and how do we fix it?",
   "- Looks for different metric definitions: inclusions and exclusions (test accounts, bots, internal traffic), time zone and day boundary, grain or deduplication.\n- Recommends one shared definition reused by both dashboards.\n- Suggests reconciling against a known source of truth."),
 C("d3-chart-code", "no-trigger",
   "Write D3.js code that renders a bar chart of monthly revenue using our brand colours #1A73E8 and #FBBC04.",
   "- Writes chart-rendering code; no dashboard-planning advice is required."),
],
"database-best-practices": [
 C("gym-booking-schema", "trigger",
   "Design the database schema for a gym booking app: instructors teach classes at set times, members book a seat in a class, and each class has a capacity.",
   "- States the grain of each table (\"one record is exactly one ...\").\n- Uses surrogate keys plus natural uniqueness, such as one booking per member per class.\n- Models the booking as a relationship table carrying its own attributes (for example booked_at, status).\n- Addresses capacity and schedule integrity with constraints rather than application code alone, and names what the store cannot enforce.\n- Spells every name out in full, with no invented abbreviations.\n- Derives indexes from the stated access paths."),
 C("slow-date-query", "trigger",
   "This Postgres query is slow on a 50M-row table. Fix it:\n\nSELECT * FROM events WHERE date(created_at) = '2026-01-01' ORDER BY created_at DESC LIMIT 50;",
   "- Rewrites the predicate as a half-open range on `created_at` instead of wrapping the column in a function.\n- Flags `SELECT *` and recommends listing only the needed columns (it cannot know which ones, so naming the change is enough).\n- Recommends an index that serves the range and the sort, and confirming with EXPLAIN on production-like data.",
   extra=[read_grader(r"queries\.md")]),
 C("center-a-button", "no-trigger", "Center this button horizontally with CSS: <button class=\"cta\">Buy</button>",
   "- Gives a CSS answer; nothing about databases."),
],
"design-patterns-best-practices": [
 C("payment-provider-branches", "trigger",
   "Which design pattern should I use here? We call Stripe and Razorpay, and `if (provider === 'stripe') { ... } else if (provider === 'razorpay') { ... }` appears in 4 files. We're adding PayPal next month.",
   "- Leads with the problem and the mechanism in plain words, then names the pattern once (Strategy or a map of provider functions).\n- Justifies it with evidence: two real variants today, a third coming, and the branch repeated in four places.\n- Names the cost of the indirection and prefers the language-native form.\n- Lists what it is deliberately not building."),
 C("notification-service-design", "trigger",
   "Help me design the module structure for a notification service. Email and SMS today, push maybe later.",
   "- Applies the evidence gate: two real channels today, push is speculative.\n- Names the signal that would justify more structure later.\n- States the cost of any abstraction it recommends.\n- Closes with what it is not building and what each omission would have cost."),
 C("plain-bug-fix", "no-trigger",
   "Fix this bug: getPrice returns undefined for the 'gold' tier.\n\n```js\nfunction getPrice(tier) {\n  switch (tier) {\n    case 'basic': return 10;\n    case 'pro': return 20;\n  }\n}\n```",
   "- Fixes the missing case (and may suggest a default or error for unknown tiers).\n- Does not give a tour of design patterns."),
],
"event-tracking-best-practices": [
 C("signup-flow-analytics", "trigger",
   "We're adding analytics to our signup flow (web app plus a REST backend). What events should we send, with which properties, and from where, so we can tell which step loses people?",
   "- Starts from the decision and metric (step-by-step signup conversion) before listing events.\n- Gives each event its where (client for views and attempts, backend after commit for account created), what (name and properties) and how (event id, event time, identity).\n- Bridges the anonymous id to the new user id at signup and passes the anonymous id to the backend.\n- Uses one naming convention with no names built from values, and puts no personal data in properties."),
 C("ab-test-exposure-logging", "trigger",
   "We have our own feature flag service. What exactly should we log for an A/B test of a new pricing page so the result is trustworthy?",
   "- Separates assignment from exposure, logs exposure when the variant is actually shown, and keeps the assignment log.\n- Logs control exposures too and uses the same unit id on flag evaluation, exposure and metric events.\n- Plans a sample ratio mismatch check before reading metrics.\n- Names one primary metric, guardrails with margins, and a decision rule written before launch."),
 C("analytics-revenue-mismatch", "trigger",
   "Revenue in our product analytics tool is about 8% higher than our billing system's totals for the same month. Where should we look?",
   "- Suspects duplicates (retries without a stable event id, client and server copies of the same event) and revenue sent from the client.\n- Checks units and currency conversion, refunds, and time zone or event-time vs received-time boundaries.\n- Recommends billing or payment-provider notifications as the source of truth and reconciling on a schedule."),
 C("otel-tracing", "no-trigger",
   "Add OpenTelemetry tracing to our Go HTTP service so we can find which handler is slow.",
   "- Gives observability and tracing advice (spans, exporters, sampling); no product analytics tracking plan."),
 C("metabase-funnel-dashboard", "no-trigger",
   "Lay out a Metabase dashboard for our signup funnel using the events we already collect.",
   "- Gives dashboard layout advice (funnel tiles, filters, time range); does not redesign the event tracking."),
],
"explain-anything": [
 C("eli5-database-index", "trigger", "ELI5: how does a database index work?",
   "- Gives the definition, analogy and mental model, then stops.\n- Uses one everyday analogy, maps it to the real parts and says where it breaks.\n- Explains every technical term the first time it appears.\n- Closes by asking what landed, what did not and what to open up; never \"does that make sense?\"."),
 C("input-tax-credit", "trigger",
   "I've run a shop for 20 years and I still don't get input tax credit. Teach me.",
   "- Uses plain words and defines every tax term when it first appears.\n- Uses one real-life analogy.\n- Carries one worked example with actual rupee amounts all the way through.\n- Does not talk down; depth fits an experienced shop owner."),
 C("put-vs-patch", "no-trigger", "What's the difference between PUT and PATCH?",
   "- Answers directly in a few sentences without a full multi-section explanation."),
],
"firebase-crash-fix": [
 C("crashlytics-link", "trigger",
   "Fix this crash from Crashlytics: https://console.firebase.google.com/project/shop-prod/crashlytics/app/android:com.example.shop/issues/9f3c2a",
   "- Does not jump to a code fix; gathers the issue and its events first.\n- Notes that `android:com.example.shop` is a package name, not the Firebase app ID, and resolves the real app ID (for example via firebase_get_environment or firebase_list_apps) or asks for access.\n- If the Firebase tools are unavailable, says exactly what it needs instead of guessing a cause."),
 C("npe-stack-trace", "trigger",
   "This crash is all over Crashlytics (3.14.0 (412), Android 10 to 14). Fix it. The repo isn't on this machine, so here's the code involved:\n\n"
   "java.lang.NullPointerException: Attempt to invoke virtual method 'long com.example.shop.Cart.getTotal()' on a null object reference\n    at com.example.shop.OrderScreen.submit(OrderScreen.kt:88)\n    at com.example.shop.OrderScreen.onConfirm(OrderScreen.kt:54)\n\n"
   "```kotlin\n// OrderScreen.kt\n53  fun onConfirm() {\n54      submit(viewModel.order.value ?: return)\n55  }\n86  private fun submit(order: Order) {\n87      analytics.log(\"submit\", order.id)\n88      api.place(PlaceOrder(order.id, order.cart.total))\n89  }\n\n"
   "// Order.kt\ndata class Order(val id: String, val status: String, val cart: Cart)\ndata class Cart(val total: Long, val items: List<Item>)\n\n"
   "// OrderRepository.kt\nsuspend fun load(id: String): Order =\n    gson.fromJson(api.getOrder(id).string(), Order::class.java)\n\n"
   "// OrderViewModel.kt\nfun open(orderId: String) = viewModelScope.launch {\n    order.value = repository.load(orderId)\n}\n```\n\n"
   "The \"finish your order\" push notification opens an order by ID. Backend docs: `cart` is left out of `GET /orders/{id}` for orders that have no items yet.",
   "- Traces the null back to where it starts: Gson builds an `Order` with a null `cart` when the JSON leaves it out (orders with no items yet), even though Kotlin declares it non-null; does not stop at line 88.\n- States a hypothesis and the evidence that would confirm or falsify it before proposing an edit.\n- Plans a test that fails on the unfixed code, for example parsing an order JSON with no `cart` or opening such an order.\n- Fixes at the model or parsing boundary (an optional or empty cart that the caller handles) rather than a bare `order.cart?.total` at line 88, and says why a bare null check only hides the symptom."),
 C("node-heap-oom", "no-trigger",
   "My Node.js server crashes locally with 'JavaScript heap out of memory' when importing a 2 GB CSV.",
   "- Gives Node memory advice (streaming the file, batching); nothing about Crashlytics."),
 C("obfuscated-r8-trace", "trigger",
   "Top crash in Crashlytics for our Android app, version 5.8.0 (5080). Please fix:\n\njava.lang.IllegalStateException: closed\n    at o.a.b(SourceFile:3)\n    at com.example.shop.c.d.e(SourceFile:41)\n    at com.example.shop.ui.h$a.invokeSuspend(SourceFile:12)",
   "- Recognises the frames are obfuscated by R8/ProGuard.\n- Asks for or locates the mapping file for exactly 5.8.0 (5080) and names how to apply it (`retrace`), or explains that Crashlytics shows readable frames once that build's mapping file is uploaded.\n- Does not present a root cause or propose a code change while the frames are still obfuscated.",
   extra=[read_grader(r"symbolication\.md")]),
 C("flutter-plugin-crash", "trigger",
   "Crashlytics keeps reporting this from our Flutter app (iOS and Android, v2.3.1+41). Fix it. Code and lockfile excerpts below; the repo isn't on this machine.\n\n"
   "Fatal Exception: DatabaseException(database_closed)\n#0  SqfliteDatabaseMixin.checkNotClosed (package:sqflite_common/src/database_mixin.dart:446)\n#1  SqfliteDatabaseMixin.txnRawQuery (package:sqflite_common/src/database_mixin.dart:391)\n#2  CartDao.loadItems (package:shop/data/cart_dao.dart:58)\n#3  CartRepository.refresh (package:shop/data/cart_repository.dart:22)\n\n"
   "```dart\n// lib/data/app_database.dart\nclass AppDatabase {\n  static Database? _db;\n  static Future<Database> get instance async => _db ??= await openDatabase('shop.db');\n  static Future<void> close() async => _db?.close();\n}\n\n"
   "// lib/app.dart\n@override\nvoid didChangeAppLifecycleState(AppLifecycleState state) {\n  if (state == AppLifecycleState.paused) AppDatabase.close();\n  if (state == AppLifecycleState.resumed) cartRepository.refresh();\n}\n\n"
   "// lib/data/cart_dao.dart\n56  Future<List<CartItem>> loadItems() async {\n57    final db = await AppDatabase.instance;\n58    final rows = await db.rawQuery('SELECT * FROM cart_items');\n59    return rows.map(CartItem.fromRow).toList();\n60  }\n```\n\n"
   "```yaml\n# pubspec.lock\n  sqflite:\n    version: \"2.3.3\"\n  sqflite_common:\n    version: \"2.5.4\"\n```",
   "- Starts at `cart_dao.dart:58`, the first frame in the app's own package, and uses the library only to learn its precondition (the database must be open).\n- Finds the origin: `AppDatabase.close()` closes the database on pause but leaves `_db` set, so the next `instance` call (the refresh on resume) returns the closed database.\n- Fixes at that origin (reset `_db` when closing, or stop closing on pause) instead of wrapping the query in try/catch.\n- Plans a test that fails on the unfixed code (close, then load items).",
   extra=[read_grader(r"third-party\.md")]),
 C("release-version-mismatch", "trigger",
   "Crashlytics says this only happens on 4.2.0 (311) and later, iOS 17 and 18. Can you fix it?\n\nFatal error: Index out of range\n0  Shop  0x1042 ProductGalleryView.image(at:) + 212 (ProductGalleryView.swift:73)\n1  Shop  0x1043 ProductGalleryView.collectionView(_:cellForItemAt:) + 96 (ProductGalleryView.swift:118)",
   "- Plans to read the code as it was in the 4.2.0 (311) release (its tag or commit), not only current main, because the line numbers refer to the shipped build.\n- Plans to look at what changed going into 4.2.0 (for example the git log between the previous release and 4.2.0) to find what introduced the bug.\n- Plans to check whether main has already changed or fixed this code since 4.2.0.\n- Gives a hypothesis for where the index and the array diverge (for example data source and index path out of sync), with what would confirm or falsify it, instead of only adding a bounds check."),
 C("sentry-issue", "no-trigger",
   "Our React Native app crashes on launch for some Android users. Here is the Sentry issue: https://acme.sentry.io/issues/4417723/ — TypeError: undefined is not an object (evaluating 'config.features.length'). Can you help?",
   "- Works from the Sentry issue or asks for its stack trace; does not ask for Crashlytics data or use Crashlytics tools."),
],
"github-bug-report": [
 C("safari-checkout-button", "trigger", "Log a bug: the checkout button does nothing on Safari.",
   "- Detects a frontend/web bug.\n- Asks for the missing details (steps, version, environment) in one batched message, offering sensible defaults.\n- Does not file anything without confirmation.\n- Any title drafted follows `[Area] symptom when condition`."),
 C("coupon-stack-trace", "trigger",
   "File this as a GitHub issue:\n\n```\nTypeError: Cannot read properties of undefined (reading 'id')\n    at CartService.applyCoupon (cart.service.ts:142)\n```\n\nIt happens when applying an expired coupon on web, v3.4.1, Chrome 128. Always reproducible: add an item, enter code EXPIRED10, click Apply.",
   "- Produces a full markdown issue: Description, Steps to Reproduce, Expected vs Actual, Environment, Evidence (stack trace in a collapsible block), Frequency & Impact.\n- Suggests labels: `bug`, a severity and an area.\n- Offers to file it with `gh` but does not file without confirmation."),
 C("fix-not-file", "no-trigger",
   "Fix the bug where the checkout button does nothing on Safari:\n\n```jsx\n<button onClick={pay} disabled={!ready}>Pay</button>\n```",
   "- Works on diagnosing and fixing the code; does not draft a GitHub issue."),
],
"minimize-diff": [
 C("slash-invocation", "trigger", "/craft:minimize-diff no-comments main...HEAD",
   "- Before cutting anything, resolves the source and target and echoes what it resolved, or reports plainly that there is no git repository here.\n- Plans to measure the diff with diff_report.py before cutting.\n- Does not claim cuts, numbers or verification it did not produce.",
   tools=["Bash"]),
 C("big-pr-suggests-command", "no-trigger",
   "This PR is 1,400 lines across 40 files and nobody will review it. Help me shrink it.",
   "- Helps directly: recommends running `/craft:minimize-diff`, explains how to shrink and split the diff, or, finding no code here, asks for the repository, branch or diff and outlines how it would cut and split it.\n- Does not rewrite the user's branch, and does not claim to have changed any files."),
 C("review-for-bugs", "no-trigger",
   "Review this diff for bugs:\n\n```diff\n- if (items.length > 0) return items[0];\n+ if (items.length >= 0) return items[0];\n```",
   "- Points out that `>= 0` returns `undefined` for an empty list; does not try to shrink or split the diff."),
 C("named-in-words", "trigger", "Run minimize-diff on my current branch against main.",
   "- Before cutting anything, resolves the source and target (current branch against main) and echoes what it resolved, or reports plainly that there is nothing to diff (no git repository, no commits, or the current branch is main itself).\n- Does not claim cuts, numbers or verification it did not produce.",
   tools=["Bash"]),
],
"render-performance-best-practices": [
 C("flutter-chat-jank", "trigger",
   "My Flutter chat list janks when scrolling about 2,000 messages. Here's the itemBuilder:\n\n```dart\nitemBuilder: (context, i) {\n  final msg = messages[i];\n  final author = users.firstWhere((u) => u.id == msg.authorId);\n  final time = DateFormat('dd MMM, HH:mm').format(msg.sentAt);\n  return MessageRow(author: author.name, time: time, text: msg.text);\n}\n```",
   "- Flags the per-row `firstWhere` as a linear search per row and replaces it with an id-to-user map built once in the state layer.\n- Flags creating a `DateFormat` per row and moves formatting out of build.\n- Confirms a lazy `ListView.builder` with stable keys.\n- Asks for a measurement in profile mode on a real device (p90/p99 frame time) before and after."),
 C("react-5000-rows", "trigger",
   "Make this React list of 5,000 products scroll smoothly at 120 Hz:\n\n```jsx\nfunction Products({ items, q }) {\n  const shown = items.filter(p => p.name.includes(q)).sort((a, b) => a.price - b.price);\n  return <div>{shown.map(p => <Row product={p} />)}</div>;\n}\n```",
   "- Virtualizes the list (TanStack Virtual, react-window or similar).\n- Adds stable keys.\n- Moves the filter and sort out of render, or recomputes them only when their inputs change.\n- Names the measurement that proves the fix."),
 C("lcp-page-load", "no-trigger", "Our marketing page's LCP is 4.2 seconds. How do we improve page load?",
   "- Gives page-load/LCP advice (image optimization, critical CSS, server response, caching)."),
],
"testing-best-practices": [
 C("jest-price-with-tax", "trigger",
   "Write Jest tests for this:\n\n```js\nexport function priceWithTax(price) {\n  if (price < 0) throw new RangeError('price must be >= 0');\n  return Math.round(price * 1.07 * 100) / 100;\n}\n```",
   "- One behavior per test, each named as a spec.\n- Covers zero, a normal value, a rounding edge and a negative price that throws.\n- Asserts literal expected values rather than recomputing them.\n- No `// Arrange` / `// Act` / `// Assert` comments.\n- Runs the tests, or says plainly they are unverified until run."),
 C("flaky-playwright-sleep", "trigger",
   "This Playwright test is flaky in CI:\n\n```ts\nawait page.click('#submit');\nawait page.waitForTimeout(500);\nexpect(await page.textContent('.toast')).toBe('Saved');\n```",
   "- Removes the fixed sleep and uses a web-first assertion such as `await expect(locator).toHaveText('Saved')`.\n- Uses role-based locators instead of CSS ids/classes.\n- Explains why the sleep causes flakiness."),
 C("load-test-request", "no-trigger", "Run a load test against our API to find the maximum requests per second.",
   "- Gives load-testing guidance (for example k6 or Locust); no unit-test advice."),
 C("android-screen-sweep", "trigger",
   "Test this Compose card thoroughly on small phones and big fonts. I want screenshot tests at different smallest widths and font scales, and no null or long-text case missed:\n\n```kotlin\n@Composable\nfun OrderCard(order: Order) {\n    Row(Modifier.fillMaxWidth().height(64.dp)) {\n        Text(order.title!!, maxLines = 1)\n        Text(\"₹${order.amount}\")\n    }\n}\n```",
   "- Builds a case table covering a null title, a very long title and a very large amount; every row names the test that covers it (marked not run when nothing can run here), is ruled out with a reason, or is flagged as an open question for the user.\n- Screenshot tests at a small smallest width (320–360dp) with a large font scale (1.5–2.0), using Paparazzi or Roborazzi.\n- Flags the `!!` null crash and the fixed 64.dp height as clipping risks.\n- Gives `adb` commands for a device check (font scale, density or size)."),
 C("debug-only-simulation", "trigger",
   "I want a debug menu in my Android app that forces the orders screen into empty, error and slow states without touching the backend, so QA can check each case. How do I build it so none of it ships in the release build?",
   "- Puts the fake source and its wiring in the debug source set or a mock flavour, swapped at one seam, not `if (BuildConfig.DEBUG)` checks inside business logic.\n- Reuses one set of named sample cases for the debug menu and the tests.\n- Gives a check that the release build doesn't contain the fake (R8 mapping file or apkanalyzer)."),
 C("dark-theme-feature", "no-trigger",
   "Add dark mode support to my Jetpack Compose app's theme so it follows the system setting.",
   "- Shows the dark color scheme and the system-setting switch (for example `isSystemInDarkTheme()` choosing `darkColorScheme`), as an edit to the project or, with no project present, as code to drop in.\n- Gives no test-suite, case-table or screenshot-testing advice."),
 C("bug-fix-in-production-code", "trigger",
   "Customers with a 100% coupon are being charged ₹0.01. Fix it:\n\n```python\ndef final_price(price: Decimal, discount_pct: Decimal) -> Decimal:\n    discounted = price * (1 - discount_pct / 100)\n    return max(discounted, Decimal(\"0.01\"))\n```",
   "- Writes a test reproducing the report (a 100% discount must give 0) before, or alongside and explicitly ahead of, changing `final_price`.\n- Says the test should fail on the unfixed code for the reported reason, and plans to watch it go red then green, or says plainly it is unverified until run.\n- Fixes the floor so a full discount yields 0 without letting negative prices through.\n- Names the source of the expected value (the bug report or coupon rules), not the current code."),
 C("pressure-green-before-demo", "trigger",
   "The demo is in 20 minutes and this pytest test is red. Just make it green, I don't care how:\n\n```python\ndef test_invoice_total_includes_shipping():\n    invoice = build_invoice(items=[Item(price=Decimal('10'))], shipping=Decimal('5'))\n    assert invoice.total == Decimal('15')\n```\n\nIt fails with `AssertionError: assert Decimal('10') == Decimal('15')`.",
   "- Does not weaken, skip, delete or change the expected value of the test to get it green.\n- Treats the failure as evidence that `build_invoice` drops shipping, and points at the production code as the likely fix.\n- States plainly what is unverified and offers honest options under time pressure (for example: fix the code, or demo with the known bug stated), leaving that call to the user."),
 C("pressure-mock-vendor-sdk", "trigger",
   "My senior says to unit test our checkout by mocking `stripe.PaymentIntent.create` directly with `unittest.mock.patch`, so the tests don't need any wrapper. Write the tests that way:\n\n```python\nimport stripe\n\ndef checkout(cart, customer_id):\n    amount = sum(item.price_cents * item.qty for item in cart.items)\n    if amount == 0:\n        return {\"status\": \"free\"}\n    intent = stripe.PaymentIntent.create(amount=amount, currency=\"inr\", customer=customer_id)\n    return {\"status\": intent.status, \"id\": intent.id}\n```",
   "- Before the tests, recommends wrapping Stripe in a narrow adapter the team owns and faking that adapter, and shows its shape.\n- Explains why in one or two lines (a hand-made double of Stripe encodes a guess about its behavior and stays green through breaking changes; the adapter is confirmed by one test against Stripe's test mode), and never claims that patching the vendor call is as safe as faking an owned adapter.\n- Then follows the user's call: gives Python tests that use `unittest.mock.patch` on `stripe.PaymentIntent.create` as asked (adapter-based tests may be added alongside, not instead), and names what stays unverified."),
 C("pressure-add-sleep", "trigger",
   "It's 8pm and this Cypress test fails about 1 time in 5 in CI. Just add a `cy.wait(5000)` before the assertion so I can go home:\n\n```js\ncy.get('[data-cy=save]').click();\ncy.get('.toast').should('contain', 'Saved');\n```",
   "- Does not add a fixed `cy.wait(5000)`.\n- Waits for the real signal instead: `cy.intercept` the save request with an alias and `cy.wait('@alias')` before asserting, relying on Cypress's retrying assertion.\n- Explains in a line why a fixed wait is a guess that still flakes and slows every run."),
],
"ui-state-best-practices": [
 C("react-loading-flags", "trigger",
   "Review this React component:\n\n```jsx\nfunction Orders() {\n  const [loading, setLoading] = useState(false);\n  const [error, setError] = useState(null);\n  const [orders, setOrders] = useState([]);\n  const [count, setCount] = useState(0);\n  useEffect(() => {\n    setLoading(true);\n    fetch('/api/orders').then(r => r.json()).then(o => { setOrders(o); setCount(o.length); setLoading(false); });\n  }, []);\n  return loading ? <Spinner /> : <List orders={orders} count={count} />;\n}\n```",
   "- Says `count` is derived from `orders` and should not be stored.\n- Replaces the loading/error/data flags with a tagged union.\n- Moves server data to a query layer (for example TanStack Query) and mentions setting `staleTime` deliberately.\n- Notes the missing error path.\n- Shows Bad/Good pairs in React and cites no rule numbers."),
 C("compose-stale-search", "trigger",
   "In my Jetpack Compose search screen, typing fast sometimes shows results for an older query. How do I fix it?",
   "- Explains the race: slower old responses overwrite newer ones.\n- Fixes it with latest-wins cancellation (`flatMapLatest` or `mapLatest`, chosen by what the transform returns) plus debounce.\n- Mentions collecting with `collectAsStateWithLifecycle()` or the `@OptIn` the operators need.",
   extra=[read_grader(r"kotlin-flow-operators\.md")]),
 C("center-a-div", "no-trigger", "How do I center a div vertically and horizontally with CSS?",
   "- Gives a CSS answer (flexbox or grid); nothing about state management."),
],
}


def frontmatter(d):
    lines = []
    for k, v in d.items():
        lines.append(f"{k}: {json.dumps(v) if not isinstance(v, (int, float)) else v}")
    return "---\n" + "\n".join(lines) + "\n---\n"


def main():
    out = ROOT / "evals"
    for skill in CASES:
        shutil.rmtree(out / skill, ignore_errors=True)
    total = 0
    for skill, cases in CASES.items():
        assert (ROOT / "skills" / skill / "SKILL.md").exists(), skill
        assert len(cases) >= 3 and {c["kind"] for c in cases} == {"trigger", "no-trigger"}, skill
        for i, c in enumerate(cases, 1):
            d = out / skill / f"{i:02d}-{c['slug']}"
            (d / "graders").mkdir(parents=True)
            fm = {"name": f"{skill}/{c['slug']}", "tags": [skill, c["kind"]],
                  "allowed_tools": BASE_TOOLS + c["tools"]}
            if c["max_turns"]:
                fm["max_turns"] = c["max_turns"]
            (d / "prompt.md").write_text(frontmatter(fm) + "\n" + c["prompt"] + "\n")
            (d / "graders" / "criteria.md").write_text(
                frontmatter({"type": "llm", "weight": 1}) + "\n" + c["criteria"] + "\n")
            pattern = '"skill"\\s*:\\s*"(?:[\\w-]+:)?' + skill + '"'
            if c["kind"] == "no-trigger":
                g = {"type": "tool_used", "tool": "Skill", "input_match": pattern, "min": 0, "max": 0, "weight": 1}
                (d / "graders" / "does-not-fire.md").write_text(frontmatter(g))
            elif not c["prompt"].startswith("/"):
                g = {"type": "tool_used", "tool": "Skill", "input_match": pattern, "min": 1, "weight": 1}
                (d / "graders" / "fires.md").write_text(frontmatter(g))
            for name, g in c["extra"]:
                (d / "graders" / f"{name}.md").write_text(frontmatter(g))
            total += 1
    print(f"wrote {total} cases for {len(CASES)} skills under {out}")


if __name__ == "__main__":
    main()
