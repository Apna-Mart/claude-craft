# Edge cases — the checklist behind the case table

**Currency stamp: 2026-10-06.** Parent §20 owns the principle (every variable, every row covered, ruled out, or flagged as an open question that was asked). This file is the checklist you run each variable through, plus the table format and how to combine axes. Values here are starting points: keep the ones the variable can actually reach.

## Contents

1. Build the inventory
2. The case table
3. Absence and emptiness — every variable
4. Text
5. Numbers and money
6. Collections and paging
7. Dates and time
8. Identifiers, links, files and images
9. Type drift and versions — data from outside
10. State, lifecycle and timing
11. Environment
12. Combining axes without exploding
13. Traps

---

## 1. Build the inventory

List every value the code under test reads, one row each:

| Variable | Source | Declared type | Who can make it wrong |
|---|---|---|---|
| `user.name` | server JSON | `String` (non-null after parsing) | server, old cache |
| `cart.items` | local database | `List<Item>` | migration, concurrent edit |
| `now` | device clock | `Instant` | user setting, time zone, travel |

Sources to sweep: server or API response, user input, URL or deep link parameters, device settings (size, font, language, theme, permissions), remote config and feature flags, clock and time zone, storage and cache (including data written by an older app version), OS lifecycle, other services and queues, environment variables and config files.

**Where untyped data enters, test absence and wrong types there, once.** A parser that turns server JSON into a non-null model is the boundary; behind it, the type rules out null, so the screens don't each need a null test (§20 "ruled out").

## 2. The case table

```
| # | Variable | Case | Expected (source) | Must not happen | Level | Proof |
```

- **Expected** is a behavior someone can check, decided on purpose: "shows Guest", "rejects with 400 and field error", "retries 3 times then shows offline banner". "Doesn't crash" is a floor, not an expectation.
- **Source** in brackets after the expected value: spec or ticket, the product's own words (label, docs, error text), previous version, a standard or law, or consistency with the rest of the product — never "what the code does now" for new behavior. No source → the row's status is **open question — asked**, with who was asked; it is neither covered nor ruled out until answered.
- **Must not happen** is the side effect that would make a correct-looking result wrong: a second charge, an error toast, navigation away, a stale value still shown, a write to the wrong account. The test asserts it alongside the expected result.
- **Level** follows parent §2: unit for logic, integration for a real boundary, screenshot for layout, device or browser for lifecycle and permissions.
- **Proof** is the test name with its result, the reviewed screenshot, or the quoted output of a direct check. An empty proof cell is an open item. When a test is written but can't run here, the cell still names it and says so (`ProfileHeaderTest › null name — not run`); the row stays open until the result is filled in, and the report says which rows those are.
- **Ruled out** rows name the guard: the type, the validation, the database constraint, or the contract. If you can't name it, the case is reachable — test it.

## 3. Absence and emptiness — every variable

- `null` / `nil` / `None` / `undefined`
- Key **missing** versus key **present with null** — JSON parsers often treat these differently
- Empty: `""`, `[]`, `{}`, a zero-byte file, an empty response body with status 200
- Blank: `"   "`, `"\n"`, a zero-width space (U+200B)
- Not ready yet: still loading, remote config not fetched, cache cold, first launch with no data
- Not allowed: permission denied or "only this time", feature flag off, signed out, account type without access
- Not reachable: offline, DNS failure, timeout, 500, 503 with `Retry-After`, 401 mid-session, 429

## 4. Text

- **Length:** one character; typical; the maximum allowed; maximum + 1; 10,000 characters; one long word with no spaces (a URL, an email address, a German compound) that can't wrap; many lines
- **Script:** emoji including joined sequences (👨‍👩‍👧) and skin tones; Devanagari and Thai (tall marks above and below that clip in fixed-height boxes); Arabic and Hebrew (right-to-left, mixed with numbers and Latin); Chinese and Japanese (no spaces to wrap on); accented Latin
- **Content:** leading and trailing spaces; HTML or Markdown that must not render; quotes and apostrophes (`O'Brien`); newlines and tabs; control characters; format placeholders (`%s`, `{0}`) inside user text
- **Comparison:** case (Turkish dotted and dotless i break naive upper/lower), Unicode normalization (é as one code point versus e + accent), trimming

## 5. Numbers and money

- **Boundaries:** 0, −1, 1, typical, maximum, minimum, maximum + 1. 32-bit integer max 2,147,483,647; 64-bit max 9,223,372,036,854,775,807; JavaScript's largest exact integer 9,007,199,254,740,991 (IDs above it silently change in a browser)
- **Fractions:** `0.1 + 0.2`; rounding half-up versus half-even; many decimal places; currencies with 0 decimals (JPY) or 3 (KWD); never binary floating point for money
- **Formats:** Indian grouping (1,00,000) versus 100,000; decimal comma (de-DE `1.234,56`); negative amounts; percentages above 100 or below 0; very large counts in a small badge ("99+")
- **Special values:** NaN, Infinity, −0.0; division by zero; a number arriving as a string (`"12"`, `"1e3"`, `"12.0"`)

## 6. Collections and paging

- Empty, one, two (plural wording), many, huge (10,000+: paging, memory, scroll speed)
- Duplicates; unsorted, already sorted, reverse sorted; nulls inside the list; nested empty lists
- Paging boundaries: exactly one page, one item over a page, last page partial, an empty next page, the same item appearing on two pages after an insert
- Changes while shown: an item removed or added while scrolling, a list replaced mid-animation

## 7. Dates and time

- Time zones at the extremes (UTC−12, UTC+14) and half or quarter hours (UTC+5:30, UTC+5:45)
- Daylight-saving start (a skipped hour) and end (a repeated hour)
- Midnight, end of month, 29 February, 31 December → 1 January, week start differing by locale
- 12-hour versus 24-hour display; local calendar settings
- Device clock wrong or changed by the user; server and device clocks disagreeing
- Far past and far future (1970, 2038 for 32-bit timestamps, 9999-12-31 as a "never expires" value); expired tokens and sessions; zero and negative durations

## 8. Identifiers, links, files and images

- IDs: unknown, deleted, belonging to another user (an authorization case, not just "not found"), very long, special characters
- Links and deep links: missing parameters, extra parameters, encoded characters, a link to a screen the user can't access
- Files: missing, empty, huge, wrong extension for the content, unreadable, disk full while writing, paths with spaces and non-ASCII characters
- Images: missing URL, 404, slow, huge (8,000 px), tiny, extreme aspect ratios, transparent, animated

## 9. Type drift and versions — data from outside

- A field with the wrong type (`"true"` or `1` for a boolean, an object where a list was expected)
- An enum or status value the app has never seen (the server shipped first) — map it to a safe "unknown", never crash
- Extra unknown fields (must be ignored), a missing new field from an older server
- Data stored by an older app or schema version, read by the new code (migration)

## 10. State, lifecycle and timing

- Every screen state: loading, partial, success, empty, error, retry after error, refreshing over stale data (`ui-state-best-practices` owns the state shape)
- User actions: double tap or double submit, back during loading, rapid typing, cancel halfway, signed out mid-flow, session expiring during a form
- App lifecycle: background and foreground, rotation or window resize, process killed and restored, first launch versus upgrade, low memory, low storage
- Timing: two updates at once, a response arriving after the screen is gone, responses arriving out of order, a retry duplicating a write (`backend-best-practices` owns idempotency)

## 11. Environment

UI: window or screen size, font scale, display size, language and its text length, right-to-left, dark mode, high contrast, reduced motion, screen reader, hardware keyboard, foldable posture, notches and insets — the platform files say how to set each one. Backend: dependency latency and failure, a full disk, a read-only replica, clock skew between hosts — see `backend.md`.

## 12. Combining axes without exploding

1. **Each axis alone at its extremes first.** Most bugs need only one bad value.
2. **Then the worst corners together:** smallest width + largest font + longest language; right-to-left + long mixed text; large window + landscape; dark mode + error state; slow network + double submit.
3. **Pairwise when more is needed:** a pairwise set covers every pair of values at least once with far fewer combinations than the full product. Microsoft's PICT generates one from a model file.
4. **Generated inputs for value ranges:** a property-based test (parent §4) explores ranges you'd never list; pin each shrunk counterexample as a fixed row.

State the number of combinations you chose and why; "5 × 5 × 2 × 2 = 100, cut to 8 corners" is a decision a reviewer can check.

## 13. Traps

- **Testing impossible states.** If the type or a validation already excludes a case, a test for it is noise; mark it ruled out and test the guard instead.
- **Only "doesn't crash".** An unhandled null that shows a blank label passes a crash test and still ships a bug; assert the expected output.
- **Edge values only in the unit layer.** A parser that handles a 200-character name is still wrong if the layout clips it — the screenshot row is a separate case.
- **Real customer data in fixtures.** Use generated or anonymized values with the same shape.
