# PHP anti-patterns

Read this whole file before writing or reviewing PHP code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the PHP-specific traps.

SQL built by string concatenation, including the removed `mysql_*` API, is covered by the SQL injection rule in `SKILL.md`; use PDO prepared statements and see `database-best-practices` for query shape.

## Contents

1. `unserialize()` on user input
2. `include` / `require` with a user-controlled path
3. Shell commands built from strings
4. `md5()` / `sha1()` for passwords
5. `rand()`, `mt_rand()` or `uniqid()` for secrets
6. Loose `==` comparisons
7. `in_array()` and `array_search()` without strict mode
8. Truthiness checks on `strpos()`
9. `switch` where `match` fits
10. `empty()` on user input
11. Missing `declare(strict_types=1)`
12. `header('Location: ...')` without `exit`
13. The `@` error-suppression operator
14. Leftover reference after `foreach ($a as &$v)`
15. Using the return value of in-place array functions
16. `extract()` and variable variables
17. The `global` keyword
18. Class constants where an enum fits
19. Untyped, dynamic and mutable properties

## 1. `unserialize()` on user input

**Avoid:** Calling `unserialize()` on cookies, request data, or any string an attacker can influence.
**Why:** Unserializing instantiates objects and triggers autoloading and magic methods, which allows object injection and code execution; the manual warns against it even with the `allowed_classes` option.
**Instead:** Exchange data as JSON and decode it with `json_decode()`.

```php
// Bad
$cart = unserialize($_COOKIE['cart']);
```

```php
// Good
$cart = json_decode($_COOKIE['cart'] ?? '[]', true, 512, JSON_THROW_ON_ERROR);
```

**Caught by:** Psalm `TaintedUnserialize` (taint analysis)
**Since:** PHP 7.3 (`JSON_THROW_ON_ERROR`)
**Source:** https://www.php.net/manual/en/function.unserialize.php

## 2. `include` / `require` with a user-controlled path

**Avoid:** Building the path given to `include`, `require` or their `_once` forms from request data.
**Why:** Path traversal such as `../../etc/passwd` or an uploaded file turns the include into file disclosure or remote code execution.
**Instead:** Map the input to a fixed allowlist of files.

```php
// Bad
include __DIR__ . '/pages/' . $_GET['page'] . '.php';
```

```php
// Good
$pages = ['home' => 'home.php', 'about' => 'about.php'];
$file = $pages[$_GET['page'] ?? 'home'] ?? 'home.php';
include __DIR__ . '/pages/' . $file;
```

**Caught by:** Psalm `TaintedInclude` (taint analysis)
**Source:** https://www.php.net/manual/en/security.filesystem.php

## 3. Shell commands built from strings

**Avoid:** Passing interpolated strings to `exec`, `shell_exec`, `system`, `passthru` or backticks.
**Why:** The command string goes through the shell, so input such as `x; rm -rf ~` runs as a second command.
**Instead:** Pass the command as an array to `proc_open`, which skips the shell, or wrap every argument in `escapeshellarg()`.

```php
// Bad
exec("convert {$upload} out.png");
```

```php
// Good
$process = proc_open(['convert', $upload, 'out.png'], [], $pipes);
$exitCode = proc_close($process);
```

**Caught by:** Psalm `TaintedShell` (taint analysis); phpstan-strict-rules `disallowedBacktick` for backticks
**Since:** PHP 7.4 (array command for `proc_open`)
**Source:** https://www.php.net/manual/en/function.proc-open.php

## 4. `md5()` / `sha1()` for passwords

**Avoid:** Storing passwords as `md5`, `sha1`, `hash('sha256', ...)` or any fast, unsalted hash.
**Why:** Fast hashes can be brute-forced at billions of guesses per second, and without a per-user salt identical passwords share a hash.
**Instead:** Use `password_hash()` with `PASSWORD_DEFAULT`, `password_verify()` to check, and `password_needs_rehash()` to upgrade.

```php
// Bad
$hash = md5($password);
$isValid = md5($input) === $user->passwordHash;
```

```php
// Good
$hash = password_hash($password, PASSWORD_DEFAULT);
$isValid = password_verify($input, $user->passwordHash);
```

**Source:** https://www.php.net/manual/en/faq.passwords.php

## 5. `rand()`, `mt_rand()` or `uniqid()` for secrets

**Avoid:** Generating tokens, reset codes, session IDs or API keys with `rand()`, `mt_rand()`, `uniqid()` or a hash of them.
**Why:** These are not cryptographically secure; their output can be predicted, so tokens can be guessed.
**Instead:** Use `random_bytes()` for tokens and `random_int()` for numeric codes.

```php
// Bad
$token = md5(uniqid((string) mt_rand(), true));
```

```php
// Good
$token = bin2hex(random_bytes(32));
```

**Since:** PHP 7.0 (`random_bytes`, `random_int`)
**Source:** https://www.php.net/manual/en/function.mt-rand.php

## 6. Loose `==` comparisons

**Avoid:** Comparing with `==` or `!=`, and comparing secrets with any operator other than `hash_equals()`.
**Why:** `==` converts types first: `"1e3" == "1000"`, `"0e12" == "0e99"` and `null == false` are all `true`, so magic-hash strings pass token checks; before PHP 8.0, `"abc" == 0` was also `true`. `==` on secrets also leaks timing.
**Instead:** Use `===` and `!==`, and `hash_equals()` for tokens and signatures.

```php
// Bad
if ($request->token == $storedToken && $quantity != 0) {
    applyOrder();
}
```

```php
// Good
if (hash_equals($storedToken, $request->token) && $quantity !== 0) {
    applyOrder();
}
```

**Caught by:** phpstan-strict-rules `disallowedLooseComparison`; PHP_CodeSniffer `Squiz.Operators.ComparisonOperatorUsage`
**Source:** https://www.php.net/manual/en/types.comparisons.php

## 7. `in_array()` and `array_search()` without strict mode

**Avoid:** Calling `in_array()`, `array_search()` or `array_keys()` with a search value but without `true` as the strict argument.
**Why:** They compare with `==`, so `null` matches `0`, `''` and `false`, and `'1e1'` matches `'10'`, which lets unexpected values pass allowlists.
**Instead:** Always pass `true` for the strict parameter.

```php
// Bad
$isAllowed = in_array($role, $allowedRoles);
```

```php
// Good
$isAllowed = in_array($role, $allowedRoles, true);
```

**Caught by:** phpstan-strict-rules `strictFunctionCalls`
**Source:** https://www.php.net/manual/en/function.in-array.php

## 8. Truthiness checks on `strpos()`

**Avoid:** Using the result of `strpos()`, `stripos()` or `array_search()` directly in a condition.
**Why:** They return `0` for a match at the start and `false` for no match, and both are falsy, so a match at position 0 is treated as no match.
**Instead:** Use `str_contains()`, `str_starts_with()` or `str_ends_with()`, or compare with `!== false`.

```php
// Bad
if (strpos($header, 'Bearer ')) {
    $token = substr($header, 7);
}
```

```php
// Good
if (str_starts_with($header, 'Bearer ')) {
    $token = substr($header, 7);
}
```

**Caught by:** phpstan-strict-rules `booleansInConditions`
**Since:** PHP 8.0 (`str_contains`, `str_starts_with`, `str_ends_with`)
**Source:** https://www.php.net/manual/en/function.strpos.php

## 9. `switch` where `match` fits

**Avoid:** Using `switch` to map a value to a result.
**Why:** `switch` compares with `==`, falls through when a `break` is missing, and silently does nothing for unhandled values.
**Instead:** Use `match`, which compares with `===`, never falls through, and throws `UnhandledMatchError` for unhandled values.

```php
// Bad
switch ($quantity) {
    case 0:
        $label = 'none';
        break;
    case 1:
        $label = 'one';
}
```

```php
// Good
$label = match ($quantity) {
    0 => 'none',
    1 => 'one',
    default => 'many',
};
```

**Since:** PHP 8.0 (`match`)
**Source:** https://www.php.net/manual/en/control-structures.match.php

## 10. `empty()` on user input

**Avoid:** Validating input or checking values with `empty()`.
**Why:** `empty()` is true for `"0"`, `0`, `0.0`, `[]`, `null` and `false`, so a user who enters `0` is told the field is required; it also hides undefined variables and typos without a warning.
**Instead:** Compare against the exact empty value you mean, such as `=== ''` or `=== null`.

```php
// Bad
if (empty($_POST['quantity'])) {
    throw new InvalidArgumentException('quantity is required');
}
```

```php
// Good
$quantity = $_POST['quantity'] ?? '';
if ($quantity === '') {
    throw new InvalidArgumentException('quantity is required');
}
```

**Caught by:** phpstan-strict-rules `disallowedEmpty`
**Source:** https://www.php.net/manual/en/function.empty.php

## 11. Missing `declare(strict_types=1)`

**Avoid:** Writing PHP files without `declare(strict_types=1);` as the first statement.
**Why:** In the default coercive mode, scalar arguments are converted silently: the string `"false"` passed to a `bool` parameter becomes `true`, and numeric strings pass as `int`.
**Instead:** Start every file with `declare(strict_types=1);` and convert input explicitly at the boundary.

```php
// Bad
function setNewsletter(bool $subscribed): void { saveSetting('newsletter', $subscribed); }
setNewsletter($_POST['subscribed']);
```

```php
// Good
declare(strict_types=1);

function setNewsletter(bool $subscribed): void { saveSetting('newsletter', $subscribed); }
setNewsletter(filter_var($_POST['subscribed'] ?? '', FILTER_VALIDATE_BOOLEAN));
```

**Caught by:** PHP_CodeSniffer `Generic.PHP.RequireStrictTypes`
**Since:** PHP 7.0
**Source:** https://www.php.net/manual/en/language.types.declarations.php#language.types.declarations.strict

## 12. `header('Location: ...')` without `exit`

**Avoid:** Sending a redirect header and letting the script continue.
**Why:** `header()` only queues a response header; the rest of the script still runs, so code after an "access denied" redirect executes for unauthorized users.
**Instead:** Call `exit` right after the redirect, or return a redirect response from the framework.

```php
// Bad
if (!$user->isAdmin()) {
    header('Location: /login');
}
deleteAllUsers();
```

```php
// Good
if (!$user->isAdmin()) {
    header('Location: /login');
    exit;
}
deleteAllUsers();
```

**Source:** https://www.php.net/manual/en/function.header.php

## 13. The `@` error-suppression operator

**Avoid:** Prefixing calls with `@` to hide warnings.
**Why:** It hides the diagnostic that explains why the call failed, so the failure surfaces later with no context; before PHP 8.0 it could even hide fatal errors.
**Instead:** Check the return value and throw with context, or convert warnings to exceptions with an error handler.

```php
// Bad
$data = @file_get_contents($path);
```

```php
// Good
$data = file_get_contents($path);
if ($data === false) {
    throw new RuntimeException("Cannot read {$path}");
}
```

**Caught by:** PHP_CodeSniffer `Generic.PHP.NoSilencedErrors`
**Source:** https://www.php.net/manual/en/language.operators.errorcontrol.php

## 14. Leftover reference after `foreach ($a as &$v)`

**Avoid:** Iterating by reference and then reusing the loop variable.
**Why:** After the loop, `$v` is still a reference to the last element, so a later `foreach ($a as $v)` overwrites that element on every iteration.
**Instead:** Use `array_map()` to build a new array, or `unset($v)` right after a by-reference loop.

```php
// Bad
foreach ($prices as &$price) {
    $price *= 1.2;
}
foreach ($prices as $price) {
    echo $price, PHP_EOL;
}
```

```php
// Good
$prices = array_map(fn (float $price): float => $price * 1.2, $prices);
foreach ($prices as $price) {
    echo $price, PHP_EOL;
}
```

**Since:** PHP 7.4 (arrow functions)
**Source:** https://www.php.net/manual/en/control-structures.foreach.php

## 15. Using the return value of in-place array functions

**Avoid:** Assigning the result of `sort()`, `usort()`, `ksort()`, `shuffle()` or similar functions as if it were the sorted array.
**Why:** These functions modify their argument by reference and return `true`, so `$sorted = sort($names)` stores a boolean.
**Instead:** Call the function on a copy and use the copy.

```php
// Bad
$sorted = sort($names);
```

```php
// Good
$sorted = $names;
sort($sorted);
```

**Source:** https://www.php.net/manual/en/function.sort.php

## 16. `extract()` and variable variables

**Avoid:** Calling `extract()` on arrays, especially request data, or creating variables with `$$name`.
**Why:** `extract($_POST)` lets the client create or overwrite any local variable, such as `$isAdmin`, and variable variables hide data flow from readers and static analysis.
**Instead:** Read the keys you need explicitly, and use an array for dynamic names.

```php
// Bad
extract($_POST);
$$field = $value;
```

```php
// Good
$email = $_POST['email'] ?? '';
$settings[$field] = $value;
```

**Caught by:** phpstan-strict-rules `noVariableVariables` (variable variables only)
**Source:** https://www.php.net/manual/en/function.extract.php

## 17. The `global` keyword

**Avoid:** Pulling dependencies into functions with `global $x` or `$GLOBALS`.
**Why:** The function's real inputs are hidden, any code can change them, and tests must set up global state in the right order.
**Instead:** Pass dependencies as parameters or constructor arguments.

```php
// Bad
function connect(): PDO
{
    global $config;
    return new PDO($config['dsn']);
}
```

```php
// Good
function connect(array $config): PDO
{
    return new PDO($config['dsn']);
}
```

**Caught by:** PHP_CodeSniffer `Squiz.PHP.GlobalKeyword`
**Source:** https://www.php.net/manual/en/language.variables.scope.php

## 18. Class constants where an enum fits

**Avoid:** Modeling a closed set of values as class constants passed around as `string` or `int`.
**Why:** Any string passes the type check, so typos and invalid values reach the database.
**Instead:** Use a backed `enum` and type parameters with it.

```php
// Bad
final class Status
{
    public const DRAFT = 'draft';
    public const PUBLISHED = 'published';
}
function publish(string $status): void {}
```

```php
// Good
enum Status: string
{
    case Draft = 'draft';
    case Published = 'published';
}
function publish(Status $status): void {}
```

**Since:** PHP 8.1
**Source:** https://www.php.net/manual/en/language.types.enumerations.php

## 19. Untyped, dynamic and mutable properties

**Avoid:** Declaring properties without types, writing to undeclared properties, and leaving value objects mutable.
**Why:** Untyped properties accept anything, a typo such as `$money->ammount = 5` silently creates a new dynamic property (deprecated since PHP 8.2), and shared value objects can be changed by any holder.
**Instead:** Declare typed properties, use constructor promotion, and mark value objects `readonly`.

```php
// Bad
class Money
{
    public $amount;
    public $currency;
}
```

```php
// Good
final readonly class Money
{
    public function __construct(
        public int $amount,
        public string $currency,
    ) {}
}
```

**Caught by:** PHPStan level 6 (missing type hints)
**Since:** PHP 7.4 (typed properties), 8.0 (constructor promotion), 8.1 (`readonly` properties), 8.2 (`readonly` classes)
**Source:** https://www.php.net/manual/en/language.oop5.properties.php

## Sources

- https://www.php.net/manual/en/function.unserialize.php
- https://www.php.net/manual/en/function.json-decode.php
- https://www.php.net/manual/en/security.filesystem.php
- https://www.php.net/manual/en/function.proc-open.php
- https://www.php.net/manual/en/faq.passwords.php
- https://www.php.net/manual/en/function.mt-rand.php
- https://www.php.net/manual/en/types.comparisons.php
- https://www.php.net/manual/en/language.operators.comparison.php
- https://www.php.net/manual/en/function.in-array.php
- https://www.php.net/manual/en/function.strpos.php
- https://www.php.net/manual/en/control-structures.match.php
- https://www.php.net/manual/en/function.empty.php
- https://www.php.net/manual/en/language.types.declarations.php#language.types.declarations.strict
- https://www.php.net/manual/en/function.header.php
- https://www.php.net/manual/en/language.operators.errorcontrol.php
- https://www.php.net/manual/en/control-structures.foreach.php
- https://www.php.net/manual/en/function.sort.php
- https://www.php.net/manual/en/function.extract.php
- https://www.php.net/manual/en/language.variables.scope.php
- https://www.php.net/manual/en/language.types.enumerations.php
- https://www.php.net/manual/en/language.oop5.properties.php
- https://github.com/phpstan/phpstan-strict-rules
- https://phpstan.org/user-guide/rule-levels
- https://psalm.dev/docs/security_analysis/
- https://github.com/PHPCSStandards/PHP_CodeSniffer
