# Java anti-patterns

Read this whole file before writing or reviewing Java code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Java-specific traps.

## Contents

1. Deserializing untrusted data with `ObjectInputStream`
2. `==` on strings and boxed numbers
3. `equals` without `hashCode`
4. Streams from `Files.lines`, `Files.list` and `Files.walk` left open
5. Swallowing `InterruptedException`
6. `ThreadLocal` values never removed on pooled threads
7. Shared `SimpleDateFormat` and `java.util.Date`
8. Removing from a collection inside a for-each loop
9. Ignoring the result of an immutable operation
10. `new BigDecimal(double)`
11. `Optional` as a field or parameter, returned as `null`, or opened with `get()`
12. Mutable static state
13. Catching a checked exception and printing or dropping it
14. Calling overridable methods from a constructor
15. Raw types
16. String concatenation in a loop
17. Hand-written value classes and `instanceof` chains

## 1. Deserializing untrusted data with `ObjectInputStream`

**Avoid:** Calling `readObject()` on bytes that come from a network, a file a user can supply, a cache, or a message queue.
**Why:** Deserialization runs code from whatever classes are on the classpath, so a crafted stream can execute arbitrary code or exhaust memory before your cast ever runs.
**Instead:** Exchange data in a format without code execution (JSON, protobuf) mapped to explicit types; if Java serialization cannot be removed, install an allow-list `ObjectInputFilter`.

```java
// Bad
try (var in = new ObjectInputStream(request.getInputStream())) {
    Order order = (Order) in.readObject();
    process(order);
}
```

```java
// Good
Order order = objectMapper.readValue(request.getInputStream(), Order.class);
process(order);
```

**Caught by:** Error Prone `BanSerializableRead` (experimental)
**Since:** Java 9 for `ObjectInputFilter` (JEP 290)
**Source:** https://www.oracle.com/java/technologies/javase/seccodeguide.html

## 2. `==` on strings and boxed numbers

**Avoid:** Comparing `String`, `Integer`, `Long`, or other boxed values with `==` or `!=`.
**Why:** `==` compares references; it passes in tests because literals are interned and `Integer.valueOf` caches -128 to 127, then fails for runtime strings and larger numbers.
**Instead:** Use `equals` (constant first for strings), `Objects.equals` when either side can be `null`, or unbox to primitives.

```java
// Bad
if (status == "ACTIVE") { activate(); }
Integer requested = order.quantity();
Integer limit = 1000;
if (requested == limit) { stop(); }
```

```java
// Good
if ("ACTIVE".equals(status)) { activate(); }
Integer requested = order.quantity();
Integer limit = 1000;
if (Objects.equals(requested, limit)) { stop(); }
```

**Caught by:** Error Prone `ReferenceEquality` and `BoxedPrimitiveEquality`; SpotBugs `ES_COMPARING_STRINGS_WITH_EQ` and `RC_REF_COMPARISON`
**Source:** https://errorprone.info/bugpattern/BoxedPrimitiveEquality

## 3. `equals` without `hashCode`

**Avoid:** Overriding `equals` and keeping `Object.hashCode`.
**Why:** Equal objects must return equal hash codes; otherwise `HashMap`, `HashSet`, and `contains` miss objects that compare equal.
**Instead:** Use a `record` for value types, which derives both from the components; otherwise override both from the same fields.

```java
// Bad
final class Point {
    final int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
    @Override public boolean equals(Object o) {
        return o instanceof Point p && p.x == x && p.y == y;
    }
}
```

```java
// Good
record Point(int x, int y) {}
```

**Caught by:** Error Prone `EqualsHashCode` (error by default); SpotBugs `HE_EQUALS_NO_HASHCODE`
**Since:** Java 16 for records (JEP 395)
**Source:** https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html#hashCode()

## 4. Streams from `Files.lines`, `Files.list` and `Files.walk` left open

**Avoid:** Using a stream that wraps an open file or directory handle in a single expression without closing it.
**Why:** These streams hold an OS handle that the garbage collector does not release promptly, so a service leaks file descriptors until it fails with "too many open files".
**Instead:** Open every `AutoCloseable`, including these streams, in try-with-resources.

```java
// Bad
long errors = Files.lines(logFile).filter(line -> line.startsWith("ERROR")).count();
```

```java
// Good
try (Stream<String> lines = Files.lines(logFile)) {
    return lines.filter(line -> line.startsWith("ERROR")).count();
}
```

**Caught by:** Error Prone `StreamResourceLeak`
**Since:** Java 7 for try-with-resources
**Source:** https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)

## 5. Swallowing `InterruptedException`

**Avoid:** Catching `InterruptedException` (directly or through `catch (Exception e)`) and only logging it.
**Why:** Throwing `InterruptedException` clears the thread's interrupt status, so after the catch nothing upstream knows a shutdown or cancellation was requested and the thread keeps working.
**Instead:** Declare `throws InterruptedException`, or restore the flag with `Thread.currentThread().interrupt()` and stop the current work.

```java
// Bad
try {
    Thread.sleep(backoff.toMillis());
} catch (InterruptedException e) {
    log.warn("interrupted during backoff", e);
}
```

```java
// Good
try {
    Thread.sleep(backoff.toMillis());
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

**Caught by:** Error Prone `InterruptedExceptionSwallowed` (experimental) for broad catches
**Source:** https://docs.oracle.com/javase/tutorial/essential/concurrency/interrupt.html

## 6. `ThreadLocal` values never removed on pooled threads

**Avoid:** Calling `ThreadLocal.set` in request or task code that runs on a thread pool without a matching `remove()`.
**Why:** Pool threads live for the whole process, so the value stays reachable and leaks into the next unrelated task on that thread, which can expose one user's data to another.
**Instead:** Pair every `set` with `remove()` in `finally`; on Java 25 and later prefer `ScopedValue.where(...).run(...)`, whose binding ends with the call.

```java
// Bad
void handle(Request request) {
    CURRENT_USER.set(authenticate(request));
    process(request);
}
```

```java
// Good
void handle(Request request) {
    CURRENT_USER.set(authenticate(request));
    try {
        process(request);
    } finally {
        CURRENT_USER.remove();
    }
}
```

**Caught by:** Error Prone `ThreadLocalUsage` for the related case of a `ThreadLocal` held in an instance field
**Since:** Java 25 for `ScopedValue` (JEP 506)
**Source:** https://openjdk.org/jeps/506

## 7. Shared `SimpleDateFormat` and `java.util.Date`

**Avoid:** Storing a `SimpleDateFormat` in a static field, and modeling dates and times with `Date` or `Calendar`.
**Why:** `SimpleDateFormat` is not synchronized, so concurrent use returns wrong dates or throws; `Date` is mutable and mixes an instant with time-zone-dependent display.
**Instead:** Use `java.time` types (`Instant`, `LocalDate`, `ZonedDateTime`) with an immutable, thread-safe `DateTimeFormatter`.

```java
// Bad
private static final SimpleDateFormat FORMAT = new SimpleDateFormat("yyyy-MM-dd");
String format(Date date) { return FORMAT.format(date); }
```

```java
// Good
private static final DateTimeFormatter FORMAT = DateTimeFormatter.ISO_LOCAL_DATE;
String format(LocalDate date) { return FORMAT.format(date); }
```

**Caught by:** Error Prone `DateFormatConstant` and `JavaUtilDate`; SpotBugs `STCAL_STATIC_SIMPLE_DATE_FORMAT_INSTANCE`
**Since:** Java 8 for `java.time`
**Source:** https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/text/SimpleDateFormat.html

## 8. Removing from a collection inside a for-each loop

**Avoid:** Calling `remove` or `add` on a collection while a for-each loop iterates over it.
**Why:** The iterator detects the change and throws `ConcurrentModificationException`, or the iteration behaves unpredictably and skips elements.
**Instead:** Use `removeIf`, an explicit `Iterator.remove()`, or build a new collection with a stream.

```java
// Bad
for (Order order : orders) {
    if (order.isCancelled()) {
        orders.remove(order);
    }
}
```

```java
// Good
orders.removeIf(Order::isCancelled);
```

**Caught by:** Error Prone `ModifyCollectionInEnhancedForLoop`
**Since:** Java 8 for `Collection.removeIf`
**Source:** https://errorprone.info/bugpattern/ModifyCollectionInEnhancedForLoop

## 9. Ignoring the result of an immutable operation

**Avoid:** Calling methods on immutable types (`String`, `BigDecimal`, `BigInteger`, `LocalDate`) as if they changed the receiver.
**Why:** They return a new value and leave the original untouched, so the code compiles, runs, and does nothing.
**Instead:** Assign or return the result.

```java
// Bad
name.trim();
total.add(tax);
```

```java
// Good
String trimmedName = name.trim();
BigDecimal grandTotal = total.add(tax);
```

**Caught by:** Error Prone `ReturnValueIgnored` (error by default, covers JDK methods such as `String.trim()`); SpotBugs `RV_RETURN_VALUE_IGNORED`
**Source:** https://errorprone.info/bugpattern/ReturnValueIgnored

## 10. `new BigDecimal(double)`

**Avoid:** Constructing a `BigDecimal` from a `double` literal or value.
**Why:** The constructor keeps the exact binary value of the double, so `new BigDecimal(0.1)` is `0.1000000000000000055511151231257827021181583404541015625` and money calculations drift.
**Instead:** Use `new BigDecimal("0.1")` or `BigDecimal.valueOf(double)`, or keep amounts in integer minor units.

```java
// Bad
BigDecimal rate = new BigDecimal(0.1);
```

```java
// Good
BigDecimal rate = new BigDecimal("0.1");
```

**Caught by:** Error Prone `BigDecimalLiteralDouble`; SpotBugs `DMI_BIGDECIMAL_CONSTRUCTED_FROM_DOUBLE`
**Source:** https://errorprone.info/bugpattern/BigDecimalLiteralDouble

## 11. `Optional` as a field or parameter, returned as `null`, or opened with `get()`

**Avoid:** `Optional` fields and parameters, methods that return `null` where the type is `Optional`, and `get()` without a presence check.
**Why:** `Optional` is designed as a return type; a `null` `Optional` reintroduces the `NullPointerException` it was meant to remove, and `get()` on an empty one throws `NoSuchElementException`.
**Instead:** Return `Optional.ofNullable(...)`, consume it with `map` / `orElse` / `orElseThrow`, and use a plain nullable field or an overload for optional inputs.

```java
// Bad
private Optional<String> nickname;
Optional<User> findUser(String id) { return users.containsKey(id) ? Optional.of(users.get(id)) : null; }
String name = findUser(id).get().name();
```

```java
// Good
private String nickname;
Optional<User> findUser(String id) { return Optional.ofNullable(users.get(id)); }
String name = findUser(id).map(User::name).orElse("guest");
```

**Caught by:** SpotBugs `NP_OPTIONAL_RETURN_NULL`; Error Prone `NullOptional` for a `null` passed as an `Optional` argument
**Since:** Java 8 for `Optional`; Java 10 for no-argument `orElseThrow()`
**Source:** https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Optional.html

## 12. Mutable static state

**Avoid:** `public static final` arrays or mutable collections presented as constants, and non-final `static` fields shared across threads.
**Why:** `final` only fixes the reference, so any caller can change the contents; a plain `static int` counter loses updates under concurrency and makes tests depend on order.
**Instead:** Expose unmodifiable collections (`List.of`, `Set.of`), make statics `final` and deeply immutable, and use atomic types for counters that must be shared.

```java
// Bad
public static final String[] SUPPORTED_LOCALES = {"en", "de"};
private static int requestCount;
```

```java
// Good
public static final List<String> SUPPORTED_LOCALES = List.of("en", "de");
private static final AtomicInteger REQUEST_COUNT = new AtomicInteger();
```

**Caught by:** Error Prone `MutablePublicArray`, and `NonFinalStaticField` (experimental); SpotBugs `MS_MUTABLE_ARRAY` and `MS_MUTABLE_COLLECTION`
**Since:** Java 9 for `List.of`
**Source:** https://errorprone.info/bugpattern/MutablePublicArray

## 13. Catching a checked exception and printing or dropping it

**Avoid:** `catch (IOException e) { e.printStackTrace(); }` or an empty catch that returns a fake value to satisfy the compiler.
**Why:** The program carries on with an empty or default result, the trace goes to stderr where production logging never sees it, and the caller cannot tell success from failure.
**Instead:** Declare the exception, handle it for real, or wrap it in an unchecked exception that keeps the cause, such as `UncheckedIOException`.

```java
// Bad
try {
    return Files.readString(path);
} catch (IOException e) {
    e.printStackTrace();
    return "";
}
```

```java
// Good
try {
    return Files.readString(path);
} catch (IOException e) {
    throw new UncheckedIOException("cannot read " + path, e);
}
```

**Caught by:** Error Prone `CatchAndPrintStackTrace` and `EmptyCatch`
**Since:** Java 8 for `UncheckedIOException`; Java 11 for `Files.readString`
**Source:** https://errorprone.info/bugpattern/CatchAndPrintStackTrace

## 14. Calling overridable methods from a constructor

**Avoid:** Calling a non-private, non-final, non-static method of `this` from a constructor.
**Why:** The superclass constructor runs before the subclass's fields are assigned, so an override sees `null` or zero fields and can throw or record wrong state.
**Instead:** Keep constructors to field assignment; call the overridable step after construction, or make the method `private` or `final`.

```java
// Bad
class Widget {
    Widget() { render(); }
    protected void render() {}
}
class Label extends Widget {
    private final String text;
    Label(String text) { this.text = text; }
    @Override protected void render() { System.out.println(text.length()); }
}
```

```java
// Good
class Widget {
    protected void render() {}
}
Label label = new Label("Total");
label.render();
```

**Caught by:** PMD `ConstructorCallsOverridableMethod`; SpotBugs `MC_OVERRIDABLE_METHOD_CALL_IN_CONSTRUCTOR`
**Source:** https://docs.pmd-code.org/latest/pmd_rules_java_errorprone.html#constructorcallsoverridablemethod

## 15. Raw types

**Avoid:** Using a generic type without type arguments, such as `List`, `Map`, or `Comparable`.
**Why:** The compiler stops checking element types, so a wrong element goes in silently and fails later with `ClassCastException` far from the insert.
**Instead:** Always supply type arguments, using the diamond `<>` on construction.

```java
// Bad
List names = new ArrayList();
names.add(42);
String first = (String) names.get(0);
```

```java
// Good
List<String> names = new ArrayList<>();
names.add("Ada");
String first = names.get(0);
```

**Caught by:** javac `-Xlint:rawtypes`
**Source:** https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.8

## 16. String concatenation in a loop

**Avoid:** Building a string with `+=` inside a loop.
**Why:** Each iteration copies the whole string built so far, so the loop is O(n²) in the output length; javac's concatenation optimization (JEP 280) applies to one expression, not across iterations.
**Instead:** Use `String.join`, `Collectors.joining`, or a `StringBuilder` created before the loop.

```java
// Bad
String csv = "";
for (String field : fields) {
    csv += field + ",";
}
```

```java
// Good
String csv = String.join(",", fields);
```

**Caught by:** SpotBugs `SBSC_USE_STRINGBUFFER_CONCATENATION`
**Source:** https://spotbugs.readthedocs.io/en/stable/bugDescriptions.html#sbsc-method-concatenates-strings-using-in-a-loop-sbsc-use-stringbuffer-concatenation

## 17. Hand-written value classes and `instanceof` chains

**Avoid:** Writing value classes with manual constructors, accessors, `equals` and `hashCode`, and dispatching over a closed set of types with `instanceof` and casts.
**Why:** The boilerplate drifts out of sync with the fields, and an `if`/`else` chain compiles even when a new subtype is added and never handled.
**Instead:** Model closed hierarchies as a `sealed` interface of `record`s and dispatch with a pattern-matching `switch`, which the compiler checks for exhaustiveness.

```java
// Bad
double area(Shape shape) {
    if (shape instanceof Circle) {
        Circle c = (Circle) shape;
        return Math.PI * c.radius() * c.radius();
    } else if (shape instanceof Square) {
        return ((Square) shape).side() * ((Square) shape).side();
    }
    throw new IllegalArgumentException("unknown shape");
}
```

```java
// Good
sealed interface Shape permits Circle, Square {}
record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}
double area(Shape shape) {
    return switch (shape) {
        case Circle c -> Math.PI * c.radius() * c.radius();
        case Square s -> s.side() * s.side();
    };
}
```

**Since:** Java 16 for records (JEP 395); Java 17 for sealed classes (JEP 409); Java 21 for pattern matching for `switch` (JEP 441)
**Source:** https://openjdk.org/jeps/441

## Sources

- https://www.oracle.com/java/technologies/javase/seccodeguide.html
- https://openjdk.org/jeps/290
- https://errorprone.info/bugpatterns
- https://errorprone.info/bugpattern/BoxedPrimitiveEquality
- https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Integer.html#valueOf(int)
- https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Object.html#hashCode()
- https://openjdk.org/jeps/395
- https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path)
- https://docs.oracle.com/javase/tutorial/essential/concurrency/interrupt.html
- https://openjdk.org/jeps/506
- https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/text/SimpleDateFormat.html
- https://errorprone.info/bugpattern/ModifyCollectionInEnhancedForLoop
- https://errorprone.info/bugpattern/ReturnValueIgnored
- https://errorprone.info/bugpattern/BigDecimalLiteralDouble
- https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Optional.html
- https://errorprone.info/bugpattern/MutablePublicArray
- https://errorprone.info/bugpattern/CatchAndPrintStackTrace
- https://docs.pmd-code.org/latest/pmd_rules_java_errorprone.html#constructorcallsoverridablemethod
- https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.8
- https://openjdk.org/jeps/280
- https://spotbugs.readthedocs.io/en/stable/bugDescriptions.html#sbsc-method-concatenates-strings-using-in-a-loop-sbsc-use-stringbuffer-concatenation
- https://openjdk.org/jeps/409
- https://openjdk.org/jeps/441
