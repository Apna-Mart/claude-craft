# Swift anti-patterns

Read this whole file before writing or reviewing Swift code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Swift-specific traps.

## Contents

1. Force-unwrapping optionals that can be nil
2. `try!` and `as!` on operations that can fail
3. `DispatchQueue.main.sync` called from the main thread
4. A checked continuation resumed twice or never
5. Silencing data-race checks with `@unchecked Sendable` or `nonisolated(unsafe)`
6. Strong `self` in stored or escaping closures
7. Strong delegate references
8. Target-selector `Timer` that retains its target
9. Block-based NotificationCenter observers that are never removed
10. Long-running `Task {}` that nobody owns or cancels
11. Async loops that ignore cancellation
12. Heavy synchronous work on the main actor
13. Codable models that fail on real payloads
14. Implicitly unwrapped optionals outside `@IBOutlet`
15. A class where a struct fits

## 1. Force-unwrapping optionals that can be nil

**Avoid:** Writing `!` on an optional whose `nil` case can actually happen, such as user input, `URL(string:)`, `first`, or a dictionary lookup.
**Why:** A `nil` at runtime traps and crashes the process, and the crash points at the unwrap, not at the reason the value was missing.
**Instead:** Unwrap with `guard let` or `if let`, give a default with `??`, or throw a typed error; keep `!` for states that only a programmer error can produce.

```swift
// Bad
let url = URL(string: userInput)!
let newest = orders.first!
```

```swift
// Good
guard let url = URL(string: userInput) else { throw InputError.invalidURL(userInput) }
guard let newest = orders.first else { throw OrderError.noOrders }
```

**Caught by:** SwiftLint `force_unwrapping` (opt-in)
**Source:** https://docs.swift.org/swift-book/documentation/the-swift-programming-language/thebasics#Force-Unwrapping

## 2. `try!` and `as!` on operations that can fail

**Avoid:** `try!` on a call that can throw at runtime, and `as!` on a value whose type comes from outside your code (JSON, `Any`, user info dictionaries).
**Why:** Both turn an expected failure into a crash; the error value or the real type is lost.
**Instead:** Propagate with `try`, handle with `do`/`catch`, and downcast with `as?` plus a guard.

```swift
// Bad
let data = try! Data(contentsOf: fileURL)
let user = json["user"] as! [String: Any]
```

```swift
// Good
let data = try Data(contentsOf: fileURL)
guard let user = json["user"] as? [String: Any] else { throw PayloadError.missingUser }
```

**Caught by:** SwiftLint `force_try` and `force_cast` (both on by default)
**Source:** https://docs.swift.org/swift-book/documentation/the-swift-programming-language/errorhandling#Disabling-Error-Propagation

## 3. `DispatchQueue.main.sync` called from the main thread

**Avoid:** Calling `DispatchQueue.main.sync` (or `sync` on any serial queue) from code that may already be running on that queue.
**Why:** Apple documents that calling `sync` and targeting the current queue deadlocks; current libdispatch usually detects this and crashes the app with a trap instead.
**Instead:** Mark main-thread work `@MainActor` and `await` it from other contexts; in callback-based code use `DispatchQueue.main.async`.

```swift
// Bad
func updateBadge(_ count: Int) {
    DispatchQueue.main.sync {
        badgeLabel.text = "\(count)"
    }
}
```

```swift
// Good
@MainActor
func updateBadge(_ count: Int) {
    badgeLabel.text = "\(count)"
}
```

**Source:** https://developer.apple.com/documentation/dispatch/dispatchqueue/sync(execute:)-3segw

## 4. A checked continuation resumed twice or never

**Avoid:** Wrapping a callback API in `withCheckedContinuation` / `withCheckedThrowingContinuation` with paths that resume more than once or not at all.
**Why:** Resuming twice is undefined behavior; never resuming leaves the awaiting task suspended forever and leaks everything it holds.
**Instead:** Resume exactly once on every path (an `if`/`else` that covers all cases, or `resume(with:)` on a `Result`); use `AsyncStream` for callbacks that fire repeatedly, and prefer the SDK's own `async` variant when one exists.

```swift
// Bad
try await withCheckedThrowingContinuation { continuation in
    client.fetchProfile { profile, error in
        if let error { continuation.resume(throwing: error) }
        if let profile { continuation.resume(returning: profile) }
    }
}
```

```swift
// Good
try await withCheckedThrowingContinuation { continuation in
    client.fetchProfile { profile, error in
        if let profile {
            continuation.resume(returning: profile)
        } else {
            continuation.resume(throwing: error ?? ProfileError.emptyResponse)
        }
    }
}
```

**Since:** Swift 5.5
**Source:** https://developer.apple.com/documentation/swift/checkedcontinuation

## 5. Silencing data-race checks with `@unchecked Sendable` or `nonisolated(unsafe)`

**Avoid:** Adding `@unchecked Sendable` or `nonisolated(unsafe)` to make a strict-concurrency error go away when the state is not actually protected.
**Why:** The compiler stops checking that type or variable entirely, so the data race the error reported is still there, now invisible.
**Instead:** Isolate the state in an `actor`, make it immutable, or guard it with `Mutex`; use the unchecked forms only around a real lock the compiler cannot see.

```swift
// Bad
final class ImageCache: @unchecked Sendable {
    private var images: [URL: Data] = [:]
    func insert(_ data: Data, for url: URL) { images[url] = data }
}
```

```swift
// Good
actor ImageCache {
    private var images: [URL: Data] = [:]
    func insert(_ data: Data, for url: URL) { images[url] = data }
}
```

**Since:** Swift 6.0 for the Swift 6 language mode and `Mutex` (Synchronization module, iOS 18 / macOS 15); Swift 5.10 for `nonisolated(unsafe)`
**Source:** https://www.swift.org/migration/documentation/swift-6-concurrency-migration-guide/dataracesafety

## 6. Strong `self` in stored or escaping closures

**Avoid:** Capturing `self` strongly in a closure that `self` stores, directly or through an object it owns.
**Why:** `self` holds the closure and the closure holds `self`, so neither is freed, `deinit` never runs, and callbacks keep firing on a dead screen.
**Instead:** Capture `[weak self]` and unwrap with `guard let self`; use `unowned` only when the closure provably cannot outlive `self`.

```swift
// Bad
func start() {
    service.onUpdate = { items in
        self.render(items)
    }
}
```

```swift
// Good
func start() {
    service.onUpdate = { [weak self] items in
        guard let self else { return }
        render(items)
    }
}
```

**Since:** Swift 5.7 for `guard let self` (SE-0345); Swift 5.8 for implicit `self` after that unwrap (SE-0365)
**Source:** https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting#Strong-Reference-Cycles-for-Closures

## 7. Strong delegate references

**Avoid:** Declaring a delegate property as a strong `var` and its protocol without an `AnyObject` constraint.
**Why:** The delegate usually owns the delegating object, so a strong back-reference forms a cycle that leaks both.
**Instead:** Constrain the protocol to `AnyObject` and declare the property `weak`.

```swift
// Bad
protocol PlayerDelegate {
    func playerDidFinish(_ player: Player)
}
final class Player {
    var delegate: PlayerDelegate?
}
```

```swift
// Good
protocol PlayerDelegate: AnyObject {
    func playerDidFinish(_ player: Player)
}
final class Player {
    weak var delegate: PlayerDelegate?
}
```

**Caught by:** SwiftLint `class_delegate_protocol` (on by default), `weak_delegate` (opt-in)
**Source:** https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting#Weak-References

## 8. Target-selector `Timer` that retains its target

**Avoid:** `Timer.scheduledTimer(timeInterval:target:selector:userInfo:repeats:)` with `target: self`, invalidated only in `deinit`.
**Why:** The timer holds a strong reference to its target until it is invalidated, so `deinit` never runs and the timer never stops.
**Instead:** Drive the repeat from a stored `Task` that holds `self` weakly and is cancelled from an explicit stop point.

```swift
// Bad
timer = Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
deinit { timer?.invalidate() }
```

```swift
// Good
tickTask = Task { [weak self] in
    while true {
        try await Task.sleep(for: .seconds(1))
        guard let self else { return }
        tick()
    }
}
func stop() { tickTask?.cancel() }
```

**Since:** iOS 16 / macOS 13 for `Task.sleep(for:)`
**Source:** https://developer.apple.com/documentation/foundation/timer/scheduledtimer(timeinterval:target:selector:userinfo:repeats:)

## 9. Block-based NotificationCenter observers that are never removed

**Avoid:** Calling `addObserver(forName:object:queue:using:)` and discarding the returned token, or capturing `self` strongly in its block.
**Why:** The center holds the token and the block until you remove the registration, so the observer keeps firing and keeps `self` alive.
**Instead:** Store the token, capture `[weak self]`, and remove it when observation ends; the block is `@Sendable`, so hop to main-actor state with `MainActor.assumeIsolated` when `queue` is `.main`.

```swift
// Bad
NotificationCenter.default.addObserver(forName: .userDidLogOut, object: nil, queue: .main) { _ in
    self.hide()
}
```

```swift
// Good
logoutObserver = NotificationCenter.default.addObserver(
    forName: .userDidLogOut, object: nil, queue: .main
) { [weak self] _ in
    MainActor.assumeIsolated { self?.hide() }
}

func stopObserving() {
    if let logoutObserver { NotificationCenter.default.removeObserver(logoutObserver) }
}
```

**Caught by:** SwiftLint `discarded_notification_center_observer` (opt-in)
**Since:** Swift 5.9 for `MainActor.assumeIsolated`
**Source:** https://developer.apple.com/documentation/foundation/notificationcenter/addobserver(forname:object:queue:using:)

## 10. Long-running `Task {}` that nobody owns or cancels

**Avoid:** Starting an unstructured `Task {}` that loops over an endless sequence (sockets, notifications, streams) without storing it, and throwing tasks whose errors nobody reads.
**Why:** A task runs whether or not you keep a reference; an endless one holds `self` forever and can never be cancelled, and a discarded throwing task drops its error silently.
**Instead:** Store the task, capture `self` weakly, cancel it when the owner stops; prefer structured `async let` or a task group when the work belongs to one call.

```swift
// Bad
func startListening() {
    Task {
        for await event in socket.events {
            handle(event)
        }
    }
}
```

```swift
// Good
func startListening() {
    listenTask = Task { [weak self, events = socket.events] in
        for await event in events {
            self?.handle(event)
        }
    }
}
func stopListening() { listenTask?.cancel() }
```

**Caught by:** SwiftLint `unhandled_throwing_task` (opt-in) for the dropped-error case
**Source:** https://developer.apple.com/documentation/swift/task

## 11. Async loops that ignore cancellation

**Avoid:** Long CPU-bound loops inside `async` functions that never check whether the task was cancelled.
**Why:** Swift cancellation is cooperative; a loop that never checks keeps burning CPU and memory after the user has left and the result is thrown away.
**Instead:** Call `try Task.checkCancellation()` (or read `Task.isCancelled`) at each iteration of long work.

```swift
// Bad
func thumbnails(for images: [CGImage]) async -> [CGImage] {
    images.map { downscale($0) }
}
```

```swift
// Good
func thumbnails(for images: [CGImage]) async throws -> [CGImage] {
    var result: [CGImage] = []
    for image in images {
        try Task.checkCancellation()
        result.append(downscale(image))
    }
    return result
}
```

**Source:** https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency#Task-Cancellation

## 12. Heavy synchronous work on the main actor

**Avoid:** Doing parsing, image processing, or file encoding inside a `@MainActor` method, or in a `Task {}` started from main-actor code, which inherits that isolation.
**Why:** Main-actor code runs on the main thread, so the work blocks UI events and frames for its whole duration.
**Instead:** Move the heavy part into a function that runs off the actor: `@concurrent` in Swift 6.2, or a `nonisolated` async function in earlier modes.

```swift
// Bad
@MainActor final class ReportViewModel {
    func export() async throws -> URL {
        try write(buildCSV(rows))
    }
}
```

```swift
// Good
@MainActor final class ReportViewModel {
    func export() async throws -> URL {
        try await Self.render(rows)
    }

    @concurrent
    private static func render(_ rows: [Row]) async throws -> URL {
        try write(buildCSV(rows))
    }
}
```

**Since:** Swift 6.2 for `@concurrent` (SE-0461); without the `NonisolatedNonsendingByDefault` feature a plain `nonisolated` async function already runs off the actor
**Source:** https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md

## 13. Codable models that fail on real payloads

**Avoid:** Declaring every field non-optional when the server may omit it, and decoding dates with the default `JSONDecoder` settings.
**Why:** One missing key throws `keyNotFound` for the whole object, and the default `.deferredToDate` strategy expects a number (seconds since 1 January 2001), so ISO 8601 strings fail with `typeMismatch`; wrapping the call in `try?` then hides why the data vanished.
**Instead:** Make fields the API can omit optional (or decode them with a default), set `dateDecodingStrategy` to match the wire format, and surface the `DecodingError`.

```swift
// Bad
struct Order: Decodable {
    let id: Int
    let note: String
    let createdAt: Date
}
let order = try? JSONDecoder().decode(Order.self, from: data)
```

```swift
// Good
struct Order: Decodable {
    let id: Int
    let note: String?
    let createdAt: Date
}
let decoder = JSONDecoder()
decoder.dateDecodingStrategy = .iso8601
let order = try decoder.decode(Order.self, from: data)
```

**Source:** https://developer.apple.com/documentation/foundation/jsondecoder/datedecodingstrategy-swift.property

## 14. Implicitly unwrapped optionals outside `@IBOutlet`

**Avoid:** Declaring properties as `Type!` to postpone initialization.
**Why:** Every read is a hidden force unwrap; if the setter was skipped the app crashes far from the cause.
**Instead:** Pass the value through `init` and store it as a non-optional `let`, or use a real optional and unwrap it.

```swift
// Bad
final class ProfileController {
    var user: User!
    func greeting() -> String { "Hi, \(user.name)" }
}
```

```swift
// Good
final class ProfileController {
    let user: User
    init(user: User) { self.user = user }
    func greeting() -> String { "Hi, \(user.name)" }
}
```

**Caught by:** SwiftLint `implicitly_unwrapped_optional` (opt-in)
**Source:** https://docs.swift.org/swift-book/documentation/the-swift-programming-language/thebasics#Implicitly-Unwrapped-Optionals

## 15. A class where a struct fits

**Avoid:** Modeling plain data (money, coordinates, settings, DTOs) as a `class`.
**Why:** Classes are shared references, so a "copy" that someone mutates changes every holder, and the type is not `Sendable` without extra work.
**Instead:** Use a `struct` by default; use a class only when you need identity, inheritance, or Objective-C interop.

```swift
// Bad
final class Money {
    var amount: Decimal
    init(amount: Decimal) { self.amount = amount }
}
let price = Money(amount: 10)
let discounted = price
discounted.amount -= 2
```

```swift
// Good
struct Money {
    var amount: Decimal
}
let price = Money(amount: 10)
var discounted = price
discounted.amount -= 2
```

**Source:** https://developer.apple.com/documentation/swift/choosing-between-structures-and-classes

## Sources

- https://docs.swift.org/swift-book/documentation/the-swift-programming-language/thebasics#Force-Unwrapping
- https://docs.swift.org/swift-book/documentation/the-swift-programming-language/errorhandling#Disabling-Error-Propagation
- https://developer.apple.com/documentation/dispatch/dispatchqueue/sync(execute:)-3segw
- https://developer.apple.com/documentation/swift/checkedcontinuation
- https://www.swift.org/migration/documentation/swift-6-concurrency-migration-guide/dataracesafety
- https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting#Strong-Reference-Cycles-for-Closures
- https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting#Weak-References
- https://developer.apple.com/documentation/foundation/timer/scheduledtimer(timeinterval:target:selector:userinfo:repeats:)
- https://developer.apple.com/documentation/foundation/notificationcenter/addobserver(forname:object:queue:using:)
- https://developer.apple.com/documentation/swift/task
- https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency#Task-Cancellation
- https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md
- https://developer.apple.com/documentation/foundation/jsondecoder/datedecodingstrategy-swift.property
- https://docs.swift.org/swift-book/documentation/the-swift-programming-language/thebasics#Implicitly-Unwrapped-Optionals
- https://developer.apple.com/documentation/swift/choosing-between-structures-and-classes
- https://realm.github.io/SwiftLint/rule-directory.html
