# Kotlin anti-patterns

Read this whole file before writing or reviewing Kotlin code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Kotlin-specific traps.

## Contents

1. The `!!` operator on values that can be null
2. Catching `CancellationException` in suspending code
3. `GlobalScope.launch` and `GlobalScope.async`
4. `runBlocking` outside `main` and tests
5. Blocking calls inside coroutines without a dispatcher switch
6. CPU loops in coroutines that never check cancellation
7. `Context` or `Activity` held in an `object` or `companion object`
8. Platform types leaking from Java into Kotlin
9. Read-modify-write on `MutableStateFlow.value`
10. Collecting a Flow in `lifecycleScope` without `repeatOnLifecycle`
11. `lateinit` for state that may never be set
12. `var` and array properties in data classes
13. An `else` branch in `when` over a sealed type or enum
14. Exposing mutable state from a class
15. Nested and chained scope functions

## 1. The `!!` operator on values that can be null

**Avoid:** Writing `!!` on a nullable value whose `null` case can actually happen: a lookup, a Java return value, a preference, an intent extra.
**Why:** It throws `NullPointerException` at runtime, which is exactly the crash Kotlin's type system exists to prevent, and the stack trace says nothing about why the value was missing.
**Instead:** Use `?:` with a default, an early `return`, or a typed exception; use `requireNotNull` / `checkNotNull` with a message when `null` truly is a bug.

```kotlin
// Bad
val user = repository.findUser(id)!!
val token = prefs.getString("token", null)!!
```

```kotlin
// Good
val user = repository.findUser(id) ?: throw UserNotFoundException(id)
val token = prefs.getString("token", null) ?: return AuthState.SignedOut
```

**Caught by:** detekt `UnsafeCallOnNullableType` (active by default), `MapGetWithNotNullAssertionOperator` for `map[key]!!`
**Source:** https://kotlinlang.org/docs/null-safety.html#not-null-assertion-operator

## 2. Catching `CancellationException` in suspending code

**Avoid:** `catch (e: Exception)`, `catch (e: Throwable)`, or `runCatching { }` around suspending calls without rethrowing `CancellationException`.
**Why:** Cancellation is delivered as a `CancellationException`; swallowing it lets a cancelled coroutine keep running, write state for a screen that is gone, and break structured concurrency.
**Instead:** Catch the specific exception types you can handle; if you must catch broadly, rethrow `CancellationException` first.

```kotlin
// Bad
suspend fun refresh() {
    try {
        feed = api.fetchFeed()
    } catch (e: Exception) {
        lastError = e
    }
}
```

```kotlin
// Good
suspend fun refresh() {
    try {
        feed = api.fetchFeed()
    } catch (e: IOException) {
        lastError = e
    }
}
```

**Caught by:** detekt `SuspendFunSwallowedCancellation` (not active by default) for `runCatching`, `TooGenericExceptionCaught` (active by default)
**Source:** https://kotlinlang.org/docs/coroutines-cancellation.html#cancel-coroutines

## 3. `GlobalScope.launch` and `GlobalScope.async`

**Avoid:** Launching work in `GlobalScope`, or replacing it with an ad hoc `CoroutineScope(...)` that nobody cancels.
**Why:** `GlobalScope` has no `Job`, so nothing cancels its coroutines when the caller goes away; they leak if they never finish, and an uncaught exception goes to the global handler, which crashes an Android app.
**Instead:** Make the function `suspend`, use `coroutineScope { }` for parallel work inside a call, or inject an application-lifetime `CoroutineScope` for work that must outlive the caller.

```kotlin
// Bad
fun onLogout() {
    GlobalScope.launch { analytics.flush() }
}
```

```kotlin
// Good
class SessionManager(private val appScope: CoroutineScope) {
    fun onLogout() {
        appScope.launch { analytics.flush() }
    }
}
```

**Caught by:** a compiler warning on `GlobalScope` (it is `@DelicateCoroutinesApi`) unless you opt in with `@OptIn(DelicateCoroutinesApi::class)`; detekt `GlobalCoroutineUsage` (not active by default)
**Source:** https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-global-scope/

## 4. `runBlocking` outside `main` and tests

**Avoid:** Calling `runBlocking` inside a suspend function, or on a UI or request-handling thread to "get the value now".
**Why:** It blocks the thread instead of suspending, which starves dispatcher threads, freezes the Android main thread into an ANR, and ignores the caller's coroutine context and cancellation.
**Instead:** Call the suspending function directly from suspending code; from non-suspending code, launch in an owned scope and deliver the result asynchronously.

```kotlin
// Bad
suspend fun loadConfiguration(): Config {
    val raw = runBlocking { fetchConfigurationData() }
    return parse(raw)
}
```

```kotlin
// Good
suspend fun loadConfiguration(): Config {
    val raw = fetchConfigurationData()
    return parse(raw)
}
```

**Source:** https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/run-blocking.html

## 5. Blocking calls inside coroutines without a dispatcher switch

**Avoid:** File, database, or blocking network calls in a `suspend` function that does not move off the caller's dispatcher, and `Thread.sleep` inside coroutines.
**Why:** `suspend` does not make a call non-blocking; called from `Dispatchers.Main` it freezes the UI, and `Thread.sleep` holds a dispatcher thread that other coroutines need.
**Instead:** Make each suspend function main-safe by wrapping blocking work in `withContext` on an injected I/O dispatcher, and use `delay` instead of `Thread.sleep`.

```kotlin
// Bad
suspend fun readReport(file: File): String {
    Thread.sleep(200)
    return file.readText()
}
```

```kotlin
// Good
class ReportReader(private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO) {
    suspend fun readReport(file: File): String = withContext(ioDispatcher) {
        delay(200)
        file.readText()
    }
}
```

**Caught by:** detekt `SleepInsteadOfDelay` (active by default)
**Source:** https://developer.android.com/kotlin/coroutines/coroutines-best-practices

## 6. CPU loops in coroutines that never check cancellation

**Avoid:** Long loops of non-suspending work inside a coroutine with no cancellation check.
**Why:** Coroutine cancellation is cooperative; a loop that never suspends or checks keeps running after its scope is cancelled, burning CPU for a result nobody will read.
**Instead:** Call `ensureActive()` (or check `isActive`) on each iteration of long work.

```kotlin
// Bad
suspend fun indexAll(files: List<File>) = withContext(defaultDispatcher) {
    files.forEach { index(it) }
}
```

```kotlin
// Good
suspend fun indexAll(files: List<File>) = withContext(defaultDispatcher) {
    files.forEach {
        ensureActive()
        index(it)
    }
}
```

**Source:** https://developer.android.com/kotlin/coroutines/coroutines-best-practices

## 7. `Context` or `Activity` held in an `object` or `companion object`

**Avoid:** Storing an `Activity`, `View`, `Fragment`, or any non-application `Context` in a singleton `object`, a `companion object`, or another static-lifetime holder.
**Why:** The static reference outlives the screen, so the whole view hierarchy stays in memory after rotation or navigation.
**Instead:** Inject only `applicationContext` into long-lived objects, and pass short-lived contexts as function parameters.

```kotlin
// Bad
object Analytics {
    lateinit var context: Context
}
Analytics.context = this
```

```kotlin
// Good
class Analytics(private val appContext: Context)
val analytics = Analytics(applicationContext)
```

**Caught by:** Android Lint `StaticFieldLeak`
**Source:** https://googlesamples.github.io/android-custom-lint-rules/checks/StaticFieldLeak.md.html

## 8. Platform types leaking from Java into Kotlin

**Avoid:** Using a Java return value (type `T!`) without deciding its nullability, especially in a public function whose return type is inferred.
**Why:** Kotlin relaxes null checks on platform types, so a `null` from Java throws `NullPointerException` at the use site or at an assignment far from the Java call.
**Instead:** Give platform values an explicit Kotlin type at the boundary, and annotate the Java side with JSpecify `@Nullable` / `@NullMarked` so the compiler checks it.

```kotlin
// Bad
fun nickname(user: JavaUser) = user.getNickname()
val length = nickname(user).length
```

```kotlin
// Good
fun nickname(user: JavaUser): String? = user.getNickname()
val length = nickname(user)?.length ?: 0
```

**Caught by:** detekt `HasPlatformType` (active by default, needs type resolution)
**Since:** Kotlin 2.1.0 reports JSpecify nullability mismatches as errors by default
**Source:** https://kotlinlang.org/docs/java-interop.html#null-safety-and-platform-types

## 9. Read-modify-write on `MutableStateFlow.value`

**Avoid:** Computing a new state from `_state.value` and assigning it back in two steps.
**Why:** Two coroutines can read the same old value and each write their own result, so one update is lost.
**Instead:** Use `update { }`, which applies the change atomically with compare-and-set and retries on contention.

```kotlin
// Bad
_state.value = _state.value.copy(count = _state.value.count + 1)
```

```kotlin
// Good
_state.update { it.copy(count = it.count + 1) }
```

**Since:** kotlinx.coroutines 1.5.1
**Source:** https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/update.html

## 10. Collecting a Flow in `lifecycleScope` without `repeatOnLifecycle`

**Avoid:** Calling `collect` directly inside `lifecycleScope.launch` in an Activity or Fragment, or using the deprecated `launchWhenStarted`.
**Why:** The collector keeps running while the app is in the background, so upstream producers (location, sockets, database queries) stay active and views that are not visible keep updating.
**Instead:** Wrap collection in `repeatOnLifecycle(Lifecycle.State.STARTED)`, which cancels it on stop and restarts it on start. Compose collection belongs to `ui-state-best-practices`.

```kotlin
// Bad
lifecycleScope.launch {
    viewModel.locations.collect { showOnMap(it) }
}
```

```kotlin
// Good
lifecycleScope.launch {
    repeatOnLifecycle(Lifecycle.State.STARTED) {
        viewModel.locations.collect { showOnMap(it) }
    }
}
```

**Since:** androidx.lifecycle 2.4.0 for `repeatOnLifecycle`; `launchWhenX` is deprecated since 2.6.0
**Source:** https://developer.android.com/kotlin/flow/stateflow-and-sharedflow

## 11. `lateinit` for state that may never be set

**Avoid:** `lateinit var` for values that are optional, or that callers must remember to set, followed by `::prop.isInitialized` checks.
**Why:** Reading it before assignment throws `UninitializedPropertyAccessException` at runtime, and `isInitialized` checks are null checks that the type system no longer tracks.
**Instead:** Require the value in the constructor, use `by lazy` for expensive derived values, or use a nullable type when absence is real.

```kotlin
// Bad
class CheckoutPresenter {
    lateinit var cart: Cart
    fun total(): Money = if (::cart.isInitialized) cart.total() else Money.ZERO
}
```

```kotlin
// Good
class CheckoutPresenter(private val cart: Cart) {
    fun total(): Money = cart.total()
}
```

**Caught by:** detekt `LateinitUsage` (not active by default)
**Source:** https://kotlinlang.org/docs/properties.html#late-initialized-properties-and-variables

## 12. `var` and array properties in data classes

**Avoid:** Declaring data class properties as `var`, or giving a data class an `Array` / `ByteArray` property.
**Why:** `equals` and `hashCode` are derived from the properties, so mutating one while the object sits in a `HashSet` or as a `HashMap` key makes it unfindable; array properties compare by reference, so two data objects with the same bytes are not equal.
**Instead:** Use `val` properties and `copy()` for changes, and hold `List` instead of arrays (or override `equals` / `hashCode` with `contentEquals` / `contentHashCode`).

```kotlin
// Bad
data class Tag(var name: String)
val tags = hashSetOf(Tag("kotlin"))
tags.first().name = "java"
```

```kotlin
// Good
data class Tag(val name: String)
val tag = Tag("kotlin")
val renamed = tag.copy(name = "java")
```

**Caught by:** detekt `DataClassShouldBeImmutable` (not active by default)
**Source:** https://kotlinlang.org/docs/data-classes.html#copying

## 13. An `else` branch in `when` over a sealed type or enum

**Avoid:** Adding `else ->` to a `when` over a sealed class, sealed interface, or enum, and modeling variants that carry different data as an enum plus nullable fields.
**Why:** `else` turns off the exhaustiveness check, so a new subtype silently falls into the default branch instead of failing compilation at every place that must handle it.
**Instead:** Model variants as a sealed interface with one subtype per case, and list every case in `when` without `else`.

```kotlin
// Bad
fun label(state: Upload): String = when (state) {
    is Upload.Done -> "Done"
    else -> "Working"
}
```

```kotlin
// Good
fun label(state: Upload): String = when (state) {
    is Upload.Uploading -> "Uploading ${state.progress}%"
    is Upload.Done -> "Done"
    is Upload.Failed -> "Failed: ${state.reason}"
}
```

**Caught by:** detekt `ElseCaseInsteadOfExhaustiveWhen` (not active by default, needs type resolution)
**Since:** Kotlin 1.7.0 makes non-exhaustive `when` statements over sealed, enum, and Boolean subjects a compile error
**Source:** https://kotlinlang.org/docs/sealed-classes.html#use-sealed-classes-with-when-expression

## 14. Exposing mutable state from a class

**Avoid:** Public `MutableStateFlow`, `MutableList`, or `var` properties holding mutable collections.
**Why:** Any caller can change the state, so updates no longer go through the owning class, invariants break, and a `var` plus a mutable collection gives two ways to mutate the same thing.
**Instead:** Keep the mutable form in a private backing property and expose a read-only type (`StateFlow` via `asStateFlow()`, `List`).

```kotlin
// Bad
class SessionRepository {
    val session = MutableStateFlow<Session?>(null)
    var recentUsers = mutableListOf<User>()
}
```

```kotlin
// Good
class SessionRepository {
    private val _session = MutableStateFlow<Session?>(null)
    val session: StateFlow<Session?> = _session.asStateFlow()
    private val _recentUsers = mutableListOf<User>()
    val recentUsers: List<User> get() = _recentUsers.toList()
}
```

**Caught by:** detekt `DoubleMutabilityForCollection` (active by default) for a `var` holding a mutable collection
**Source:** https://kotlinlang.org/docs/coding-conventions.html#names-for-backing-properties

## 15. Nested and chained scope functions

**Avoid:** Nesting `let`, `run`, `apply`, `also`, and `with` inside each other, or chaining several on one expression.
**Why:** `it` and `this` change meaning at every level, so readers lose track of which object each line touches and bugs hide in the wrong receiver.
**Instead:** Use safe calls with an early `return`, and named local values.

```kotlin
// Bad
user?.let { u ->
    u.address?.let { address ->
        address.city.also { log(it) }.run { format(this) }
    }
}
```

```kotlin
// Good
val city = user?.address?.city ?: return
log(city)
format(city)
```

**Caught by:** detekt `NestedScopeFunctions` (not active by default)
**Source:** https://kotlinlang.org/docs/scope-functions.html

## Sources

- https://kotlinlang.org/docs/null-safety.html#not-null-assertion-operator
- https://kotlinlang.org/docs/coroutines-cancellation.html#cancel-coroutines
- https://developer.android.com/kotlin/coroutines/coroutines-best-practices
- https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-global-scope/
- https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/run-blocking.html
- https://googlesamples.github.io/android-custom-lint-rules/checks/StaticFieldLeak.md.html
- https://kotlinlang.org/docs/java-interop.html#null-safety-and-platform-types
- https://kotlinlang.org/docs/whatsnew21.html
- https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/update.html
- https://github.com/Kotlin/kotlinx.coroutines/releases/tag/1.5.1
- https://developer.android.com/kotlin/flow/stateflow-and-sharedflow
- https://developer.android.com/jetpack/androidx/releases/lifecycle
- https://kotlinlang.org/docs/properties.html#late-initialized-properties-and-variables
- https://kotlinlang.org/docs/data-classes.html#copying
- https://kotlinlang.org/docs/arrays.html
- https://kotlinlang.org/docs/sealed-classes.html#use-sealed-classes-with-when-expression
- https://kotlinlang.org/docs/compatibility-guide-17.html
- https://kotlinlang.org/docs/coding-conventions.html#names-for-backing-properties
- https://kotlinlang.org/docs/scope-functions.html
- https://detekt.dev/docs/rules/coroutines
- https://detekt.dev/docs/rules/potential-bugs
