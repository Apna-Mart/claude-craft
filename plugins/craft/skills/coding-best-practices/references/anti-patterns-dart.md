# Dart anti-patterns

Read this whole file before writing or reviewing Dart code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Dart-specific traps. Flutter widget state shape belongs to `ui-state-best-practices` and rebuild or frame cost to `render-performance-best-practices`; this file covers the Dart language and the one Flutter trap that is a plain async bug.

## Contents

1. Null assertion `!` on a value that can be null
2. `late` used to dodge initialization
3. Futures that are never awaited
4. `async` callback passed to `forEach`
5. `BuildContext` used after an `await`
6. Stream subscriptions that are never cancelled
7. `catch` with no `on` clause
8. `dynamic` leaking from decoded JSON
9. Casting a decoded list straight to `List<String>`
10. Collection lookups with an unrelated type
11. Side effects and repeated work in lazy iterables
12. `==` without `hashCode`, or on a mutable class
13. Type-test chains where a sealed class fits
14. Awaiting independent futures one after another
15. `print` in production code
16. `Map<String, dynamic>` returned for several values

## 1. Null assertion `!` on a value that can be null

**Avoid:** forcing a nullable value with `!` when null is a reachable state.
**Why:** `!` throws at runtime ("Null check operator used on a null value"), which is the crash sound null safety exists to prevent.
**Instead:** handle null where it appears: copy to a local and test it, use `?.` and `??`, or match it with an `if-case` null-check pattern.

```dart
// Bad
String displayName(Map<String, User> cache, String id) {
  return cache[id]!.name;
}
```

```dart
// Good
String displayName(Map<String, User> cache, String id) {
  if (cache[id] case final user?) return user.name;
  return 'Unknown';
}
```

**Since:** Dart 3.0 (`if-case` patterns); Dart 3.2 promotes private final fields, so `_field!` after a null check is no longer needed there.
**Source:** https://dart.dev/null-safety/understanding-null-safety

## 2. `late` used to dodge initialization

**Avoid:** marking a field `late` because the analyzer complained, when nothing guarantees it is set before it is read.
**Why:** reading it too early throws `LateInitializationError` at runtime, and you cannot test whether a `late` variable has been set.
**Instead:** take the value in the constructor or initializer list; use a nullable field when "not set yet" is a real state.

```dart
// Bad
class ProfileLoader {
  late String token;
  Future<Profile> load(Api api) => api.fetchProfile(token);
}
```

```dart
// Good
class ProfileLoader {
  ProfileLoader(this.token);
  final String token;
  Future<Profile> load(Api api) => api.fetchProfile(token);
}
```

**Source:** https://dart.dev/effective-dart/usage

## 3. Futures that are never awaited

**Avoid:** calling a `Future`-returning function and dropping the result.
**Why:** the caller finishes before the work does, and a failure becomes an unhandled async error instead of reaching the caller's `try`.
**Instead:** `await` it; when fire-and-forget is truly intended, wrap it in `unawaited(...)` from `dart:async` so the intent is explicit.

```dart
// Bad
Future<void> save(Order order) async {
  repository.write(order);
  analytics.log('order_saved');
}
```

```dart
// Good
Future<void> save(Order order) async {
  await repository.write(order);
  unawaited(analytics.log('order_saved'));
}
```

**Caught by:** Dart lints `unawaited_futures` (inside `async` bodies) and `discarded_futures` (inside synchronous bodies)
**Since:** Dart 2.14 (`unawaited` in `dart:async`)
**Source:** https://dart.dev/tools/linter-rules/unawaited_futures

## 4. `async` callback passed to `forEach`

**Avoid:** `list.forEach((x) async { await ... })`.
**Why:** `forEach` takes a `void` callback, so it never waits; the code after it runs before any item is processed and errors are lost.
**Instead:** use a `for` loop with `await` for sequential work, or `Future.wait` when items can run in parallel.

```dart
// Bad
Future<void> uploadAll(List<File> files) async {
  files.forEach((file) async => await upload(file));
  markComplete();
}
```

```dart
// Good
Future<void> uploadAll(List<File> files) async {
  for (final file in files) {
    await upload(file);
  }
  markComplete();
}
```

**Caught by:** Dart lint `avoid_function_literals_in_foreach_calls`
**Source:** https://dart.dev/tools/linter-rules/avoid_function_literals_in_foreach_calls

## 5. `BuildContext` used after an `await`

**Avoid:** using a `BuildContext` (navigation, `Theme.of`, `ScaffoldMessenger.of`) after an `await` without checking that the widget is still mounted.
**Why:** if the user left the screen during the await, the context points at a disposed element and the call throws or acts on the wrong route.
**Instead:** check `context.mounted` (or `mounted` inside a `State`) right after the await and return if it is false.

```dart
// Bad
Future<void> onSave(BuildContext context, Draft draft) async {
  await repository.save(draft);
  Navigator.of(context).pop();
}
```

```dart
// Good
Future<void> onSave(BuildContext context, Draft draft) async {
  await repository.save(draft);
  if (!context.mounted) return;
  Navigator.of(context).pop();
}
```

**Caught by:** Dart lint `use_build_context_synchronously`
**Since:** Flutter 3.7 (`BuildContext.mounted`)
**Source:** https://dart.dev/tools/linter-rules/use_build_context_synchronously

## 6. Stream subscriptions that are never cancelled

**Avoid:** calling `stream.listen(...)` without keeping the `StreamSubscription`, or creating a `StreamController` that is never closed.
**Why:** the listener keeps its owner alive and keeps firing after the owner is gone, which leaks memory and runs callbacks on dead objects.
**Instead:** store the subscription and cancel it in the owner's teardown; close every controller you create.

```dart
// Bad
class PriceTicker {
  PriceTicker(Stream<double> prices) {
    prices.listen(_onPrice);
  }
  void _onPrice(double price) {}
}
```

```dart
// Good
class PriceTicker {
  PriceTicker(Stream<double> prices) {
    _subscription = prices.listen(_onPrice);
  }
  late final StreamSubscription<double> _subscription;
  void _onPrice(double price) {}
  Future<void> dispose() => _subscription.cancel();
}
```

**Caught by:** Dart lints `cancel_subscriptions` (a stored subscription that is never cancelled; an unstored `listen` is not reported) and `close_sinks` (controllers and sinks)
**Source:** https://dart.dev/tools/linter-rules/cancel_subscriptions

## 7. `catch` with no `on` clause

**Avoid:** bare `catch (e)` blocks, catching `Error` subtypes, and `throw e` to rethrow.
**Why:** a bare `catch` also traps `Error`s such as `TypeError` and `StateError`, which are bugs, and `throw e` resets the stack trace to the rethrow site.
**Instead:** catch the specific `Exception` type with `on`, and use `rethrow` when you pass an error on.

```dart
// Bad
try {
  return await api.fetchUser(id);
} catch (e) {
  return cachedUser(id);
}
```

```dart
// Good
try {
  return await api.fetchUser(id);
} on SocketException {
  return cachedUser(id);
}
```

**Caught by:** Dart lints `avoid_catches_without_on_clauses`, `avoid_catching_errors`, `use_rethrow_when_possible`
**Source:** https://dart.dev/effective-dart/usage

## 8. `dynamic` leaking from decoded JSON

**Avoid:** calling members on the `dynamic` result of `jsonDecode` and letting it flow into typed code.
**Why:** every call on `dynamic` skips static checking, so a renamed or missing key fails at runtime deep inside unrelated code.
**Instead:** turn the payload into typed values at the boundary, with a map pattern or explicit checks, and enable the strict analyzer modes.

```dart
// Bad
num orderTotal(String body) {
  final json = jsonDecode(body);
  return json['items'].length * json['price'];
}
```

```dart
// Good
num orderTotal(String body) {
  if (jsonDecode(body) case {'items': List<Object?> items, 'price': num price}) {
    return items.length * price;
  }
  throw const FormatException('Unexpected order payload');
}
```

**Caught by:** Dart lint `avoid_dynamic_calls`; analyzer language modes `strict-casts`, `strict-inference`, `strict-raw-types`
**Since:** Dart 3.0 (patterns)
**Source:** https://dart.dev/tools/analysis

## 9. Casting a decoded list straight to `List<String>`

**Avoid:** `json['tags'] as List<String>` on data from `jsonDecode`.
**Why:** the decoder builds a `List<dynamic>`, so the cast throws a `TypeError` even when every element is a string.
**Instead:** build a new typed list that checks each element, such as `List<String>.from(...)` or a collection-for with a per-element cast.

```dart
// Bad
List<String> readTags(Map<String, Object?> json) {
  return json['tags'] as List<String>;
}
```

```dart
// Good
List<String> readTags(Map<String, Object?> json) {
  return List<String>.from(json['tags'] as List);
}
```

**Source:** https://dart.dev/effective-dart/usage

## 10. Collection lookups with an unrelated type

**Avoid:** calling `contains`, `remove`, `indexOf` or `[]` with a value whose type can never match the collection's element or key type.
**Why:** these methods take `Object?`, so the code compiles and silently returns `false` or `null` every time.
**Instead:** pass a value of the element type; convert at the boundary, not at the lookup.

```dart
// Bad
bool isSelected(Set<int> selectedIds, Row row) {
  return selectedIds.contains(row.id.toString());
}
```

```dart
// Good
bool isSelected(Set<int> selectedIds, Row row) {
  return selectedIds.contains(row.id);
}
```

**Caught by:** Dart lint `collection_methods_unrelated_type`
**Since:** Dart 2.19 (lint)
**Source:** https://dart.dev/tools/linter-rules/collection_methods_unrelated_type

## 11. Side effects and repeated work in lazy iterables

**Avoid:** using `map` for side effects, or iterating a `where`/`map` result several times.
**Why:** `map` and `where` are lazy and uncached: an un-iterated `map` never runs, and each new iteration re-runs the callback for every element.
**Instead:** use a `for` loop or a tear-off with `forEach` for side effects, and call `.toList()` once when you need the result more than once.

```dart
// Bad
ids.map(cache.evict);
final visible = orders.where((order) => order.isVisible);
render(visible);
log('${visible.length} visible');
```

```dart
// Good
ids.forEach(cache.evict);
final visible = orders.where((order) => order.isVisible).toList();
render(visible);
log('${visible.length} visible');
```

**Source:** https://api.dart.dev/dart-core/Iterable/map.html

## 12. `==` without `hashCode`, or on a mutable class

**Avoid:** overriding `operator ==` without `hashCode`, or giving value equality to a class with mutable fields.
**Why:** equal objects with different hash codes break `Set` and `Map` lookups, and mutating a key after insertion makes it unfindable.
**Instead:** make the fields `final`, mark the class `@immutable` (from `package:meta`), override both members, and combine hashes with `Object.hash`; a record gets this for free.

```dart
// Bad
class Point {
  Point(this.x, this.y);
  int x, y;
  @override
  bool operator ==(Object other) => other is Point && other.x == x && other.y == y;
}
```

```dart
// Good
@immutable
class Point {
  const Point(this.x, this.y);
  final int x, y;
  @override
  bool operator ==(Object other) => other is Point && other.x == x && other.y == y;
  @override
  int get hashCode => Object.hash(x, y);
}
```

**Caught by:** Dart lints `hash_and_equals`, `avoid_equals_and_hash_code_on_mutable_classes` (reports `==` or `hashCode` on any class not annotated `@immutable`)
**Since:** Dart 2.14 (`Object.hash`)
**Source:** https://dart.dev/effective-dart/design

## 13. Type-test chains where a sealed class fits

**Avoid:** `if (x is A) ... else if (x is B) ...` chains that end in a `throw` for "unknown type".
**Why:** adding a subtype compiles cleanly and fails only at runtime, in every chain you forgot to update.
**Instead:** declare the family `sealed` and use an exhaustive `switch` expression with object patterns, so a new subtype is a compile error at each switch.

```dart
// Bad
String describe(Shape shape) {
  if (shape is Circle) return 'circle r=${shape.radius}';
  if (shape is Square) return 'square s=${shape.side}';
  throw ArgumentError('unknown shape');
}
```

```dart
// Good
sealed class Shape {}
final class Circle extends Shape { Circle(this.radius); final double radius; }
final class Square extends Shape { Square(this.side); final double side; }

String describe(Shape shape) => switch (shape) {
  Circle(:final radius) => 'circle r=$radius',
  Square(:final side) => 'square s=$side',
};
```

**Caught by:** Dart compiler errors `non_exhaustive_switch_expression` and `non_exhaustive_switch_statement`
**Since:** Dart 3.0
**Source:** https://dart.dev/language/class-modifiers

## 14. Awaiting independent futures one after another

**Avoid:** awaiting two or more unrelated futures in sequence.
**Why:** the second request starts only after the first finishes, so latency adds up for no reason.
**Instead:** start them together and await the record with `.wait` (or `Future.wait` for a list).

```dart
// Bad
final user = await fetchUser(id);
final orders = await fetchOrders(id);
```

```dart
// Good
final (user, orders) = await (fetchUser(id), fetchOrders(id)).wait;
```

**Since:** Dart 3.0 (`wait` on records of futures; failures surface as `ParallelWaitError`)
**Source:** https://api.dart.dev/dart-async/FutureRecord2/wait.html

## 15. `print` in production code

**Avoid:** `print` for diagnostics in shipped code.
**Why:** it cannot be filtered by level or source, carries no error or stack trace, and still writes to the device or server log in release builds, where it can expose user data.
**Instead:** use `log` from `dart:developer` or a logging package; in Flutter, `debugPrint` also prints in release builds, so wrap debug-only output in `if (kDebugMode)`.

```dart
// Bad
print('Payment failed for $userId: $error');
```

```dart
// Good
developer.log('Payment failed', name: 'payments', error: error, stackTrace: stackTrace);
```

**Caught by:** Dart lint `avoid_print`
**Source:** https://dart.dev/tools/linter-rules/avoid_print

## 16. `Map<String, dynamic>` returned for several values

**Avoid:** returning a `Map<String, dynamic>`, a `List`, or a one-off class just to hand back two or three values.
**Why:** map keys are unchecked strings and values are `dynamic`, so typos and wrong types show up only at runtime.
**Instead:** return a record with named fields and destructure it at the call site.

```dart
// Bad
Map<String, dynamic> parseRange(String input) {
  final parts = input.split('-');
  return {'start': int.parse(parts[0]), 'end': int.parse(parts[1])};
}
```

```dart
// Good
({int start, int end}) parseRange(String input) {
  final parts = input.split('-');
  return (start: int.parse(parts[0]), end: int.parse(parts[1]));
}

final (:start, :end) = parseRange('3-7');
```

**Since:** Dart 3.0
**Source:** https://dart.dev/language/records

## Sources

- https://dart.dev/null-safety/understanding-null-safety
- https://dart.dev/effective-dart/usage
- https://dart.dev/effective-dart/design
- https://dart.dev/tools/linter-rules/unawaited_futures
- https://dart.dev/tools/linter-rules/discarded_futures
- https://dart.dev/tools/linter-rules/avoid_function_literals_in_foreach_calls
- https://dart.dev/tools/linter-rules/use_build_context_synchronously
- https://docs.flutter.dev/release/release-notes/release-notes-3.7.0
- https://dart.dev/tools/linter-rules/cancel_subscriptions
- https://dart.dev/tools/linter-rules/close_sinks
- https://dart.dev/tools/analysis
- https://dart.dev/tools/linter-rules/collection_methods_unrelated_type
- https://dart.dev/tools/linter-rules/avoid_equals_and_hash_code_on_mutable_classes
- https://api.dart.dev/dart-core/Iterable/map.html
- https://dart.dev/language/class-modifiers
- https://dart.dev/tools/diagnostics/non_exhaustive_switch_expression
- https://api.dart.dev/dart-async/FutureRecord2/wait.html
- https://dart.dev/tools/linter-rules/avoid_print
- https://dart.dev/language/records
- https://github.com/dart-lang/sdk/blob/main/CHANGELOG.md
