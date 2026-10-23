# iOS and macOS — case tables, sweeps and debug-only hooks

**Currency stamp: 2026-10-06.** Parent §20–§22 own the principles. This file is the Apple-platform mechanics: the device grid, setting it in previews, tests and the simulator, screenshot tests, faking the network, and debug-only hooks. `simctl` syntax was checked against `xcrun simctl help` on Xcode; library APIs against their source. Verify against the installed versions before relying on them.

## Contents

1. The device grid
2. Setting the grid on the simulator (`simctl` and launch arguments)
3. Setting the grid in previews and UI tests
4. Screenshot tests: swift-snapshot-testing
5. Faking the network and other sources
6. Debug-only hooks and the release check
7. Traps

---

## 1. The device grid

| Axis | Values to cover | Why |
|---|---|---|
| Width | the smallest supported iPhone (375-point SE class), a large Pro Max-class phone, iPad in Split View (compact width), iPad full screen (regular width) | Size classes switch layouts; the narrowest width runs out of room first |
| Dynamic Type | `large` (default), `extra-extra-extra-large`, `accessibility-extra-extra-extra-large` | The accessibility sizes are where fixed heights and single-line labels break |
| Language | the development language, Double-Length Pseudolanguage, Right-to-Left Pseudolanguage, Arabic or Hebrew, the longest real translation | Expansion and mirroring bugs |
| Appearance | light, dark, Increase Contrast | Hard-coded colors and low-contrast text |
| Orientation | portrait, landscape (and iPad multitasking sizes) | Safe areas and two-column layouts |

**Default corner set per screen** (parent §20): smallest iPhone × `accessibility-extra-extra-extra-large` × Double-Length; Right-to-Left; iPad Split View; dark × error state. Add the case-table states (empty, longest content) at the smallest width with the largest text.

## 2. Setting the grid on the simulator (`simctl` and launch arguments)

```bash
xcrun simctl ui booted content_size accessibility-extra-extra-extra-large
xcrun simctl ui booted content_size large
xcrun simctl ui booted appearance dark
xcrun simctl ui booted increase_contrast enabled
xcrun simctl status_bar booted override --time 9:41
xcrun simctl io booted screenshot shot.png
```

- `content_size` takes the standard sizes `extra-small` … `extra-extra-extra-large` and the accessibility sizes `accessibility-medium` … `accessibility-extra-extra-extra-large`, or `increment` / `decrement`.
- Language, region and direction go in as launch arguments — through `simctl launch` (arguments after the bundle identifier), the scheme's Arguments pane, or `XCUIApplication.launchArguments`:
  ```bash
  xcrun simctl launch booted <bundle-id> -AppleLanguages "(ar)" -AppleLocale ar_SA
  ```
  Force right-to-left on iOS with `-AppleTextDirection YES`; on macOS add both `-NSForceRightToLeftWritingDirection YES` and `-AppleTextDirection YES`. In a scheme or test plan, the App Language menu also offers pseudolanguages: Double-Length, Right-to-Left, Accented, Bounded String and Tall.
- Other cases on the simulator: `xcrun simctl privacy booted revoke photos <bundle-id>` (permissions), `xcrun simctl location booted set <lat>,<lon>` (location), `xcrun simctl push booted <bundle-id> payload.json` (notifications).
- **Reset everything after the sweep** (`content_size large`, `appearance light`, `increase_contrast disabled`, `status_bar booted clear`).

## 3. Setting the grid in previews and UI tests

**SwiftUI previews** — feed the sample catalogue (`simulation.md` §2) and vary the environment:

```swift
#Preview("Long name, AX5, right-to-left") {
    ProfileHeader(user: UserSamples.longName)
        .dynamicTypeSize(.accessibility5)
        .environment(\.layoutDirection, .rightToLeft)
        .preferredColorScheme(.dark)
}
```

The Xcode canvas also has a Variants button with Dynamic Type, color scheme and orientation variants — a fast visual sweep while building, not a regression guard.

**XCUITest** — set the case before launch:

```swift
let app = XCUIApplication()
app.launchArguments += ["-AppleLanguages", "(ar)", "-AppleLocale", "ar_SA", "-AppleTextDirection", "YES"]
app.launch()
```

Test plans can hold one configuration per language and region and run the same UI tests across all of them.

## 4. Screenshot tests: swift-snapshot-testing

Use the tool the project already has; with none, use **swift-snapshot-testing** (Point-Free).

```swift
func test_profileHeader_longName_largestText() {
    let vc = ProfileHeaderViewController(user: UserSamples.longName)
    assertSnapshot(of: vc, as: .image(on: .iPhoneSe, traits: UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge)))
}

func test_profileHeader_swiftUI_rightToLeft() {
    let view = ProfileHeader(user: UserSamples.rtlName)
    assertSnapshot(of: view, as: .image(layout: .device(config: .iPhone13), traits: UITraitCollection(layoutDirection: .rightToLeft)))
}
```

- `.image(on:traits:)` is for view controllers; SwiftUI views use `.image(layout: .device(config:), traits:)`; plain `UIView`s take `size:` and `traits:` without a device.
- Record with `withSnapshotTesting(record: .all) { ... }` (other modes: `.failed`, `.missing`, `.never`), not the deprecated `isRecording` flag.
- Record and verify on the same simulator model and OS version, usually in CI — rendering differs between them.
- Open every new or changed image before accepting it (parent §22).

## 5. Faking the network and other sources

- **In tests:** a `URLProtocol` subclass registered in `URLSessionConfiguration.protocolClasses` returns fixture data, status codes, delays and errors per request, without touching real networking code. Better still, fake your own API-client protocol (parent §3) and keep one `URLProtocol` integration test for the parsing layer.
- **Clock:** inject a `now` provider (a closure or protocol) instead of calling `Date()` inside logic.
- **On a device or simulator:** Network Link Conditioner (Settings → Developer on a device, or the Additional Tools for Xcode on a Mac) for slow and lossy links; airplane mode for offline.

## 6. Debug-only hooks and the release check

- Wrap the fake source, the debug menu and their wiring **whole** in `#if DEBUG … #endif`. Swift's `DEBUG` condition comes from the Debug configuration's active compilation conditions in a standard project.
- Swap at one seam — the composition root picks the fake or the real implementation; no `#if DEBUG` inside business logic (parent §10, §21).
- **Release check:** build the Release configuration and run the bundled check on the binary (or the exported `.ipa`), expecting exit 0:
  ```bash
  bash <skill-dir>/scripts/check-no-dev-artifacts.sh <path-to-Release-binary> --text FakeOrdersSource
  ```
  Swift keeps type names in its metadata, so this check can fail: on a Swift sample the script found the name in the debug binary (exit 1) and not in the optimized build without `DEBUG` (exit 0). Run `bash <skill-dir>/scripts/check-no-dev-artifacts.sh --self-test` first (works with no project); to prove it on a real build, build Release once with the fake's file temporarily outside `#if DEBUG`, confirm exit 1, then restore it. Then propose making it run on every Release build, and make the change once the user agrees: copy the script into the repository and add a Run Script build phase that runs it on `"$TARGET_BUILD_DIR/$EXECUTABLE_PATH"` for the Release configuration. With user script sandboxing on (the default in new projects), list the script and the binary as the phase's input files, or the sandbox blocks the read.

## 7. Traps

- **Fixed heights and `numberOfLines = 1` on labels.** They break first at the accessibility text sizes; the AX5 screenshot catches them.
- **Custom fonts that ignore Dynamic Type.** Use `UIFontMetrics` or `.font(.custom(_:size:relativeTo:))` so they scale; a largest-text screenshot shows when they don't.
- **Leading/trailing confused with left/right.** Hard-coded left/right constraints and `.left` text alignment don't mirror; the right-to-left run exposes them.
- **Snapshots recorded on a developer's Mac and verified in CI** with a different simulator or OS — failures that aren't bugs.
