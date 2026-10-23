# Android — case tables, sweeps and debug-only hooks

**Currency stamp: 2026-10-06.** Parent §20–§22 own the principles. This file is the Android mechanics: the device grid, setting it in tests and on a device, screenshot tools, fake servers and debug-only hooks. Commands were checked against developer.android.com and the Android source; verify library APIs against the installed version before relying on them.

## Contents

1. The device grid
2. Setting the grid on a device or emulator (`adb`)
3. Setting the grid in previews and tests
4. Screenshot tests: the default and the alternatives
5. Asserting text isn't clipped
6. Faking the server: MockWebServer
7. Debug-only hooks and the release check
8. Other cases to reach on a device
9. Traps

---

## 1. The device grid

| Axis | Values to cover | Why |
|---|---|---|
| Smallest width | 320dp, 360dp, 411dp, 600dp, 840dp+ | Resource qualifiers (`sw600dp`) switch layouts on the shortest side; 320dp is where text runs out of room |
| Window width class | compact < 600dp · medium 600–840dp · expanded 840–1200dp · large 1200–1600dp · extra-large ≥ 1600dp | Adaptive layouts branch on these classes; test each branch you implemented |
| Font scale | 0.85, 1.0, 1.3, 1.5, 2.0 | Android 14+ supports up to 200%, with non-linear scaling at large sizes |
| Display size | default and the largest setting | Changes density, so dp sizes shrink on the same screen |
| Language | English, `en-XA` (accented, longer, bracketed), `ar-XB` (right-to-left), and the app's longest real translation | Expansion and direction bugs |
| Theme | light, dark, dynamic color where used | Contrast and hard-coded colors |
| Orientation and posture | portrait, landscape, foldable half-open where supported | Insets and two-pane layouts |

**Default corner set per screen** (parent §20): sw320dp × font 2.0 × `en-XA`; `ar-XB`; 840dp+ landscape; dark × error state. Add the case-table states (empty, longest content) at sw320dp × font 2.0.

Pseudo-locales work only after enabling them in the debug build type:

```kotlin
android {
    buildTypes.getByName("debug") {
        isPseudoLocalesEnabled = true
    }
}
```

(Groovy: `debug { pseudoLocalesEnabled true }`.)

## 2. Setting the grid on a device or emulator (`adb`)

```bash
adb shell settings put system font_scale 2.0
adb shell settings put system font_scale 1.0

adb shell wm density 540
adb shell wm density reset
adb shell wm size 1080x1920
adb shell wm size reset

adb shell cmd uimode night yes
adb shell cmd uimode night no

adb shell cmd locale set-app-locales <package> --locales ar-XB
adb shell cmd locale set-app-locales <package>
```

- **Hitting a smallest width:** smallest width in dp = shortest side in pixels × 160 ÷ density. On a 1080-pixel-wide phone, `wm density 540` gives 320dp; `wm density 480` gives 360dp.
- `set-app-locales` (Android 13+) changes one app's language; leaving out `--locales` resets it to the system language. It takes a comma-separated list (`--locales en-XA,ar`).
- Turn animations off for stable screenshots: `adb shell settings put global window_animation_scale 0`, and the same for `transition_animation_scale` and `animator_duration_scale`. Gradle's `testOptions { animationsDisabled = true }` only affects instrumented runs started by Gradle, not runs from Android Studio.
- Capture: `adb exec-out screencap -p > shot.png`, then open the image and look at it.
- **Reset everything after the sweep** — a font scale of 2.0 left on the emulator changes every later test.

## 3. Setting the grid in previews and tests

**Compose previews** — the multipreview annotations come from `ui-tooling-preview` (check the installed version has them):

```kotlin
@PreviewFontScale
@PreviewScreenSizes
@PreviewLightDark
@Composable
fun ProfileHeaderPreview(@PreviewParameter(UserSampleProvider::class) user: User) {
    ProfileHeader(user)
}

class UserSampleProvider : PreviewParameterProvider<User> {
    override val values = sequenceOf(UserSamples.typical, UserSamples.longName, UserSamples.rtlName)
}
```

`@PreviewFontScale` covers 85% to 200%. `@PreviewDynamicColors` adds dynamic-color variants. The provider is the sample catalogue from `simulation.md` §2 — the same samples feed unit tests and the debug menu.

**Robolectric tests** set the device with qualifiers and the font scale at run time. Any test that measures text — clipping, ellipsis, wrapping, screenshots — needs native graphics: Robolectric's `LEGACY` graphics are no-op fakes, so a clipping assertion under them can never fail.

```kotlin
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w320dp-h640dp-night")
@Test fun header_longName_smallScreen_largeFont() {
    RuntimeEnvironment.setFontScale(2f)
    ...
}
```

## 4. Screenshot tests: the default and the alternatives

Use the tool the project already has. With none: **Paparazzi** — it renders on the JVM with no device and takes size and font scale per test. If the project already runs Robolectric tests, use **Roborazzi** instead so screenshots reuse that setup.

**Paparazzi** (`app.cash.paparazzi`):

```kotlin
@get:Rule val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5.copy(fontScale = 2f))

@Test fun profileHeader_longName() {
    paparazzi.snapshot { ProfileHeader(UserSamples.longName) }
}
```

Record goldens with `./gradlew recordPaparazziDebug`; check them with `./gradlew verifyPaparazziDebug`.

**Roborazzi** — device presets such as `@Config(qualifiers = RobolectricDeviceQualifiers.Pixel5)`, add `+night` for dark mode, and `RuntimeEnvironment.setFontScale(2f)` (from Robolectric) for text size. Tasks: `recordRoborazziDebug`, `compareRoborazziDebug`, `verifyRoborazziDebug`, `verifyAndRecordRoborazziDebug`.

**Compose Preview Screenshot Testing** (Google) turns previews marked `@PreviewTest` in a `screenshotTest` source set into screenshot tests. It is experimental: it needs `android.experimental.enableScreenshotTest=true` in `gradle.properties` and the matching `experimentalProperties` entry in the module. Record with `./gradlew updateDebugScreenshotTest`, check with `./gradlew validateDebugScreenshotTest`; goldens live in `src/screenshotTest<Variant>/reference`. Its setup depends on the Android Gradle Plugin version (a standalone plugin, or Gradle test suites); follow the setup page for the version in the project's build files.

For every tool: record only after opening each new image and confirming it is right, and commit goldens with the change that produced them.

## 5. Asserting text isn't clipped

Compose has no ready-made "no overflow" assertion. Read the text layout through semantics and assert what the design says:

```kotlin
val layouts = mutableListOf<TextLayoutResult>()
composeTestRule.onNodeWithTag("profileName")
    .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
assertFalse(layouts.single().hasVisualOverflow)
```

For text designed to cut off with an ellipsis, assert `isLineEllipsized(lastLine)` instead, so the test states the intended behavior. In Views, check `textView.layout.getEllipsisCount(line)` the same way.

Under Robolectric, run these with `@GraphicsMode(GraphicsMode.Mode.NATIVE)` (§3), and prove the check can fail once: render the longest sample with the fixed height still in place and watch it go red.

## 6. Faking the server: MockWebServer

Use the `mockwebserver3` package (artifact `com.squareup.okhttp3:mockwebserver3`):

```kotlin
server.enqueue(MockResponse.Builder().code(200).body(fixture("orders_empty.json")).build())
server.enqueue(MockResponse.Builder().code(200).body(fixture("orders_huge.json"))
    .throttleBody(1024, 1, TimeUnit.SECONDS).build())
server.enqueue(MockResponse.Builder().onResponseStart(SocketEffect.ShutdownConnection).build())
server.enqueue(MockResponse.Builder().code(503).addHeader("Retry-After", "30").build())
```

- Delays: `headersDelay(...)` and `bodyDelay(...)`. Failures: `onRequestStart`, `onRequestBody`, `onResponseStart`, `onResponseBody` or `onResponseEnd` with a `SocketEffect` — `CloseSocket(...)`, `ShutdownConnection`, `CloseStream(http2ErrorCode)` or `Stall`.
- If the project's tests already use the deprecated `okhttp3.mockwebserver` package (`setSocketPolicy(SocketPolicy...)`), stay on it in that module rather than mixing both.

## 7. Debug-only hooks and the release check

- Put the fake source, the debug menu screen and its dependency-injection binding in `src/debug/`. Put the real-only binding in `src/release/`, so `src/main/` never names the fake. Add a `mock` product flavour instead only when testers need a separately installable mock build next to the normal debug build.
- Register the debug menu activity in `src/debug/AndroidManifest.xml`; manifest merging adds it to debug builds only.
- Feed the debug menu from the same sample catalogue and fixture files the tests use (`simulation.md` §2).
- **Release check:** build the release variant, then run the bundled check on R8's mapping file (obfuscation renames classes inside the APK, so searching the APK alone can't fail); without shrinking, point it at the release APK instead:
  ```bash
  bash <skill-dir>/scripts/check-no-dev-artifacts.sh app/build/outputs/mapping/release/mapping.txt --text FakeOrdersSource
  ```
  Run `bash <skill-dir>/scripts/check-no-dev-artifacts.sh --self-test` first (works with no project). To prove it on a real build, bind the fake in `src/release/` once, confirm exit 1, then restore the real binding — a debug build has no `mapping.txt` and is no control. Then propose making it run every time, and make the change once the user agrees: copy the script into the repository and add a Gradle `Exec` task that runs it, with both `assembleRelease` and `bundleRelease` `finalizedBy` that task (store uploads usually come from `bundleRelease`), so a hit fails the release build (`simulation.md` §5).

## 8. Other cases to reach on a device

- Permissions: `adb shell pm revoke <package> android.permission.CAMERA`.
- Offline: `adb shell cmd connectivity airplane-mode enable` (and `disable`); Wi-Fi alone: `adb shell cmd wifi set-wifi-enabled disabled`.
- Slow links on an emulator: `adb emu network delay gprs` and `adb emu network speed gsm` (or exact values, `adb emu network speed 14.4 80`); `none` and `full` restore them.
- Process death: send the app to the background, then `adb shell am kill <package>`, then reopen it from recents — restored state must match what the user left.
- Insets and cut-outs: enable a display cut-out in Developer options, and test gesture versus three-button navigation.

## 9. Traps

- **Testing only the emulator's default 411dp phone.** Most real overflow shows up at sw320dp with font 1.5–2.0.
- **Hard-coded heights on text containers.** They clip Devanagari, Thai and large fonts first; a `font 2.0 × longest language` screenshot catches them.
- **`sp` versus `dp` mix-ups.** Text in `dp` ignores the user's font scale — an accessibility bug a font-scale screenshot reveals as "nothing changed".
- **Goldens recorded on different machines.** Fonts and rendering can differ between operating systems; record and verify in the same environment (usually CI).
