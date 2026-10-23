# Go anti-patterns

Read this whole file before writing or reviewing Go code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Go-specific traps.

## Contents

1. Writing to a nil map
2. Unsynchronized map access from several goroutines
3. Returning a typed nil pointer as an `error`
4. Discarding errors with `_` or by ignoring the return value
5. Goroutines with no exit path
6. Sending on an unbuffered channel after the receiver gave up
7. Not closing an HTTP response body
8. `defer` inside a loop
9. Copying a value that contains a `sync.Mutex`
10. Calling `WaitGroup.Add` inside the goroutine
11. Comparing errors with `==` or a type assertion
12. Wrapping errors with `%v` instead of `%w`
13. Loop variable capture below Go 1.22, and redundant copies above it
14. Storing a `context.Context` in a struct or calling `context.Background` deep in the stack
15. `time.After` in a busy loop in modules below Go 1.23
16. `panic` for ordinary errors
17. Side effects in `init()`
18. Interfaces defined next to their only implementation

## 1. Writing to a nil map

**Avoid:** Declaring a map with `var m map[K]V` (or a struct field left zero) and then assigning to it.
**Why:** Reading a nil map works and returns zero values, so the bug hides until the first write, which panics at runtime.
**Instead:** Create the map with `make` or a literal before the first write, and initialize map fields in the constructor.

```go
// Bad
var counts map[string]int
counts["go"]++
```

```go
// Good
counts := make(map[string]int)
counts["go"]++
```

**Caught by:** staticcheck SA5000
**Source:** https://go.dev/blog/maps

## 2. Unsynchronized map access from several goroutines

**Avoid:** Reading and writing a plain map from more than one goroutine without a lock.
**Why:** Go maps are not safe for concurrent use; the runtime detects concurrent writes and kills the whole process with `fatal error: concurrent map writes`, which `recover` cannot catch.
**Instead:** Guard the map with a `sync.Mutex` or `sync.RWMutex`, or use `sync.Map` for write-once, read-many caches.

```go
// Bad
cache := map[string]int{}
for _, k := range keys {
    go func() { cache[k] = compute(k) }()
}
```

```go
// Good
var mu sync.Mutex
cache := map[string]int{}
for _, k := range keys {
    go func() {
        v := compute(k)
        mu.Lock()
        cache[k] = v
        mu.Unlock()
    }()
}
```

**Caught by:** the race detector (`go test -race`, `go build -race`)
**Source:** https://go.dev/doc/faq#atomic_maps

## 3. Returning a typed nil pointer as an `error`

**Avoid:** Returning a nil `*MyError` (or any nil concrete pointer) through an `error` return, or declaring `*MyError` as a function's return type.
**Why:** An interface holding a typed nil pointer is not nil, so the caller's `if err != nil` is always true and success is reported as failure.
**Instead:** Declare the return type as `error` and return a literal `nil` on success.

```go
// Bad
func validate(in string) error {
    var err *ValidationError
    if in == "" {
        err = &ValidationError{Field: "in"}
    }
    return err
}
```

```go
// Good
func validate(in string) error {
    if in == "" {
        return &ValidationError{Field: "in"}
    }
    return nil
}
```

**Caught by:** staticcheck SA4023
**Source:** https://go.dev/doc/faq#nil_error

## 4. Discarding errors with `_` or by ignoring the return value

**Avoid:** Assigning an error to `_`, or calling a function that returns an error as a bare statement.
**Why:** The program carries on with a zero value (an empty file, a half-filled struct) and fails later, far from the cause.
**Instead:** Check every error and return it wrapped with context, or handle it on the spot.

```go
// Bad
data, _ := os.ReadFile(path)
json.Unmarshal(data, &cfg)
```

```go
// Good
data, err := os.ReadFile(path)
if err != nil {
    return fmt.Errorf("read config %s: %w", path, err)
}
if err := json.Unmarshal(data, &cfg); err != nil {
    return fmt.Errorf("parse config %s: %w", path, err)
}
```

**Caught by:** golangci-lint `errcheck`
**Source:** https://go.dev/wiki/CodeReviewComments#handle-errors

## 5. Goroutines with no exit path

**Avoid:** Starting a goroutine that loops or blocks forever with no way to tell it to stop.
**Why:** Each one pins its stack and everything it references for the life of the process; in a server, one per request becomes an unbounded leak.
**Instead:** Pass a `context.Context` and return when `ctx.Done()` closes.

```go
// Bad
go func() {
    for {
        refreshCache()
        time.Sleep(time.Minute)
    }
}()
```

```go
// Good
t := time.NewTicker(time.Minute)
defer t.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-t.C:
        refreshCache()
    }
}
```

**Source:** https://go.dev/wiki/CodeReviewComments#goroutine-lifetimes

## 6. Sending on an unbuffered channel after the receiver gave up

**Avoid:** Having a worker goroutine send its result on an unbuffered channel while the caller may return early on a timeout or cancellation.
**Why:** Once the caller stops listening, the worker blocks on the send forever, leaking one goroutine per timed-out call.
**Instead:** Give the result channel a buffer of 1 so the send always completes, and pass a context so the work itself stops.

```go
// Bad
ch := make(chan Result)
go func() { ch <- slowCall(ctx) }()
select {
case r := <-ch:
    return r, nil
case <-ctx.Done():
    return Result{}, ctx.Err()
}
```

```go
// Good
ch := make(chan Result, 1)
go func() { ch <- slowCall(ctx) }()
select {
case r := <-ch:
    return r, nil
case <-ctx.Done():
    return Result{}, ctx.Err()
}
```

**Source:** https://go.dev/blog/concurrency-timeouts

## 7. Not closing an HTTP response body

**Avoid:** Reading from `resp.Body` (or ignoring it) without closing it.
**Why:** The underlying connection is never released or reused, so file descriptors and goroutines pile up until the process hits its limit.
**Instead:** `defer resp.Body.Close()` right after the error check, and read the body to EOF if you want keep-alive reuse.

```go
// Bad
resp, err := client.Do(req)
if err != nil {
    return err
}
return json.NewDecoder(resp.Body).Decode(&out)
```

```go
// Good
resp, err := client.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()
return json.NewDecoder(resp.Body).Decode(&out)
```

**Caught by:** golangci-lint `bodyclose`
**Source:** https://pkg.go.dev/net/http#Client.Do

## 8. `defer` inside a loop

**Avoid:** Calling `defer f.Close()` (or `defer mu.Unlock()`) inside a loop body.
**Why:** Deferred calls run when the function returns, not at the end of the iteration, so every file stays open until the loop finishes and large inputs exhaust file descriptors.
**Instead:** Move the loop body into its own function so each `defer` runs once per iteration.

```go
// Bad
for _, path := range paths {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()
    process(f)
}
```

```go
// Good
func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()
    return process(f)
}
```

**Caught by:** staticcheck SA9001 (range loops)
**Source:** https://staticcheck.dev/docs/checks/#SA9001

## 9. Copying a value that contains a `sync.Mutex`

**Avoid:** Value receivers, value parameters, or plain assignments on structs that hold a `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup` or `atomic` type.
**Why:** Each copy gets its own lock, so the critical section protects nothing; with a value receiver the update also lands on the copy and is lost.
**Instead:** Use pointer receivers and pass such structs by pointer.

```go
// Bad
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

```go
// Good
func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

**Caught by:** `go vet` copylocks
**Source:** https://pkg.go.dev/sync#Mutex

## 10. Calling `WaitGroup.Add` inside the goroutine

**Avoid:** Calling `wg.Add(1)` as the first line of the goroutine it counts.
**Why:** `wg.Wait()` can run before any goroutine has called `Add`, see a zero counter, and return while work is still running.
**Instead:** Call `wg.Add` before the `go` statement, or use `wg.Go` on Go 1.25 and later.

```go
// Bad
var wg sync.WaitGroup
for _, u := range urls {
    go func() {
        wg.Add(1)
        defer wg.Done()
        fetch(u)
    }()
}
wg.Wait()
```

```go
// Good
var wg sync.WaitGroup
for _, u := range urls {
    wg.Go(func() { fetch(u) })
}
wg.Wait()
```

**Caught by:** staticcheck SA2000; `go vet` waitgroup (Go 1.25+)
**Since:** Go 1.25 (`WaitGroup.Go`)
**Source:** https://go.dev/doc/go1.25

## 11. Comparing errors with `==` or a type assertion

**Avoid:** `err == ErrSomething` or `err.(*SomeError)` on errors that may have been wrapped.
**Why:** As soon as any layer wraps the error with `%w`, the comparison and the assertion silently stop matching and the handling branch never runs.
**Instead:** Use `errors.Is` for sentinel values and `errors.As` for error types; both walk the whole wrap chain.

```go
// Bad
if err == sql.ErrNoRows {
    return nil, ErrNotFound
}
if pe, ok := err.(*fs.PathError); ok {
    log.Println(pe.Path)
}
```

```go
// Good
if errors.Is(err, sql.ErrNoRows) {
    return nil, ErrNotFound
}
var pe *fs.PathError
if errors.As(err, &pe) {
    log.Println(pe.Path)
}
```

**Caught by:** golangci-lint `errorlint`
**Since:** Go 1.13
**Source:** https://go.dev/blog/go1.13-errors

## 12. Wrapping errors with `%v` instead of `%w`

**Avoid:** `fmt.Errorf("...: %v", err)` when callers need to inspect the cause.
**Why:** `%v` flattens the cause into text, so `errors.Is` and `errors.As` upstream can no longer find it.
**Instead:** Use `%w` to keep the chain; use `%v` on purpose only when the cause is an internal detail you do not want in your API.

```go
// Bad
return fmt.Errorf("load user %d: %v", id, err)
```

```go
// Good
return fmt.Errorf("load user %d: %w", id, err)
```

**Caught by:** golangci-lint `errorlint`
**Since:** Go 1.13 (`%w`); Go 1.20 (several `%w` in one call, `errors.Join`)
**Source:** https://go.dev/blog/go1.13-errors

## 13. Loop variable capture below Go 1.22, and redundant copies above it

**Avoid:** In a module whose `go.mod` says `go 1.21` or lower, capturing a loop variable in a goroutine or closure; in a module on `go 1.22` or later, adding `v := v` copies.
**Why:** Below 1.22 the variable is shared by all iterations, so every goroutine sees the last value; from 1.22 each iteration gets its own variable and the copy is dead noise.
**Instead:** Raise the `go` line in `go.mod` to 1.22 or later and drop the copies; if you cannot, pass the variable as an argument.

```go
// Bad
for _, job := range jobs {
    go func() { run(job) }()
}
```

```go
// Good
for _, job := range jobs {
    go func(j Job) { run(j) }(job)
}
```

**Caught by:** `go vet` loopclosure (modules below 1.22); golangci-lint `copyloopvar` (redundant copies on 1.22+)
**Since:** Go 1.22 (per-iteration loop variables, gated on the `go.mod` `go` line)
**Source:** https://go.dev/blog/loopvar-preview

## 14. Storing a `context.Context` in a struct or calling `context.Background` deep in the stack

**Avoid:** Keeping a context in a struct field, or creating `context.Background()` inside a function that is reached from a request.
**Why:** The work no longer sees the caller's deadline or cancellation, so a cancelled request keeps running queries and holding connections.
**Instead:** Accept `ctx context.Context` as the first parameter of every function that does I/O and pass it down; create `context.Background()` only in `main`, tests and top-level setup.

```go
// Bad
func (s *Service) Load(id string) (*User, error) {
    return s.repo.Find(context.Background(), id)
}
```

```go
// Good
func (s *Service) Load(ctx context.Context, id string) (*User, error) {
    return s.repo.Find(ctx, id)
}
```

**Caught by:** golangci-lint `containedctx` (struct fields) and `contextcheck` (non-inherited context)
**Source:** https://pkg.go.dev/context

## 15. `time.After` in a busy loop in modules below Go 1.23

**Avoid:** `case <-time.After(d):` inside a `for`/`select` loop that iterates often, in a module whose `go.mod` says `go 1.22` or lower.
**Why:** Each call creates a new timer, and before Go 1.23 an unfired timer is not garbage-collected until it fires, so a busy loop keeps thousands of live timers. From Go 1.23 they are collected, and the `time` docs say there is no reason to prefer `NewTimer` when `After` will do.
**Instead:** Raise the `go` line to 1.23 or later; if you cannot, create one `time.Timer` outside the loop and stop, drain and reset it.

```go
// Bad
for {
    select {
    case msg := <-msgs:
        handle(msg)
    case <-time.After(30 * time.Second):
        return errIdle
    }
}
```

```go
// Good
idle := time.NewTimer(30 * time.Second)
defer idle.Stop()
for {
    select {
    case msg := <-msgs:
        handle(msg)
        if !idle.Stop() {
            <-idle.C
        }
        idle.Reset(30 * time.Second)
    case <-idle.C:
        return errIdle
    }
}
```

**Since:** Go 1.23 (unstopped timers collected and `Reset` safe without draining, both gated on the `go.mod` `go` line)
**Source:** https://go.dev/doc/go1.23

## 16. `panic` for ordinary errors

**Avoid:** Calling `panic` for bad input, missing files, failed network calls or any other expected failure.
**Why:** A panic skips every caller's error handling and crashes the process unless some layer recovers it, turning one bad request into an outage.
**Instead:** Return an `error`; keep `panic` for programmer bugs and `Must*` helpers that run on constant input at startup (like `regexp.MustCompile`).

```go
// Bad
func ParsePort(s string) int {
    p, err := strconv.Atoi(s)
    if err != nil {
        panic(err)
    }
    return p
}
```

```go
// Good
func ParsePort(s string) (int, error) {
    p, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parse port %q: %w", s, err)
    }
    return p, nil
}
```

**Source:** https://go.dev/wiki/CodeReviewComments#dont-panic

## 17. Side effects in `init()`

**Avoid:** Opening connections, reading environment variables or files, or starting goroutines in `init()`.
**Why:** `init` runs on import, cannot return an error, and runs in tests too, so a missing env var crashes every test binary and the dependency is hidden from callers.
**Instead:** Do the work in an explicit constructor that takes its inputs as parameters and returns an error.

```go
// Bad
var db *sql.DB

func init() {
    var err error
    db, err = sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        log.Fatal(err)
    }
}
```

```go
// Good
func NewStore(dsn string) (*Store, error) {
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        return nil, fmt.Errorf("open db: %w", err)
    }
    return &Store{db: db}, nil
}
```

**Caught by:** golangci-lint `gochecknoinits` and `gochecknoglobals`
**Source:** https://github.com/uber-go/guide/blob/master/style.md#avoid-init

## 18. Interfaces defined next to their only implementation

**Avoid:** Declaring an interface in the producer package and returning it from the constructor "for mocking".
**Why:** The interface grows to every method the type has, each consumer depends on methods it never calls, and adding a method breaks every fake.
**Instead:** Return the concrete type, and let each consumer declare the small interface it actually needs.

```go
// Bad
package storage

type UserStore interface {
    Get(id string) (User, error)
    Put(u User) error
}

func NewUserStore(db *sql.DB) UserStore { return &pgStore{db: db} }
```

```go
// Good
package billing

type userGetter interface {
    Get(id string) (storage.User, error)
}

func NewInvoicer(users userGetter) *Invoicer { return &Invoicer{users: users} }
```

**Caught by:** golangci-lint `ireturn` and `iface`
**Source:** https://go.dev/wiki/CodeReviewComments#interfaces

## Sources

- https://go.dev/blog/maps
- https://go.dev/doc/faq#atomic_maps
- https://go.dev/doc/faq#nil_error
- https://go.dev/wiki/CodeReviewComments#handle-errors
- https://go.dev/wiki/CodeReviewComments#goroutine-lifetimes
- https://go.dev/blog/concurrency-timeouts
- https://pkg.go.dev/net/http#Client.Do
- https://staticcheck.dev/docs/checks/#SA9001
- https://pkg.go.dev/sync#Mutex
- https://go.dev/doc/go1.25
- https://go.dev/blog/go1.13-errors
- https://go.dev/blog/loopvar-preview
- https://pkg.go.dev/context
- https://go.dev/doc/go1.23
- https://go.dev/wiki/CodeReviewComments#dont-panic
- https://github.com/uber-go/guide/blob/master/style.md#avoid-init
- https://go.dev/wiki/CodeReviewComments#interfaces
