# C# anti-patterns

Read this whole file before writing or reviewing C# code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the C#-specific traps.

## Contents

1. `async void` methods and async lambdas passed as `Action`
2. Blocking on async code with `.Result`, `.Wait()` or `GetAwaiter().GetResult()`
3. Unobserved tasks (fire-and-forget)
4. Not disposing `IDisposable` objects
5. Creating an `HttpClient` per request
6. `throw ex;` instead of `throw;`
7. Nullable reference types off, or silenced with `!`
8. Event subscriptions that are never removed
9. `lock (this)`, `lock (typeof(...))` or locking a string
10. Enumerating an `IEnumerable` more than once
11. Not forwarding the `CancellationToken`
12. Missing `ConfigureAwait(false)` in library code, and adding it in app code
13. Mutable structs
14. `DateTime.Now` for timestamps and comparisons
15. String concatenation in a loop
16. `is` check followed by a cast
17. Hand-written value equality instead of records

## 1. `async void` methods and async lambdas passed as `Action`

**Avoid:** Declaring `async void` methods other than event handlers, or passing an `async` lambda where an `Action` is expected (for example `List<T>.ForEach`).
**Why:** The caller gets no task to await, so it cannot know when the work ends, and any exception is raised on the synchronization context, where it usually crashes the process instead of reaching a `catch`.
**Instead:** Return `Task` (or `Task<T>`), and use a plain `foreach` with `await` instead of `ForEach` with an async lambda.

```csharp
// Bad
public async void SaveAsync(Order order)
{
    await _repository.AddAsync(order);
}

items.ForEach(async item => await ProcessAsync(item));
```

```csharp
// Good
public async Task SaveAsync(Order order)
{
    await _repository.AddAsync(order);
}

foreach (var item in items)
{
    await ProcessAsync(item);
}
```

**Caught by:** Microsoft.VisualStudio.Threading.Analyzers VSTHRD100, VSTHRD101
**Source:** https://learn.microsoft.com/en-us/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming

## 2. Blocking on async code with `.Result`, `.Wait()` or `GetAwaiter().GetResult()`

**Avoid:** Waiting synchronously for a task inside code that runs on a UI thread, in classic ASP.NET, or on a busy thread pool.
**Why:** On a single-threaded synchronization context the awaited continuation needs the thread you are blocking, so it deadlocks; elsewhere it ties up pool threads and starves the server under load. `.Result` and `.Wait()` also wrap failures in `AggregateException`.
**Instead:** Make the caller async and `await` all the way up to the entry point.

```csharp
// Bad
public User GetUser(int id)
{
    return _client.GetUserAsync(id).Result;
}
```

```csharp
// Good
public Task<User> GetUserAsync(int id) => _client.GetUserAsync(id);
```

**Caught by:** Microsoft.VisualStudio.Threading.Analyzers VSTHRD002
**Source:** https://learn.microsoft.com/en-us/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming

## 3. Unobserved tasks (fire-and-forget)

**Avoid:** Calling a `Task`-returning method without awaiting or storing the task, including `_ = SendAsync()` used only to hide the warning.
**Why:** The method carries on before the work finishes, and any exception from the task is lost, so failures such as an unsent email never surface.
**Instead:** `await` the task; if the work must outlive the request, hand it to a background queue or hosted service that owns its errors.

```csharp
// Bad
public async Task PlaceOrderAsync(Order order)
{
    await _orders.SaveAsync(order);
    _email.SendConfirmationAsync(order);
}
```

```csharp
// Good
public async Task PlaceOrderAsync(Order order)
{
    await _orders.SaveAsync(order);
    await _email.SendConfirmationAsync(order);
}
```

**Caught by:** compiler warning CS4014; Microsoft.VisualStudio.Threading.Analyzers VSTHRD110
**Source:** https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/async-await-errors

## 4. Not disposing `IDisposable` objects

**Avoid:** Creating streams, readers, database connections, timers or other `IDisposable` objects without a `using`.
**Why:** The handle stays open until the finalizer runs at some unknown time, so files stay locked and connections leak, and an exception before a manual `Dispose()` skips it.
**Instead:** Use a `using` declaration so disposal runs at the end of the scope on every exit path.

```csharp
// Bad
var reader = File.OpenText(path);
string text = reader.ReadToEnd();
reader.Dispose();
return text;
```

```csharp
// Good
using var reader = File.OpenText(path);
return reader.ReadToEnd();
```

**Caught by:** CA2000 (not on by default); CA2213 for disposable fields
**Since:** C# 8.0 (`using` declarations)
**Source:** https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2000

## 5. Creating an `HttpClient` per request

**Avoid:** `new HttpClient()` (even inside `using`) for each call, or one static client with default settings in a long-running service.
**Why:** Each instance owns its own connection pool, and closed sockets linger in TIME_WAIT, so per-request clients exhaust ports under load; a static client that never recycles connections never sees DNS changes.
**Instead:** Inject clients from `IHttpClientFactory` (typed clients), or use one long-lived client whose `SocketsHttpHandler` sets `PooledConnectionLifetime`.

```csharp
// Bad
public async Task<string> GetAsync(string url)
{
    using var client = new HttpClient();
    return await client.GetStringAsync(url);
}
```

```csharp
// Good
public sealed class CatalogClient
{
    private readonly HttpClient _http;
    public CatalogClient(HttpClient http) => _http = http;
    public Task<string> GetAsync(string url) => _http.GetStringAsync(url);
}

builder.Services.AddHttpClient<CatalogClient>();
```

**Source:** https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines

## 6. `throw ex;` instead of `throw;`

**Avoid:** Rethrowing a caught exception with `throw ex;`.
**Why:** It resets the stack trace to the current method, so the frames that show where the failure started are gone.
**Instead:** Use bare `throw;` to rethrow, or throw a new exception with the original as `innerException`; use an exception filter (`catch (X ex) when (...)`) if you only want to catch some cases.

```csharp
// Bad
catch (IOException ex)
{
    RollBack();
    throw ex;
}
```

```csharp
// Good
catch (IOException)
{
    RollBack();
    throw;
}
```

**Caught by:** CA2200 (warning by default)
**Source:** https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2200

## 7. Nullable reference types off, or silenced with `!`

**Avoid:** Projects without `<Nullable>enable</Nullable>`, and the null-forgiving operator `!` used to make a warning go away.
**Why:** Without the annotations every reference may be null and nothing tells you which; `!` asserts non-null without checking, so the `NullReferenceException` just moves to runtime.
**Instead:** Enable nullable reference types (and `<WarningsAsErrors>nullable</WarningsAsErrors>`), mark maybe-missing values `T?`, and check them with a pattern before use.

```csharp
// Bad
var name = FindUser(id)!.Name;
return Ok(name);
```

```csharp
// Good
User? user = FindUser(id);
if (user is null)
{
    return NotFound();
}
return Ok(user.Name);
```

**Caught by:** compiler warnings CS8602 (dereference of a possibly null reference), CS8618 (non-nullable member not initialized)
**Since:** C# 8.0
**Source:** https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references

## 8. Event subscriptions that are never removed

**Avoid:** Subscribing with `+=` to an event on a longer-lived object (a service, a static, a shared feed) and never unsubscribing.
**Why:** The event source holds a strong reference to the subscriber, so the subscriber can never be collected, and it keeps handling events after it should be gone.
**Instead:** Unsubscribe with `-=` in `Dispose` (subscribe with a named method, not a lambda, so you can remove it), or use a weak event pattern.

```csharp
// Bad
public sealed class PriceWidget
{
    public PriceWidget(PriceFeed feed)
    {
        feed.PriceChanged += OnPriceChanged;
    }
    private void OnPriceChanged(object? sender, PriceEventArgs e) => Render(e.Price);
}
```

```csharp
// Good
public sealed class PriceWidget : IDisposable
{
    private readonly PriceFeed _feed;
    public PriceWidget(PriceFeed feed)
    {
        _feed = feed;
        _feed.PriceChanged += OnPriceChanged;
    }
    private void OnPriceChanged(object? sender, PriceEventArgs e) => Render(e.Price);
    public void Dispose() => _feed.PriceChanged -= OnPriceChanged;
}
```

**Source:** https://learn.microsoft.com/en-us/dotnet/desktop/wpf/events/weak-event-patterns

## 9. `lock (this)`, `lock (typeof(...))` or locking a string

**Avoid:** Locking on `this`, a `Type`, a string, or any object other code can reach.
**Why:** Outside code can take the same lock, which causes deadlocks and contention you cannot see from the class; interned strings are shared across the whole process.
**Instead:** Lock a private, dedicated, readonly field: a `System.Threading.Lock` on .NET 9 and C# 13, or a `new object()` on older targets.

```csharp
// Bad
public void Deposit(decimal amount)
{
    lock (this)
    {
        _balance += amount;
    }
}
```

```csharp
// Good
private readonly Lock _balanceLock = new();

public void Deposit(decimal amount)
{
    lock (_balanceLock)
    {
        _balance += amount;
    }
}
```

**Caught by:** CA2002 (not on by default; flags `this`, strings, `Type` and other weak-identity objects)
**Since:** .NET 9 and C# 13 (`System.Threading.Lock`)
**Source:** https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock

## 10. Enumerating an `IEnumerable` more than once

**Avoid:** Calling `Any()`, `Count()`, `First()` or `foreach` several times on the same deferred LINQ query.
**Why:** Each enumeration runs the query again: a database query runs twice, side effects repeat, and the results can differ between calls.
**Instead:** Materialize once with `ToList()` or `ToArray()` and use the list.

```csharp
// Bad
IEnumerable<Order> pending = orders.Where(o => o.IsPending);
if (pending.Any())
{
    Notify(pending.Count());
    Archive(pending);
}
```

```csharp
// Good
List<Order> pending = orders.Where(o => o.IsPending).ToList();
if (pending.Count > 0)
{
    Notify(pending.Count);
    Archive(pending);
}
```

**Caught by:** CA1851 (not on by default)
**Since:** .NET 7 SDK (CA1851)
**Source:** https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1851

## 11. Not forwarding the `CancellationToken`

**Avoid:** Accepting a `CancellationToken` and then calling async APIs without passing it on.
**Why:** When the request is aborted or times out, the inner I/O keeps running to the end and holds threads, connections and locks for work nobody will read.
**Instead:** Pass the token to every call that has a token parameter or overload.

```csharp
// Bad
public async Task<Report> BuildAsync(string path, CancellationToken ct)
{
    string json = await File.ReadAllTextAsync(path);
    return Report.Parse(json);
}
```

```csharp
// Good
public async Task<Report> BuildAsync(string path, CancellationToken ct)
{
    string json = await File.ReadAllTextAsync(path, ct);
    return Report.Parse(json);
}
```

**Caught by:** CA2016 (suggestion by default)
**Source:** https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2016

## 12. Missing `ConfigureAwait(false)` in library code, and adding it in app code

**Avoid:** Plain `await` in a reusable library that may be called from UI or classic ASP.NET apps; and, the other way, `ConfigureAwait(false)` in UI handlers before code that touches the UI.
**Why:** In a library the continuation posts back to the caller's synchronization context, which costs context switches and deadlocks callers that block; in a UI handler `false` resumes on a pool thread and UI access then throws. ASP.NET Core has no synchronization context, so there it changes nothing.
**Instead:** In library projects add `.ConfigureAwait(false)` to every await; in application code leave it out.

```csharp
// Bad
public async Task<Config> LoadAsync(string path)
{
    string json = await File.ReadAllTextAsync(path);
    return JsonSerializer.Deserialize<Config>(json) ?? throw new InvalidDataException(path);
}
```

```csharp
// Good
public async Task<Config> LoadAsync(string path)
{
    string json = await File.ReadAllTextAsync(path).ConfigureAwait(false);
    return JsonSerializer.Deserialize<Config>(json) ?? throw new InvalidDataException(path);
}
```

**Caught by:** CA2007 (enable for library projects only); Microsoft.VisualStudio.Threading.Analyzers VSTHRD111
**Source:** https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2007

## 13. Mutable structs

**Avoid:** Structs with settable properties, public mutable fields, or methods that change `this`.
**Why:** Structs are copied on every assignment, property read and `readonly` field access, so a mutation often lands on a hidden copy and is silently lost.
**Instead:** Make structs `readonly` (a `readonly record struct` gives value equality and `with` for free) and return a new value instead of mutating.

```csharp
// Bad
public struct Counter
{
    public int Value;
    public void Increment() => Value++;
}

private readonly Counter _counter;
public void Hit() => _counter.Increment();
```

```csharp
// Good
public readonly record struct Counter(int Value)
{
    public Counter Increment() => this with { Value = Value + 1 };
}

private Counter _counter;
public void Hit() => _counter = _counter.Increment();
```

**Since:** C# 7.2 (`readonly struct`); C# 10 (`record struct`)
**Source:** https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/struct

## 14. `DateTime.Now` for timestamps and comparisons

**Avoid:** Reading `DateTime.Now` (or `DateTime.UtcNow` directly) in business logic, and storing or comparing local `DateTime` values.
**Why:** Local time jumps at daylight-saving changes and differs between servers, `DateTime` comparisons ignore `Kind`, and logic that reads the clock directly cannot be tested at a chosen time.
**Instead:** Store instants as `DateTimeOffset` in UTC and read the clock from an injected `TimeProvider`.

```csharp
// Bad
order.CreatedAt = DateTime.Now;
bool expired = DateTime.Now >= token.ExpiresAt;
```

```csharp
// Good
order.CreatedAt = _clock.GetUtcNow();
bool expired = _clock.GetUtcNow() >= token.ExpiresAt;
```

**Since:** .NET 8 (`TimeProvider`; the `Microsoft.Bcl.TimeProvider` package for older targets)
**Source:** https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview

## 15. String concatenation in a loop

**Avoid:** Building a string with `+=` inside a loop.
**Why:** Strings are immutable, so each `+=` copies everything built so far; the loop becomes quadratic in time and garbage.
**Instead:** Use `string.Join` or `string.Concat` over a sequence, or a `StringBuilder` when the logic needs a loop.

```csharp
// Bad
string csv = "";
foreach (var row in rows)
{
    csv += row.ToCsv() + "\n";
}
```

```csharp
// Good
string csv = string.Join("\n", rows.Select(r => r.ToCsv()));
```

**Source:** https://learn.microsoft.com/en-us/dotnet/standard/base-types/stringbuilder

## 16. `is` check followed by a cast

**Avoid:** Testing a type with `is` or `as` and then casting again, or chains of `if (x is A) ... else if (x is B)`.
**Why:** The type is checked twice, the cast can drift from the check during edits, and a missing case falls through silently.
**Instead:** Use a declaration pattern (`is Circle c`) or a `switch` expression over the cases.

```csharp
// Bad
if (shape is Circle)
{
    var circle = (Circle)shape;
    return Math.PI * circle.Radius * circle.Radius;
}
```

```csharp
// Good
return shape switch
{
    Circle c => Math.PI * c.Radius * c.Radius,
    Square s => s.Side * s.Side,
    _ => throw new ArgumentOutOfRangeException(nameof(shape))
};
```

**Caught by:** IDE0020, IDE0038 (`is` then cast); IDE0019 (`as` then null check)
**Since:** C# 7.0 (type patterns); C# 8.0 (`switch` expressions)
**Source:** https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/ide0020-ide0038

## 17. Hand-written value equality instead of records

**Avoid:** Data classes with mutable properties and field-by-field comparisons, or hand-written `Equals`/`GetHashCode` pairs.
**Why:** Hand-written equality drifts when a property is added, and mutable data used as a dictionary key or shared between threads changes under its holders.
**Instead:** Use a positional `record` for immutable data with value equality and non-destructive `with` copies.

```csharp
// Bad
public sealed class Money
{
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "";
}

bool same = a.Amount == b.Amount && a.Currency == b.Currency;
```

```csharp
// Good
public sealed record Money(decimal Amount, string Currency);

bool same = a == b;
var doubled = a with { Amount = a.Amount * 2 };
```

**Since:** C# 9.0
**Source:** https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record

## Sources

- https://learn.microsoft.com/en-us/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming
- https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/async-await-errors
- https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2000
- https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines
- https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2200
- https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references
- https://learn.microsoft.com/en-us/dotnet/desktop/wpf/events/weak-event-patterns
- https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock
- https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1851
- https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2016
- https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2007
- https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/struct
- https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview
- https://learn.microsoft.com/en-us/dotnet/standard/base-types/stringbuilder
- https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/ide0020-ide0038
- https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record
