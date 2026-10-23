# Case tables, simulation and screen sweeps (§20–§22)

**Currency stamp: 2026-10-06.** The full rules, Bad/Good pairs and details for parent Part 5, moved out of SKILL.md and then extended. Section numbers are the parent's, so `§N` citations elsewhere still point here.

## Contents

- 20. List every variable, then build the case table — no silent gaps
- 21. Simulate each case where it's cheapest — and keep app hooks debug-only
- 22. Sweep the screen: size, font, language, direction, theme — with screenshots

---

Parts 1–4 decide how each test looks. This part decides **which cases exist**, so "test this thoroughly" ends with evidence for every case instead of the ones that came to mind. Before building a case table, read `references/edge-cases.md` and `references/simulation.md` whole; before a screen sweep or a debug hook, read the platform file for the stack (Additional resources).

### 20. List every variable, then build the case table — no silent gaps
Most shipped bugs are a case nobody wrote down: the null name, the empty cart, font scale 2.0 on a 320dp phone. Memory doesn't scale; a table does. List every value the code reads and where it comes from, run each one through the checklist in `references/edge-cases.md`, and close every row as **covered** (a named test, screenshot or direct check), **ruled out** (by a type, a validation or a contract — name which), or **open question — asked** (no source for the expected value yet; say who was asked). An open question is reported, not passed: the row stays open until answered, and the report lists it. A row with none of these is an unflagged gap — the worst kind.

**Bad:** "added tests for the profile header" — three happy-path tests; nobody can tell whether a missing avatar, a 200-character name or Arabic text was ever considered.
**Good:** the table is the deliverable, with the proof column filled:
```
| # | Variable  | Case                 | Expected (source)                        | Must not happen        | Level      | Proof                        |
| 1 | user.name | null from the server | shows "Guest" (spec PROFILE-12)          | no crash, no blank row | unit       | UserParserTest › null name   |
| 2 | user.name | 200 chars, no spaces | ellipsis; avatar stays put (design file) | avatar pushed off      | screenshot | sw320dp × font 2.0, reviewed |
| 3 | user.name | null inside the UI   | ruled out: non-null after parsing (row 1) | —                     | —          | —                            |
| 4 | user.name | only spaces          | open question — asked product owner      | —                      | —          | — (open)                     |
```
- **Sources first, then values.** Server, user input, device settings, remote config and flags, clock and time zone, storage and cache, OS lifecycle, other services. Untyped data enters at these edges, so test absence and wrong types once at the boundary — not on every screen behind it.
- **Combine axes by risk, not by multiplication.** Each axis alone at its extremes, then the worst corners together (smallest width + largest font + longest language; right-to-left + long text); pairwise sampling when more is needed. State how many combinations you chose and why.
- **Every expected value names its source — never the code you just wrote.** The spec or ticket, the product's own words (labels, docs, error text), the previous version, a standard or law, or consistency with the rest of the product. With no source, the row is an **open question — asked**, not an assertion: ask the person who owns the answer instead of encoding a guess.
- **Add what must not happen.** Next to each expected result, the side effect that would make it wrong anyway: no second charge, no error toast, no navigation away, no stale value left on screen. Assert it too.

### 21. Simulate each case where it's cheapest — and keep app hooks debug-only
Every row needs a way to make its case happen on demand. Prefer, in order: a test with a fake (builder, in-memory fake, fake server, fixed clock) → a preview or screenshot test fed the same sample data → the running app through a debug-only override → the environment (device settings, network shaping). Keep one sample catalogue per model (`UserSamples.nullName`, `.longName`, `.rtlName`) and feed it to unit tests, previews, screenshot tests and the debug menu, so the cases can't drift apart.

**Bad:** `if (DEBUG && settings.forceEmpty) return []` inside the repository — debug logic in shipping code, easy to leave on, and the tests now cover a branch users never run.
**Good:** the repository depends on an `OrdersSource` interface; the debug build binds `FakeOrdersSource` (debug-only source folder or build flavour), chosen from a debug menu; the release build has neither the binding nor the class — and one check proves it: build the release artifact and search its class list (or the shrinker's mapping file, since obfuscation renames classes) for `FakeOrdersSource`, expecting zero hits, with the bundled release-check script (`simulation.md` §5).
- **This is §10's "no test-only branches" applied to the running app** — one seam swapped at app setup, never conditionals sprinkled through business logic.
- **Debug-only, without exception.** An override that fakes prices, login, permissions or server responses must not exist in a release build; per-platform mechanics and the release check are in `references/simulation.md` and the platform files.
- **Reset overrides between cases** — a persisted override (a forced flag left on) silently changes the next case.

### 22. Sweep the screen: size, font, language, direction, theme — with screenshots
Layout bugs live where text is long and space is short. Render every changed screen at the risky corners of the device grid and look at each image: smallest width with the largest font scale, a long pseudo-locale, right-to-left, a large window, and dark mode — crossed with the case-table states (loading, empty, error, longest content). Screenshot (golden) tests guard those images against future change; one sweep of the debug build on a device, simulator or browser proves the real thing.

**Bad:** one screenshot at the default phone size, default font, English — the overflow at font scale 2.0 on a 320dp phone ships.
**Good:** a parameterized screenshot test over the corner set (about 6–8 images per screen), goldens opened and reviewed before they are recorded, plus one pass over the debug build with the same settings applied through `adb`, `simctl` or browser emulation.
- **Freeze what varies** — clock, data, animations, network images, fonts — or screenshots flake (§7).
- **A screenshot shows that something changed, not that it's right.** Open and look at every new or changed image, and pair it with one assertion that means something (text not clipped, the main button still on screen).
- **A clipping check must be able to fail** (§9): make sure the renderer measures real text — a JVM renderer with faked graphics passes every layout check — and watch it go red once on the unfixed layout.
- **Use the screenshot tool the project already has**; the platform file names the default when there is none.
