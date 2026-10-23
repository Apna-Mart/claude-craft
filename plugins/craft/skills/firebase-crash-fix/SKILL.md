---
name: firebase-crash-fix
description: "Fixes Firebase Crashlytics crashes, non-fatals and ANRs on Android (Kotlin/Java), iOS (Swift/ObjC), Flutter (Dart) and React Native. Drives an evidence-first loop: pull the issue, its variants and sample events, de-obfuscate unreadable frames, read the code as shipped in the crashing release, trace back to where the bad state started, reproduce it with a test that fails on the unfixed code, then apply the smallest fix and prove it. Use when the user shares a Crashlytics issue, crash ID, Firebase console link, a stack trace from Crashlytics, an ANR report, an obfuscated or unsymbolicated Crashlytics trace, or says 'fix this crash', 'app is crashing', 'top crash', 'this ANR'. Not for Sentry, Bugsnag or other non-Firebase crash reports, local crashes in development with no Crashlytics report, or feature work."
---

# Firebase Crash Fix

The crash tells you where execution **ended**. The bug is where the bad state **started**.
Every step pushes backward from the crash site toward that origin, and nothing is fixed until
a test that failed on the unfixed code passes on the fixed one.

## Rules for every step

- **No edit before evidence.** No code change until the crash is traced to its origin and a
  test fails for the reason you predicted. Jumping from the stack trace to a fix is the failure
  this skill exists to prevent; a fix you never saw fail first is a guess wearing a diff.
- **Read the code that crashed.** Line numbers belong to the shipped build, not to `main`.
  Read the files at the crashing release (Phase 3) before you trust a line number.
- **Never trace unreadable frames.** Obfuscated or unsymbolicated frames get de-obfuscated
  first (Phase 1). Offer no cause, not even a labelled "likely lead" from the exception
  message: it anchors you and the user on a guess the real frames often overturn.
- **Fix at the origin, not the crash site.** No guard until you know why the value is invalid;
  no `try/catch` that swallows; no feature, refactor or cleanup in a crash fix.
- **Ask before outward actions:** closing or muting an issue, adding a Crashlytics note,
  switching the active Firebase project, filing an upstream bug.
- **Act in parallel.** Every group of calls marked *one message* below has no dependencies;
  send them together. Waiting on them one by one is the main way this loop gets slow.

Load `craft:testing-best-practices` before the reproduction test and
`craft:coding-best-practices` before the fix. Whenever the top frames are library code, read
[references/third-party.md](references/third-party.md) before concluding — even when the cause
already looks like ours, because it holds the version-pin and known-issue checks.
**Read reference files whole** — never `head`, a line range or a single section, because their
parts build on each other and a partial read drops rules.

## Pick the entry point

| You have | Start |
|---|---|
| Crashlytics link or issue ID, Firebase tools connected | Phase 1, all of it |
| A pasted stack trace, tools connected | Phase 3 now; alongside it resolve the app ID (Phase 1, *Coordinates*), then find the issue with a `topIssues` report, match its title, and fill in Phase 1–2 |
| A pasted stack trace, no Firebase tools | Phase 3 now. Ask once, in one message, for what the trace lacks: affected versions, OS spread, and a link if they have one |
| Obfuscated or unsymbolicated frames | De-obfuscate first (Phase 1, *Unreadable frames*), then continue |
| "The app crashes", nothing else | With tools: resolve the app ID (Phase 1, *Coordinates*), then `topIssues` filtered to `FATAL` (add `ANR` on Android if they mention freezing), show the top 5 by impacted users, ask which one. Without: ask for the link or the trace |

If the Firebase tools are not available, say exactly what is missing (the Firebase MCP server,
or `firebase login`) and what you need instead. Do not stall and do not guess a cause.

**When you must stop and ask** (no source, no crash data, no symbols), the reply still carries
the work so far: the crash site and the hypothesis with what would falsify it (Phase 3), and the
exact checks you will run once unblocked — read the code at the crashing release's ref (its tag
or version-bump commit), read what changed going into that release, check whether `main`
already changed it since, then the failing test. The user can then send exactly what those
checks need. When the blocker is missing symbols, skip the hypothesis — no cause until the
frames are real — and ask for the symbols of that exact version and build number.

---

## Phase 1 — Gather

Tool names below are the ones the Firebase MCP server exposes in Claude Code (`mcp__firebase__…`).
If your server is registered under another prefix, keep the tool name and swap the prefix.

**Coordinates.** From a console URL take the project ID and the issue ID:
`.../project/{projectId}/crashlytics/app/{platform}:{package}/issues/{issueId}`. The app segment
(`android:com.example.app`) is the **package name, not the app ID**. In one message, call
`mcp__firebase__firebase_get_environment` (active project and detected app IDs,
`1:PROJECT_NUMBER:platform:HEX` — match by package or bundle ID) and
`mcp__firebase__firebase_read_resources(uris: ["firebase://guides/crashlytics/reports"])`, which
the report tool requires before its first call. `firebase_get_environment` and
`firebase_list_apps` only see the active project; the app's own config is the fallback that
does not depend on it: `mobilesdk_app_id` and `project_id` in
`google-services.json`, `GOOGLE_APP_ID` and `PROJECT_ID` in `GoogleService-Info.plist` (pick the
file of the flavour or scheme that matches the package). If the active project is not the one
in the URL, ask before switching it with `mcp__firebase__firebase_update_environment`. Still no
match: `mcp__firebase__firebase_list_apps`. If the source repository is unclear, ask — do not
assume the working directory is the app.

**Batch 1 — one message:**

```
mcp__firebase__crashlytics_get_issue(appId, issueId)
mcp__firebase__crashlytics_list_notes(appId, issueId)
mcp__firebase__crashlytics_get_report(appId, report: "topVariants",         filter: { issueId })
mcp__firebase__crashlytics_get_report(appId, report: "topVersions",         filter: { issueId })
mcp__firebase__crashlytics_get_report(appId, report: "topOperatingSystems", filter: { issueId })
mcp__firebase__crashlytics_get_report(appId, report: "topAndroidDevices",   filter: { issueId })   // or "topAppleDevices" on iOS
```

**Batch 2 — the full events.** Collect the `sampleEvent` names from the issue and from each
variant row, and fetch them all in **one** call:
`mcp__firebase__crashlytics_batch_get_events(appId, names: [<issue sample>, <variant A sample>, ...])`.
That gives one complete event per variant — every thread, breadcrumbs, custom keys, logs,
device, memory, build stamp. If it fails with "Too many events in batchGet request", fall back
to `mcp__firebase__crashlytics_list_events(appId, filter: { issueVariantId }, pageSize: 3)` per
variant, all in one message.

**Only when a question needs it** — is the latest version still crashing, is one OS or device
special — list events for that slice, e.g.
`list_events(appId, filter: { issueId, versionDisplayNames: ["3.12.4 (507)"] }, pageSize: 3)`.

### API rules that otherwise cost a round trip

- `list_events` `pageSize` **defaults to 1**. Pass 3–5.
- `issueId` and `issueVariantId` are mutually exclusive in a `list_events` filter.
- `topVariants` requires `issueId` in the filter.
- Display names must be copied exactly from an earlier response: version `"3.12.4 (507)"`,
  OS `"Android (10)"`, device `"INFINIX MOBILITY LIMITED (Infinix X680D)"`.
- The window defaults to the last 7 days. A custom window needs **both** `intervalStartTime` and
  `intervalEndTime` (ISO 8601), computed from today's date, within the last 90 days.
- `issueErrorTypes` takes `FATAL`, `NON_FATAL` or `ANR` (ANR is Android only).

### Unreadable frames

Frames like `o.a.b(SourceFile:3)`, raw hex addresses, `<redacted>`, or minified JavaScript mean
the build's symbols never reached Crashlytics. Read [references/symbolication.md](references/symbolication.md)
and recover the names with the symbols of **that exact build** (version and build number)
before tracing anything. No symbols, no cause: ask for them rather than guess.

**Record before moving on:** error type (fatal, non-fatal, ANR), exception and message, first
frame in your own code, first-seen and last-seen versions, the version, OS and device pattern,
the last breadcrumbs, custom keys and logs, and any team notes. Breadcrumbs are the user's
actual path into the bug; skipping them is why investigations stall.

---

## Phase 2 — Map the variants

One issue groups **variants**: distinct stack paths that landed on one signature. They need not
share a cause, and a fix for one can leave another live. Write the map:

```
Variant A: CartDao.load:58      — 3.12–3.14, 412 users — cause X
Variant B: CartSync.merge:120   — 3.10 only,   38 users — different: pre-migration data shape
Scope of this fix: A (highest impact). B tracked separately.
```

**Find the release ref** for each version in scope: `git tag --list '*<version>*'`, else the
commit that set that build number — the oldest line of
`git log --reverse --oneline -S'<build number>' -- <build file>`, confirmed by
`git show <commit>:<build file>` holding that exact number (a short number can match unrelated
text). If CI injects the build number, use the commit that CI build ran on. Phase 3 reads the
code at this ref.

Then ask **is it already fixed?** Compare the last-seen version with the latest release, and run
`git log <release-ref>..HEAD -- <files on the stack>`. If a later commit already removed the
cause, report that with the commit and stop — the work left is shipping it, not fixing it.

---

## Phase 3 — Trace backward

**Read the shipped code** at the release ref (`git show <ref>:<path>`). Came straight here
from a pasted trace? Find the ref first, as in Phase 2, *Find the release ref*.
If the crash starts at a version, read what changed going in:
`git log --oneline <previous-release-ref>..<release-ref> -- <paths>`. That diff is often the whole answer.
No tags and no way to find the commit? Say so, and confirm the line still matches the
exception before relying on it.

**Split the stack once.** Frames from `android.*`, `androidx.*`, `java.*`, `kotlinx.*`, `UIKit`,
`SwiftUI`, `Foundation`, `dart:*`, `package:flutter/` and the React Native runtime are the path
that led there. Start at the **first frame in your own code** and read every one of your frames
— the whole crashing file, its callers, the data layer that produced the value, and the state
holder if UI state is involved. The top frame is where the problem was *detected*, rarely
where it was *created*.

For each of your frames ask: what does this line assume, and what could make that false? Then
follow the value back until you reach the **origin of the bad state** — usually a parser, a
cache, a lifecycle event or an async callback, not the screen that crashed:

```
crash at submit():88   → what does this line assume?
  ↑ onConfirm():54     → what did it pass in?
    ↑ ViewModel state  → where did that state come from?
      ↑ API parser     → was the field ever there?
```

**Five Whys, written out.** If the first "why" hands you a null check, you have not finished:

```
Crash: NullPointerException on order.cart.total
Why 1: cart is null
Why 2: the Order was built without a cart
Why 3: the API response had no "cart" field
Why 4: the API omits cart while order status is "pending"
Why 5: our model declares cart non-optional — the contract was never modelled
Root cause: invalid assumption at the API model boundary.
```

**State the hypothesis before you open an editor** — what you believe, what the code must show
if it is true, and what would falsify it:

```
HYPOTHESIS: cart is null because pending orders arrive without the field and Order treats it as required.
EXPECT TO SEE: cart declared non-nullable; parser with no branch for a missing key.
FALSIFIED BY: nulls on confirmed orders too (→ wrong API call), or the field present but unparsed (→ parser bug).
```

Then say plainly whether the code confirmed or falsified it. If two causes stay equally
plausible, name both and the evidence that separates them (a custom key, an event on another
version, a breadcrumb) and fetch it — never pick one silently. If the evidence cannot reach a
root cause, say why and what data would, instead of guessing.

**By error type:**

- **Non-fatal** — something called `recordException` / `recordError`. Find that call first;
  the question may be whether the error is handled correctly, not why it crashed.
- **ANR (Android)** — read the main thread in the event, and every thread holding a lock it
  waits on. The blocking call is the cause; the frame on top may be innocent. A Perfetto trace,
  if the user has one, gives detail the dump lacks.
- **iOS watchdog kill** (`0x8badf00d`) — the main thread was blocked too long; treat as an ANR.
- **Out of memory and native crashes** (`OutOfMemoryError`, `SIGSEGV`, `EXC_BAD_ACCESS`) — the
  crash frame is where memory ran out or was misused, not where it leaked or was freed. Use
  the memory figures, the other threads and the breadcrumbs to find what grew or what was
  released early.

---

## Phase 4 — Reproduce: the test must fail first

```
1. Write the test while the bug is still in the tree
2. Run it → it fails, with the failure message you predicted
3. Apply the fix → it passes
4. Revert the fix, re-run → it fails again; restore the fix
```

**Predict the failure message before running.** If it fails for another reason, the test
exercises something else and you do not yet understand the crash. If it passes on the unfixed
code, it is not testing the bug.

Find the nearest existing test for the class and copy its setup, fakes and naming. Run only that
test while iterating, then the module's tests once at the end:

| Platform | One test |
|---|---|
| Android | `./gradlew :<module>:testDebugUnitTest --tests '<package.ClassTest>'` |
| iOS | `xcodebuild test -scheme <Scheme> -destination '<device>' -only-testing:<Target>/<Class>/<test>` |
| Flutter | `flutter test <path>_test.dart --plain-name '<test name>'` |
| React Native | `npx jest <path> -t '<test name>'` (or the project's runner) |

**When the crashing line cannot run in a harness** (OS bug, OEM ROM, driver, race), move the
assertion one step back onto the decision that led there — never retreat to a happy-path test:

| Cannot test | Assert instead |
|---|---|
| Platform throws inside the OS or SDK | which OS/SDK entry point our code chose |
| Race between two threads | the ordering or guard that makes it impossible |
| Device-specific driver failure | our branch for that device or OS condition |
| Corrupt bytes from a remote | the parser, given those same bytes |

**Cover the axis that selects the bug.** If the crash needs one OS version, flavour, locale or
form factor, test the broken value **and** its neighbours: Robolectric `@Config(sdk = [...])`
on Android, an injected version check on iOS, a seam over the platform lookup in Flutter, a
mocked `Platform.Version` in React Native.

**Report numbers, not adjectives:** "without the fix, 1 failed at API 33,
`expected:<X> but was:<null>`; with the fix, 48 tests, 0 failures." If the project has no test
harness, say so and state how you verified instead — do not build a harness inside a crash fix.

---

## Phase 5 — Fix the cause, not the symptom

A guard is sometimes exactly right — at a **boundary**. Ask first whether this value should ever
be invalid here. If not, the invalid value is a symptom and the bug is upstream.

Boundaries are API responses, user input, SDK callbacks, disk and database reads, shared
preferences and deep links: there, return a typed error or a modelled empty state. Between your
own classes (ViewModel → Repository → DB, state transitions, async handoffs), fail loudly — an
app running on corrupted state does more damage than a crashed one.

| Symptom fix | Root-cause fix |
|---|---|
| null-check and skip | model the field as optional; the caller handles absence |
| catch `Exception`, swallow | catch the specific error, surface it to the caller |
| return an empty default | fail fast, expose the invalid state |
| retry on any error | detect the actual failure and recover for that case |

- Only fix the bug, bump one dependency, or add a minimal guard. If it would not ship as a
  hotfix, it does not belong here.
- Change as few lines as possible, at the correct layer, in patterns the codebase already uses.
- One change at a time — two at once and you cannot tell which one worked.
- Put a guard at the **tightest scope**, never at a higher layer that swallows the error.
- Changing a base class or shared helper? Read every subclass and caller it affects first.
- A new `try/catch` added as crash mitigation gets its reason in the commit body, not a code
  comment: name the trigger and add `Ref: <Crashlytics issue URL>`. A catch nobody can explain
  gets deleted in a later cleanup, and the crash comes back.

**ANRs** — find the block, move it off the main thread:

| Platform | Typical blocker | Fix |
|---|---|---|
| Android | `runBlocking`, disk, DB or Binder calls on main | the project's injected dispatcher → `Dispatchers.IO` |
| iOS | sync network or disk on main, `DispatchQueue.main.sync` deadlock | a background queue, or `async/await` off the main actor |
| Flutter | heavy compute on the UI isolate | `compute()` or a dedicated `Isolate` |
| React Native | JS thread blocked by sync work | a native module, or defer the work off the startup path |

---

## Phase 6 — Verify and report

Check all five; any that fails goes under *Scope → Still open*:

1. Walk the Five Whys again — is the bottom "why" now impossible?
2. Handling the state or hiding it? Handling means the caller gets a typed error or a correct
   empty state, and the UI reflects reality.
3. Does the crashing line still run with the same precondition? Then the fix is incomplete.
4. Does the happy path still work? Re-read the normal flow through the changed code.
5. Did the test fail before the fix? If not, it is documentation, not proof.

Then check the variant map: every variant you claimed is covered, version-specific variants
are fixed on the right branch, and anything still open is stated, not omitted.

Every reply that proposes a fix uses this report — also when you could not run the test (no
repository, no harness). Then *Proof* gives the exact command, the failure you predict without
the fix, and says plainly that it has not run yet.

```
## Root Cause
<the origin, not the crash site — 1–2 sentences; say if a library is at fault>
Crash site: <first own frame, file:line> → Origin: <where the bad state started, file:line>

## Hypothesis
<what you predicted, what would have falsified it, and whether the code confirmed it>

## What Was Happening
<user did X → state Y → assumption Z broke → crash — the Five Whys in plain language>

## Fix
<what changed and why it closes the root cause>

## Why This Approach
<why this over the alternative — e.g. model the field vs guard the call site>

## Proof
<pre-fix failure quoted; post-fix test counts>

## Scope
Resolved:   Variant(s) A, B — v3.12–v3.14
Still open: Variant C — different root cause, tracked separately
Branch:     <target branch; note if a live version needs a hotfix>
```

Then offer, and do only once the user confirms: a note on the issue with the root cause and the
fix commit (`mcp__firebase__crashlytics_create_note`); and, after the fix ships and production
confirms it, `mcp__firebase__crashlytics_update_issue(appId, issueId, state: "CLOSED")`. Never
close speculatively: close once a release that contains the fix is live and shows no new events
of this issue. Crashlytics reopens a closed issue as *regressed* only when it recurs in an app
version it had not seen at closing time, so an early close followed by a release that lacks the
fix reads as a fix that broke again, and the history misleads the next person. A confirmed
won't-fix gets `state: "MUTED"` instead, which never reopens.

---

## Bundled files

- [references/symbolication.md](references/symbolication.md) — read whole when frames are
  obfuscated or unsymbolicated: where each platform's symbols live, the command that applies
  them, and what to do when they are gone.
- [references/third-party.md](references/third-party.md) — read whole when the crash happens
  inside a library: pin the exact version, read its source at that version, check known
  issues, pick a strategy, and turn it into a change at our call site.
