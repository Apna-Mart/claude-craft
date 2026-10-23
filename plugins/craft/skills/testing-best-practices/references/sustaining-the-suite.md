# Sustaining the suite (§15–§19)

**Currency stamp: 2026-10-06.** The full rules, Bad/Good pairs and details for parent Part 4, moved out of SKILL.md and then extended. Section numbers are the parent's, so `§N` citations elsewhere still point here.

## Contents

- 15. Kill flakiness; never normalize it
- 16. Fast feedback — keep the loop tight
- 17. Test code is production code
- 18. Know what NOT to test
- 19. Untested legacy code gets characterization tests first

---

### 15. Kill flakiness; never normalize it
A flaky test — one that passes and fails on the same code — is worse than no test: it trains the team to ignore red CI, and real regressions then hide behind the noise. Treat every flake as a bug with a root cause, not a dice roll to re-roll. The re-run reflex is the trap.

**Bad:** the test fails intermittently, so CI is set to retry 3×; it "passes" and the merge goes through — the underlying race is still there, now invisible, and trust in the suite quietly dies.
**Good:** reproduce it (run it many times: `--repeat-each`, rerun under load), find the category — timing/async, shared state, unstable selector, resource contention, non-deterministic input — and fix *that*. Retries stay only as a diagnostic (capture a trace on first retry), never as the cure.
- **Diagnose by category** — most flakes are: acted-before-ready (§13), test interdependence/shared state (§14), unstable locator (§13), or an uncontrolled input like clock/random/network (§7). Each has a real fix.
- **Retries diagnose, they don't repair** — `retries: 2` with trace-on-retry gives you the evidence to fix the flake; a permanent retry policy is a decision to stop looking.
- **Quarantine the residue with accountability** — move a stubborn flake to a separate *non-blocking* job (so it still runs and you keep the signal), tagged with the suspected cause, and give it an **owner, a ticket, and a deadline**. A quarantined test protects nothing; time-box it (fix or delete within a sprint or two). Don't silently `.skip` it into oblivion.
- **Quarantine on a measured rate, and always state the unit.** Track pass/fail per test across runs; anything failing on unchanged code more than roughly **1 run in 100** goes to the non-blocking job with an owner and a ticket. That same per-run rate is the suite-level budget — Google measures about **1.5% of all test runs** flaky across roughly **16% of tests**, which is why "a 2% flake rate" is meaningless unless you say whether you mean per run or per test.
- **Size the proof that a flake is fixed.** Zero failures in N runs only shows, with 95% confidence, that the failure rate is below about 3/N (the rule of three): 50 clean runs shows below about 6%, and showing below the 1-in-100 bar takes about 300 clean runs. State N next to "fixed".

### 16. Fast feedback — keep the loop tight
A slow suite is a skipped suite. The unit layer should run in seconds so developers run it constantly; slower integration/e2e layers run less often (pre-push, CI) but must still finish before attention wanders. Speed is a feature you protect, not an accident.

**Bad:** every test spins up the full app, a real DB, and seeds 10k rows — the "unit" suite takes 12 minutes, so nobody runs it before pushing and breakage is found late.
**Good:** true unit tests run pure logic in-memory (milliseconds each); integration tests share a fast ephemeral DB and run in parallel; the heavy e2e set is a small, separate CI stage. Each layer meets its budget.
- **Parallelize and isolate** (§14 makes this safe) — independent tests should run concurrently across workers.
- **Budget by layer** (adapt to the project): unit tests in single-digit milliseconds each, the whole unit suite in seconds-to-low-minutes; keep e2e small precisely because each run is expensive.
- **Push work down the pyramid** to reclaim speed — a behavior tested at the unit level doesn't need a slow e2e re-test (§2).

### 17. Test code is production code
The suite is a codebase you maintain forever; hold it to the same bar as shipping code. Everything in `coding-best-practices` applies **to the tests**: intent-revealing names, no duplicated-and-drifting setup, no dead/`skip`-ped tests rotting in place, small focused units, and surgical diffs. Sloppy tests decay into a suite people fear to touch and eventually delete.

**Bad:** copy-pasted 40-line setup across 30 tests, cryptic names (`test1`, `testUser2`), and five commented-out tests "we might need" — the suite is now a liability nobody trusts or edits.
**Good:** shared setup behind a named builder (§10), spec-style names (§5), dead tests deleted (version control remembers), each test small and single-purpose — the suite reads as living documentation.
- **Refactor tests too** — when the code's design changes, update the tests' structure; don't let them ossify into a museum of the old shape.
- **Apply the same review lens** — a test PR gets the same scrutiny for clarity and correctness as any other.

### 18. Know what NOT to test
Tests cost time to write and maintain; spending them on the wrong things adds drag without adding safety. Don't test code with no logic, code you don't own, or internals you can reach through the public surface — those tests are pure maintenance with no bug-catching upside.

**Bad:** a test asserting a plain getter returns the field it was set to; a test re-verifying the standard library's `sort` works; a test reaching into a private method via reflection to assert an intermediate value.
**Good:** trust the language/framework and third-party libraries (test only *your* use of them at a boundary); test private logic *through* the public API that exercises it — and if a private piece is complex enough to deserve its own test, that's a signal to extract it into its own unit (`coding-best-practices` §12).
- **Don't test the framework or the language** — assume `map`, the ORM's basic persistence, and the HTTP router work; test the behavior *you* built on top.
- **Don't test implementation details through the back door** — no reflection into privates, no asserting on internal call order (§1). If it's worth testing directly, it's worth extracting.
- **Skip trivial, logic-free code** — getters/setters, pass-through delegators, pure config. Coverage tools will flag them red; that's fine (§4).

### 19. Untested legacy code gets characterization tests first
Every principle above assumes a seam exists. When you're asked to add tests to code that has none — the most common real starting condition — you can't write a spec, because nobody knows what the spec is. So pin what the code *currently does*, bugs included, before changing anything.

**Bad:** refactor the untested function first "to make it testable", then write tests against the refactored output — that pins the refactor's bugs as if they were the requirement, and you have no way to tell what you broke.
**Good:** run the existing code, capture its actual output for a spread of realistic inputs, and assert exactly that. Then create a seam (extract the part you're changing into something you can call directly), and only then write the real spec for the new behavior.
- **Name them so nobody mistakes them for requirements** — `characterizes_current_behavior_*`. A characterization test deliberately encodes wrong behavior; if it reads like a spec, someone will defend the bug.
- **This is the one case where a failing test might mean the test is right and the code is right** — a characterization test failing after an intentional behavior change is expected. Update it deliberately and say so. That is not a licence to weaken tests generally (§9).
