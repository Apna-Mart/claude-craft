# React Native — case tables, sweeps and debug-only hooks

**Currency stamp: 2026-10-06.** Parent §20–§22 own the principles. This file is the React Native mechanics. The component layer follows the Testing Library rules in `e2e.md` — React Native Testing Library uses the same `getBy*` / `findBy*` / `queryBy*` queries and waiting model; device settings follow the host platform (`android.md`, `apple.md`). Verify APIs against the installed versions before relying on them.

## Contents

1. What each layer can and can't show
2. The device grid
3. Font scale and window size
4. Right-to-left
5. Screenshots on a device
6. Faking sources
7. Dev-only hooks and the release check
8. Traps

---

## 1. What each layer can and can't show

- **Jest with React Native Testing Library** renders components without a real layout engine. It proves logic, state and what text is shown for each case-table row — but it **cannot** show clipping, overflow or wrapping. A Jest snapshot of the render tree is not an image.
- **Layout cases** (font scale, narrow width, long text, right-to-left) need a device, emulator or simulator: an end-to-end tool taking screenshots (§5), or a manual sweep of the debug build.

So the case table's Level column splits cleanly: content and logic rows → Jest; layout rows → device screenshots.

## 2. The device grid

Use the host platform's grid: `android.md` §1 (smallest width 320dp, font scale up to 2.0, pseudo-locales) and `apple.md` §1 (smallest iPhone, accessibility text sizes, pseudolanguages). Same corner set per screen.

## 3. Font scale and window size

- `Text` respects the user's font setting by default (`allowFontScaling` is `true`). `maxFontSizeMultiplier` caps how far one piece of text can grow — use it deliberately on space-critical labels, never as a blanket fix.
- `PixelRatio.getFontScale()` returns the current font scale; `useWindowDimensions()` returns the current window size. Read them through a small hook you own so tests can pass fixed values.
- On a device: set font scale and size with `adb` (`android.md` §2) or `simctl ui … content_size` (`apple.md` §2).

## 4. Right-to-left

`I18nManager.forceRTL(true)` (with `I18nManager.allowRTL(true)`) switches layout direction after the app reloads. Put the switch in the debug menu (§7) and run the right-to-left corner of the sweep after a reload. Use `start`/`end` style properties instead of `left`/`right` so layouts mirror.

## 5. Screenshots on a device

Use the end-to-end tool the project already has. With none: **Maestro** — a `takeScreenshot` step in a flow, no test code in the app. If the project already runs Detox, use `await device.takeScreenshot('profile-long-name-font2')` inside its tests. Either way, set the device's font scale and language first.
- Compare images against reviewed goldens with an image-diff step in CI, and open every new or changed image before accepting it (parent §22). Freeze clock, data and animations first (parent §7).

## 6. Faking sources

- Fake your own API-client module (parent §3) and feed it the sample catalogue (`simulation.md` §2).
- For the HTTP layer in Jest, use Mock Service Worker's `setupServer` from `msw/node` with handlers per case (`web.md` §5 shows the handler shape).
- Clock: inject a `now` function; Jest's fake timers for timers (`frameworks.md`).

## 7. Dev-only hooks and the release check

- Load the debug menu and fake sources from the app entry under `__DEV__`, through one seam that picks the fake or real implementation:
  ```js
  const ordersSource = __DEV__ ? require('./debug/FakeOrdersSource').default : RealOrdersSource;
  ```
  `__DEV__` is `false` in release bundles, so the bundler drops the branch — keep this to the entry point, never inside business logic (parent §10, §21).
- **Release check:** build the release app and run the bundled check on it, searching for a string that exists only in the debug module. It unpacks the APK and searches every file, including `assets/index.android.bundle`; with Hermes the bundle is bytecode, but string literals stay searchable:
  ```bash
  bash <skill-dir>/scripts/check-no-dev-artifacts.sh app-release.apk --text "debug-panel"
  ```
  Run `bash <skill-dir>/scripts/check-no-dev-artifacts.sh --self-test` first (works with no project). To prove it on a real build, build the release app once with the debug module required unconditionally, confirm exit 1, then restore the `__DEV__` seam.

## 8. Traps

- **Trusting Jest for layout.** A green Jest suite says nothing about clipping at font scale 2.0.
- **Blanket `allowFontScaling={false}`.** It hides the overflow and breaks accessibility; fix the layout instead.
- **Forgetting the reload after `forceRTL`.** Direction changes apply only after the app restarts.
