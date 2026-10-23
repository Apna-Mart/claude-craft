# Scala anti-patterns

Read this whole file before writing or reviewing Scala code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Scala-specific traps.

## Contents

1. `null` instead of `Option`
2. Partial calls: `Option.get`, `.head`, `.last`, `Try.get`, `.toInt`
3. Catching `Throwable` instead of a specific type or `NonFatal`
4. Blocking calls on the global `ExecutionContext`
5. `Await.result` in production code
6. Shared `var` or mutable collection updated from `Future`s
7. Discarded `Future` and other non-`Unit` statements
8. `return` inside a lambda
9. `isInstanceOf` / `asInstanceOf` instead of pattern matching
10. Universal `==` across unrelated types
11. Open hierarchies and `Enumeration` instead of sealed ADTs and `enum`
12. Mixed-type collections that infer `Any`
13. Non-final case classes extended by other classes
14. Assuming `Seq` accepts mutable collections in 2.13
15. Implicit conversions for API convenience
16. Pre-2.13 collection APIs: `JavaConverters` and `Stream`

## 1. `null` instead of `Option`

**Avoid:** Returning or storing `null` to mean "absent", and passing Java results that may be `null` straight into Scala code.
**Why:** The type says a value is always there, so callers skip the check and hit a `NullPointerException` far from the source.
**Instead:** Return `Option[T]`, and wrap nullable Java results once at the boundary with `Option(x)`.

```scala
// Bad
def findUser(id: Long): User = {
  val row = jdbc.lookup(id)
  if (row == null) null else User.from(row)
}
```

```scala
// Good
def findUser(id: Long): Option[User] =
  Option(jdbc.lookup(id)).map(User.from)
```

**Caught by:** WartRemover `Null`; Scala 3 `-Yexplicit-nulls` (experimental, makes reference types non-nullable)
**Source:** https://docs.scala-lang.org/scala3/book/fp-functional-error-handling.html

## 2. Partial calls: `Option.get`, `.head`, `.last`, `Try.get`, `.toInt`

**Avoid:** Methods that throw on the empty or invalid case: `Option.get`, `head`, `last`, `max`, `reduce` on collections that can be empty, `Try.get`, `String.toInt`.
**Why:** They compile as if the value is always there and throw `NoSuchElementException`, `UnsupportedOperationException` or `NumberFormatException` on the first empty or bad input.
**Instead:** Use the total versions (`headOption`, `lastOption`, `maxByOption`, `toIntOption`, `fold`, `getOrElse`) and pattern match or map over the result.

```scala
// Bad
val port = sys.env.get("PORT").get.toInt
val newest = events.sortBy(_.at).last
```

```scala
// Good
val port: Either[String, Int] =
  sys.env.get("PORT").toRight("PORT not set")
    .flatMap(_.toIntOption.toRight("PORT is not a number"))
val newest: Option[Event] = events.maxByOption(_.at)
```

**Caught by:** WartRemover `OptionPartial`, `IterableOps`, `TryPartial`
**Since:** Scala 2.13 (`toIntOption`, `maxByOption`)
**Source:** https://www.wartremover.org/doc/warts.html

## 3. Catching `Throwable` instead of a specific type or `NonFatal`

**Avoid:** `case e: Throwable =>` or an untyped `case e =>` in a `catch`.
**Why:** It also catches `OutOfMemoryError`, `StackOverflowError`, `InterruptedException` and the `ControlThrowable` used by `scala.util.control.Breaks`, so a dying JVM or a cancelled thread is treated as an ordinary failure.
**Instead:** Catch the specific exception you can handle; where a broad handler is truly needed (a top-level loop), use `case NonFatal(e) =>`.

```scala
// Bad
try loadConfig()
catch { case e: Throwable => defaultConfig }
```

```scala
// Good
try loadConfig()
catch { case _: java.io.IOException => defaultConfig }
```

**Caught by:** Scala 2 scalac warning "This catches all Throwables" (untyped `case e =>` only)
**Source:** https://www.scala-lang.org/api/current/scala/util/control/NonFatal$.html

## 4. Blocking calls on the global `ExecutionContext`

**Avoid:** Running JDBC calls, file I/O, `Thread.sleep` or blocking HTTP clients inside `Future { ... }` on `ExecutionContext.global`.
**Why:** The global pool is a `ForkJoinPool` sized to the CPU count; a few blocked threads starve every other `Future` in the application.
**Instead:** Run long blocking work on a dedicated `ExecutionContext`; for a rare short blocking call on the global pool, wrap it in `blocking { ... }`.

```scala
// Bad
import scala.concurrent.ExecutionContext.Implicits.global

def loadAll(ids: List[Long]): Future[List[Row]] =
  Future.traverse(ids)(id => Future(jdbc.query(id)))
```

```scala
// Good
implicit val dbEc: ExecutionContext =
  ExecutionContext.fromExecutor(Executors.newFixedThreadPool(16))

def loadAll(ids: List[Long]): Future[List[Row]] =
  Future.traverse(ids)(id => Future(jdbc.query(id)))
```

**Source:** https://docs.scala-lang.org/overviews/core/futures.html

## 5. `Await.result` in production code

**Avoid:** Calling `Await.result` or `Await.ready` inside request handlers, actors or library code, especially with `Duration.Inf`.
**Why:** It blocks a thread per call, can deadlock when the awaited `Future` needs the same pool, and with `Duration.Inf` hangs forever if the `Future` never completes.
**Instead:** Return the `Future` and compose with `map`, `flatMap` or a for-comprehension; block only at the program edge (`main`, tests).

```scala
// Bad
def handle(req: Request): Response = {
  val user = Await.result(userService.find(req.userId), Duration.Inf)
  Response.ok(user)
}
```

```scala
// Good
def handle(req: Request): Future[Response] =
  userService.find(req.userId).map(Response.ok)
```

**Source:** https://docs.scala-lang.org/overviews/core/futures.html

## 6. Shared `var` or mutable collection updated from `Future`s

**Avoid:** Closing over a `var` or a `mutable.ListBuffer`/`mutable.Map` and updating it from several `Future` bodies.
**Why:** The updates race, so counts come out low and buffers lose or corrupt elements, and nothing tells you when all updates are done.
**Instead:** Return results from each `Future` and combine them with `Future.traverse`/`Future.sequence`; if shared state is unavoidable, use `AtomicReference` or `TrieMap`.

```scala
// Bad
var processed = 0
val results = scala.collection.mutable.ListBuffer.empty[Result]
items.foreach { item =>
  Future {
    results += handle(item)
    processed += 1
  }
}
```

```scala
// Good
val results: Future[List[Result]] =
  Future.traverse(items)(item => Future(handle(item)))
val processed: Future[Int] = results.map(_.size)
```

**Caught by:** WartRemover `Var`, `MutableDataStructures`
**Source:** https://docs.scala-lang.org/scala3/book/fp-immutable-values.html

## 7. Discarded `Future` and other non-`Unit` statements

**Avoid:** Calling a method that returns a `Future`, `Either` or `Try` as a statement and dropping the result, including as the last line of a `Unit` method.
**Why:** The method returns before the work finishes, and a failed `Future` or a `Left` disappears without a trace.
**Instead:** Return the `Future` and sequence the steps with a for-comprehension, or handle the `Either`/`Try` explicitly.

```scala
// Bad
def register(user: User): Unit = {
  repo.save(user)
  mailer.sendWelcome(user)
}
```

```scala
// Good
def register(user: User): Future[Unit] =
  for {
    _ <- repo.save(user)
    _ <- mailer.sendWelcome(user)
  } yield ()
```

**Caught by:** scalac `-Wnonunit-statement` (Scala 2.13.9+ and Scala 3.3.1+) and `-Wvalue-discard`; WartRemover `NonUnitStatements`
**Source:** https://docs.scala-lang.org/scala3/reference/error-codes/E176.html

## 8. `return` inside a lambda

**Avoid:** Using `return` inside a closure passed to `foreach`, `map` or any higher-order function.
**Why:** It is a non-local return implemented by throwing an exception: a surrounding `catch` on `Throwable` swallows it, and if the lambda runs later (in a `Future`) it fails at runtime. Scala 3 deprecated it in 3.2.
**Instead:** Use a combinator (`find`, `exists`, `collectFirst`, `takeWhile`); when none fits, use `scala.util.boundary` and `break`.

```scala
// Bad
def firstNegative(xs: List[Int]): Option[Int] = {
  xs.foreach(x => if (x < 0) return Some(x))
  None
}
```

```scala
// Good
def firstNegative(xs: List[Int]): Option[Int] = xs.find(_ < 0)
```

**Caught by:** Scala 3.2+ deprecation warning; WartRemover `Return`
**Since:** Scala 3.3 (`scala.util.boundary`)
**Source:** https://docs.scala-lang.org/scala3/reference/dropped-features/nonlocal-returns.html

## 9. `isInstanceOf` / `asInstanceOf` instead of pattern matching

**Avoid:** Testing a type with `isInstanceOf` and then casting with `asInstanceOf`.
**Why:** The cast is unchecked against the test, a missing case throws `ClassCastException` at runtime, and the compiler cannot check exhaustiveness.
**Instead:** Pattern match on the type or the case-class extractor.

```scala
// Bad
def area(shape: Shape): Double =
  if (shape.isInstanceOf[Circle]) {
    val c = shape.asInstanceOf[Circle]
    math.Pi * c.r * c.r
  } else shape.asInstanceOf[Square].side * shape.asInstanceOf[Square].side
```

```scala
// Good
def area(shape: Shape): Double = shape match {
  case Circle(r)    => math.Pi * r * r
  case Square(side) => side * side
}
```

**Caught by:** WartRemover `IsInstanceOf`, `AsInstanceOf`
**Source:** https://docs.scala-lang.org/tour/pattern-matching.html

## 10. Universal `==` across unrelated types

**Avoid:** Comparing values of different types with `==`, such as a wrapper type against a raw `String`.
**Why:** Universal equality lets most pairs of types be compared, so the expression compiles and is always `false`; Scala 3 rejects only pairs where one side has its own `CanEqual` (such as `Int` or `Long`), and Scala 2 warns only in some cases.
**Instead:** In Scala 3 enable strict equality and derive `CanEqual` for your types, and compare like with like.

```scala
// Bad
final case class UserId(value: String)

def isAdmin(id: UserId): Boolean = id == "admin"
```

```scala
// Good
import scala.language.strictEquality

final case class UserId(value: String) derives CanEqual

val AdminId = UserId("admin")
def isAdmin(id: UserId): Boolean = id == AdminId
```

**Caught by:** Scala 3 `-language:strictEquality`; WartRemover `Equals`
**Since:** Scala 3.0
**Source:** https://docs.scala-lang.org/scala3/reference/contextual/multiversal-equality.html

## 11. Open hierarchies and `Enumeration` instead of sealed ADTs and `enum`

**Avoid:** A plain `trait` as the root of a closed set of cases, and `scala.Enumeration` for enumerated values.
**Why:** The compiler only checks match exhaustiveness on sealed types, so adding a case silently falls through to a `MatchError`; `Enumeration` values all share one erased type and rely on reflection.
**Instead:** Use a `sealed trait` with final case classes, or a Scala 3 `enum`.

```scala
// Bad
object Color extends Enumeration {
  val Red, Green, Blue = Value
}

trait Event
case class Created(id: Long) extends Event
case class Deleted(id: Long) extends Event
```

```scala
// Good
enum Color {
  case Red, Green, Blue
}

sealed trait Event
final case class Created(id: Long) extends Event
final case class Deleted(id: Long) extends Event
```

**Caught by:** WartRemover `Enumeration`; the compiler's exhaustivity warning (sealed types only)
**Since:** Scala 3.0 (`enum`)
**Source:** https://docs.scala-lang.org/scala3/reference/enums/adts.html

## 12. Mixed-type collections that infer `Any`

**Avoid:** Putting values of unrelated types into one collection or branch result and letting the compiler infer the element type.
**Why:** In Scala 2 `List(42, "alice", true)` is a `List[Any]`, so every use needs a cast and type errors move to runtime.
**Instead:** Model the record with a case class, or the alternatives with a sealed ADT or `Either`, and annotate the type you mean.

```scala
// Bad
val row = List(42, "alice", true)
val name = row(1).asInstanceOf[String]
```

```scala
// Good
final case class Row(id: Int, name: String, active: Boolean)

val row = Row(42, "alice", true)
val name = row.name
```

**Caught by:** Scala 2 scalac `-Xlint:infer-any`; WartRemover `Any`
**Source:** https://docs.scala-lang.org/overviews/compiler-options/index.html

## 13. Non-final case classes extended by other classes

**Avoid:** Leaving a case class open and extending it with a regular class that adds fields.
**Why:** The generated `equals`, `hashCode` and `copy` only know the parent's fields, so two subclass values with different extra fields compare equal and `copy` drops the extra fields.
**Instead:** Mark case classes `final` and use composition for the extra data.

```scala
// Bad
case class Money(amount: BigDecimal, currency: String)

class TaxedMoney(amount: BigDecimal, currency: String, val rate: BigDecimal)
  extends Money(amount, currency)
```

```scala
// Good
final case class Money(amount: BigDecimal, currency: String)

final case class TaxedMoney(money: Money, rate: BigDecimal)
```

**Caught by:** WartRemover `FinalCaseClass`
**Source:** https://www.wartremover.org/doc/warts.html

## 14. Assuming `Seq` accepts mutable collections in 2.13

**Avoid:** Writing or cross-building code that expects `scala.Seq` to accept an `ArrayBuffer` or `Array`, and "fixing" the compile error with `.toSeq` at every call.
**Why:** Since 2.13 `scala.Seq` is `immutable.Seq`, so mutable buffers no longer conform; scattered `.toSeq` calls copy the data each time.
**Instead:** Take `collection.Seq` when you only read the argument, take `immutable.Seq` (plain `Seq`) when you keep it, and convert once at the boundary.

```scala
// Bad
def total(xs: Seq[Int]): Int = xs.sum

val buf = scala.collection.mutable.ArrayBuffer(1, 2, 3)
total(buf.toSeq)
```

```scala
// Good
def total(xs: scala.collection.Seq[Int]): Int = xs.sum

val buf = scala.collection.mutable.ArrayBuffer(1, 2, 3)
total(buf)
```

**Since:** Scala 2.13
**Source:** https://docs.scala-lang.org/overviews/core/collections-migration-213.html

## 15. Implicit conversions for API convenience

**Avoid:** Defining implicit conversions (`implicit def` or `given Conversion`) so one type can be passed where another is expected.
**Why:** The conversion runs invisibly at call sites, hides failures (a throwing `toLong` inside it), and makes overload resolution and errors hard to follow.
**Instead:** Use an explicit method, or an extension method in Scala 3 (an `implicit class` in Scala 2), so the call site shows the conversion.

```scala
// Bad
import scala.language.implicitConversions

implicit def stringToUserId(s: String): UserId = UserId(s.toLong)

repo.find("42")
```

```scala
// Good
extension (s: String)
  def toUserId: Option[UserId] = s.toLongOption.map(UserId(_))

"42".toUserId.map(repo.find)
```

**Caught by:** WartRemover `ImplicitConversion`; scalac feature warning without `scala.language.implicitConversions` (at the `implicit def` definition; for a Scala 3 `given Conversion`, at each call site)
**Since:** Scala 3.0 (extension methods)
**Source:** https://docs.scala-lang.org/scala3/book/ca-implicit-conversions.html

## 16. Pre-2.13 collection APIs: `JavaConverters` and `Stream`

**Avoid:** `scala.collection.JavaConverters` and `Stream` in code built with Scala 2.13 or 3.
**Why:** Both are deprecated; `Stream` also evaluates its head eagerly, which surprises code that expects full laziness.
**Instead:** Use `scala.jdk.CollectionConverters` and `LazyList`.

```scala
// Bad
import scala.collection.JavaConverters._

val names = javaList.asScala.toList
val naturals = Stream.from(1)
```

```scala
// Good
import scala.jdk.CollectionConverters._

val names = javaList.asScala.toList
val naturals = LazyList.from(1)
```

**Caught by:** scalac `-deprecation`
**Since:** Scala 2.13
**Source:** https://docs.scala-lang.org/overviews/core/collections-migration-213.html

## Sources

- https://docs.scala-lang.org/scala3/book/fp-functional-error-handling.html
- https://www.wartremover.org/doc/warts.html
- https://www.scala-lang.org/api/current/scala/util/control/NonFatal$.html
- https://docs.scala-lang.org/overviews/core/futures.html
- https://docs.scala-lang.org/scala3/book/fp-immutable-values.html
- https://docs.scala-lang.org/scala3/reference/error-codes/E176.html
- https://docs.scala-lang.org/scala3/reference/dropped-features/nonlocal-returns.html
- https://docs.scala-lang.org/tour/pattern-matching.html
- https://docs.scala-lang.org/scala3/reference/contextual/multiversal-equality.html
- https://docs.scala-lang.org/scala3/reference/enums/adts.html
- https://docs.scala-lang.org/overviews/compiler-options/index.html
- https://docs.scala-lang.org/overviews/core/collections-migration-213.html
- https://docs.scala-lang.org/scala3/book/ca-implicit-conversions.html
