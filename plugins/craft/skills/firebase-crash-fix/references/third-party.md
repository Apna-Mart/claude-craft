# Crashes inside a third-party library

Read this when the crash happens inside a library. The goal is never to patch the library — it
is to learn what precondition the library assumes so you can satisfy it at **your** call site.
The first frame in your own code is still where the investigation starts.

## 1. Pin the exact version

The resolved version decides whether a known fix already exists, so read what the build
resolved, not the range in the manifest.

| Platform | Where the resolved version lives | Command |
|---|---|---|
| Android (Gradle) | the resolved dependency graph | `./gradlew :app:dependencyInsight --dependency <artifact> --configuration releaseRuntimeClasspath` |
| iOS (CocoaPods) | `Podfile.lock` | read the file |
| iOS (Swift Package Manager) | `Package.resolved` | read the file |
| Flutter | `pubspec.lock` | read the file |
| React Native | `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | `npm ls <pkg>`, `yarn why <pkg>` or `pnpm why <pkg>` — whichever the project uses |

Read it at the crashing release (`git show <tag>:<lockfile>`) when that differs from `main`.

Map the crashing package to a library: `com.google.android.gms.*` → Play Services,
`com.squareup.okhttp3.*` → OkHttp, `io.reactivex.*` → RxJava, `androidx.*` → Jetpack (report to
Google), `package:<name>/` → that pub package. Unknown prefix → search
`site:mvnrepository.com <package.prefix>`.

## 2. Read the source at that version — do not guess

**Local copies first.** No network, and it is the exact code you shipped.

```
~/.gradle/caches/modules-2/files-2.1/<group>/<artifact>/<version>/   # Android: *-sources.jar → unzip it
Pods/<PodName>/                                                       # iOS CocoaPods, inside the project
~/Library/Developer/Xcode/DerivedData/<Project>-*/SourcePackages/checkouts/<package>/   # iOS SPM
~/.pub-cache/hosted/pub.dev/<package>-<version>/lib/                  # Flutter
node_modules/<package>/                                               # React Native
```

**Then GitHub**, at the tag that matches your version — not `main`, which may already contain the
fix and mislead you.

**Then decompile**, only when no source exists:

```bash
jadx --deobf <library.aar|classes.dex>          # Android, readable Java/Kotlin
class-dump -H <Framework.framework/Framework>   # iOS Objective-C headers
nm -gU <binary> | grep <MethodName>             # iOS symbols
otool -tV <binary> | grep -A 30 <methodName>    # iOS disassembly
```

You are looking for three things: the precondition the crashing method asserts; whether the
crash is a missing guard on our side or a deliberate assertion inside the library; and which
public API we call that reaches that internal path.

## 3. Check whether it is already known

Search with the library name, your version and the exception, all in one message:

```
site:github.com <library> "<ExceptionType>" "<message fragment>"
github.com/<org>/<repo>/issues?q=<ExceptionType>
github.com/<org>/<repo>/releases        # and CHANGELOG.md — look for a fix after your version
site:stackoverflow.com <library> <ExceptionType>
```

For Google SDKs also check `issuetracker.google.com` and the migration guide for your version.

## 4. Choose the strategy

| Situation | Fix |
|---|---|
| Our call passes invalid state (null, wrong type, wrong lifecycle) | validate at our call site before calling in |
| Known library bug, fixed upstream | bump to the **minimum** version that contains the fix, with the package manager's own command; read the changelog between the two versions for breaking changes |
| Known library bug, no fix yet | guard our call site so the broken path cannot be reached; file or upvote upstream once the user confirms |
| Hardware or OS-specific (GPU out of memory, driver) | detect the condition; skip or degrade gracefully |
| Correct usage, no fix, negligible impact | document as won't-fix; mute in Crashlytics only after the user confirms |

## 5. Turn the reading into a change on our side

- The library asserts a non-null parameter → validate at our boundary, not in a catch block.
- The library has an internal state machine (open, closed, released) → call it only from
  states it accepts, and find what moves it to the bad state while we still use it.
- The library does synchronous I/O → call it from the right dispatcher or queue.
- The library needs initialization first → enforce that order before first use.
- The source shows a supported workaround API → adopt it.

Never patch decompiled output and ship it. The insight goes into our call sites.
