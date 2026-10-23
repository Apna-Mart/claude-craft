# Simulation — making every case happen on demand

**Currency stamp: 2026-10-06.** Parent §21 owns the principle (cheapest place first, app hooks debug-only). This file is the mechanics: where each source gets faked, the shared sample catalogue, the debug-only hook pattern, and the check that proves hooks never reach a release build. Platform-specific commands live in the platform files. Verify a library API against the installed version before relying on it.

## Contents

1. Where to simulate, in order
2. One sample catalogue per model
3. Faking each source
4. Debug-only hooks in the running app
5. Proving hooks are absent from release
6. Traps

---

## 1. Where to simulate, in order

1. **A test with a fake.** Fastest and repeatable; covers logic, parsing and most error paths. Parent §3 governs which double to use — fakes of your own adapters, never doubles of vendor types.
2. **A preview or screenshot test fed sample data.** Covers layout for each state without running the app.
3. **The running debug build through an override.** Covers what tests can't: real navigation, real rendering on a device, lifecycle, the feel of a slow response. Manual, so it proves today's build but guards nothing tomorrow — pair it with a test.
4. **The environment.** Device settings, network shaping, revoked permissions, a proxy between the app and the server. Use it for the final sweep and for cases no seam reaches.

Pick the first place that can actually produce the case, and write down the place in the case table's Level column.

## 2. One sample catalogue per model

Write the edge values once, as named samples, and reuse them everywhere:

```
UserSamples.typical      UserSamples.nullName       UserSamples.longName (200 chars, no spaces)
UserSamples.rtlName      UserSamples.emojiName      UserSamples.unknownStatus
```

- **Unit tests** build inputs from it; **previews and screenshot tests** take it as a parameter list; **the debug menu** lists it so a person can pick a case on a device.
- One list means a new edge case added for a bug shows up in every layer at once, and the layers can't drift apart.
- **Where it lives:** test-only code for the tests (a shared test-fixtures module where the build supports one); a debug-only source folder when the debug menu uses it too. Never in shipping code.
- Fixture files (recorded JSON responses) follow the same rule: one folder of named responses per endpoint — `orders_empty.json`, `orders_huge.json`, `orders_unknown_status.json` — shared by the fake server in tests and the debug menu.

## 3. Faking each source

| Source | In tests | In the running debug build |
|---|---|---|
| Server or API | A fake of *your* adapter interface (parent §3). For the HTTP layer itself, a fake server: MockWebServer on Android, WireMock for JVM backend services, Mock Service Worker for web and Node. Recorded real responses, edited per case | A debug menu that picks a fixture per endpoint, or points the app at a local fake server |
| Clock and time zone | An injected clock (`java.time.Clock` on the JVM, or a small `now()` provider you own); the runner's fake timers (`frameworks.md`); Playwright's `page.clock` (`web.md`) | A debug clock offset and time-zone override behind the same provider |
| Randomness and IDs | An injected seed or generator | A fixed-seed switch |
| Remote config and feature flags | An in-memory fake behind your flag interface | A debug screen that overrides each flag, with a visible "overrides active" marker |
| Network conditions | A fake that delays or fails; MockWebServer throttling and socket effects (`android.md`); WireMock faults and Toxiproxy (`backend.md`) | Emulator or simulator network settings, browser throttling |
| Permissions | A fake permission checker | `adb shell pm revoke <package> <permission>`; `xcrun simctl privacy booted revoke <service> <bundle-id>` |
| Storage | In-memory database, temporary directory, a database file written by the previous app version | Debug actions: "reset data", "seed state: empty / huge / legacy" |
| Device settings | Size, font scale, locale and theme set in the test (platform files) | `adb`, `simctl`, browser emulation (platform files) |

## 4. Debug-only hooks in the running app

The shape is the same on every platform: **production code depends on an interface; the debug build supplies a fake implementation through one seam at app setup; the release build has no fake and no way to reach one.**

| Platform | Where the fake and its wiring live |
|---|---|
| Android | The `src/debug/` source set, holding the fake and its dependency-injection binding (`android.md`) |
| iOS and macOS | Files wrapped whole in `#if DEBUG` (`apple.md`) |
| Flutter | A separate entry point such as `lib/main_dev.dart` that wires the fakes; the release entry point never imports it (`flutter.md`) |
| React Native | A dev-only module loaded from the app entry under `__DEV__` (`react-native.md`) |
| Web | A dev-only module loaded behind the bundler's development flag; Mock Service Worker started only in development (`web.md`) |
| Backend | A test or local configuration profile that wires fake adapters; the production profile has none, and no request header or parameter can switch one on (`backend.md`) |

- **One seam, not scattered conditionals.** `if (DEBUG)` inside business logic is parent §10's test-only branch: it ships, it can be left on, and it tests code users never run.
- **Make overrides visible.** A banner or badge while any override is active stops a tester from filing a "bug" that is really a forced flag.
- **Reset between cases.** Persisted overrides change the next case silently; give the debug menu a "reset all overrides" action and use it.

## 5. Proving hooks are absent from release

Use the bundled script — run it, don't read it. `<skill-dir>` is this skill's folder; `SKILL.md` (Additional resources) gives its full path. The script copies the build — a folder, an archive or any single file — to a temporary folder, unpacks every archive in it, nested ones too (zip archives such as `.apk`, `.aab`, `.ipa`, `.zip`, `.jar`, `.aar`, `.war`, `.ear`; tar archives, plain or compressed with gzip, bzip2, xz or zstd, such as a `docker export`; `.7z`; a gzip-compressed single file), and searches the result for file names and strings that must never ship. It exits 0 clean, 1 found (each hit listed), 2 could not check (missing or empty build, nothing to search for, no `unzip`, an archive that won't unpack) — it never passes on what it couldn't read:

```bash
bash <skill-dir>/scripts/check-no-dev-artifacts.sh <release-build> --name mockServiceWorker.js --text FakeOrdersSource
```

**Prove it can fail, every time, in two steps:**

1. **Always, even with no project or toolchain:** run `bash <skill-dir>/scripts/check-no-dev-artifacts.sh --self-test`. It builds a clean folder, folders with a leaked file and a leaked string, and a leaky archive, and confirms the check passes, catches each leak, and refuses to pass on an empty or missing build. Quote its last line.
2. **When the release build can run:** run the check once on a **release** artifact with the fake forced in — bind the fake in the release wiring temporarily, or build the release configuration from the debug entry point — and confirm exit 1, then restore. A debug build is no control: it skips the release shrinking and obfuscation the real check runs against.

**Propose running it on every release build, not once** — a check someone has to remember is a check that stops running. The proposal: copy the script into the repository (`scripts/check-no-dev-artifacts.sh`) — a build can't see this skill's folder — and make it the last step of the release build, so a hit fails the build. It changes the user's build, so make the change when they agree or asked for a release gate. `android.md`, `apple.md` and `web.md` give the hook for those build tools; elsewhere, append it to the release build command.

What to point it at, per platform:

- **Android:** with code shrinking on, R8's mapping file — obfuscation renames classes inside the APK, so searching the APK alone can't fail: `--text FakeOrdersSource` against `<module>/build/outputs/mapping/<build-type>/mapping.txt`. Without shrinking, the release APK itself.
- **iOS and macOS:** the Release binary or the exported `.ipa`. Swift keeps type names in its metadata, so a class name is searchable: on a Swift sample, the debug build had the name and the optimized build without `DEBUG` did not.
- **Web:** the production output folder (`dist/`), with `--name mockServiceWorker.js` plus `--text` for the mocking library and a string unique to the debug panel.
- **Backend:** a test that starts the production configuration and asserts the real adapter is wired, not the fake; use the script too when the deployable is a folder or archive (a container's exported filesystem, a `.jar`).

## 6. Traps

- **A fake that drifts from the real thing.** Contract-test the boundary (parent §11) or refresh recorded fixtures from the real service on a schedule.
- **Fixtures copied from production.** Anonymize them; keep the shape, drop the person.
- **Simulating in the wrong layer.** A fake repository can't show a parsing bug; the fake server can. Fake at the layer whose behavior the case is about.
- **Overrides that survive an upgrade.** A debug flag stored in preferences can outlive the build that set it; clear overrides on version change.
