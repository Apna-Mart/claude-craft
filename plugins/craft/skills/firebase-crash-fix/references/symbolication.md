# Making unreadable frames readable

Read this when the stack shows obfuscated names (`o.a.b(SourceFile:3)`), raw hex addresses,
`<redacted>`, or minified JavaScript. Those mean the build's symbols never reached Crashlytics.
Tracing them gives confident, wrong answers, so recover the real names first.

## Use the symbols of that exact build

Match the version **and** build number in the event, e.g. `5.8.0 (5080)`. Symbols from any other
build map names to the wrong code. Look in this order: the release's CI artifacts, the local
build output if it was built from the release tag, then ask the user.

| Platform | Symbols | Where they usually are | Command |
|---|---|---|---|
| Android (R8 / ProGuard) | `mapping.txt` | `app/build/outputs/mapping/<variant>/mapping.txt`, or the CI artifact for that release | `retrace mapping.txt stacktrace.txt` (in the Android SDK `cmdline-tools/<version>/bin/`) |
| iOS | the `.dSYM` | the Xcode archive for that build (Organizer → Show in Finder), or CI | `atos -arch arm64 -o <App>.dSYM/Contents/Resources/DWARF/<App> -l <load address> <address> ...` |
| Flutter (`--obfuscate`) | the `--split-debug-info` folder | wherever the release build wrote it, often CI | `flutter symbolize -i stacktrace.txt -d <dir>/app.<platform>-<arch>.symbols`, matching the event's OS and architecture: `arm64-v8a` → `app.android-arm64.symbols`, `armeabi-v7a` → `app.android-arm.symbols`, `x86_64` → `app.android-x64.symbols`, iOS → `app.ios-arm64.symbols` |
| React Native | the JS bundle's source map | the release build output or CI | `metro-symbolicate <bundle>.map < stacktrace.txt` |

For `atos`, the load address is the binary's image base from the crash's binary images section;
each frame address goes after it.

## If the symbols are gone

Say so plainly and stop tracing that variant. Other events in the same issue, from a build whose
symbols were uploaded, may still be readable — check other versions with
`list_events(appId, filter: { issueId, versionDisplayNames: [...] }, pageSize: 3)` before giving up.

## Stop it recurring

Mention, as a note and not as part of the crash fix, that each release should upload its
symbols: the Crashlytics Gradle plugin for `mapping.txt`, the dSYM upload run script for iOS,
and `firebase crashlytics:symbols:upload --app=<appId> <symbols dir>` for Flutter and native
symbols.
