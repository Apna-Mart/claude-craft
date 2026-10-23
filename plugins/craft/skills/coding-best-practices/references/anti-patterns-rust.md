# Rust anti-patterns

Read this whole file before writing or reviewing Rust code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Rust-specific traps.

## Contents

1. `unwrap` and `expect` in library code
2. Plain arithmetic that can overflow
3. `as` casts between numeric types
4. Large `unsafe` blocks, or `unsafe` where a safe API exists
5. `static mut`
6. Holding a `std::sync::Mutex` guard across `.await`
7. Blocking calls inside async code
8. `let _ =` on a `#[must_use]` value
9. Panicking or failing work in `Drop`
10. Indexing and byte-slicing that can panic
11. `Rc<RefCell<T>>` as the default way to share
12. `.clone()` to silence the borrow checker
13. `Box<dyn Error>` as a library's error type
14. `&String`, `&Vec<T>` and owned parameters where a borrow fits
15. `collect` only to iterate again
16. `Mutex` around a single integer or flag

## 1. `unwrap` and `expect` in library code

**Avoid:** calling `.unwrap()` or `.expect()` on a `Result` or `Option` whose failure depends on input, I/O, or the caller.
**Why:** a bad input becomes a panic that takes down the caller's thread or process, and the caller gets no chance to handle it.
**Instead:** return the error with `?` (converting it into your error type), and keep `expect` for invariants the code itself guarantees, with a message that states the invariant.

```rust
// Bad
pub fn load_port(path: &Path) -> u16 {
    let text = fs::read_to_string(path).unwrap();
    text.trim().parse().unwrap()
}
```

```rust
// Good
pub fn load_port(path: &Path) -> Result<u16, ConfigError> {
    let text = fs::read_to_string(path)?;
    Ok(text.trim().parse()?)
}
```

**Caught by:** Clippy `unwrap_used`, `expect_used` (allow-by-default; enable them for library crates)
**Source:** https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html#guidelines-for-error-handling

## 2. Plain arithmetic that can overflow

**Avoid:** `+`, `-` and `*` on integers whose values come from input, sizes, or counters that can grow without bound.
**Why:** overflow panics in debug builds but wraps silently in release builds, so tests pass and production computes a wrong length, price or index.
**Instead:** say what overflow should do: `checked_*` to get an `Option`, `saturating_*` to clamp, or `wrapping_*` when wrap-around is the intended behavior.

```rust
// Bad
let total = unit_price * quantity;
```

```rust
// Good
let total = unit_price
    .checked_mul(quantity)
    .ok_or(OrderError::TotalOverflow)?;
```

**Caught by:** Clippy `arithmetic_side_effects` (allow-by-default)
**Source:** https://doc.rust-lang.org/book/ch03-02-data-types.html#integer-overflow

## 3. `as` casts between numeric types

**Avoid:** `as` to convert between integer types or from floats to integers when the value might not fit.
**Why:** `as` never fails: it truncates high bits, turns negative numbers into huge unsigned ones, and saturates floats, so `300_u32 as u8` is `44` with no error.
**Instead:** use `From` for conversions that always fit and `TryFrom` (`u8::try_from(x)?`) for the rest.

```rust
// Bad
let len = payload.len() as u16;
```

```rust
// Good
let len = u16::try_from(payload.len()).map_err(|_| FrameError::TooLarge)?;
```

**Caught by:** Clippy `cast_possible_truncation`, `cast_sign_loss`, `cast_possible_wrap` (allow-by-default), or `as_conversions` to ban `as` outright
**Source:** https://doc.rust-lang.org/reference/expressions/operator-expr.html#numeric-cast

## 4. Large `unsafe` blocks, or `unsafe` where a safe API exists

**Avoid:** wrapping many statements in one `unsafe` block, or using `unsafe` where a safe API does the same job.
**Why:** the compiler cannot check the operations an `unsafe` block unlocks, so an unmet invariant (here, `end <= data.len()`) is undefined behavior, and a large block hides which line depends on which invariant.
**Instead:** prefer the safe API; when `unsafe` is required, keep one operation per block and wrap it in a safe function that checks the invariant first. Write a `// SAFETY:` comment only when the crate enables Clippy `undocumented_unsafe_blocks`, which flags every `unsafe` block without one; otherwise the zero-comment rule in `SKILL.md` applies.

```rust
// Bad
fn checksum(data: &[u8], end: usize) -> u32 {
    unsafe { data.get_unchecked(..end).iter().map(|&b| u32::from(b)).sum() }
}
```

```rust
// Good
fn checksum(data: &[u8], end: usize) -> Option<u32> {
    Some(data.get(..end)?.iter().map(|&b| u32::from(b)).sum())
}
```

**Caught by:** Clippy `multiple_unsafe_ops_per_block` (allow-by-default); rustc `unsafe_op_in_unsafe_fn` (warn-by-default in the 2024 edition)
**Since:** Rust 1.85 (2024 edition) for `unsafe_op_in_unsafe_fn` warning by default
**Source:** https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html

## 5. `static mut`

**Avoid:** global state declared as `static mut` and accessed through references.
**Why:** any two references to it, from two threads or even one re-entrant call, are a data race or aliasing violation, which is undefined behavior.
**Instead:** use an atomic, a `Mutex` or `RwLock` in a plain `static`, or `OnceLock`/`LazyLock` for values initialized once.

```rust
// Bad
static mut RECENT_ERRORS: Vec<String> = Vec::new();
fn record_error(message: String) { unsafe { RECENT_ERRORS.push(message) } }
```

```rust
// Good
static RECENT_ERRORS: Mutex<Vec<String>> = Mutex::new(Vec::new());
fn record_error(message: String) { RECENT_ERRORS.lock().unwrap().push(message); }
```

**Caught by:** rustc `static_mut_refs` (deny-by-default in the 2024 edition; it flags references such as the method call above, not a plain `COUNTER += 1`, which is still a race)
**Since:** Rust 1.70 for `OnceLock`, 1.80 for `LazyLock`
**Source:** https://doc.rust-lang.org/edition-guide/rust-2024/static-mut-references.html

## 6. Holding a `std::sync::Mutex` guard across `.await`

**Avoid:** keeping a `std::sync::MutexGuard` (or `RwLock` guard, or `RefCell` borrow) alive across an `.await`.
**Why:** while the task is suspended the lock stays held, so another task on the same worker thread that tries to lock it blocks the thread and can deadlock the runtime.
**Instead:** copy what you need out of the guard and drop it before awaiting; use `tokio::sync::Mutex` only when the lock must be held across the await.

```rust
// Bad
let mut cache = state.cache.lock().unwrap();
let user = fetch_user(id).await?;
cache.insert(id, user);
```

```rust
// Good
let user = fetch_user(id).await?;
state.cache.lock().unwrap().insert(id, user);
```

**Caught by:** Clippy `await_holding_lock`, `await_holding_refcell_ref` (warn-by-default)
**Source:** https://tokio.rs/tokio/tutorial/shared-state#holding-a-mutexguard-across-an-await

## 7. Blocking calls inside async code

**Avoid:** `std::thread::sleep`, `std::fs`, blocking network clients, or long CPU loops inside an `async fn`.
**Why:** an async runtime runs many tasks on a few threads, so one blocking call stalls every task scheduled on that thread.
**Instead:** use the runtime's async equivalents (`tokio::time::sleep`, `tokio::fs`), and move unavoidable blocking or CPU-heavy work to `tokio::task::spawn_blocking`.

```rust
// Bad
async fn refresh(path: &Path) -> io::Result<String> {
    std::thread::sleep(Duration::from_secs(1));
    std::fs::read_to_string(path)
}
```

```rust
// Good
async fn refresh(path: &Path) -> io::Result<String> {
    tokio::time::sleep(Duration::from_secs(1)).await;
    tokio::fs::read_to_string(path).await
}
```

**Caught by:** Clippy `disallowed_methods` configured in `clippy.toml` with `std::thread::sleep` and the `std::fs` functions
**Source:** https://docs.rs/tokio/latest/tokio/index.html#cpu-bound-tasks-and-blocking-code

## 8. `let _ =` on a `#[must_use]` value

**Avoid:** discarding a `Result`, a future, or a lock guard with `let _ = ...`.
**Why:** a discarded `Result` hides a failed write; a discarded future never runs; and `let _ = mutex.lock()` drops the guard at once, so the code after it runs unlocked.
**Instead:** handle or propagate the `Result` with `?`, `.await` the future, and bind guards to a named variable (`let _guard = ...`) for as long as the lock is needed.

```rust
// Bad
let _ = file.write_all(&bytes);
let _ = file.sync_all();
```

```rust
// Good
file.write_all(&bytes)?;
file.sync_all()?;
```

**Caught by:** rustc `let_underscore_lock` (deny-by-default); Clippy `let_underscore_future` (warn-by-default), `let_underscore_must_use` (allow-by-default). rustc `unused_must_use` does not fire, because `let _ =` silences it.
**Source:** https://doc.rust-lang.org/reference/attributes/diagnostics.html#the-must_use-attribute

## 9. Panicking or failing work in `Drop`

**Avoid:** calling `unwrap`, `expect` or `panic!` in a `Drop` impl, or doing the only flush or commit of a resource there.
**Why:** a panic in `drop` while the thread is already unwinding aborts the process, and an error inside `drop` has no way to reach the caller.
**Instead:** expose an explicit fallible method (`close`, `commit`, `finish`) that returns `Result`, and keep `drop` as a best-effort fallback that ignores errors.

```rust
// Bad
impl Drop for Journal {
    fn drop(&mut self) {
        self.file.sync_all().expect("journal sync failed");
    }
}
```

```rust
// Good
impl Journal {
    pub fn close(self) -> io::Result<()> {
        self.file.sync_all()
    }
}
```

**Source:** https://rust-lang.github.io/api-guidelines/dependability.html#c-dtor-fail

## 10. Indexing and byte-slicing that can panic

**Avoid:** `v[i]`, `&v[a..b]` and `&s[a..b]` with indices derived from input, and slicing a `str` at byte offsets you did not get from the string itself.
**Why:** an out-of-range index panics, and a `str` slice that cuts through a multi-byte UTF-8 character panics even when the index is in range.
**Instead:** use `.get(i)`, `.get(a..b)`, `split_at_checked`, or iterator methods, and find string boundaries with `char_indices` or `find`.

```rust
// Bad
let prefix = &name[..3];
let first = items[0];
```

```rust
// Good
let prefix = name.get(..3).unwrap_or(name);
let first = items.first().copied().ok_or(ParseError::Empty)?;
```

**Caught by:** Clippy `indexing_slicing`, `string_slice` (allow-by-default)
**Since:** Rust 1.80 for `split_at_checked`
**Source:** https://doc.rust-lang.org/std/primitive.str.html#method.get

## 11. `Rc<RefCell<T>>` as the default way to share

**Avoid:** wrapping objects in `Rc<RefCell<T>>` (or `Arc<Mutex<T>>`) so that many parts of the program can mutate them.
**Why:** borrow rules move from compile time to run time, so a nested `borrow_mut` panics with `BorrowMutError`, and reference cycles leak.
**Instead:** give data one owner and pass `&mut` down, store related items in a `Vec` and refer to them by index, and use `Weak` for back-references when shared ownership is genuinely needed.

```rust
// Bad
struct Node { children: Vec<Rc<RefCell<Node>>>, parent: Option<Rc<RefCell<Node>>> }
```

```rust
// Good
struct Tree { nodes: Vec<Node> }
struct Node { children: Vec<usize>, parent: Option<usize> }
```

**Source:** https://doc.rust-lang.org/book/ch15-05-interior-mutability.html#keeping-track-of-borrows-at-runtime-with-refcellt

## 12. `.clone()` to silence the borrow checker

**Avoid:** adding `.clone()` (or `.to_owned()`, `.to_string()`) until a borrow error goes away.
**Why:** each clone copies the whole value, often inside a loop, and edits then land on the copy instead of the original.
**Instead:** shorten the borrow, borrow instead of moving (`&value`), split the struct into fields you borrow separately, or take ownership once with `std::mem::take`.

```rust
// Bad
fn notify_all(&mut self) {
    for user in self.users.clone() {
        self.mailer.send(&user);
    }
}
```

```rust
// Good
fn notify_all(&mut self) {
    for user in &self.users {
        self.mailer.send(user);
    }
}
```

**Caught by:** no lint catches the loop above; Clippy `redundant_clone` (nursery, allow-by-default) catches clones of values never used again, and `unnecessary_to_owned` (warn-by-default) catches `.to_string()` or `.to_owned()` passed where a borrow fits
**Source:** https://rust-lang.github.io/rust-clippy/master/index.html#redundant_clone

## 13. `Box<dyn Error>` as a library's error type

**Avoid:** returning `Box<dyn Error>` (or `anyhow::Error`) from a library's public functions.
**Why:** callers cannot match on what went wrong, so they cannot retry on one failure and give up on another without parsing message strings.
**Instead:** define an error enum with one variant per failure the caller can act on, implement `Error` and `Display` (for example with `thiserror`), and keep `anyhow` for binaries.

```rust
// Bad
pub fn load_port(path: &Path) -> Result<u16, Box<dyn std::error::Error>> {
    Ok(fs::read_to_string(path)?.trim().parse()?)
}
```

```rust
// Good
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("cannot read config")]
    Read(#[from] std::io::Error),
    #[error("invalid port")]
    Port(#[from] std::num::ParseIntError),
}
pub fn load_port(path: &Path) -> Result<u16, ConfigError> {
    Ok(fs::read_to_string(path)?.trim().parse()?)
}
```

**Source:** https://rust-lang.github.io/api-guidelines/interoperability.html#c-good-err

## 14. `&String`, `&Vec<T>` and owned parameters where a borrow fits

**Avoid:** parameters typed `&String`, `&Vec<T>` or `&PathBuf`, and `String` or `Vec<T>` parameters the function only reads.
**Why:** callers holding a `&str`, a slice, or a literal must allocate a copy just to make the call.
**Instead:** take `&str`, `&[T]` or `&Path`, and take ownership only when the function stores or consumes the value.

```rust
// Bad
fn is_admin(name: &String, roles: &Vec<Role>) -> bool {
    name.starts_with("admin-") || roles.contains(&Role::Admin)
}
```

```rust
// Good
fn is_admin(name: &str, roles: &[Role]) -> bool {
    name.starts_with("admin-") || roles.contains(&Role::Admin)
}
```

**Caught by:** Clippy `ptr_arg` (warn-by-default), `needless_pass_by_value` (allow-by-default)
**Source:** https://rust-lang.github.io/rust-clippy/master/index.html#ptr_arg

## 15. `collect` only to iterate again

**Avoid:** collecting an iterator into a `Vec` and then immediately iterating, counting, or checking it.
**Why:** it allocates and fills a collection that is thrown away, and it evaluates every element even when the answer was known after the first.
**Instead:** chain the next adapter directly (`.count()`, `.any()`, `.sum()`, a `for` loop over the iterator).

```rust
// Bad
let expired: Vec<_> = sessions.iter().filter(|s| s.is_expired()).collect();
let has_expired = !expired.is_empty();
```

```rust
// Good
let has_expired = sessions.iter().any(|s| s.is_expired());
```

**Caught by:** Clippy `needless_collect` (nursery, allow-by-default)
**Source:** https://rust-lang.github.io/rust-clippy/master/index.html#needless_collect

## 16. `Mutex` around a single integer or flag

**Avoid:** `Mutex<bool>`, `Mutex<usize>` and similar when the lock protects one primitive value.
**Why:** every read and write takes a lock and can block, and the guard must be unwrapped for poisoning, where an atomic does the same in one instruction.
**Instead:** use `AtomicBool`, `AtomicUsize` and friends; keep the `Mutex` when several values must change together.

```rust
// Bad
let shutting_down = Mutex::new(false);
*shutting_down.lock().unwrap() = true;
```

```rust
// Good
let shutting_down = AtomicBool::new(false);
shutting_down.store(true, Ordering::Release);
```

**Caught by:** Clippy `mutex_atomic`, `mutex_integer` (allow-by-default)
**Source:** https://rust-lang.github.io/rust-clippy/master/index.html#mutex_atomic

## Sources

- https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html#guidelines-for-error-handling
- https://doc.rust-lang.org/book/ch03-02-data-types.html#integer-overflow
- https://doc.rust-lang.org/reference/expressions/operator-expr.html#numeric-cast
- https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html
- https://doc.rust-lang.org/edition-guide/rust-2024/static-mut-references.html
- https://tokio.rs/tokio/tutorial/shared-state#holding-a-mutexguard-across-an-await
- https://docs.rs/tokio/latest/tokio/index.html#cpu-bound-tasks-and-blocking-code
- https://doc.rust-lang.org/reference/attributes/diagnostics.html#the-must_use-attribute
- https://rust-lang.github.io/api-guidelines/dependability.html#c-dtor-fail
- https://doc.rust-lang.org/std/primitive.str.html#method.get
- https://doc.rust-lang.org/book/ch15-05-interior-mutability.html#keeping-track-of-borrows-at-runtime-with-refcellt
- https://rust-lang.github.io/api-guidelines/interoperability.html#c-good-err
- https://rust-lang.github.io/rust-clippy/master/index.html#redundant_clone
- https://rust-lang.github.io/rust-clippy/master/index.html#ptr_arg
- https://rust-lang.github.io/rust-clippy/master/index.html#needless_collect
- https://rust-lang.github.io/rust-clippy/master/index.html#mutex_atomic
