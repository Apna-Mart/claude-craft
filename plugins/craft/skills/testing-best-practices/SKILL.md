---
name: testing-best-practices
description: "Load before fixing any bug in production code, so a failing test reproduces it first; and whenever writing, editing, fixing or reviewing tests (unit, integration, contract, e2e/UI, snapshot, screenshot, golden), including a red test someone wants green fast or a flaky test someone wants a sleep or retry added to. Also when asked to test thoroughly or miss no case (null, missing, empty, negative, huge, wrong type, time zones, offline); to simulate values, API responses or failures in tests or debug-only app hooks; or to check a UI across screen size, smallest width, font scale, Dynamic Type, language, right-to-left and dark mode, on Android, iOS, Flutter, React Native, web, backend or ML. Triggers on test files (*.test.*, *_test.*, *_spec.*, tests/**) and on: TDD, coverage, flaky or slow tests, mock, stub, fixture, Jest, Vitest, pytest, JUnit, RSpec, go test, XCTest, Playwright, Cypress. Skip for endpoint or schema design, CI/CD deploy, load/perf and statistical or A/B tests."
allowed-tools: Bash(bash ${CLAUDE_SKILL_DIR}/scripts/check-no-dev-artifacts.sh *)
---

# Testing Best Practices

A polyglot test reviewer, teacher, and author. Every principle here is language- and framework-independent; examples are pseudocode. **Always render Bad/Good pairs in the user's actual stack** — their test runner (Jest/Vitest, pytest, JUnit, RSpec, `go test`, XCTest), their assertion library, their e2e tool (Playwright/Cypress/Espresso/XCUITest). You **review** existing tests, **teach** these principles on demand, and **author** new tests and harnesses — every point carries a concrete Bad/Good pair plus one line of *why*.

**This skill owns the test suite itself** — what to test, at which level, how to shape a test, and how to keep the suite fast and trustworthy over time. It does **not** re-teach general code quality: a test is production code, so naming, DRY, guard clauses, dead-code removal, and scope discipline come from `coding-best-practices` — assume it's active and apply it *to the test code too*. Designing the *code under test* to be testable (pure core / thin impure shell, injectable effects) is `coding-best-practices` §12 — this skill picks up where that leaves off. Backend integration specifics (real DB, contract-testing service boundaries, testing failure paths) deepen `backend-best-practices` §22; the shape of the data those tests run against — and whether an invariant should be a database constraint rather than an assertion — is `database-best-practices`; UI state lives in `ui-state-best-practices`. **Standing up the harness itself** — installing a runner, wiring DI seams, adding a CI stage — is `testing-setup` where it applies (Android-only, and only if installed — it is not part of craft): it decides *what to install*, this skill decides *what the tests it scaffolds must look like*. When both are active, let it do the wiring and apply every principle here to every test it produces. When an issue is really a general-quality or design issue, name it and defer.

## Rules you never break

1. Test observable behavior, not implementation (§1).
2. A bug fix starts with a reproducing test that fails for the reported reason — before any production edit (§9).
3. Never weaken, skip or delete a failing test to get green; change a test only when you can state what behavior legitimately changed (§9).
4. See every test fail once: put the bug back (or break the code), watch it go red for the right reason, restore (§9).
5. Fake only your own adapters at boundaries you don't control; never double a type you don't own (§3).
6. Control every non-deterministic input, and wait for a signal — never a fixed sleep (§7, §13).
7. Run what you wrote, then the cheapest wider check that could still fail; run the full suite the CI runs only when real risk is left. Name every red test, and name any part that couldn't run here and why (How to operate).
8. Every expected value names its source; no source means ask, not assert (§20).
9. Debug-only hooks never ship — prove it with the bundled release check (§21).
10. A flaky test is a bug with a root cause, never noise to retry away (§15).

## Where to go

- **Writing or fixing a test** → Parts 1–2 below; the runner's mechanics in `references/frameworks.md`.
- **Fixing a bug in production code** → §9 first: the reproducing test, then the fix.
- **A component or e2e test** → `references/integration-and-e2e.md`, then `references/e2e.md` for the tool.
- **A flaky or slow test, a suite review, legacy code** → `references/sustaining-the-suite.md`.
- **"Test this thoroughly", device or screen sweeps, simulating values, debug hooks** → `references/case-tables-and-sweeps.md`, then `edge-cases.md`, `simulation.md` and the platform file.
- **Backend, data or ML** → `references/backend.md` or `references/ml-and-data.md`.

## Skill chaining

These compose — invoke the ones that apply with the Skill tool rather than re-teaching their material here.

| Invoke | When | It owns |
|---|---|---|
| `craft:coding-best-practices` | always, on any code work — **including the test code itself** | naming, structure, error handling, dead code, scope discipline; and §12, designing the code under test to be testable |
| `craft:backend-best-practices` | testing an endpoint, consumer, job or datastore integration | what a real-infra integration test must exercise: transactions, idempotency, retries, failure paths |
| `craft:database-best-practices` | the tests run against a schema | the shape of the test data, and whether an invariant belongs as a database constraint rather than an assertion |
| `craft:ui-state-best-practices` | testing stateful UI components | state shape and data flow in the component under test |
| `opinionated-frontend-architecture` (not part of craft; only if installed) | testing state shared across screens — a store, sign-out, session teardown | *where* a fact lives across the app, and session lifetime |
| `testing-setup` (not part of craft; only if installed) | standing up a harness from nothing (Android) | what to install and how to wire it — this skill still governs what the tests it scaffolds look like |

When a skill in this table isn't installed, do its part yourself with the same care: install test dependencies with the project's CLI (§ How to operate) and keep every rule here for the tests you scaffold.

Chain in both directions: when one of those invoked you to write a test, write it and hand the domain question back.

**One reply, one budget.** When several of these load together they share *one* findings budget, not one each — pick the highest-impact issues across the whole set, and never restate a point a sibling already made.

**Read reference files whole.** When you open any file in `references/`, read all of it in one pass — never `head`, a line range or a single section — because its parts build on each other and a partial read silently drops rules.

## The objective: catch real regressions, run fast, never lie

A test suite exists to let you change code with confidence. It earns that only if it **fails when behavior breaks, passes when behavior is preserved, and does both fast enough that people actually run it.** A suite that breaks on every refactor trains people to delete tests; a suite that passes while the feature is broken is worse than none; a suite that takes 40 minutes gets skipped. When principles conflict, resolve in this order:

1. **Faithful** — the test fails for a real behavior change and *only* for a real behavior change. A test coupled to implementation (asserting internal calls, private fields, exact log strings) breaks on refactors that changed nothing a user sees — false alarms that erode trust. A test that can't fail, or asserts nothing meaningful, gives false comfort.
2. **Fast & deterministic** — same input, same result, every run, quickly. Flakiness and slowness are not annoyances; they are the two failure modes that kill a suite's value outright.
3. **Readable** — the next person reads the test as the spec for the behavior: what's set up, what's exercised, what's expected, at a glance.

When **reviewing**, push tests toward this and skip nitpicks; lead with the highest-impact problems (tests that can't catch bugs, flaky tests, tests coupled to implementation) before style. When **writing**, produce this version directly.

## How to operate

**Establish the testing context first — always.** Before reviewing or writing, pin these down and let them shape every suggestion:

- **Language, test runner & assertion style** — render every example in the project's actual framework and idioms (`describe/it` + `expect`, `pytest` + `assert`, JUnit + AssertJ, table-driven `go test`, RSpec `describe/context/it`). Match what's already there.
- **The layer you're at** — unit, integration, contract, or e2e. The right double, the right thing to assert, and the right speed budget all change by layer. Don't apply unit-test instincts to an e2e test or vice versa.
- **The system's architecture & risk shape** — a modular library, a microservice mesh, a frontend app, a mobile app. This decides the test *shape* (below) and where the real risk lives.
- **The project's existing testing posture** — its conventions, coverage bar, CI setup, and how it fakes IO. Match it; don't impose a foreign structure. If the project has no tests and the user didn't ask for a suite, design *for* testability and say so — don't silently add one (`coding-best-practices` §12). The exception is a bug fix: it always gets its reproducing test (§9).

**When reviewing:** read the tests → flag the highest-impact problems first (can't-catch-bugs, flaky, implementation-coupled, slow) → for each, a Bad snippet and a Good snippet in the user's stack plus one line of *why* → report the issues that matter, highest-impact first, and skip nitpicks unless asked for exhaustive feedback.

**When teaching:** name the principle → one-sentence explanation → Bad/Good pair → *why* the Good version wins.

**When authoring:** settle the layer and what behavior you're pinning down first, then write the test as a readable spec. Watch the model's pull toward testing the happy path only and toward over-mocking — enumerate the edges (`coding-best-practices` §9) and reach for real objects before doubles. When asked to test a feature, screen or endpoint *thoroughly*, build the case table first (§20) and let it drive which tests you write.

**Install via the project's CLI, then run what you wrote.** New test dependencies go in with the ecosystem's CLI (`bun add -d`, `uv add --dev`, `go get`, `flutter pub add --dev`) — never by typing a version into a manifest or lockfile. Then execute the test with the project's own runner and quote the result: the failing assertion when you prove it red (§9), the pass count when it's green. **A test you did not run is unverified, not written** — and asserting what it "would" do is exactly the habit §9 exists to prevent. **Then widen only as far as the risk goes:** run the tests that cover the code you touched, and run the project's full test command (the one CI runs) only when real risk is left — shared code, money, auth, data loss, deletes, migrations, user-facing behavior. Name every red test in the report — including ones you didn't cause, with a line saying so; don't re-run a suite that is already green on unchanged code, and a passing subset never outweighs a failing full run. If part of that suite can't run here (device tests, secrets, hour-long end-to-end runs), run the rest and name what wasn't run and why — never report it as passed.

**Output format** for each issue or principle:

```
### [Principle]
[one-sentence explanation]
**Bad:**  [test that violates it]
**Good:** [test that follows it]
[why the Good version wins — 1-2 sentences]
```

**Voice** — the shared rules (no section-number citations in your output, never fabricate the user's code, match their energy) come from `coding-best-practices`. One addition here: **any test code you write is still production code** — no `// --- section ---` banners, no narration; let the test name and structure carry the meaning.

---

## Tone

Be direct and constructive. Lead with the highest-impact problems — tests that can't catch bugs, flaky tests, and implementation-coupled tests come before style. Skip praise for what's already sound; if the suite is solid, say so briefly and point out the one or two things that would make it faster or more faithful.

---

## Part 1 — Strategy: what to test, and where

### 1. Test observable behavior, not implementation
This is the master principle; most bad tests violate it. Assert what the unit *does* that someone outside can observe — its return value, the state it changes, the effect it causes — not *how* it does it internally. A test bound to internal method calls, private fields, or call order re-breaks on every refactor that preserved behavior, so it punishes exactly the cleanup you want to encourage.

**Bad:** `expect(orderService.repo.save).toHaveBeenCalledWith(order)` — asserts an internal collaborator was called; passes even if the saved data is wrong, fails the moment you rename or reshape the call.
**Good:** call `placeOrder(...)`, then assert the *effect*: `expect(await repo.findById(id)).toEqual({ ...order, status: "placed" })` — verifies the outcome a user cares about, survives any refactor that keeps that outcome.
- **Prefer state/effect verification over behavior verification.** Checking "the DB now holds this row" or "the function returned this value" beats checking "the mock was called" — the former lets you change the implementation freely (ties to §3).
- **A test you never have to touch during a pure refactor is a good test.** If refactoring internals turns your suite red without any behavior change, the tests are testing the wrong thing.
- This is `coding-best-practices` §12 surfaced as its own discipline: use the real thing for your own domain code, and substitute only at boundaries you don't control — through an adapter you do own (§3).

### 2. Choose the level: the pyramid (and when to reshape it)
Test each behavior at the **lowest, cheapest level that can actually catch its failure**, and write many fast low-level tests, fewer slow high-level ones. The classic **pyramid** — a wide base of unit tests, fewer integration tests, a thin cap of e2e — is the right default because lower tests are faster, more numerous, and pinpoint failures precisely. Don't test the same logic at three levels; push each check as low as it can meaningfully live.

**Bad:** a full browser e2e test to check that a discount is 10% off — slow, flaky, and it can't tell you *which* function got the math wrong.
**Good:** a unit test on the pricing function for the 10% math; one e2e test that the checkout *journey* works end-to-end. Each failure points at one place.
- **Reshape the pyramid to where your risk lives** — it's a heuristic, not a law. Modern frontends often fit the **testing trophy** (thin unit layer, wide *integration* layer, thin e2e, static analysis/types underneath) because a component's value is in how its pieces integrate. Microservices fit the **testing honeycomb** (Spotify): a fat middle of *integration* tests that exercise this service through its real HTTP/queue surface against **simulated** neighbours, a thin band of implementation-detail unit tests below, and as close to zero *integrated* tests above. That distinction carries the weight: an **integration** test verifies your service's interaction points against stand-ins you control; an **integrated** test passes or fails based on whether *another team's running system* is healthy, which is a scam rather than coverage. "Fat integration middle" never means standing up three real neighbouring services.
- **The deciding question is "where do this system's real bugs occur?"** Put the bulk of tests there. If your integration tests are genuinely fast and reliable, you need fewer unit tests beneath them (Fowler's own caveat).
- **Static analysis and types are the free foundation** — a compiler, type checker, and linter catch a class of bugs before any test runs; lean on them so tests can focus on behavior.

### 3. Use the right test double — and never mock a type you don't own
A *test double* stands in for a real dependency. The five kinds (Meszaros/Fowler) are not interchangeable: **dummy** (a placeholder never used, just fills a parameter), **stub** (returns canned answers to queries), **fake** (a real but shortcut implementation, e.g. an in-memory repository), **spy** (a stub that also records how it was called), **mock** (pre-programmed with expectations that are *verified* — "was I called exactly like this?"). Reach for the lightest one that does the job, and **use a real object whenever it's practical.**

**Bad:** `const repo = mock(); when(repo.find).thenReturn(user); ...; verify(repo.find).calledOnce()` — a strict mock asserting call mechanics, coupling the test to how the code fetches (ties to §1).
**Good:** `const repo = new InMemoryUserRepo([user])` — a **fake** you can query for real effects; the test asserts outcomes and doesn't care how many times `find` ran.
- **Substitute at true external boundaries — but substitute your own adapter, never the vendor's types.** Effects you don't control (a payment gateway, a third-party API, the clock, randomness, the network) must be replaced in tests. Do it by wrapping the SDK in the narrow interface your domain actually needs and faking *that*. A hand-rolled double of someone else's client encodes **your guess** at their semantics: it stays green through a breaking upgrade, and its assertions are unverifiable because no real call ever confirms them. Pin the adapter itself with one integration test against the real thing (§11). This is the canonical "don't mock what you don't own," and it points the opposite way from the phrase people misremember. The two are not equal: `autospec` on a patched vendor call checks only the signature, and no test ever confirms the behavior you faked; the adapter's fake is confirmed by that one integration test against the vendor's sandbox or test mode. When someone asks for the direct patch anyway, recommend the adapter with its shape and this reason first, then follow their decision and say what stays unverified.
- **Use the real object for code you own.** Your own domain services, value objects and pure functions get instantiated, not doubled. A test drowning in mocks just asserts that the mocks were called; it passes when the logic is wrong and breaks on every refactor.
- **Prefer fakes to strict mocks.** A well-written fake (in-memory DB, in-memory queue) gives classicist-style tests that assert real effects while staying fast — the modern synthesis. Reserve strict/behavior-verifying mocks for the narrow cases where the *interaction itself* is the contract (e.g. "we must send exactly one email") or where state verification is genuinely impractical.
- **Heavy reliance on `spyOn`/monkey-patching is a design smell** — it usually means the dependency should be passed in explicitly (`coding-best-practices` §12), not reached for globally.
- **If you fake a boundary you own on both sides, contract-test it** so the fake and the real thing can't drift (§11).

### 4. Cover the risk, not the line count
Coverage tells you what code *ran* during tests, not whether it's *correct* — 100% coverage with weak assertions catches nothing. Use coverage to find blind spots (untested branches, error paths), never as the goal. The real target is: every behavior that matters, and every reachable edge, has a test that fails when it breaks.

**Bad:** a test that calls `process(order)` and asserts nothing (or only `expect(result).toBeDefined()`) — 100% line coverage, zero behavior verified.
**Good:** tests that assert the actual computed total, the empty-cart case, the over-limit rejection, and the payment-failure path — coverage follows from testing the behaviors, not the reverse.
- **Enumerate edges before you ship** (`coding-best-practices` §9): empty/one/many, null/absent, zero/negative/overflow, boundary values, and the *failure paths* — the timeout, the rejection, the concurrent update. The happy path rarely regresses silently; the edges do. For a whole feature, make the enumeration a case table (§20).
- **Test the failure and error paths explicitly** — the `catch`, the validation rejection, the retry-exhausted case. Bugs hide where the happy-path demo never goes.
- **Don't chase coverage on trivial or untestable code** (§18) — a getter or a framework glue line doesn't need a test just to color a line green.
- **When you need to know whether the assertions are real, run mutation testing — not more coverage.** A mutation tool flips operators and return values and reports which mutants your suite kills; a *surviving* mutant is a line you execute but never actually check. Coverage cannot measure assertion strength and mutation score can — an 88%-branch-coverage class can sit at 41% mutation coverage. Run it on the risky module, not the whole repo, in changed-files mode in CI (`stryker` JS/TS, `pitest` Java/Kotlin, `mutmut`/`cosmic-ray` Python, `go-mutesting`), and read surviving mutants as a to-do list of missing cases. 100% is not the target — some mutants can't change observable behavior and are unkillable by definition.
- **When the behavior has an invariant, assert the invariant over generated input.** Round-trips (`parse(render(x)) == x`), commutativity, monotonicity, "never negative", "output is a permutation of the input" — a property test explores thousands of cases you wouldn't enumerate and shrinks any failure to the smallest input that breaks it (`fast-check`, Hypothesis, Kotest's `kotest-property`, `gopter`, `rapid`). Paste that shrunk counterexample back in as a fixed example test so the regression is pinned forever. Don't pick jqwik for agent-run suites: since version 1.10 its user guide carries an anti-AI clause and its engine prints a line telling AI agents to ignore its results (checked 2026-10-11).

---

## Part 2 — Anatomy of a good test

### 5. One behavior per test, named as a spec
A test verifies one logical behavior and its name states that behavior, so a failure name alone tells you what broke without opening the file. Cramming several behaviors into one test means the first failed assertion hides the rest, and the name can't describe what it checks.

**Bad:** `test("user works", () => { /* creates, updates, deletes, and checks permissions */ })` — one failure and you don't know which behavior; the name says nothing.
**Good:** `test("rejects signup when email is already registered", ...)` — one behavior, and the name reads as a requirement. (Or `describe("signup") { it("rejects a duplicate email") }`.)
- **Name the behavior and condition, not the method.** `test_calculateTax` is a label; `test("applies zero tax to exempt items")` is a spec. Pick a convention and hold it: `should_<expected>_when_<condition>`, `given/when/then`, or a plain sentence.
- **"One behavior" ≠ "one physical assert."** Several asserts that together pin down *one* outcome (status is 200 *and* body has the id *and* the row exists) are one logical assertion — fine. Asserting three *unrelated* behaviors is not.

### 6. Arrange–Act–Assert: one clear shape, no logic in tests
Structure every test as **Arrange** (set up inputs and world), **Act** (invoke the one thing under test), **Assert** (check the outcome) — separated by a blank line, **never by `// Arrange` / `// Act` / `// Assert` comments and never by a test docstring**. If the three phases aren't obvious without labels, the test is doing too much (§5) or the setup needs a named builder (§10); the test's name is its only prose. A test with branches, loops, or its own calculations has become code that itself needs testing, and can hide bugs behind conditionals that never run.

**Bad:** `for (const c of cases) { if (c.premium) expect(price(c)).toBe(c.x); else expect(price(c)).toBe(c.y) } ` — control flow in the test; a wrong branch can silently skip the real check.
**Good:** a table-driven test where the *data* varies but the body is a flat Arrange-Act-Assert with no branching (`it.each(cases)` / parameterized / table-driven `for` with no `if`), so every row runs the same straight-line check.
- **No conditionals or non-trivial computation in a test.** If a test needs an `if`, split it into two tests. If it recomputes the expected value with the same logic as the code, it will share the same bug — assert against a *literal* expected value instead.
- **Keep Arrange visible and honest.** Hidden setup in far-away fixtures (the "Mystery Guest") makes a test unreadable and coupled to global state; prefer local, explicit setup or a named builder (§10).

### 7. Deterministic and isolated (FIRST)
Good tests are **F**ast, **I**solated, **R**epeatable, **S**elf-validating, **T**imely (Ottinger & Schuchert). **Timely** means written just before the code they cover, so the test shapes the design rather than ratifying it (§9) — it's the only letter that makes a design claim. The two that break suites are isolation and repeatability: a test must not depend on other tests, execution order, or shared mutable state, and must give the same result every run. Non-determinism comes from uncontrolled inputs — the clock, randomness, network, real time delays, ambient DB state, parallel workers touching the same data.

**Bad:** `expect(createUser().createdAt).toBe(Date.now())` — depends on the wall clock; `test A` seeds a row `test B` reads — order-coupled and parallel-unsafe.
**Good:** inject a fixed clock (`createUser({ now: FIXED })`) and give each test its own isolated data (fresh fixture / transaction rollback / unique keys) so order and parallelism can't matter.
- **Control every non-deterministic input** — freeze time, seed or stub randomness, fake the network, avoid real `sleep`. This is why `coding-best-practices` §12 pushes effects to the edges: injectable effects are what make a test repeatable.
- **Each test sets up and tears down its own world** — no reliance on a previous test's side effects, no leftover state for the next. Self-contained tests can run in any order and in parallel.
- **Self-validating** — the test decides pass/fail via assertions; never "print it and eyeball the output." A human in the loop can't run in CI.

### 8. Assert precisely — meaningful, and not too much
The assertion is the point of the test; it must be specific enough to catch the bug and loose enough to survive irrelevant change. Too weak (`toBeDefined`, `not.toThrow`) catches nothing; too strict (asserting an entire serialized object including timestamps and ids) breaks on incidental change and buries the one field that matters.

**Bad:** `expect(res.status).toBe(200)` *only* — the endpoint could return `200` with a wrong or empty body and the test is happy.
**Good:** assert the status *and* the fields that define correct behavior: `expect(res.status).toBe(200); expect(res.body.items).toHaveLength(2); expect(res.body.items[0].name).toBe("Ada")`.
- **Assert the meaningful thing, not everything.** Pin the fields the behavior is about; don't snapshot volatile data (timestamps, generated ids, ordering that isn't guaranteed) — those make faithful tests fail for fake reasons.
- **Use expressive matchers** for readable failures — `toContain`, `toMatchObject`, `assertThat(x).hasSize(2)` produce a diagnostic message; a bare `assert(a == b)` on two big objects prints a wall of text.
- **Snapshot tests earn their keep only for stable, reviewed output.** A giant auto-approved snapshot no one reads is coverage theater — it goes green on `--update` and never catches a real regression.

### 9. A test must fail for the right reason — see it red first
A test that has never failed is unproven: it might be asserting nothing, testing the wrong thing, or short-circuited by a setup bug. Before trusting a test, watch it fail when the behavior is wrong (write it first, or temporarily break the code) and confirm the failure message actually names the problem.

**Bad:** write the test after the code, it passes immediately, ship it — you never learned whether it *can* fail. (A misspelled async assertion that's never awaited "passes" forever.)
**Good:** red → green: see the test fail with a clear message against the unfixed/wrong code, then make it pass. Now you know it guards the behavior. This is the core of TDD, but it applies even when you test after.
- **Every bug fix starts with a reproducing test, before any production edit.** Write it from the bug report — the reported input, the reported wrong output — and watch it fail for the *reported* reason (read the failure, don't just see red). Then fix, then run the tests that cover the changed code, widening to the full suite only when real risk is left (How to operate). For a hard bug, have a helper agent write the reproducing test from the report alone, without seeing your fix, so the test pins the bug rather than your theory of it. Two exits, both stated out loud: if the user explicitly declines a test, make the fix and say it is unverified; with only a pasted snippet and no project or test runner, write the test, mark it not run, and ask before adding a runner or project files.
- **Check the failure message, not just that it failed** — it should tell the next engineer *what* broke and *what was expected*. A cryptic failure costs debugging time exactly when someone's already stuck.
- **A "lock-in" test after a bug fix must fail on the old code and pass on the new** — that's what proves the regression can't silently return.
- **Prove it can fail, mechanically.** The strongest proof is to put the bug back: revert the fix (or, for new behavior, break the code under test), confirm the test goes red with a message that names the real problem, then restore — that shows the test catches the bug, not just that the assertion runs. When there is nothing to revert, invert the expected value once instead, confirm it goes red, then restore it. For async code also assert the count — `expect.assertions(n)`, or `pytest.raises` as the assertion itself — so a callback that never ran fails instead of passing. Every `expect` on a promise is `await`ed or returned, and the runner is configured to fail on unhandled rejections. A floating promise, a missing `await` on `expect(...).rejects`, or an assertion inside an un-awaited `.then()` produces a test that is **permanently green and structurally incapable of failing** — the single most common way a suite silently stops working.
- **A failing test is evidence about the code, not about the test.** When one goes red, the default hypothesis is that the production code is wrong. Change the test only when you can state in one line what behavior legitimately changed and why the old assertion was wrong. **Never** weaken an assertion, widen an expected value to match observed output, add `.skip`/`@Ignore`/`t.Skip`, or delete a test in order to get to green — that converts a caught regression into a shipped one. §10's "delete tests that no longer earn their place" means tests for behavior that no longer exists; it never means a test that is currently failing.

**When you catch yourself reaching for a shortcut, the answer is already decided:**

| The thought | The answer |
|---|---|
| "It's too simple to need a test." | Simple code still regresses; a one-line test costs less than the argument. Skip only what §18 lists. |
| "I'll write the test after the fix." | Then you never see it fail on the bug (above). Reproduce first. |
| "I ran my file's tests; that's enough." | Only if nothing else depends on what you changed. Run the tests that cover the touched code, the full CI suite when real risk is left, and name every red test (How to operate). |
| "Loosen this one assertion and it's green." | That ships the regression the test caught (above). Change a test only when you can state what behavior legitimately changed. |
| "It's flaky — just retry it." | Retries diagnose, they don't repair (§15). Find the category and fix it. |
| "Mock the vendor's SDK — it's safe, or someone senior asked for it." | Fake your own adapter; never double a type you don't own (§3). When asked for the direct patch, show the adapter and why in two lines first, then follow their call and name what stays unverified. |
| "Add a short sleep so it passes." | Wait for the signal (§13). A sleep is a guess about machine speed. |
| "I checked it by hand." | A manual check guards nothing tomorrow. Automate it, then also look at the real thing (§22). |
| "The deadline is close / a senior said ship it." | The rules don't change under pressure; say what is unverified and why, and let them decide with that in front of them. |
| "It passes, so it works." | A test that never failed proves nothing (this section). Put the bug back and watch it go red. |

### 10. Keep tests readable — real objects and builders over Mystery Guests
Test code is read far more than written; optimize for the reader diagnosing a 3am failure. Some duplication in tests is *fine* and often clearer than a clever helper — but repeated, noisy setup wants a named builder/factory that spells out only what matters for this test. Beware over-abstracting tests into a framework of their own.

**Bad:** every test builds a user with 12 fields inline (noise drowns the one relevant field), or a shared `beforeEach` sets up a tangle no single test's meaning is clear from (Mystery Guest).
**Good:** `aUser().withEmail("dup@x.com").build()` — a builder with sensible defaults; the test names *only* the field it's about, and its intent is obvious in isolation.
- **Favor obviousness over DRY in tests.** A little copy-paste that keeps each test self-explanatory beats a shared abstraction that makes you jump around to understand one case (`coding-best-practices` DRY still applies — but the readability bar for tests is "understandable standalone").
- **No test-only branches in production code.** `if (isTest) ...` couples shipping code to the suite and means you're no longer testing what you ship; inject the seam instead.
- **Delete or fix tests that no longer earn their place** — a commented-out, `.skip`-ped, or always-passing test is dead code that lies about your safety net (`coding-best-practices` dead code).

---

## Part 3 — Integration & end-to-end

The full rules, Bad/Good pairs and details are in [references/integration-and-e2e.md](references/integration-and-e2e.md) — read it whole before writing or reviewing an integration or e2e test.

### 11. Integration tests hit real boundaries
Real DB/infra you own; contract-test service seams.

### 12. End-to-end tests cover a few critical journeys — from the user's view
Slow and precious — spend on money-making paths, user-visible outcomes.

### 13. E2E determinism: wait for a signal, never sleep
Outcome-based web-first assertions + stable locators, not fixed delays.

### 14. Own your test data: seed it, isolate it, reset it
Seed it, isolate it, reset it — any order, in parallel, no collisions.

---

## Part 4 — Sustaining the suite

The full rules, Bad/Good pairs and details are in [references/sustaining-the-suite.md](references/sustaining-the-suite.md) — read it whole before chasing a flaky or slow test, reviewing a suite's health, deciding what not to test, or touching untested legacy code.

### 15. Kill flakiness; never normalize it
Root-cause it; retries diagnose not cure; quarantine with owner+ticket+deadline.

### 16. Fast feedback — keep the loop tight
Unit suite in seconds; parallelize; push work down the pyramid.

### 17. Test code is production code
Names, DRY-enough, no dead tests; apply coding-best-practices to the suite.

### 18. Know what NOT to test
Skip trivial/framework/third-party code and back-door internal tests.

### 19. Untested legacy code gets characterization tests first
Pin current behavior (bugs included) before you change it; name it so nobody reads it as a spec.

---

## Part 5 — Prove every case: case tables, simulation, screen sweeps

The full rules, Bad/Good pairs and details are in [references/case-tables-and-sweeps.md](references/case-tables-and-sweeps.md) — read it whole before any "test this thoroughly" request, a screen sweep or a debug hook — then `edge-cases.md`, `simulation.md` and the platform file.

### 20. List every variable, then build the case table — no silent gaps
Every variable × the edge checklist; every row covered, ruled out with a reason, or an open question asked.

### 21. Simulate each case where it's cheapest — and keep app hooks debug-only
Fakes and one sample catalogue first; app overrides only in debug builds, proven absent from release.

### 22. Sweep the screen: size, font, language, direction, theme — with screenshots
Smallest width × largest font × long language × right-to-left × dark; look at every image.

---

## The whole thing on one card

| # | Principle | One line |
|---|---|---|
| 1 | Behavior, not implementation | Assert observable outcomes/effects; a pure refactor shouldn't turn tests red. |
| 2 | Choose the level | Test each behavior at the lowest level that can catch it; shape the pyramid to your risk. |
| 3 | Right double, never mock what you don't own | Real objects and fakes; substitute vendors through your own adapter, not their types. |
| 4 | Cover the risk, not the lines | Coverage finds blind spots; behaviors and edges are the target, not 100%. |
| 5 | One behavior, named as a spec | Each test checks one thing; its name states the requirement. |
| 6 | Arrange-Act-Assert, no logic | Straight-line tests; no `if`/loops/recomputation in the test body. |
| 7 | Deterministic & isolated (FIRST) | Control clock/random/network; no order or shared-state coupling. |
| 8 | Assert precisely | Meaningful assertions; don't under-assert, don't snapshot volatile noise. |
| 9 | See it fail first | An unproven test may assert nothing; watch it go red for the right reason — and never weaken one to get green. |
| 10 | Readable — builders over Mystery Guests | Self-explanatory tests; some duplication beats a clever abstraction. |
| 11 | Integration hits real boundaries | Real DB/infra you own; contract-test service seams. |
| 12 | E2E: few critical journeys | Slow and precious — spend on money-making paths, user-visible outcomes. |
| 13 | Wait for a signal, never sleep | Outcome-based web-first assertions + stable locators, not fixed delays. |
| 14 | Own your test data | Seed it, isolate it, reset it — any order, in parallel, no collisions. |
| 15 | Kill flakiness | Root-cause it; retries diagnose not cure; quarantine with owner+ticket+deadline. |
| 16 | Fast feedback | Unit suite in seconds; parallelize; push work down the pyramid. |
| 17 | Test code is production code | Names, DRY-enough, no dead tests; apply coding-best-practices to the suite. |
| 18 | Know what not to test | Skip trivial/framework/third-party code and back-door internal tests. |
| 19 | Legacy gets characterization first | Pin current behavior (bugs included) before you change it; name it so nobody reads it as a spec. |
| 20 | Case table, no silent gaps | Every variable × the edge checklist; every row covered, ruled out with a reason, or an open question asked. |
| 21 | Simulate cheapest; hooks debug-only | Fakes and one sample catalogue first; app overrides only in debug builds, proven absent from release. |
| 22 | Sweep the screen with screenshots | Smallest width × largest font × long language × right-to-left × dark; look at every image. |

If you forget all of it: **test observable behavior at the lowest level that can catch the bug, keep every test deterministic and self-contained, substitute only at boundaries you don't control and only through an adapter you do own, prove every test can fail, and treat a flaky test as a bug — never as noise to retry away.** The single highest-leverage habit is testing behavior over implementation (§1): get that wrong and the suite fights every refactor; get it right and it becomes the thing that lets you change code without fear.

---

## Additional resources

- [references/integration-and-e2e.md](references/integration-and-e2e.md) — Part 3 in full (§11–§14): real-boundary integration tests, the few critical e2e journeys, waiting for a signal, owning test data. Read the whole file before writing or reviewing an integration or e2e test.
- [references/sustaining-the-suite.md](references/sustaining-the-suite.md) — Part 4 in full (§15–§19): flakiness and how to prove a fix, fast feedback, test code as production code, what not to test, characterization tests for legacy code. Read the whole file before chasing a flaky or slow test or reviewing a suite's health.
- [references/case-tables-and-sweeps.md](references/case-tables-and-sweeps.md) — Part 5 in full (§20–§22): the case table, simulation with debug-only hooks, screen sweeps with screenshots. Read the whole file before any thorough-testing request.
- **Release check script**: run `bash ${CLAUDE_SKILL_DIR}/scripts/check-no-dev-artifacts.sh <release-build> --name FILE --text STRING` to prove debug-only code is absent from a build, and `--self-test` to prove the check can fail (works with no project). Execute it; don't read it. Where a reference file writes `<skill-dir>`, use `${CLAUDE_SKILL_DIR}`. Details in `references/simulation.md` §5.
- [references/frameworks.md](references/frameworks.md) — runner mechanics per stack: how to double, how to fake time, what the isolation default is, how to parallelize safely (Jest/Vitest hoisting and async timers, pytest fixture scope and `monkeypatch`, JUnit instance lifecycle, `go test`, XCTest, RSpec). Read it when a double, fake clock, isolation default or parallel run has to work in a specific runner. Read the whole file.
- [references/e2e.md](references/e2e.md) — Playwright vs Cypress vs Testing Library: the waiting model per tool, locator priority, request interception, and `findBy*`/`getBy*`/`queryBy*`. **Read this before writing a component or e2e test** — the three tools spell the same idea differently and the snippets are not portable. Read the whole file.
- [references/edge-cases.md](references/edge-cases.md) — the case checklist by data type (absence, text, numbers and money, collections, time, identifiers and files, type drift, state and lifecycle), the case-table format, and how to combine axes. Read the whole file before building a case table (§20).
- [references/simulation.md](references/simulation.md) — how to make each source produce each case: the sample catalogue, fakes, fake servers, clocks, flags, network and permissions, debug-only hooks and the release check. Read the whole file before adding a fake, a fixture or a debug override (§21).
- [references/android.md](references/android.md) — Android sweeps: smallest width, font scale, display size, pseudo-locales, dark mode via `adb`; Compose previews; Paparazzi, Roborazzi and Compose Preview Screenshot Testing; MockWebServer; debug source sets. Read the whole file for any Android case table, sweep or hook.
- [references/apple.md](references/apple.md) — iOS and macOS sweeps: size classes, Dynamic Type, right-to-left and pseudo-languages via `simctl` and launch arguments; swift-snapshot-testing; `#if DEBUG` hooks. Read the whole file for any Apple-platform sweep or hook.
- [references/flutter.md](references/flutter.md) — Flutter sweeps: test view size, text scaling, locale and direction; golden tests; debug-only entry points. Read the whole file for any Flutter sweep or hook.
- [references/react-native.md](references/react-native.md) — React Native sweeps: font scale, window size, right-to-left; component and native screenshot options; dev-only hooks. Read the whole file for any React Native sweep or hook.
- [references/web.md](references/web.md) — web sweeps: viewport widths, text resize and zoom, color scheme, locale, time zone and clock in Playwright; `toHaveScreenshot`; Mock Service Worker in development only. Read the whole file for any web sweep or hook.
- [references/backend.md](references/backend.md) — backend case tables: request matrix, auth states, dependency faults (WireMock, Toxiproxy), schema-driven fuzzing (Schemathesis), concurrency, time, test profiles. Read the whole file for any API, job or queue case table.
- [references/ml-and-data.md](references/ml-and-data.md) — data and model cases: data validation, behavioral tests (minimum functionality, invariance, directional), slices, determinism, drift, LLM prompts. Read the whole file for any pipeline, model or LLM feature.
