# TypeScript anti-patterns

Read this whole file before writing or reviewing TypeScript code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the TypeScript-specific traps. `anti-patterns-javascript.md` also applies to every TypeScript file.

## Contents

1. `any` in place of a real type
2. Asserting the type of parsed JSON instead of checking it
3. `as` casts to silence the compiler
4. Non-null assertion `!`
5. Floating and misused promises
6. Turning off strict checks
7. Assuming indexed access is always defined
8. Treating `catch` variables as `any`
9. `@ts-ignore`
10. Non-exhaustive `switch` over a union
11. Optional chaining on values the types say are present
12. `||` for defaults
13. `Function`, `Object`, `{}` and wrapper types
14. Reaching for `enum` by default
15. Annotating a constant and losing its literal type
16. Object intersections where `interface extends` fits

## 1. `any` in place of a real type

**Avoid:** typing values as `any`, explicitly or through untyped parameters.
**Why:** `any` turns off checking for the value and everything it flows into, so typos and wrong shapes reach runtime with no error.
**Instead:** write the real type; use `unknown` for values that are truly unknown and narrow them before use.

```ts
// Bad
function total(items: any) {
  return items.reduce((sum: number, item: any) => sum + item.price, 0);
}
```

```ts
// Good
interface LineItem { price: number }

function total(items: readonly LineItem[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

**Caught by:** compiler `noImplicitAny` (part of `strict`); typescript-eslint `no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, `no-unsafe-argument`
**Source:** https://www.typescriptlang.org/docs/handbook/2/everyday-types.html

## 2. Asserting the type of parsed JSON instead of checking it

**Avoid:** `JSON.parse(text) as T` or `(await response.json()) as T`.
**Why:** both return `any`, so the assertion is a promise the compiler cannot check, and a changed API shape fails far from the boundary.
**Instead:** treat the result as `unknown` and validate it with a type guard or a schema library before use.

```ts
// Bad
const user = (await response.json()) as User;
sendWelcome(user.email.toLowerCase());
```

```ts
// Good
function isUser(value: unknown): value is User {
  return typeof value === "object" && value !== null
    && "email" in value && typeof value.email === "string";
}

const body: unknown = await response.json();
if (!isUser(body)) throw new Error("Unexpected /user payload");
sendWelcome(body.email.toLowerCase());
```

**Caught by:** typescript-eslint `no-unsafe-type-assertion` (reports assertions from `any`), or `consistent-type-assertions` with `assertionStyle: "never"`
**Since:** TypeScript 4.9 (`in` narrowing of unlisted properties used by the guard)
**Source:** https://www.typescriptlang.org/docs/handbook/2/narrowing.html

## 3. `as` casts to silence the compiler

**Avoid:** `{} as T`, `value as unknown as T`, or any `as` added only to make an error go away.
**Why:** an assertion tells the compiler to stop checking, so a missing property or wrong type becomes a runtime crash instead of a compile error.
**Instead:** annotate the variable so the compiler checks the value, or convert the value for real.

```ts
// Bad
const config = {} as Config;
const port = input as unknown as number;
```

```ts
// Good
const config: Config = { host: "localhost", port: 8080 };
const port = Number(input);
```

**Caught by:** typescript-eslint `consistent-type-assertions` (`objectLiteralTypeAssertions: "never"`), `no-unsafe-type-assertion`
**Source:** https://typescript-eslint.io/rules/consistent-type-assertions/

## 4. Non-null assertion `!`

**Avoid:** `value!` and definite-assignment fields `field!: T` where `undefined` or `null` can really occur.
**Why:** `!` removes `null` and `undefined` from the type without any runtime check, so the crash moves to the next property access.
**Instead:** check the value and handle the missing case, or initialize the field in the constructor.

```ts
// Bad
const user = users.find((u) => u.id === id)!;
notify(user.email);
```

```ts
// Good
const user = users.find((u) => u.id === id);
if (!user) throw new Error(`No user with id ${id}`);
notify(user.email);
```

**Caught by:** typescript-eslint `no-non-null-assertion`, `no-non-null-asserted-optional-chain`
**Source:** https://typescript-eslint.io/rules/no-non-null-assertion/

## 5. Floating and misused promises

**Avoid:** leaving a promise unhandled, passing an `async` function where a `void` callback is expected, and prefixing a call with `void` to quiet the linter.
**Why:** rejections go unhandled and callers move on before the work completes; `void` only hides the lint, the rejection is still unhandled.
**Instead:** `await` or return the promise, or end the chain with a `.catch()` that handles the error.

```ts
// Bad
button.addEventListener("click", async () => {
  await saveDraft();
});
void syncInBackground();
```

```ts
// Good
button.addEventListener("click", () => {
  saveDraft().catch(reportError);
});
syncInBackground().catch(reportError);
```

**Caught by:** typescript-eslint `no-floating-promises` (set `ignoreVoid: false` to report `void`), `no-misused-promises`
**Source:** https://typescript-eslint.io/rules/no-floating-promises/

## 6. Turning off strict checks

**Avoid:** `"strict": false`, or switching off members of the strict family such as `strictNullChecks`.
**Why:** without strict mode `null` and `undefined` fit every type and implicit `any` is allowed, so most of the bugs in this file compile cleanly.
**Instead:** keep `strict` on and add the stricter flags that `strict` does not include.

```jsonc
// Bad
{ "compilerOptions": { "strict": false } }
```

```jsonc
// Good
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

**Since:** TypeScript 6.0 makes `strict` the default; `noUncheckedIndexedAccess` needs 4.1, `exactOptionalPropertyTypes` needs 4.4
**Source:** https://www.typescriptlang.org/tsconfig/#strict

## 7. Assuming indexed access is always defined

**Avoid:** reading `array[i]` or `record[key]` and using the result as if it must exist.
**Why:** by default TypeScript types `items[0]` as `T` even for an empty array, so the missing case crashes at runtime.
**Instead:** enable `noUncheckedIndexedAccess` so the result is `T | undefined`, and handle the `undefined` case.

```ts
// Bad
const first = items[0];
render(first.name);
```

```ts
// Good
const first = items[0];
if (first === undefined) return;
render(first.name);
```

**Caught by:** compiler option `noUncheckedIndexedAccess`
**Since:** TypeScript 4.1
**Source:** https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess

## 8. Treating `catch` variables as `any`

**Avoid:** `catch (error: any)`, or reading `error.message` without narrowing.
**Why:** JavaScript can throw any value, so `error.message` is `undefined` or throws when a string or plain object was thrown.
**Instead:** keep the variable `unknown` and narrow with `instanceof Error` before reading fields.

```ts
// Bad
try {
  await upload(file);
} catch (error: any) {
  showToast(error.message);
}
```

```ts
// Good
try {
  await upload(file);
} catch (error) {
  showToast(error instanceof Error ? error.message : "Upload failed");
}
```

**Caught by:** compiler `useUnknownInCatchVariables` (part of `strict`); typescript-eslint `use-unknown-in-catch-callback-variable` for `.catch()` callbacks
**Since:** TypeScript 4.4
**Source:** https://www.typescriptlang.org/tsconfig/#useUnknownInCatchVariables

## 9. `@ts-ignore`

**Avoid:** suppressing errors with `// @ts-ignore` or `// @ts-nocheck`.
**Why:** `@ts-ignore` hides every error on the next line, including new ones, and stays forever after the original problem is fixed.
**Instead:** fix the type; when a suppression is unavoidable, use `// @ts-expect-error` with a reason, which fails the build once the error is gone.

```ts
// Bad
// @ts-ignore
legacyWidget.render(props);
```

```ts
// Good
// @ts-expect-error: legacy-widget types omit the props overload
legacyWidget.render(props);
```

**Caught by:** typescript-eslint `ban-ts-comment` (by default it reports `@ts-ignore` and `@ts-nocheck`, and allows `@ts-expect-error` only with a description)
**Since:** TypeScript 3.9 (`@ts-expect-error`)
**Source:** https://typescript-eslint.io/rules/ban-ts-comment/

## 10. Non-exhaustive `switch` over a union

**Avoid:** a `switch` over a union that falls back to a `default` returning a placeholder.
**Why:** adding a member to the union compiles cleanly and the new case silently takes the fallback.
**Instead:** list every member and make the `default` assert `never`, so a new member is a compile error.

```ts
// Bad
function label(status: "active" | "paused" | "cancelled"): string {
  switch (status) {
    case "active": return "Active";
    case "paused": return "Paused";
    default: return "Unknown";
  }
}
```

```ts
// Good
function label(status: "active" | "paused" | "cancelled"): string {
  switch (status) {
    case "active": return "Active";
    case "paused": return "Paused";
    case "cancelled": return "Cancelled";
    default: return status satisfies never;
  }
}
```

**Caught by:** typescript-eslint `switch-exhaustiveness-check`
**Since:** TypeScript 4.9 (`satisfies`)
**Source:** https://typescript-eslint.io/rules/switch-exhaustiveness-check/

## 11. Optional chaining on values the types say are present

**Avoid:** adding `?.` and `?? fallback` to values whose types are not nullable.
**Why:** it hides broken invariants: when data is missing because of a bug, the user sees a plausible default instead of an error you can find.
**Instead:** trust non-nullable types and use `?.` only where the type includes `null` or `undefined`; fix the type if it is wrong.

```ts
// Bad
function formatTotal(cart: Cart): string {
  return cart?.total?.toFixed(2) ?? "0.00";
}
```

```ts
// Good
function formatTotal(cart: Cart): string {
  return cart.total.toFixed(2);
}
```

**Caught by:** typescript-eslint `no-unnecessary-condition`
**Source:** https://typescript-eslint.io/rules/no-unnecessary-condition/

## 12. `||` for defaults

**Avoid:** `value || fallback` when `0`, `""` or `false` are valid values.
**Why:** `||` replaces every falsy value, so a page size of `0` or an empty title is silently overwritten.
**Instead:** use `??`, which replaces only `null` and `undefined`.

```ts
// Bad
const pageSize = options.pageSize || 20;
```

```ts
// Good
const pageSize = options.pageSize ?? 20;
```

**Caught by:** typescript-eslint `prefer-nullish-coalescing`
**Source:** https://typescript-eslint.io/rules/prefer-nullish-coalescing/

## 13. `Function`, `Object`, `{}` and wrapper types

**Avoid:** `Function`, `Object`, `{}`, and the wrapper types `String`, `Number` and `Boolean` in annotations.
**Why:** `Function` accepts any callable and returns `any`, `{}` and `Object` accept every non-nullish value including strings and numbers, and wrapper types describe boxed objects, not primitives.
**Instead:** write the function signature, use `object` or a specific shape, and use the lowercase primitives.

```ts
// Bad
declare function retry(task: Function, options: {}, label: String): Object;
```

```ts
// Good
declare function retry<T>(task: () => Promise<T>, options: RetryOptions, label: string): Promise<T>;
```

**Caught by:** typescript-eslint `no-unsafe-function-type`, `no-empty-object-type`, `no-wrapper-object-types`
**Source:** https://typescript-eslint.io/rules/no-wrapper-object-types/

## 14. Reaching for `enum` by default

**Avoid:** numeric enums, `const enum` in published code, and `enum` in code that must run under type stripping.
**Why:** enums emit runtime code, so `erasableSyntaxOnly` and Node's type stripping reject them; numeric enums add reverse mappings, so `Object.values` returns names and numbers mixed; ambient `const enum`s break consumers that use `isolatedModules`.
**Instead:** use a union of string literals, or an `as const` object plus a derived union when you need the values at runtime; if you keep an enum, give every member a string value.

```ts
// Bad
enum Status { Active, Paused }
const all = Object.values(Status);
```

```ts
// Good
const STATUS = { Active: "active", Paused: "paused" } as const;
type Status = (typeof STATUS)[keyof typeof STATUS];
const all = Object.values(STATUS);
```

**Caught by:** compiler option `erasableSyntaxOnly` (rejects every `enum` declaration)
**Since:** TypeScript 5.8 (`erasableSyntaxOnly`)
**Source:** https://www.typescriptlang.org/docs/handbook/enums.html

## 15. Annotating a constant and losing its literal type

**Avoid:** annotating a lookup table or config object with a wide type such as `Record<string, string>`.
**Why:** the annotation replaces the inferred type, so a misspelled key like `ROUTES.setings` compiles as `string` and the known keys are lost.
**Instead:** check the value with `satisfies`, which validates the shape and keeps the precise inferred type.

```ts
// Bad
const ROUTES: Record<string, string> = { home: "/", settings: "/settings" };
const link = ROUTES.setings;
```

```ts
// Good
const ROUTES = { home: "/", settings: "/settings" } as const satisfies Record<string, `/${string}`>;
const link = ROUTES.settings;
```

**Since:** TypeScript 4.9
**Source:** https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html

## 16. Object intersections where `interface extends` fits

**Avoid:** building object types from `&` intersections when one extends another, and mixing `type` and `interface` for objects without a rule.
**Why:** intersections merge conflicting properties into `never` without an error and are slower to check, while `interface extends` reports the conflict at the declaration.
**Instead:** pick one style for object shapes per codebase, use `interface ... extends` to compose them, and keep `type` for unions, mapped and conditional types.

```ts
// Bad
type Timestamps = { createdAt: number; updatedAt: number };
type User = Timestamps & { id: string; createdAt: string };
```

```ts
// Good
interface Timestamps { createdAt: number; updatedAt: number }
interface User extends Timestamps { id: string }
```

**Caught by:** typescript-eslint `consistent-type-definitions`
**Source:** https://github.com/microsoft/TypeScript/wiki/Performance#preferring-interfaces-over-intersections

## Sources

- https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- https://typescript-eslint.io/rules/consistent-type-assertions/
- https://typescript-eslint.io/rules/no-unsafe-type-assertion/
- https://typescript-eslint.io/rules/no-non-null-assertion/
- https://typescript-eslint.io/rules/no-floating-promises/
- https://typescript-eslint.io/rules/no-misused-promises/
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- https://www.typescriptlang.org/tsconfig/#strict
- https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess
- https://www.typescriptlang.org/tsconfig/#useUnknownInCatchVariables
- https://typescript-eslint.io/rules/use-unknown-in-catch-callback-variable/
- https://typescript-eslint.io/rules/ban-ts-comment/
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html
- https://typescript-eslint.io/rules/switch-exhaustiveness-check/
- https://typescript-eslint.io/rules/no-unnecessary-condition/
- https://typescript-eslint.io/rules/prefer-nullish-coalescing/
- https://typescript-eslint.io/rules/no-unsafe-function-type/
- https://typescript-eslint.io/rules/no-empty-object-type/
- https://typescript-eslint.io/rules/no-wrapper-object-types/
- https://www.typescriptlang.org/docs/handbook/enums.html
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html
- https://github.com/microsoft/TypeScript/wiki/Performance#preferring-interfaces-over-intersections
