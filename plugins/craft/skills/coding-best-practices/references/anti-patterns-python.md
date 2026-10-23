# Python anti-patterns

Read this whole file before writing or reviewing Python code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Python-specific traps.

## Contents

1. Mutable default arguments
2. Bare `except:` and silent `except Exception: pass`
3. Late-binding closures created in a loop
4. `pickle`, `yaml.load` and `eval` on untrusted data
5. `subprocess` with `shell=True`
6. `assert` for runtime validation
7. Fire-and-forget `asyncio.create_task`
8. Blocking calls inside `async def`
9. Mutating a collection while iterating over it
10. Mutable class attributes shared by every instance
11. `datetime.utcnow()` and `datetime.utcfromtimestamp()`
12. Naive datetimes for real-world times
13. `open()` without `with` or `encoding`
14. `is` to compare with literals
15. `type(x) == T` instead of `isinstance`
16. Wildcard imports
17. Shadowing builtins
18. Building strings with `+=` in a loop
19. Public functions without type hints

## 1. Mutable default arguments

**Avoid:** Using a list, dict, set or other mutable object as a default parameter value.
**Why:** The default is evaluated once, when the function is defined, so every call that relies on it shares and mutates the same object.
**Instead:** Default to `None` and create the object inside the function.

```python
# Bad
def add_tag(tag, tags=[]):
    tags.append(tag)
    return tags
```

```python
# Good
def add_tag(tag, tags=None):
    if tags is None:
        tags = []
    tags.append(tag)
    return tags
```

**Caught by:** Ruff `B006` (mutable-argument-default)
**Source:** https://docs.python.org/3/tutorial/controlflow.html#default-argument-values

## 2. Bare `except:` and silent `except Exception: pass`

**Avoid:** Writing `except:` with no exception type, or `except Exception:` whose body is only `pass`.
**Why:** A bare `except:` catches `BaseException`, so it also swallows `KeyboardInterrupt` and `SystemExit`: Ctrl-C and `sys.exit()` stop working. `except Exception: pass` hides every bug in the block.
**Instead:** Catch the specific exceptions the block can raise and handle them; let the rest propagate.

```python
# Bad
try:
    config = load_config(path)
except:
    config = {}
```

```python
# Good
try:
    config = load_config(path)
except FileNotFoundError:
    config = DEFAULT_CONFIG
```

**Caught by:** Ruff `E722` (bare-except), `BLE001` (blind-except), `S110` (try-except-pass)
**Source:** https://peps.python.org/pep-0008/#programming-recommendations

## 3. Late-binding closures created in a loop

**Avoid:** Creating a lambda or inner function in a loop that reads the loop variable.
**Why:** Closures look up the variable when they run, not when they are created, so every closure sees the last value of the loop.
**Instead:** Bind the current value at creation time with `functools.partial` or a default argument.

```python
# Bad
handlers = [lambda: print(i) for i in range(3)]
```

```python
# Good
from functools import partial

handlers = [partial(print, i) for i in range(3)]
```

**Caught by:** Ruff `B023` (function-uses-loop-variable)
**Source:** https://docs.python.org/3/faq/programming.html#why-do-lambdas-defined-in-a-loop-with-different-values-all-return-the-same-result

## 4. `pickle`, `yaml.load` and `eval` on untrusted data

**Avoid:** Calling `pickle.loads`, `yaml.load` with an unsafe loader, or `eval` on data from a user, a network peer or a file you do not control.
**Why:** Unpickling and full YAML loading can construct arbitrary objects and run code, and `eval` runs any expression. One crafted payload is remote code execution.
**Instead:** Use `json.loads`, `yaml.safe_load`, or `ast.literal_eval` for Python literals.

```python
# Bad
session = pickle.loads(request_body)
settings = yaml.load(text, Loader=yaml.Loader)
limit = eval(user_input)
```

```python
# Good
session = json.loads(request_body)
settings = yaml.safe_load(text)
limit = ast.literal_eval(user_input)
```

**Caught by:** Ruff `S301` (suspicious-pickle-usage), `S506` (unsafe-yaml-load), `S307` (suspicious-eval-usage)
**Source:** https://docs.python.org/3/library/pickle.html

## 5. `subprocess` with `shell=True`

**Avoid:** Passing a formatted command string to `subprocess` with `shell=True`, or calling `os.system`.
**Why:** The shell interprets every character in the string, so a file name like `x; rm -rf ~` becomes a second command.
**Instead:** Pass the command as a list of arguments and leave `shell` at its default of `False`.

```python
# Bad
subprocess.run(f"tar -czf {archive} {folder}", shell=True, check=True)
```

```python
# Good
subprocess.run(["tar", "-czf", archive, folder], check=True)
```

**Caught by:** Ruff `S602` (subprocess-popen-with-shell-equals-true), `S605` (start-process-with-a-shell)
**Source:** https://docs.python.org/3/library/subprocess.html#security-considerations

## 6. `assert` for runtime validation

**Avoid:** Using `assert` to check user input, permissions or any condition production code relies on.
**Why:** Python emits no code for `assert` when run with `-O` or `PYTHONOPTIMIZE`, so the check silently disappears in optimized deployments.
**Instead:** Raise a specific exception with an explicit `if`.

```python
# Bad
def withdraw(account, amount):
    assert amount > 0, "amount must be positive"
    account.balance -= amount
```

```python
# Good
def withdraw(account, amount):
    if amount <= 0:
        raise ValueError(f"amount must be positive, got {amount}")
    account.balance -= amount
```

**Caught by:** Ruff `S101` (assert)
**Source:** https://docs.python.org/3/reference/simple_stmts.html#the-assert-statement

## 7. Fire-and-forget `asyncio.create_task`

**Avoid:** Calling `asyncio.create_task` without keeping a reference to the returned task.
**Why:** The event loop keeps only weak references to tasks, so an unreferenced task can be garbage-collected mid-run, and its exception is never retrieved.
**Instead:** Keep each background task in a set and remove it with `add_done_callback`; for work the caller must wait for, use an `asyncio.TaskGroup`.

```python
# Bad
async def handle(event):
    asyncio.create_task(send_email(event))
```

```python
# Good
background_tasks: set[asyncio.Task[None]] = set()

async def handle(event):
    task = asyncio.create_task(send_email(event))
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)
```

**Caught by:** Ruff `RUF006` (asyncio-dangling-task)
**Since:** Python 3.11 (`asyncio.TaskGroup`)
**Source:** https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task

## 8. Blocking calls inside `async def`

**Avoid:** Calling `time.sleep`, `requests`, synchronous file I/O or other blocking functions inside a coroutine.
**Why:** A blocking call stops the whole event loop, so every other task on it stalls until the call returns.
**Instead:** Use the async equivalent (`asyncio.sleep`, an async HTTP client), or move the blocking call to a thread with `asyncio.to_thread`.

```python
# Bad
async def fetch_report(url):
    response = requests.get(url, timeout=10)
    time.sleep(1)
    return response.json()
```

```python
# Good
async def fetch_report(url):
    response = await asyncio.to_thread(requests.get, url, timeout=10)
    await asyncio.sleep(1)
    return response.json()
```

**Caught by:** Ruff `ASYNC210` (blocking-http-call-in-async-function), `ASYNC251` (blocking-sleep-in-async-function), `ASYNC230` (blocking-open-call-in-async-function)
**Since:** Python 3.9 (`asyncio.to_thread`)
**Source:** https://docs.python.org/3/library/asyncio-dev.html#running-blocking-code

## 9. Mutating a collection while iterating over it

**Avoid:** Removing from or adding to a list, dict or set inside a `for` loop over that same collection.
**Why:** On a list, each removal shifts the items so the loop skips the next one; on a dict or set it raises `RuntimeError: ... changed size during iteration`.
**Instead:** Build a new collection with a comprehension, or iterate over a copy.

```python
# Bad
for user in users:
    if user.is_inactive:
        users.remove(user)
```

```python
# Good
users = [user for user in users if not user.is_inactive]
```

**Caught by:** Ruff `B909` (loop-iterator-mutation, preview only)
**Source:** https://docs.python.org/3/tutorial/controlflow.html#for-statements

## 10. Mutable class attributes shared by every instance

**Avoid:** Declaring a list or dict as a class attribute that instances then mutate.
**Why:** The attribute lives on the class, so every instance appends to the same list.
**Instead:** Create the value per instance, for example with a dataclass `field(default_factory=...)`.

```python
# Bad
class Cart:
    items = []

    def add(self, item):
        self.items.append(item)
```

```python
# Good
@dataclass
class Cart:
    items: list[str] = field(default_factory=list)

    def add(self, item: str) -> None:
        self.items.append(item)
```

**Caught by:** Ruff `RUF012` (mutable-class-default)
**Source:** https://docs.python.org/3/tutorial/classes.html#class-and-instance-variables

## 11. `datetime.utcnow()` and `datetime.utcfromtimestamp()`

**Avoid:** Calling `datetime.utcnow()` or `datetime.utcfromtimestamp()`.
**Why:** Both return a naive datetime, and many methods, such as `.timestamp()`, treat naive values as local time, so the result is off by the machine's UTC offset. Both are deprecated since Python 3.12.
**Instead:** Use an aware datetime: `datetime.now(UTC)` and `datetime.fromtimestamp(ts, UTC)`.

```python
# Bad
expires_at = datetime.utcnow() + timedelta(hours=1)
```

```python
# Good
from datetime import UTC, datetime, timedelta

expires_at = datetime.now(UTC) + timedelta(hours=1)
```

**Caught by:** Ruff `DTZ003` (call-datetime-utcnow), `DTZ004` (call-datetime-utcfromtimestamp)
**Since:** Python 3.11 (`datetime.UTC`; use `timezone.utc` before that)
**Source:** https://docs.python.org/3/library/datetime.html#datetime.datetime.utcnow

## 12. Naive datetimes for real-world times

**Avoid:** Creating datetimes for stored, compared or scheduled times without `tzinfo`, such as `datetime.now()` or `datetime(2026, 3, 29, 9, 0)`.
**Why:** A naive value has no zone, so it means different instants on different servers and across DST changes, and comparing it with an aware value raises `TypeError`.
**Instead:** Attach a zone with `zoneinfo.ZoneInfo` or `UTC`, and store UTC.

```python
# Bad
meeting = datetime(2026, 3, 29, 9, 0)
is_past = meeting < datetime.now()
```

```python
# Good
meeting = datetime(2026, 3, 29, 9, 0, tzinfo=ZoneInfo("Europe/Berlin"))
is_past = meeting < datetime.now(UTC)
```

**Caught by:** Ruff `DTZ001` (call-datetime-without-tzinfo), `DTZ005` (call-datetime-now-without-tzinfo)
**Since:** Python 3.9 (`zoneinfo`)
**Source:** https://docs.python.org/3/library/datetime.html#aware-and-naive-objects

## 13. `open()` without `with` or `encoding`

**Avoid:** Calling `open()` outside a `with` block, or reading and writing text without an explicit `encoding`.
**Why:** Without `with`, the file closes only when the object is garbage-collected, which is not prompt on PyPy and is delayed while an exception traceback still references the frame. Without `encoding`, Python before 3.15 uses the locale encoding (often cp1252 on Windows), so the same file decodes differently per machine.
**Instead:** Open files in a `with` block and pass `encoding="utf-8"` for text.

```python
# Bad
f = open(path)
rows = f.read().splitlines()
```

```python
# Good
with open(path, encoding="utf-8") as f:
    rows = f.read().splitlines()
```

**Caught by:** Ruff `SIM115` (open-file-with-context-handler), `PLW1514` (unspecified-encoding, preview only)
**Source:** https://docs.python.org/3/library/functions.html#open

## 14. `is` to compare with literals

**Avoid:** Using `is` or `is not` to compare with a string, number or other literal.
**Why:** `is` checks identity, not value. It can pass by accident for small cached ints and interned strings in CPython and then fail for computed values. CPython emits a `SyntaxWarning` for it since 3.8.
**Instead:** Use `==` for values; keep `is` for singletons such as `None`.

```python
# Bad
if status is "active" and retries is not 0:
    resume()
```

```python
# Good
if status == "active" and retries != 0:
    resume()
```

**Caught by:** Ruff `F632` (is-literal)
**Source:** https://docs.python.org/3/whatsnew/3.8.html#changes-in-python-behavior

## 15. `type(x) == T` instead of `isinstance`

**Avoid:** Checking types with `type(x) == T` or `type(x) is T`.
**Why:** An exact type check rejects subclasses, so an `OrderedDict` or `defaultdict` fails a check meant for any `dict`.
**Instead:** Use `isinstance(x, T)`, or a tuple of types.

```python
# Bad
if type(payload) == dict:
    process(payload)
```

```python
# Good
if isinstance(payload, dict):
    process(payload)
```

**Caught by:** Ruff `E721` (type-comparison), only for the `==` / `!=` form
**Source:** https://peps.python.org/pep-0008/#programming-recommendations

## 16. Wildcard imports

**Avoid:** Writing `from module import *`.
**Why:** It pulls unknown names into the module and silently shadows existing ones; `from os import *` replaces the builtin `open` with `os.open`, which takes different arguments.
**Instead:** Import the names you use, or import the module and qualify.

```python
# Bad
from os import *

with open("report.txt") as f:
    data = f.read()
```

```python
# Good
from os import path

with open(path.join("out", "report.txt"), encoding="utf-8") as f:
    data = f.read()
```

**Caught by:** Ruff `F403` (undefined-local-with-import-star), `F405` (undefined-local-with-import-star-usage)
**Source:** https://peps.python.org/pep-0008/#imports

## 17. Shadowing builtins

**Avoid:** Naming variables or parameters `list`, `dict`, `id`, `type`, `input`, `max`, `sum` and other builtins.
**Why:** The local name hides the builtin for the rest of the scope, so a later `list(...)` call fails with `TypeError: 'list' object is not callable`.
**Instead:** Use a name that says what the value is.

```python
# Bad
list = fetch_rows()
ids = list(map(str, list))
```

```python
# Good
rows = fetch_rows()
ids = [str(row) for row in rows]
```

**Caught by:** Ruff `A001` (builtin-variable-shadowing), `A002` (builtin-argument-shadowing)
**Source:** https://docs.astral.sh/ruff/rules/builtin-variable-shadowing/

## 18. Building strings with `+=` in a loop

**Avoid:** Accumulating a string with `+=` inside a loop.
**Why:** Strings are immutable, so each `+=` can copy the whole string, which is quadratic. CPython's in-place shortcut is fragile and other implementations do not have it.
**Instead:** Collect the parts and call `"".join(...)`.

```python
# Bad
report = ""
for name, score in rows:
    report += f"{name},{score}\n"
```

```python
# Good
report = "".join(f"{name},{score}\n" for name, score in rows)
```

**Caught by:** Pylint `consider-using-join` (R1713), only for the plain `result += item` form
**Source:** https://peps.python.org/pep-0008/#programming-recommendations

## 19. Public functions without type hints

**Avoid:** Leaving parameters and return values of public functions and methods unannotated.
**Why:** Callers and type checkers cannot see the contract, so passing a `str` where a `Decimal` is expected only fails at runtime.
**Instead:** Annotate every public parameter and return type, using built-in generics and `X | None`.

```python
# Bad
def parse_price(raw, currency=None):
    return Decimal(raw)
```

```python
# Good
def parse_price(raw: str, currency: str | None = None) -> Decimal:
    return Decimal(raw)
```

**Caught by:** Ruff `ANN001` (missing-type-function-argument), `ANN201` (missing-return-type-undocumented-public-function)
**Since:** Python 3.10 (`X | None` evaluated at runtime; 3.9 for `list[str]`)
**Source:** https://docs.python.org/3/library/typing.html

## Sources

- https://docs.python.org/3/tutorial/controlflow.html#default-argument-values
- https://peps.python.org/pep-0008/#programming-recommendations
- https://docs.python.org/3/faq/programming.html#why-do-lambdas-defined-in-a-loop-with-different-values-all-return-the-same-result
- https://docs.python.org/3/library/pickle.html
- https://docs.python.org/3/library/subprocess.html#security-considerations
- https://docs.python.org/3/reference/simple_stmts.html#the-assert-statement
- https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
- https://docs.python.org/3/library/asyncio-dev.html#running-blocking-code
- https://docs.python.org/3/tutorial/controlflow.html#for-statements
- https://docs.python.org/3/tutorial/classes.html#class-and-instance-variables
- https://docs.python.org/3/library/datetime.html#datetime.datetime.utcnow
- https://docs.python.org/3/library/datetime.html#aware-and-naive-objects
- https://docs.python.org/3/library/functions.html#open
- https://peps.python.org/pep-0686/
- https://docs.python.org/3/whatsnew/3.8.html#changes-in-python-behavior
- https://peps.python.org/pep-0008/#imports
- https://docs.astral.sh/ruff/rules/builtin-variable-shadowing/
- https://docs.python.org/3/library/typing.html
- https://docs.astral.sh/ruff/rules/
- https://pylint.readthedocs.io/en/stable/user_guide/messages/refactor/consider-using-join.html
