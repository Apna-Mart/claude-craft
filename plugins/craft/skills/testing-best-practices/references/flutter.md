# Flutter — case tables, sweeps and debug-only hooks

**Currency stamp: 2026-10-06.** Parent §20–§22 own the principles. This file is the Flutter mechanics: the device grid in widget tests, golden tests, faking sources, and debug-only entry points. APIs were checked against the Flutter source and docs.flutter.dev; verify against the installed SDK before relying on them.

## Contents

1. The device grid
2. Setting the grid in widget tests
3. Overflow fails the test for free — use it
4. Golden tests
5. Faking sources
6. Debug-only entry points and the release check
7. Traps

---

## 1. The device grid

| Axis | Values to cover |
|---|---|
| Logical width | 320, 360, 411, 600+, 840+ (logical pixels) — the narrowest phone and each layout breakpoint the app uses |
| Text scale | 1.0, 1.3, 2.0 (and the largest the platform allows if the app supports it) |
| Locale and direction | the default locale, the longest translation, a right-to-left locale (`ar`, `he`) |
| Brightness | light, dark |
| Orientation | portrait, landscape |

**Default corner set per screen** (parent §20): width 320 × text scale 2.0 × longest locale; right-to-left; width 840+ landscape; dark × error state — crossed with the case-table states.

## 2. Setting the grid in widget tests

```dart
testWidgets('profile header — long name, narrow, large text, right-to-left', (tester) async {
  tester.view.physicalSize = const Size(960, 1920);
  tester.view.devicePixelRatio = 3.0;
  tester.platformDispatcher.textScaleFactorTestValue = 2.0;
  tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);

  await tester.pumpWidget(testApp(locale: const Locale('ar'), child: ProfileHeader(user: UserSamples.longName)));

  expect(find.text(UserSamples.longName.name), findsOneWidget);
});
```

- Logical width = `physicalSize.width ÷ devicePixelRatio` — the example is 320 logical pixels wide.
- `testApp` is a small helper that wraps the widget in the app's real theme, localization delegates and `locale`, so direction and translations behave as in the app.
- Locale can also come from `tester.platformDispatcher.localeTestValue` / `localesTestValue` (reset with `clearLocaleTestValue` and `clearLocalesTestValue` respectively).
- Drive the sweep from data: loop over a list of corner configurations with one `testWidgets` per entry, so each failing corner has its own name (parent §5–§6).

## 3. Overflow fails the test for free — use it

A layout overflow ("A RenderFlex overflowed by N pixels") is reported as an error during a widget test, and the test fails. So a widget test at width 320 × text scale 2.0 with the longest sample **is** an overflow assertion — no screenshot needed for that case. Keep it as a normal test; add a golden only for what an error can't catch (wrong alignment, mirrored icons, clipped text that doesn't overflow a `Flex`).

## 4. Golden tests

```dart
await expectLater(find.byType(ProfileHeader), matchesGoldenFile('goldens/profile_header_long_name_ar_dark.png'));
```

- Create or update goldens with `flutter test --update-goldens`; a normal `flutter test` compares against them.
- Widget tests render text with a test font by default, so goldens show blocks instead of real glyphs. Load the app's fonts in the test setup (with `FontLoader`) when the golden must show real text.
- Rendering differs between operating systems; record and compare goldens on one platform, usually CI.
- Open every new or changed golden before committing it (parent §22).

## 5. Faking sources

- **Server:** fake your own repository or API-client interface (parent §3); for the HTTP layer, inject the HTTP client and give it a fake that returns fixture JSON per case (`simulation.md` §2).
- **Clock:** inject a `now` function or clock object; avoid `DateTime.now()` inside logic.
- **Platform channels** (plugins): wrap each plugin behind your own interface and fake that, instead of mocking the channel.
- **On a device:** the platform files apply to the host OS — `android.md` §2 and §8 for an Android device or emulator, `apple.md` §2 for the iOS simulator.

## 6. Debug-only entry points and the release check

- Give the debug build its own entry point, for example `lib/main_dev.dart`, that wires fake sources and the debug menu; run it with `flutter run -t lib/main_dev.dart`. The release entry point `lib/main.dart` never imports the debug files, so the compiler drops them.
- `kDebugMode` is a compile-time constant, so code behind it is removed from release builds — but keep it to the entry point, not inside business logic (parent §10, §21).
- **Release check:** build with `flutter build apk --analyze-size --target-platform=android-arm64` (size analysis needs a single target architecture; `appbundle`, `ios` and `macos` work the same way). It writes a new `*-code-size-analysis_NN.json` file on every run (the number goes up each time) that breaks the Dart code down by package and file, and prints its path on the line "A summary of your … analysis can be found at:". Run the bundled check on that exact path from this build — never a remembered file name, which would check an older build — expecting exit 0:
  ```bash
  bash <skill-dir>/scripts/check-no-dev-artifacts.sh <path-printed-by-this-build>.json --text fake_orders_source --text FakeOrdersSource
  ```
  Run `bash <skill-dir>/scripts/check-no-dev-artifacts.sh --self-test` first (works with no project). To prove it on a real build, run the same release build with `-t lib/main_dev.dart`, which forces the fakes in, and confirm exit 1 on the path that build prints.

## 7. Traps

- **Fixed `height` on containers holding text.** The first thing to clip at text scale 2.0; let content size itself or test the cap on purpose.
- **`EdgeInsets.only(left: …)` and `Alignment.centerLeft`.** They don't mirror; use the directional forms (`EdgeInsetsDirectional`, `AlignmentDirectional`) and check with a right-to-left test.
- **Forgetting to reset test values.** A text scale left at 2.0 leaks into later tests; always register the `addTearDown` resets.
