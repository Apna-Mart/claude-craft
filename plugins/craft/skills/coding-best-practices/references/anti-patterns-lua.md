# Lua anti-patterns

Read this whole file before writing or reviewing Lua code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Lua-specific traps.

## Contents

1. Accidental globals from a missing `local`
2. `load`/`loadstring` on untrusted input
3. `#` on tables or varargs that can contain `nil`
4. Adding keys to a table while iterating it with `pairs`
5. `table.remove` inside a forward loop
6. `a and b or c` as a ternary when `b` can be `false` or `nil`
7. `not x == y` instead of `x ~= y`
8. Comparing numbers and strings with `==`
9. Expecting `0` or `""` to be false
10. Code that assumes one Lua version
11. Relying on `pairs` iteration order
12. Literal text passed to pattern functions
13. Off-by-one from 0-based habits
14. Mixing up `:` and `.` for methods
15. Recursive function declared with `local f = function`
16. Shadowing a local by redeclaring it
17. String concatenation in loops

## 1. Accidental globals from a missing `local`

**Avoid:** Assigning a variable or defining a function without `local`.
**Why:** Lua is global by default, so the name lands in the shared global table: two modules or two calls overwrite each other's state, a typo silently creates a new global, and reading a misspelled name returns `nil` instead of failing.
**Instead:** Declare every variable and function with `local`; on Lua 5.5, a chunk can start with `global<const> *` so that assigning any undeclared name is a compile error.

```lua
-- Bad
function count_words(line)
  count = 0
  for _ in line:gmatch("%S+") do count = count + 1 end
  return count
end
```

```lua
-- Good
local function count_words(line)
  local count = 0
  for _ in line:gmatch("%S+") do count = count + 1 end
  return count
end
```

**Caught by:** luacheck W111 (setting an undefined global), W113 (accessing an undefined global)
**Since:** `global` declarations need Lua 5.5.
**Source:** https://www.lua.org/manual/5.5/manual.html#2.2

## 2. `load`/`loadstring` on untrusted input

**Avoid:** Running user, network or config text with `load`, `loadstring` or `dofile` in the default environment.
**Why:** The chunk gets every global, including `os.execute`, `io.open` and `require`, so it can run commands or read files; a binary chunk can crash the interpreter, because Lua does not verify precompiled code.
**Instead:** Parse data with a real parser (JSON, a fixed format); if you must evaluate code, call `load` with mode `"t"` and a minimal environment table, and remember that this still does not stop infinite loops or memory exhaustion.

```lua
-- Bad
local fn = loadstring("return " .. user_expression)
local result = fn()
```

```lua
-- Good
local sandbox = { floor = math.floor, max = math.max }
local fn, err = load("return " .. user_expression, "=expr", "t", sandbox)
if not fn then return nil, err end
local ok, result = pcall(fn)
```

**Since:** The `mode` and `env` arguments of `load` need Lua 5.2 (LuaJIT 2.x also supports them); on Lua 5.1 use `loadstring` plus `setfenv`.
**Source:** https://www.lua.org/manual/5.5/manual.html#pdf-load

## 3. `#` on tables or varargs that can contain `nil`

**Avoid:** Using `#t` or `{...}` to count elements when any element can be `nil`.
**Why:** `#` returns any border of the table, so with a hole it can return the position before or after the hole, and the result differs between implementations (`#{1, 2, nil, 4}` is 2 on Lua 5.5 and 4 on LuaJIT); loops then skip trailing values or stop early.
**Instead:** Track the count yourself, use `table.pack(...)` and its `n` field, or `select("#", ...)` for varargs.

```lua
-- Bad
local function log_all(...)
  local args = {...}
  for i = 1, #args do print(i, args[i]) end
end
```

```lua
-- Good
local function log_all(...)
  local args = table.pack(...)
  for i = 1, args.n do print(i, args[i]) end
end
```

**Since:** `table.pack` needs Lua 5.2 (LuaJIT only with `LUAJIT_ENABLE_LUA52COMPAT`); otherwise use `select("#", ...)`.
**Source:** https://www.lua.org/manual/5.5/manual.html#3.4.7

## 4. Adding keys to a table while iterating it with `pairs`

**Avoid:** Assigning to a key that does not yet exist in a table while a `pairs`/`next` traversal of that table is running.
**Why:** The manual says not to do it; in practice the traversal can skip keys, visit the new keys, or fail with "invalid key to 'next'".
**Instead:** Build a new table, or collect the changes and apply them after the loop; changing or clearing existing fields during traversal is allowed.

```lua
-- Bad
for name, value in pairs(headers) do
  headers[name:lower()] = value
end
```

```lua
-- Good
local normalized = {}
for name, value in pairs(headers) do
  normalized[name:lower()] = value
end
```

**Source:** https://www.lua.org/manual/5.5/manual.html#pdf-next

## 5. `table.remove` inside a forward loop

**Avoid:** Calling `table.remove(t, i)` while walking `t` forward with `ipairs` or `for i = 1, #t`.
**Why:** Each removal shifts the following elements down by one, so the loop skips the element right after every removed one.
**Instead:** Iterate backwards with `for i = #t, 1, -1`, or build a new filtered table.

```lua
-- Bad
for i, item in ipairs(items) do
  if item.expired then table.remove(items, i) end
end
```

```lua
-- Good
for i = #items, 1, -1 do
  if items[i].expired then table.remove(items, i) end
end
```

**Source:** https://www.lua.org/manual/5.5/manual.html#pdf-table.remove

## 6. `a and b or c` as a ternary when `b` can be `false` or `nil`

**Avoid:** `cond and x or y` when `x` can be `false` or `nil`.
**Why:** If `x` is falsy the `or` falls through to `y`, so `opts.enabled ~= nil and opts.enabled or true` returns `true` when the caller passed `false`.
**Instead:** Use an `if` statement, or a direct comparison when it states the intent.

```lua
-- Bad
local enabled = opts.enabled ~= nil and opts.enabled or true
```

```lua
-- Good
local enabled = true
if opts.enabled ~= nil then enabled = opts.enabled end
```

**Source:** https://www.lua.org/pil/3.3.html

## 7. `not x == y` instead of `x ~= y`

**Avoid:** Negating a comparison as `not a == b`.
**Why:** `not` binds tighter than `==`, so the expression is `(not a) == b`, which compares a Boolean with `b` and is almost always `false`; guards written this way never fire.
**Instead:** Use `~=`.

```lua
-- Bad
if not user.role == "admin" then return deny() end
```

```lua
-- Good
if user.role ~= "admin" then return deny() end
```

**Caught by:** luacheck W582 (error-prone negation: negation has a higher priority than equality)
**Source:** https://www.lua.org/manual/5.5/manual.html#3.4.8

## 8. Comparing numbers and strings with `==`

**Avoid:** Comparing a value read from input, environment or a file with a number literal using `==`.
**Why:** `==` never converts types, so `"8080" == 8080` is `false`, while arithmetic does convert (`"10" + 1` is `11`) and `<` between a string and a number raises an error; the inconsistency hides the bug until a branch silently never runs.
**Instead:** Convert once at the boundary with `tonumber` (or `tostring`) and handle a `nil` result.

```lua
-- Bad
local port = os.getenv("PORT")
if port == 8080 then use_default_tls() end
```

```lua
-- Good
local port = tonumber(os.getenv("PORT"))
if port == 8080 then use_default_tls() end
```

**Source:** https://www.lua.org/manual/5.5/manual.html#3.4.4

## 9. Expecting `0` or `""` to be false

**Avoid:** Using a number or string directly as a condition to mean "non-zero" or "non-empty".
**Why:** Only `nil` and `false` are falsy in Lua; `0` and `""` are true, so a count of zero or an empty string passes the check.
**Instead:** Compare explicitly: `n > 0`, `s ~= ""`, `next(t) ~= nil` for a non-empty table.

```lua
-- Bad
local function has_items(list) return #list end
if has_items(cart) then checkout(cart) end
```

```lua
-- Good
local function has_items(list) return #list > 0 end
if has_items(cart) then checkout(cart) end
```

**Source:** https://www.lua.org/manual/5.5/manual.html#3.4.5

## 10. Code that assumes one Lua version

**Avoid:** Writing code for Lua 5.1/LuaJIT and running it on 5.3+, or the reverse, without checking the version-specific behavior.
**Why:** Since 5.3, `/` always returns a float, so `"page-" .. 10 / 2` gives `"page-5.0"` instead of `"page-5"`; `unpack` and `setfenv` are gone after 5.1; `//` is a syntax error in 5.1 and LuaJIT, and the bitwise operators `& | ~ << >>` are syntax errors in 5.1 and in LuaJIT before 2.1.1784535649 (use `require("bit")` there); 5.5 makes `global` a reserved word and for-loop control variables read-only.
**Instead:** Pin the target version, use constructs that behave the same on all targets (`math.floor`, `table.unpack or unpack`), and run luacheck with the matching `--std`.

```lua
-- Bad
local label = "page-" .. total / per_page
local first, second = unpack(pair)
```

```lua
-- Good
local unpack = table.unpack or unpack
local label = "page-" .. math.floor(total / per_page)
local first, second = unpack(pair)
```

**Caught by:** luacheck `--std lua51|lua52|lua53|lua54|luajit` reports globals missing from the target version as W113 (luacheck 1.2.0 has no Lua 5.5 set)
**Since:** `//` and bitwise operators need Lua 5.3 (LuaJIT has bitwise operators from 2.1.1784535649 and no `//`); `table.unpack` needs 5.2 (LuaJIT only with `LUAJIT_ENABLE_LUA52COMPAT`); `goto` needs 5.2 or LuaJIT.
**Source:** https://www.lua.org/manual/5.5/manual.html#8

## 11. Relying on `pairs` iteration order

**Avoid:** Building output, cache keys, signatures or test expectations from the order of a `pairs` loop.
**Why:** The traversal order is not specified, even for numeric keys, and it changes with insertion history, table size and between Lua and LuaJIT, so the same data produces different strings.
**Instead:** Collect the keys, sort them, then iterate over the sorted list; use `ipairs` or a numeric `for` for arrays.

```lua
-- Bad
local parts = {}
for key, value in pairs(params) do
  parts[#parts + 1] = key .. "=" .. value
end
```

```lua
-- Good
local keys = {}
for key in pairs(params) do keys[#keys + 1] = key end
table.sort(keys)
local parts = {}
for i, key in ipairs(keys) do parts[i] = key .. "=" .. params[key] end
```

**Source:** https://www.lua.org/manual/5.5/manual.html#pdf-next

## 12. Literal text passed to pattern functions

**Avoid:** Passing literal text that contains `^$()%.[]*+-?` to `string.find`, `match`, `gmatch` or `gsub`.
**Why:** These functions treat the argument as a Lua pattern, so `name:find(".tmp")` matches any character followed by `tmp`, and `s:gsub("(USD)", "EUR")` treats the parentheses as a capture and leaves them in the result.
**Instead:** Pass `plain = true` to `string.find` (`s:find(text, 1, true)`), or escape magic characters with `%` before building a pattern.

```lua
-- Bad
local is_temp = name:find(".tmp") ~= nil
```

```lua
-- Good
local is_temp = name:find(".tmp", 1, true) ~= nil
```

**Source:** https://www.lua.org/manual/5.5/manual.html#pdf-string.find

## 13. Off-by-one from 0-based habits

**Avoid:** Loops from `0` to `#t - 1`, and treating `string.sub` end indexes as exclusive.
**Why:** Lua sequences start at 1, so index 0 reads `nil` and the last element is skipped; `string.sub(s, i, j)` includes both ends.
**Instead:** Loop `for i = 1, #t` (or use `ipairs`), and use inclusive ends with `string.sub`.

```lua
-- Bad
for i = 0, #items - 1 do
  print(items[i])
end
```

```lua
-- Good
for i = 1, #items do
  print(items[i])
end
```

**Source:** https://www.lua.org/manual/5.5/manual.html#3.4.7

## 14. Mixing up `:` and `.` for methods

**Avoid:** Calling a method with `obj.method(x)` when it was defined with `:`, or defining with `.` and then using `self`.
**Why:** `obj:method(x)` passes `obj` as the hidden first argument `self`. A method defined with `:` but called with `.` takes the first explicit argument as `self` and fails with "attempt to index a number value (local 'self')"; a function defined with `.` that uses `self` reads the global `self`, which is `nil`.
**Instead:** Define methods with `function Class:method(...)` and call them with `obj:method(...)`.

```lua
-- Bad
function Account.deposit(amount) self.balance = self.balance + amount end
account.deposit(5)
```

```lua
-- Good
function Account:deposit(amount) self.balance = self.balance + amount end
account:deposit(5)
```

**Caught by:** luacheck W113 when a function defined with `.` uses `self` (accessing an undefined global)
**Source:** https://www.lua.org/manual/5.5/manual.html#3.4.11

## 15. Recursive function declared with `local f = function`

**Avoid:** `local f = function(...) ... f(...) ... end` for a function that calls itself.
**Why:** The local `f` is not in scope inside its own initializer, so the inner `f` refers to a global, which is `nil`, and the first recursive call fails with "attempt to call a nil value".
**Instead:** Use `local function f(...)`, which declares `f` before assigning the function.

```lua
-- Bad
local factorial = function(n)
  if n <= 1 then return 1 end
  return n * factorial(n - 1)
end
```

```lua
-- Good
local function factorial(n)
  if n <= 1 then return 1 end
  return n * factorial(n - 1)
end
```

**Caught by:** luacheck W113 (accessing an undefined global)
**Source:** https://www.lua.org/manual/5.5/manual.html#3.4.11

## 16. Shadowing a local by redeclaring it

**Avoid:** Writing `local x = ...` inside a block when you meant to update an outer `x`.
**Why:** The inner `local` creates a new variable that disappears at the end of the block, so the outer value never changes and the function returns the initial value.
**Instead:** Assign without `local` to update the outer variable, and give genuinely new variables new names.

```lua
-- Bad
local total = 0
for _, item in ipairs(cart) do
  local total = total + item.price
end
return total
```

```lua
-- Good
local total = 0
for _, item in ipairs(cart) do
  total = total + item.price
end
return total
```

**Caught by:** luacheck W421 (shadowing a local variable), W431 (shadowing an upvalue)
**Source:** https://luacheck.readthedocs.io/en/stable/warnings.html

## 17. String concatenation in loops

**Avoid:** Growing a string with `s = s .. piece` inside a loop.
**Why:** Strings are immutable, so each `..` copies the whole accumulated string; building a large result this way is quadratic in time and creates heavy garbage.
**Instead:** Put the pieces in a table and join them once with `table.concat`.

```lua
-- Bad
local csv = ""
for _, row in ipairs(rows) do
  csv = csv .. row.id .. "," .. row.name .. "\n"
end
```

```lua
-- Good
local lines = {}
for i, row in ipairs(rows) do
  lines[i] = row.id .. "," .. row.name .. "\n"
end
local csv = table.concat(lines)
```

**Source:** https://www.lua.org/pil/11.6.html

## Sources

- https://www.lua.org/manual/5.5/manual.html#2.2
- https://www.lua.org/manual/5.5/manual.html#3.3.7
- https://www.lua.org/manual/5.5/manual.html#pdf-load
- https://www.lua.org/manual/5.5/manual.html#3.4.7
- https://www.lua.org/manual/5.5/manual.html#pdf-next
- https://www.lua.org/manual/5.5/manual.html#pdf-table.remove
- https://www.lua.org/manual/5.5/manual.html#pdf-table.pack
- https://www.lua.org/manual/5.5/manual.html#3.4.4
- https://www.lua.org/manual/5.5/manual.html#3.4.5
- https://www.lua.org/manual/5.5/manual.html#3.4.8
- https://www.lua.org/manual/5.5/manual.html#3.4.11
- https://www.lua.org/manual/5.5/manual.html#pdf-string.find
- https://www.lua.org/manual/5.5/manual.html#8
- https://www.lua.org/versions.html
- https://www.lua.org/pil/3.3.html
- https://www.lua.org/pil/11.6.html
- https://luajit.org/extensions.html
- https://luacheck.readthedocs.io/en/stable/warnings.html
- https://luacheck.readthedocs.io/en/stable/cli.html
