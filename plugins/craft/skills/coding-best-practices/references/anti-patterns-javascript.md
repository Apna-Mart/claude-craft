# JavaScript anti-patterns

Read this whole file before writing or reviewing JavaScript code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the JavaScript-specific traps. For TypeScript, also read `anti-patterns-typescript.md`.

## Contents

1. Floating promises
2. `async` callback passed to `forEach`
3. `innerHTML` with untrusted data
4. `eval`, `new Function` and string timers
5. Recursive merge that allows prototype pollution
6. Loose equality `==`
7. `var` and its function-scoped closures
8. Passing a method as a callback and losing `this`
9. `sort()` with no comparator, or sorting in place by accident
10. Parsing non-ISO date strings
11. `parseInt` as a validator
12. Comparing with `NaN`
13. Large integer IDs stored as numbers
14. `for...in` over arrays
15. Mutating arguments through a shallow copy
16. Throwing values that are not `Error`s
17. `await` inside a loop over independent work

## 1. Floating promises

**Avoid:** calling a promise-returning function without `await`, `return`, or a `.catch()`.
**Why:** the caller carries on as if the work succeeded, and a rejection goes unhandled; since Node.js 15 an unhandled rejection crashes the process by default.
**Instead:** `await` it inside `try`/`catch`, return it to the caller, or attach a `.catch()` that handles the error.

```js
// Bad
function onSubmit(form) {
  saveDraft(form);
  showToast("Saved");
}
```

```js
// Good
async function onSubmit(form) {
  try {
    await saveDraft(form);
    showToast("Saved");
  } catch (error) {
    showToast("Could not save");
    reportError(error);
  }
}
```

**Caught by:** typescript-eslint `no-floating-promises` (type-aware; JS files must be in the TS project via `allowJs`)
**Source:** https://nodejs.org/api/cli.html#--unhandled-rejectionsmode

## 2. `async` callback passed to `forEach`

**Avoid:** `array.forEach(async (item) => { await ... })`.
**Why:** `forEach` ignores the returned promises, so the code after it runs before any item finishes and every rejection is unhandled.
**Instead:** use `for...of` with `await` when items must run in order, or `await Promise.all(array.map(...))` when they are independent.

```js
// Bad
async function sendAll(messages) {
  messages.forEach(async (message) => {
    await send(message);
  });
  markDone();
}
```

```js
// Good
async function sendAll(messages) {
  for (const message of messages) {
    await send(message);
  }
  markDone();
}
```

**Caught by:** typescript-eslint `no-misused-promises` (`checksVoidReturn`; type-aware)
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach

## 3. `innerHTML` with untrusted data

**Avoid:** building HTML strings from user or server data and assigning them to `innerHTML`, `outerHTML` or `insertAdjacentHTML`.
**Why:** `<script>` tags do not run, but attributes such as `<img src=x onerror=...>` do, which is stored or reflected XSS.
**Instead:** create elements and set `textContent`; when real HTML from outside is required, sanitize it and enforce Trusted Types.

```js
// Bad
commentEl.innerHTML = `<p>${comment.author}: ${comment.text}</p>`;
```

```js
// Good
const paragraph = document.createElement("p");
paragraph.textContent = `${comment.author}: ${comment.text}`;
commentEl.replaceChildren(paragraph);
```

**Caught by:** `eslint-plugin-no-unsanitized` rules `property` and `method`
**Source:** https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML

## 4. `eval`, `new Function` and string timers

**Avoid:** `eval`, `new Function(...)`, and passing a string to `setTimeout` or `setInterval`.
**Why:** any input that reaches the string runs as code with the caller's privileges, and these calls are blocked by a strict Content Security Policy.
**Instead:** look the behaviour up in a `Map` of functions, and pass a function to timers.

```js
// Bad
const result = eval(`${a} ${operator} ${b}`);
setTimeout("refresh()", 1000);
```

```js
// Good
const OPERATIONS = new Map([["+", (x, y) => x + y], ["-", (x, y) => x - y]]);
const operation = OPERATIONS.get(operator);
if (!operation) throw new RangeError(`Unsupported operator: ${operator}`);
const result = operation(a, b);
setTimeout(refresh, 1000);
```

**Caught by:** ESLint `no-eval`, `no-implied-eval`, `no-new-func`
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval

## 5. Recursive merge that allows prototype pollution

**Avoid:** a deep merge or path setter that copies every key from parsed JSON or query input into an object.
**Why:** `JSON.parse` creates an own `__proto__` key, and `target["__proto__"]` is `Object.prototype`, so the merge writes attacker values onto every object in the process. Inherited keys such as `toString` resolve to shared builtins the same way.
**Instead:** skip `__proto__`, `constructor` and `prototype` keys, iterate the source's own keys, recurse only into the target's own keys, and use `Map` or `Object.create(null)` for key-value data.

```js
// Bad
function merge(target, source) {
  for (const key in source) {
    const value = source[key];
    target[key] = typeof value === "object" && value !== null
      ? merge(target[key] ?? {}, value)
      : value;
  }
  return target;
}
```

```js
// Good
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const isObject = typeof value === "object" && value !== null;
    const existing = Object.hasOwn(target, key) ? target[key] : {};
    target[key] = isObject ? merge(existing, value) : value;
  }
  return target;
}
```

**Source:** https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/Prototype_pollution

## 6. Loose equality `==`

**Avoid:** `==` and `!=`.
**Why:** they coerce types first, so `"" == 0`, `"0" == 0` and `[] == 0` are all `true`, and empty input passes checks meant for zero.
**Instead:** use `===` and `!==`, and convert input to the expected type at the boundary.

```js
// Bad
if (quantity == 0) showEmptyState();
if (status != "1") deactivate();
```

```js
// Good
if (quantity === 0) showEmptyState();
if (status !== "1") deactivate();
```

**Caught by:** ESLint `eqeqeq` (the `{ "null": "ignore" }` option allows the `x == null` idiom)
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness

## 7. `var` and its function-scoped closures

**Avoid:** declaring variables with `var`.
**Why:** `var` is function-scoped and hoisted, so every closure created in a loop shares one variable and sees its final value, and use before assignment gives `undefined` instead of an error.
**Instead:** use `const` by default and `let` when the binding is reassigned; `let` in a `for` header creates a new binding per iteration.

```js
// Bad
for (var i = 0; i < buttons.length; i++) {
  buttons[i].addEventListener("click", () => select(i));
}
```

```js
// Good
for (let i = 0; i < buttons.length; i++) {
  buttons[i].addEventListener("click", () => select(i));
}
```

**Caught by:** ESLint `no-var`, `prefer-const`
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/var

## 8. Passing a method as a callback and losing `this`

**Avoid:** passing `object.method` directly as a callback or event listener when the method uses `this`.
**Why:** the method is called without its object, so `this` is `undefined` in strict code (a `TypeError`) or the event target in a DOM listener (a silent wrong write).
**Instead:** wrap the call in an arrow function, or bind it once.

```js
// Bad
class Counter {
  count = 0;
  increment() { this.count += 1; }
}
const counter = new Counter();
button.addEventListener("click", counter.increment);
```

```js
// Good
const counter = new Counter();
button.addEventListener("click", () => counter.increment());
```

**Caught by:** typescript-eslint `unbound-method` (type-aware)
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this

## 9. `sort()` with no comparator, or sorting in place by accident

**Avoid:** `array.sort()` on numbers, and `sort()` or `reverse()` on an array the caller still uses.
**Why:** the default sort compares strings, so `[9, 10, 100]` becomes `[10, 100, 9]`, and `sort()` reorders the original array for every other holder.
**Instead:** pass a comparator, and use `toSorted()` or `toReversed()` to get a new array.

```js
// Bad
const ranked = scores.sort();
```

```js
// Good
const ranked = scores.toSorted((a, b) => a - b);
```

**Caught by:** typescript-eslint `require-array-sort-compare` (type-aware)
**Since:** ES2023 (`toSorted`, `toReversed`; Baseline since July 2023)
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted

## 10. Parsing non-ISO date strings

**Avoid:** `new Date(string)` or `Date.parse` on formats like `"03/04/2026"`, and on date-only ISO strings meant as local dates.
**Why:** non-ISO formats are implementation-defined and differ between engines, and `"2026-03-04"` parses as UTC midnight, which shows as March 3 west of Greenwich.
**Instead:** build local dates from numeric parts, and exchange instants as full ISO 8601 strings with an offset.

```js
// Bad
const due = new Date("03/04/2026");
const start = new Date("2026-03-04");
```

```js
// Good
const [year, month, day] = "2026-03-04".split("-").map(Number);
const start = new Date(year, month - 1, day);
const createdAt = new Date("2026-03-04T09:30:00Z");
```

**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse

## 11. `parseInt` as a validator

**Avoid:** `parseInt(value)` to read and validate numeric input.
**Why:** it stops at the first character it cannot parse, so `parseInt("8080abc")` is `8080` and `parseInt("1.5")` is `1`, which lets malformed input through.
**Instead:** use `Number(value)` and check `Number.isInteger` or `Number.isFinite`; when you do want prefix parsing, pass the radix.

```js
// Bad
const port = parseInt(process.env.PORT);
```

```js
// Good
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new RangeError(`Invalid PORT: ${process.env.PORT}`);
}
```

**Caught by:** ESLint `radix` (missing radix only)
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt

## 12. Comparing with `NaN`

**Avoid:** `x === NaN`, `x !== NaN`, and the global `isNaN(x)`.
**Why:** `NaN` is not equal to anything, itself included, so the check is always `false` (or always `true`), and global `isNaN("abc")` coerces and returns `true` for strings.
**Instead:** use `Number.isNaN(x)`, or `Number.isFinite(x)` when infinities are also invalid.

```js
// Bad
if (total === NaN) return 0;
```

```js
// Good
if (Number.isNaN(total)) return 0;
```

**Caught by:** ESLint `use-isnan`
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isNaN

## 13. Large integer IDs stored as numbers

**Avoid:** receiving 64-bit IDs, counters or amounts as JSON numbers.
**Why:** numbers above `Number.MAX_SAFE_INTEGER` (2^53 - 1) are rounded silently, so `9007199254740993` parses as `9007199254740992` and points at another record.
**Instead:** send such values as strings and keep them as strings, or convert to `BigInt` when you need arithmetic.

```js
// Bad
const { orderId } = JSON.parse('{"orderId": 9007199254740993}');
```

```js
// Good
const { orderId } = JSON.parse('{"orderId": "9007199254740993"}');
const nextId = BigInt(orderId) + 1n;
```

**Caught by:** ESLint `no-loss-of-precision` (numeric literals written in source only)
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER

## 14. `for...in` over arrays

**Avoid:** iterating an array with `for...in`.
**Why:** it yields string keys, and it also visits non-index and inherited enumerable properties, such as ones added to `Array.prototype`.
**Instead:** use `for...of`, or `entries()` when you need the index.

```js
// Bad
for (const i in items) {
  total += items[i].price;
}
```

```js
// Good
for (const item of items) {
  total += item.price;
}
```

**Caught by:** ESLint `guard-for-in`, or `no-restricted-syntax` configured with `ForInStatement`
**Source:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...in

## 15. Mutating arguments through a shallow copy

**Avoid:** assigning to properties of an argument, or spreading it and then mutating a nested object.
**Why:** objects are passed by reference and spread copies only one level, so the caller's object, including nested ones, changes behind its back.
**Instead:** return a new object and rebuild each nested level you change; use `structuredClone` when you need a full deep copy.

```js
// Bad
function withDefaults(options) {
  options.timeout ??= 5000;
  options.headers.Accept = "application/json";
  return options;
}
```

```js
// Good
function withDefaults(options) {
  return {
    ...options,
    timeout: options.timeout ?? 5000,
    headers: { ...options.headers, Accept: "application/json" },
  };
}
```

**Caught by:** ESLint `no-param-reassign` with `{ "props": true }`
**Source:** https://eslint.org/docs/latest/rules/no-param-reassign

## 16. Throwing values that are not `Error`s

**Avoid:** `throw "message"`, `throw { code }`, and `Promise.reject` with a non-`Error`.
**Why:** a non-`Error` has no stack trace, and handlers that read `error.message` or check `instanceof Error` break.
**Instead:** throw `Error` or a subclass, and put extra data in properties or `cause`.

```js
// Bad
if (!user) throw "User not found";
```

```js
// Good
class NotFoundError extends Error {
  name = "NotFoundError";
}
if (!user) throw new NotFoundError(`User ${id} not found`);
```

**Caught by:** ESLint `no-throw-literal`, `prefer-promise-reject-errors`
**Source:** https://eslint.org/docs/latest/rules/no-throw-literal

## 17. `await` inside a loop over independent work

**Avoid:** awaiting one request per iteration when the requests do not depend on each other.
**Why:** each request waits for the previous one, so total time is the sum of all of them instead of the slowest.
**Instead:** start them together with `Promise.all` (or `Promise.allSettled` when partial failure is acceptable), and cap concurrency for large lists.

```js
// Bad
const users = [];
for (const id of ids) {
  users.push(await fetchUser(id));
}
```

```js
// Good
const users = await Promise.all(ids.map((id) => fetchUser(id)));
```

**Caught by:** ESLint `no-await-in-loop`
**Source:** https://eslint.org/docs/latest/rules/no-await-in-loop

## Sources

- https://nodejs.org/api/cli.html#--unhandled-rejectionsmode
- https://typescript-eslint.io/rules/no-floating-promises/
- https://typescript-eslint.io/rules/no-misused-promises/
- https://typescript-eslint.io/troubleshooting/typed-linting/
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach
- https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML
- https://github.com/mozilla/eslint-plugin-no-unsanitized
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval
- https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/Prototype_pollution
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/var
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this
- https://typescript-eslint.io/rules/unbound-method/
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted
- https://typescript-eslint.io/rules/require-array-sort-compare/
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt
- https://eslint.org/docs/latest/rules/radix
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isNaN
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...in
- https://eslint.org/docs/latest/rules/no-param-reassign
- https://eslint.org/docs/latest/rules/no-throw-literal
- https://eslint.org/docs/latest/rules/no-await-in-loop
