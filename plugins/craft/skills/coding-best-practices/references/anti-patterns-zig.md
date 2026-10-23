# Zig anti-patterns

Read this whole file before writing or reviewing Zig code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Zig-specific traps.

Checked against Zig 0.17.0, the latest stable release (2026-10-01). Zig is pre-1.0 and its standard library changes in every release: read `minimum_zig_version` in the project's `build.zig.zon` and confirm each API against the docs for that version before using it. Notable recent renames: `GeneralPurposeAllocator` became `DebugAllocator` in 0.14.0, and `DebugAllocator` is deprecated in favor of `SafeAllocator` in 0.17.0; the optimize modes `ReleaseSafe`, `ReleaseFast` and `ReleaseSmall` are `safe`, `fast` and `small` in 0.17.0.

## Contents

1. `catch unreachable` on errors that can happen
2. Unchecked `@intCast` and `@truncate`
3. Arithmetic that can overflow
4. Returning a slice of stack memory
5. Keeping element pointers across `ArrayList` growth
6. Reading `undefined` memory
7. `.?` on optionals that can be null
8. Missing `errdefer` on the error path
9. `defer` that frees memory which escapes the block
10. Swallowing errors with `catch {}`
11. Running without leak detection
12. Hidden allocation through a global allocator
13. Shipping `fast` for code that handles untrusted input
14. Forgetting to flush a buffered writer
15. `page_allocator` for small allocations
16. `anytype` where a concrete type fits

## 1. `catch unreachable` on errors that can happen

**Avoid:** `catch unreachable` (or `std.debug.assert`) on an error that depends on input, the file system, the network or memory.
**Why:** in `debug` and `safe` builds it panics, and in `fast` and `small` builds the optimizer assumes the error never happens, so a bad input becomes unchecked illegal behavior.
**Instead:** propagate with `try`, or map the error with `catch return error.X`, and keep `catch unreachable` for errors the code proves impossible.

```zig
// Bad
const port = std.fmt.parseInt(u16, text, 10) catch unreachable;
```

```zig
// Good
const port = std.fmt.parseInt(u16, text, 10) catch return error.InvalidPort;
```

**Source:** https://ziglang.org/documentation/0.17.0/#unreachable

## 2. Unchecked `@intCast` and `@truncate`

**Avoid:** `@intCast` on a value that may not fit the target type, and `@truncate` as a general-purpose narrowing cast.
**Why:** an out-of-range `@intCast` panics in safe builds and is unchecked illegal behavior in `fast`; `@truncate` is always defined but silently drops the high bits.
**Instead:** use `std.math.cast(T, x)`, which returns `null` when the value does not fit, and keep `@truncate` for code that intends to drop bits.

```zig
// Bad
const len: u16 = @intCast(payload.len);
```

```zig
// Good
const len = std.math.cast(u16, payload.len) orelse return error.PayloadTooLarge;
```

**Source:** https://ziglang.org/documentation/0.17.0/#intCast

## 3. Arithmetic that can overflow

**Avoid:** plain `+`, `-` and `*` on integers derived from input, sizes or counters without deciding what overflow means.
**Why:** overflow panics in `debug` and `safe` builds and is unchecked illegal behavior in `fast` and `small` builds.
**Instead:** use `std.math.add`, `std.math.mul` and friends to get `error.Overflow`, `+%` and `*%` when wrap-around is intended, or `+|` and `*|` to saturate.

```zig
// Bad
const total = unit_price * quantity;
```

```zig
// Good
const total = try std.math.mul(u64, unit_price, quantity);
```

**Source:** https://ziglang.org/documentation/0.17.0/#Integer-Overflow

## 4. Returning a slice of stack memory

**Avoid:** returning a slice or pointer to a local array or variable, or storing one in a struct that outlives the function.
**Why:** the stack frame is reused once the function returns, so the caller reads bytes that later calls overwrite.
**Instead:** let the caller pass the buffer, or take an `Allocator` and return memory the caller owns and frees.

```zig
// Bad
fn formatId(id: u32) ![]const u8 {
    var buf: [16]u8 = undefined;
    return std.fmt.bufPrint(&buf, "id-{d}", .{id});
}
```

```zig
// Good
fn formatId(buf: []u8, id: u32) ![]u8 {
    return std.fmt.bufPrint(buf, "id-{d}", .{id});
}
```

**Source:** https://ziglang.org/documentation/0.17.0/#Where-are-the-bytes

## 5. Keeping element pointers across `ArrayList` growth

**Avoid:** holding `&list.items[i]` or the `list.items` slice across `append`, `insert` or any call that can grow the list.
**Why:** growth reallocates the backing memory, so the old pointer refers to freed memory and writes through it are lost or corrupt the heap.
**Instead:** keep an index and look the element up again after the list changes.

```zig
// Bad
const first = &list.items[0];
try list.append(gpa, item);
first.count += 1;
```

```zig
// Good
try list.append(gpa, item);
list.items[0].count += 1;
```

**Source:** https://ziglang.org/documentation/0.17.0/#Lifetime-and-Ownership

## 6. Reading `undefined` memory

**Avoid:** declaring `var x: T = undefined;` and reading it, or any part of it, before every byte has been written.
**Why:** the value is meaningless; `debug` and `safe` builds fill it with `0xaa` bytes, so the bug shows up as strange numbers there and as arbitrary data in `fast`.
**Instead:** initialize with a real value (`@splat(0)` for arrays, a struct literal, `.empty` for containers) and use `undefined` only for buffers that are fully written before they are read.

```zig
// Bad
var counts: [256]u32 = undefined;
for (input) |byte| counts[byte] += 1;
```

```zig
// Good
var counts: [256]u32 = @splat(0);
for (input) |byte| counts[byte] += 1;
```

**Source:** https://ziglang.org/documentation/0.17.0/#undefined

## 7. `.?` on optionals that can be null

**Avoid:** unwrapping with `.?` when `null` is a real outcome, such as a map lookup with a key from input.
**Why:** `.?` on `null` panics in safe builds and is unchecked illegal behavior in `fast` and `small`.
**Instead:** handle the `null` case with `orelse` or `if (opt) |value|`.

```zig
// Bad
const user = users.get(id).?;
```

```zig
// Good
const user = users.get(id) orelse return error.UnknownUser;
```

**Source:** https://ziglang.org/documentation/0.17.0/#Attempt-to-Unwrap-Null

## 8. Missing `errdefer` on the error path

**Avoid:** acquiring a resource that the function returns on success but not releasing it when a later step fails.
**Why:** when the second `try` fails, the first allocation or handle has no owner and leaks.
**Instead:** put `errdefer release(x);` right after each acquisition that the function hands back on success. Do not write `errdefer |err|`; 0.17.0 removed the capture, so log the error with `catch |err|` at the call site.

```zig
// Bad
fn initBuffers(gpa: std.mem.Allocator) !Buffers {
    const input = try gpa.alloc(u8, 4096);
    const output = try gpa.alloc(u8, 4096);
    return .{ .input = input, .output = output };
}
```

```zig
// Good
fn initBuffers(gpa: std.mem.Allocator) !Buffers {
    const input = try gpa.alloc(u8, 4096);
    errdefer gpa.free(input);
    const output = try gpa.alloc(u8, 4096);
    return .{ .input = input, .output = output };
}
```

**Source:** https://ziglang.org/documentation/0.17.0/#errdefer

## 9. `defer` that frees memory which escapes the block

**Avoid:** `defer gpa.free(x)` (or `deinit`) on memory that is returned, stored in a container, or kept in a struct.
**Why:** `defer` runs when the enclosing block exits, including a loop body, so the container ends up holding freed memory.
**Instead:** use `errdefer` for memory whose ownership moves on success, and `defer` only for memory that dies in this block.

```zig
// Bad
for (raw_names) |raw| {
    const name = try gpa.dupe(u8, raw);
    defer gpa.free(name);
    try names.append(gpa, name);
}
```

```zig
// Good
for (raw_names) |raw| {
    const name = try gpa.dupe(u8, raw);
    errdefer gpa.free(name);
    try names.append(gpa, name);
}
```

**Source:** https://ziglang.org/documentation/0.17.0/#defer

## 10. Swallowing errors with `catch {}`

**Avoid:** `catch {}`, or a `catch` that only logs and continues, on an operation whose failure matters.
**Why:** the program carries on as if the write, flush or save succeeded, and the data loss shows up much later.
**Instead:** propagate with `try`, or handle the specific errors in a `switch` and propagate the rest.

```zig
// Bad
out.flush() catch {};
```

```zig
// Good
try out.flush();
```

**Source:** https://ziglang.org/documentation/0.17.0/#catch

## 11. Running without leak detection

**Avoid:** building the program and its tests on `std.heap.page_allocator` or `std.heap.c_allocator` in development, where nothing reports leaks.
**Why:** a missing `free` or `deinit` never shows up, and long-running processes slowly run out of memory.
**Instead:** take `init.gpa` from `std.process.Init` in `main` (debug builds set up leak checking), use `std.testing.allocator` in tests, and when you build your own, use `std.heap.SafeAllocator` and check that `deinit()` returns `0`.

```zig
// Bad
pub fn main() !void {
    try run(std.heap.page_allocator);
}
```

```zig
// Good
pub fn main(init: std.process.Init) !void {
    try run(init.gpa);
}
```

**Since:** 0.16.0 for `std.process.Init`; 0.17.0 for `std.heap.SafeAllocator`
**Source:** https://ziglang.org/download/0.17.0/release-notes.html#SafeAllocator-Introduced

## 12. Hidden allocation through a global allocator

**Avoid:** functions that allocate through `std.heap.page_allocator`, a global, or a container-level allocator instead of an `Allocator` parameter.
**Why:** callers cannot choose an arena, a fixed buffer or a leak-checking allocator, cannot see that the function allocates, and cannot test it for `error.OutOfMemory`.
**Instead:** accept `gpa: std.mem.Allocator` as a parameter and state that the caller owns the returned memory.

```zig
// Bad
fn joinNames(names: []const []const u8) ![]u8 {
    return std.mem.join(std.heap.page_allocator, ", ", names);
}
```

```zig
// Good
fn joinNames(gpa: std.mem.Allocator, names: []const []const u8) ![]u8 {
    return std.mem.join(gpa, ", ", names);
}
```

**Source:** https://ziglang.org/documentation/0.17.0/#Choosing-an-Allocator

## 13. Shipping `fast` for code that handles untrusted input

**Avoid:** building parsers, network services or anything fed untrusted data with `-Doptimize=fast` or `small`.
**Why:** those modes disable safety checks, so an out-of-bounds index, overflow or bad cast that would have panicked becomes unchecked illegal behavior an attacker can steer.
**Instead:** ship `safe`, and if a measured hot loop needs it, turn checks off only there with `@setRuntimeSafety(false)`.

```sh
# Bad
zig build -Doptimize=fast
```

```sh
# Good
zig build -Doptimize=safe
```

**Since:** 0.17.0 for the names `safe` and `fast` (previously `ReleaseSafe` and `ReleaseFast`)
**Source:** https://ziglang.org/documentation/0.17.0/#Optimization-Mode

## 14. Forgetting to flush a buffered writer

**Avoid:** writing through a buffered `std.Io.Writer` and returning without calling `flush`.
**Why:** the last buffer's worth of output stays in memory and never reaches the file or terminal.
**Instead:** call `try writer.flush()` once all output is written, before the buffer goes out of scope.

```zig
// Bad
var buffer: [4096]u8 = undefined;
var file_writer: std.Io.File.Writer = .init(.stdout(), io, &buffer);
const out = &file_writer.interface;
try out.print("{d} rows\n", .{count});
```

```zig
// Good
var buffer: [4096]u8 = undefined;
var file_writer: std.Io.File.Writer = .init(.stdout(), io, &buffer);
const out = &file_writer.interface;
try out.print("{d} rows\n", .{count});
try out.flush();
```

**Since:** 0.15.1 for the buffered `std.Io.Writer` interface; the `std.Io.File.Writer.init(file, io, buffer)` form shown is the 0.17.0 API
**Source:** https://ziglang.org/download/0.15.1/release-notes.html#Writergate

## 15. `page_allocator` for small allocations

**Avoid:** using `std.heap.page_allocator` directly for many small objects such as list nodes or strings.
**Why:** it makes a system call for every allocation and free and rounds each one up to whole pages, so it is slow and wastes memory.
**Instead:** use the general-purpose allocator you were given, an `ArenaAllocator` for allocations freed together, or `std.heap.smp_allocator` in `fast` builds.

```zig
// Bad
for (lines) |line| {
    const node = try std.heap.page_allocator.create(Node);
    node.* = .{ .text = line };
    tree.insert(node);
}
```

```zig
// Good
var arena: std.heap.ArenaAllocator = .init(gpa);
defer arena.deinit();
const allocator = arena.allocator();
for (lines) |line| {
    const node = try allocator.create(Node);
    node.* = .{ .text = line };
    tree.insert(node);
}
```

**Source:** https://ziglang.org/documentation/0.17.0/#Choosing-an-Allocator

## 16. `anytype` where a concrete type fits

**Avoid:** `anytype` parameters for values whose type is known, such as a writer, a slice of records, or an allocator.
**Why:** the signature no longer says what the function accepts, errors appear deep inside the body at each call site, and every distinct argument type compiles another copy of the function.
**Instead:** use the concrete type (`*std.Io.Writer`, `[]const Row`, `std.mem.Allocator`) or an explicit `comptime T: type` parameter when the function is truly generic.

```zig
// Bad
fn writeReport(out: anytype, rows: anytype) !void {
    for (rows) |row| try out.print("{s}: {d}\n", .{ row.name, row.total });
}
```

```zig
// Good
fn writeReport(out: *std.Io.Writer, rows: []const Row) std.Io.Writer.Error!void {
    for (rows) |row| try out.print("{s}: {d}\n", .{ row.name, row.total });
}
```

**Since:** 0.15.1 for the non-generic `std.Io.Writer`
**Source:** https://ziglang.org/documentation/0.17.0/#Function-Parameter-Type-Inference

## Sources

- https://ziglang.org/download/
- https://ziglang.org/documentation/0.17.0/#unreachable
- https://ziglang.org/documentation/0.17.0/#intCast
- https://ziglang.org/documentation/0.17.0/#Integer-Overflow
- https://ziglang.org/documentation/0.17.0/#Where-are-the-bytes
- https://ziglang.org/documentation/0.17.0/#Lifetime-and-Ownership
- https://ziglang.org/documentation/0.17.0/#undefined
- https://ziglang.org/documentation/0.17.0/#Attempt-to-Unwrap-Null
- https://ziglang.org/documentation/0.17.0/#errdefer
- https://ziglang.org/documentation/0.17.0/#defer
- https://ziglang.org/documentation/0.17.0/#catch
- https://ziglang.org/documentation/0.17.0/#Choosing-an-Allocator
- https://ziglang.org/documentation/0.17.0/#Optimization-Mode
- https://ziglang.org/documentation/0.17.0/#Function-Parameter-Type-Inference
- https://ziglang.org/download/0.17.0/release-notes.html#SafeAllocator-Introduced
- https://ziglang.org/download/0.17.0/release-notes.html#codeerrdefercode-Capture-Removed
- https://ziglang.org/download/0.16.0/release-notes.html#Juicy-Main
- https://ziglang.org/download/0.15.1/release-notes.html#Writergate
- https://ziglang.org/download/0.14.0/release-notes.html#DebugAllocator
- https://codeberg.org/ziglang/zig/raw/tag/0.17.0/lib/std/heap/SafeAllocator.zig
