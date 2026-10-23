# Integration and end-to-end tests (§11–§14)

**Currency stamp: 2026-10-06.** The full rules, Bad/Good pairs and details for parent Part 3, moved out of SKILL.md and then extended. Section numbers are the parent's, so `§N` citations elsewhere still point here.

## Contents

- 11. Integration tests hit real boundaries
- 12. End-to-end tests cover a few critical journeys — from the user's view
- 13. E2E determinism: wait for a signal, never sleep
- 14. Own your test data: seed it, isolate it, reset it

---

### 11. Integration tests hit real boundaries
Integration tests exist to catch the bugs unit tests can't: the actual SQL, the schema constraint, the serialization, the transaction, the wiring between components. A "integration" test that mocks the database is a unit test in disguise — it asserts your mocks, not your behavior. Run the risky integrations against something real.

**Bad:** test the repository by mocking the DB driver and asserting the query string — passes even when the SQL is malformed, the constraint is wrong, or the migration never applied.
**Good:** run against a real ephemeral database (testcontainers / an in-process instance / a disposable schema), insert and query for real, and assert the *observed rows* — catches the schema/SQL/transaction bugs mocks can't (`backend-best-practices` §22).
- **Use real infra for components you own** (your DB, your cache); substitute third parties you don't — through your own adapter over their SDK, never a double of their types (§3).
- **Contract-test service boundaries** — for consumer/provider pairs, a consumer-driven contract (e.g. Pact) verifies both sides against an agreed schema so a breaking change is caught in CI, not by a pager. Same idea keeps a fake (§3) honest against the real implementation.
- **Test the boundary's failure modes** — the timeout, the duplicate delivery, the rollback, the concurrent update (`backend-best-practices` §22).

### 12. End-to-end tests cover a few critical journeys — from the user's view
E2E tests are the slowest, flakiest, most expensive tests you own, so spend them only on the handful of journeys where a break is catastrophic (sign up → pay → receive), verified the way a user experiences them. They answer "is the whole system wired together?", not "is this function correct?" — that's what the layers below are for.

**Bad:** 200 e2e tests covering every field-validation permutation through the real UI — a slow, flaky suite that takes an hour and gets ignored; each failure could be any of a dozen layers.
**Good:** a small set of e2e tests for the money-making journeys, with field-validation edges pushed down to fast component/unit tests. E2E confirms integration; lower layers confirm logic.
- **Test user-visible outcomes, not internals** — "the confirmation page shows the order number", not "the `orders` table got a row" (that's an integration test's job).
- **Keep the count small and the value high.** Every e2e test is a standing maintenance and flakiness cost; add one only when a real end-to-end break would be expensive to miss.

### 13. E2E determinism: wait for a signal, never sleep
The number-one cause of flaky UI tests is timing — the test acts before the app is ready. **Never** use a fixed sleep (`waitForTimeout(500)`): it's either too short (flaky) or too long (slow), and it encodes a guess about machine speed that breaks on a loaded CI runner. Wait for the specific condition you actually need, and assert on the *outcome*, not just that an element appeared.

**Bad:** `await click("#submit"); await sleep(500); expect(await text(".toast")).toBe("Saved")` — races the async save; passes on a fast laptop, fails on a slow CI box.
**Good (Playwright):** `await page.getByRole("button", {name:"Submit"}).click(); await expect(page.getByRole("status")).toHaveText("Saved")` — a web-first assertion that *retries* until the real outcome appears, deterministic without a magic number.
- **The waiting model differs per tool — don't port this snippet blindly.** In **Playwright** locators auto-wait and `expect` polls. In **Testing Library** `getBy*` is **synchronous and does not retry**, so after an async action you need `await screen.findByRole(...)` (or `waitFor`); `queryBy*` exists only for asserting *absence*. In **Cypress** only queries retry and the whole chain re-runs together — action commands execute once, `.then()` is an explicit retry boundary, and the sanctioned replacement for `cy.wait(500)` is `cy.intercept()` + alias + `cy.wait('@alias')`. Copying Playwright's `getByRole(...).click()` into a React Testing Library test is the single most common cross-tool mistake.
- **Auto-waiting isn't enough on its own** — a runner waits for an element to be actionable, but it doesn't know your business logic finished. After a click that triggers an async update, assert the *data* changed (the row's new text), not just that a container is visible.
- **Subscribe before you act** when waiting on a request: set up the wait (`const resp = page.waitForResponse(url)`), *then* trigger it, *then* await — registering after the action misses it and hangs.
- **Locate the way a user identifies the element, in this order:** role + accessible name, then label, then visible text — and only when none of those can identify it, an explicit `data-testid`. These are not interchangeable alternatives: role-based locators fail when you break the accessibility tree, which is a bug worth catching, and a test id never does. Never CSS/XPath tied to markup structure or generated class names.
- **Make the environment deterministic** — fixed viewport/browser, disabled animations, frozen time, mocked/seeded third parties, and a known data state; "passes headed on my machine, fails headless in CI" is usually viewport, timing, or data drift.

### 14. Own your test data: seed it, isolate it, reset it
Shared, accumulating test data is a slow-motion flakiness generator — one test's leftovers change another's result, and order suddenly matters. Each test (or each run) starts from a known state it created and cleans up after, so tests can run in any order and in parallel without colliding.

**Bad:** tests run against a shared staging DB that anyone can mutate; `test B` assumes the 3 users `test A` created still exist — green today, red when tests reorder or run in parallel.
**Good:** each test seeds exactly the data it needs into an isolated space (transaction rolled back per test, a fresh schema/namespace, or unique keys per test) and asserts only on that — no dependence on ambient state.
- **Prefer per-test isolation** (transaction rollback, ephemeral container, unique tenant/prefix) over a shared fixture everyone mutates. Rollback works only when the test owns the connection: in e2e tests the app under test opens its own database connections, so a test's rollback can't undo its writes — isolate with unique keys or tenants, and clean up through the API or a test-only reset endpoint that exists only in test environments.
- **Reset before, not (only) after** — a crashed test leaves garbage; setting up clean state at the *start* makes the suite robust to previous failures.
- **Beware shared login/session state** — reusing one authenticated session across e2e tests speeds them up but re-introduces order coupling if a test mutates that account; isolate where it matters.
