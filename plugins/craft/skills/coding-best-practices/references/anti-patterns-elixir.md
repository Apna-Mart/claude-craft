# Elixir anti-patterns

Read this whole file before writing or reviewing Elixir code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Elixir-specific traps.

## Contents

1. Creating atoms from external input
2. `:erlang.binary_to_term` on untrusted data
3. `try/rescue` for expected failures
4. Discarding the result of `Enum`, `Map` or `String` calls
5. Reading application config in module attributes
6. `Mix.env()` in application code
7. Comparing dates and other structs with `<` and `>`
8. Unsupervised `spawn` for background work
9. Slow work inside `handle_call`
10. A GenServer used only to organize code
11. Copying large data into messages and closures
12. A catch-all `_ ->` that hides new cases
13. `map[:key]` for keys that must exist
14. `Enum` pipelines over large or unbounded input
15. Appending with `++` inside loops
16. `length(list) == 0` to test for emptiness

## 1. Creating atoms from external input

**Avoid:** `String.to_atom/1`, `List.to_atom/1`, `Module.concat/1` or `Jason.decode(json, keys: :atoms)` on request params, file content or any external string.
**Why:** Atoms are never garbage-collected and the atom table has a fixed limit (1,048,576 by default); filling it crashes the whole VM, so an attacker can take the node down by sending many distinct values.
**Instead:** Map known strings to atoms explicitly with pattern matching, or use `String.to_existing_atom/1` when the atom is already referenced in the same module.

```elixir
# Bad
def parse_status(%{"status" => status}), do: String.to_atom(status)
```

```elixir
# Good
def parse_status(%{"status" => "active"}), do: {:ok, :active}
def parse_status(%{"status" => "suspended"}), do: {:ok, :suspended}
def parse_status(_params), do: {:error, :invalid_status}
```

**Caught by:** Credo `Credo.Check.Warning.UnsafeToAtom` (disabled by default; enable it in `.credo.exs`); Sobelow `DOS.StringToAtom`
**Source:** https://elixir.hexdocs.pm/code-anti-patterns.html#dynamic-atom-creation

## 2. `:erlang.binary_to_term` on untrusted data

**Avoid:** Decoding cookies, request bodies, cache entries or any data an outsider can influence with `:erlang.binary_to_term/1`.
**Why:** The external term format can encode functions and create atoms, so decoding attacker input can exhaust memory or execute code; the `:safe` option blocks new atoms but still decodes functions.
**Instead:** Use a data-only format such as JSON for untrusted input; when you must decode ETF, only decode data you signed, with `Plug.Crypto.non_executable_binary_to_term(binary, [:safe])`, and validate the result.

```elixir
# Bad
def load_session(cookie) do
  cookie |> Base.url_decode64!() |> :erlang.binary_to_term()
end
```

```elixir
# Good
def load_session(cookie) do
  with {:ok, json} <- Base.url_decode64(cookie) do
    JSON.decode(json)
  end
end
```

**Caught by:** Sobelow `Misc.BinToTerm`
**Since:** The built-in `JSON` module needs Elixir 1.18; on older versions use the `Jason` library.
**Source:** https://security.erlef.org/secure_coding_and_deployment_hardening/serialisation

## 3. `try/rescue` for expected failures

**Avoid:** Calling bang functions (`File.read!/1`, `JSON.decode!/1`, `Repo.get!/2`) inside `try/rescue` to handle outcomes you expect, such as a missing file or bad input.
**Why:** A broad `rescue` also swallows real bugs (a `KeyError`, a `FunctionClauseError`) as if they were the expected failure, and callers lose the reason.
**Instead:** Call the non-raising variant that returns `{:ok, value}` or `{:error, reason}` and chain the steps with `with`; keep bang functions for cases where failure is a bug.

```elixir
# Bad
def read_config(path) do
  try do
    {:ok, path |> File.read!() |> JSON.decode!()}
  rescue
    _ -> {:error, :invalid_config}
  end
end
```

```elixir
# Good
def read_config(path) do
  with {:ok, body} <- File.read(path) do
    JSON.decode(body)
  end
end
```

**Since:** The built-in `JSON` module needs Elixir 1.18; on older versions use `Jason.decode/1`.
**Source:** https://elixir.hexdocs.pm/design-anti-patterns.html#exceptions-for-control-flow

## 4. Discarding the result of `Enum`, `Map` or `String` calls

**Avoid:** Calling `Map.put/3`, `Enum.map/2`, `String.trim/1` and similar functions as statements, expecting them to change their argument.
**Why:** All Elixir data is immutable; these functions return a new value, so an unbound call does nothing and the old value flows on.
**Instead:** Bind or return the result; use `Enum.each/2` only when you want side effects and no result.

```elixir
# Bad
def normalize(user) do
  Map.put(user, :email, String.downcase(user.email))
  user
end
```

```elixir
# Good
def normalize(user) do
  %{user | email: String.downcase(user.email)}
end
```

**Caught by:** Credo `Credo.Check.Warning.UnusedEnumOperation`, `UnusedMapOperation`, `UnusedStringOperation`, `UnusedListOperation`, `UnusedKeywordOperation`
**Source:** https://hexdocs.pm/credo/1.7.19/Credo.Check.Warning.UnusedEnumOperation.html

## 5. Reading application config in module attributes

**Avoid:** `@key Application.get_env(...)` or `Application.fetch_env!/2` in a module attribute or module body.
**Why:** Module attributes are evaluated at compile time, so the value is frozen into the build; a release then ignores the runtime config and environment variables, and the app may fail to compile when the key is only set at runtime.
**Instead:** Read config inside the function at runtime and set runtime values in `config/runtime.exs`; if you truly need a compile-time value, use `Application.compile_env/3`, which is checked against the runtime value when the system starts and raises if they differ.

```elixir
# Bad
defmodule MyApp.Mailer do
  @api_key Application.get_env(:my_app, :mailer_api_key)
  def api_key, do: @api_key
end
```

```elixir
# Good
defmodule MyApp.Mailer do
  def api_key, do: Application.fetch_env!(:my_app, :mailer_api_key)
end
```

**Caught by:** Credo `Credo.Check.Warning.ApplicationConfigInModuleAttribute`
**Since:** `Application.compile_env/3` needs Elixir 1.10; `config/runtime.exs` needs Elixir 1.11.
**Source:** https://elixir.hexdocs.pm/Application.html#module-compile-time-environment

## 6. `Mix.env()` in application code

**Avoid:** Branching on `Mix.env()` inside modules under `lib/`.
**Why:** Mix is a build tool and may not be available in a release, so the call fails with `UndefinedFunctionError` in production while working in development.
**Instead:** Put per-environment values in `config/*.exs` (using `config_env()` there) and read them with `Application.fetch_env!/2`.

```elixir
# Bad
def base_url do
  if Mix.env() == :prod, do: "https://api.example.com", else: "http://localhost:4000"
end
```

```elixir
# Good
def base_url, do: Application.fetch_env!(:my_app, :base_url)
```

**Caught by:** Credo `Credo.Check.Warning.MixEnv` (disabled by default; enable it in `.credo.exs`)
**Source:** https://mix.hexdocs.pm/Mix.html#env/0

## 7. Comparing dates and other structs with `<` and `>`

**Avoid:** `<`, `>`, `<=`, `>=`, `min/2`, `max/2`, `Enum.sort/1` or `Enum.max/1` on `DateTime`, `Date`, `Time`, `NaiveDateTime`, `Decimal` or `Version` values.
**Why:** Elixir comparison operators are structural: they compare the struct's fields in key order, not the moment in time, so `~D[2024-02-01] > ~D[2023-12-31]` returns `false` because the day field is compared first.
**Instead:** Use the module's `compare/2`, `before?/2` or `after?/2`, and pass the module to sorting functions (`Enum.sort(dates, Date)`, `Enum.max(dates, Date)`).

```elixir
# Bad
def expired?(token), do: token.expires_at < DateTime.utc_now()
```

```elixir
# Good
def expired?(token), do: DateTime.before?(token.expires_at, DateTime.utc_now())
```

**Caught by:** Elixir compiler type checker warning on structural comparison with structs (Elixir 1.17+)
**Since:** `DateTime.before?/2` and `after?/2` need Elixir 1.15; on older versions use `DateTime.compare(a, b) == :lt`.
**Source:** https://elixir.hexdocs.pm/Kernel.html#module-structural-comparison

## 8. Unsupervised `spawn` for background work

**Avoid:** Starting long-running or fire-and-forget work with bare `spawn/1` or `Task.start/1`.
**Why:** The process sits outside the supervision tree, so nothing restarts it, it is hard to find and monitor, and on shutdown or deploy it is killed mid-work instead of stopping in order.
**Instead:** Start it under a supervisor, for example `Task.Supervisor.start_child/2` with a `Task.Supervisor` in your application's children.

```elixir
# Bad
def handle_signup(user) do
  spawn(fn -> Mailer.send_welcome(user) end)
  {:ok, user}
end
```

```elixir
# Good
def handle_signup(user) do
  Task.Supervisor.start_child(MyApp.TaskSupervisor, fn -> Mailer.send_welcome(user) end)
  {:ok, user}
end
```

**Source:** https://elixir.hexdocs.pm/process-anti-patterns.html#unsupervised-processes

## 9. Slow work inside `handle_call`

**Avoid:** Doing slow I/O or heavy computation directly in a GenServer callback.
**Why:** A GenServer handles one message at a time, so every other caller waits; callers past the default 5000 ms `GenServer.call/3` timeout exit, often crashing their own processes.
**Instead:** Move the work out of the server: do it in the caller, or start a supervised task that replies later with `GenServer.reply/2` while the callback returns `{:noreply, state}`.

```elixir
# Bad
def handle_call({:report, id}, _from, state) do
  {:reply, Reports.build(id), state}
end
```

```elixir
# Good
def handle_call({:report, id}, from, state) do
  Task.Supervisor.start_child(MyApp.TaskSupervisor, fn ->
    GenServer.reply(from, Reports.build(id))
  end)
  {:noreply, state}
end
```

**Source:** https://elixir.hexdocs.pm/GenServer.html#module-when-not-to-use-a-genserver

## 10. A GenServer used only to organize code

**Avoid:** Wrapping stateless logic in a GenServer or Agent to group functions.
**Why:** One process serializes every caller, so the module becomes a throughput bottleneck and a single point of failure, and each call pays for message passing.
**Instead:** Use plain modules and functions; use a process only to model runtime state, concurrency or a shared resource, and let callers choose how to parallelize.

```elixir
# Bad
defmodule Calculator do
  use GenServer
  def add(a, b), do: GenServer.call(__MODULE__, {:add, a, b})
  def handle_call({:add, a, b}, _from, state), do: {:reply, a + b, state}
end
```

```elixir
# Good
defmodule Calculator do
  def add(a, b), do: a + b
end
```

**Source:** https://elixir.hexdocs.pm/process-anti-patterns.html#code-organization-by-process

## 11. Copying large data into messages and closures

**Avoid:** Sending a whole `conn`, socket assigns, or a large struct to another process, or capturing it in a closure passed to `spawn` or a task, when the receiver needs only a few fields.
**Why:** Messages and captured variables are copied into the receiving process's heap, so large terms cost memory and CPU on every send.
**Instead:** Extract the fields first and send or capture only those; for large data read by many processes and rarely changed, consider `:persistent_term`.

```elixir
# Bad
def log_request(conn) do
  Task.Supervisor.start_child(MyApp.TaskSupervisor, fn ->
    Audit.record(conn.remote_ip, conn.request_path)
  end)
end
```

```elixir
# Good
def log_request(conn) do
  %{remote_ip: ip, request_path: path} = conn
  Task.Supervisor.start_child(MyApp.TaskSupervisor, fn -> Audit.record(ip, path) end)
end
```

**Source:** https://elixir.hexdocs.pm/process-anti-patterns.html#sending-unnecessary-data

## 12. A catch-all `_ ->` that hides new cases

**Avoid:** Ending `case`, `with ... else` or function heads with `_ ->` when the possible results are known.
**Why:** When the called function later returns a new shape, the catch-all absorbs it silently and the error reason is lost, instead of failing loudly with a `CaseClauseError` at the place that needs updating.
**Instead:** Match each known result explicitly, such as `{:ok, value}` and `{:error, reason}`, and let unexpected values crash.

```elixir
# Bad
case Payments.charge(order) do
  {:ok, receipt} -> {:ok, receipt}
  _ -> {:error, :payment_failed}
end
```

```elixir
# Good
case Payments.charge(order) do
  {:ok, receipt} -> {:ok, receipt}
  {:error, reason} -> {:error, {:payment_failed, reason}}
end
```

**Source:** https://elixir.hexdocs.pm/code-anti-patterns.html#non-assertive-pattern-matching

## 13. `map[:key]` for keys that must exist

**Avoid:** Dynamic `map[:key]` access for keys that are always present.
**Why:** A missing or misspelled key returns `nil`, which travels on and fails far away (for example as `"Ada "` instead of an error); on structs, `struct[:key]` raises because structs do not implement `Access`.
**Instead:** Use `map.key` or pattern matching for required atom keys, which raise `KeyError` at the source; keep `map[:key]` for optional keys.

```elixir
# Bad
def full_name(user), do: "#{user[:first_name]} #{user[:last_name]}"
```

```elixir
# Good
def full_name(%{first_name: first, last_name: last}), do: "#{first} #{last}"
```

**Source:** https://elixir.hexdocs.pm/code-anti-patterns.html#non-assertive-map-access

## 14. `Enum` pipelines over large or unbounded input

**Avoid:** Reading a whole large file or result set into memory and running several `Enum` steps over it when you need only part of it.
**Why:** Each `Enum` step builds a full intermediate list, so memory grows with the input and the work continues past the point where you have enough results.
**Instead:** Use `File.stream!/1` and `Stream` functions so elements flow one at a time, and finish with one `Enum` call such as `Enum.take/2`.

```elixir
# Bad
"events.log"
|> File.read!()
|> String.split("\n")
|> Enum.filter(&String.contains?(&1, "ERROR"))
|> Enum.take(10)
```

```elixir
# Good
"events.log"
|> File.stream!()
|> Stream.filter(&String.contains?(&1, "ERROR"))
|> Enum.take(10)
```

**Source:** https://elixir.hexdocs.pm/Stream.html

## 15. Appending with `++` inside loops

**Avoid:** Building a list with `acc ++ [item]` in `Enum.reduce/3` or a recursive function.
**Why:** Lists are singly linked, so `++` copies the whole left list each time and the loop becomes quadratic.
**Instead:** Use `for` or `Enum.map/2`/`Enum.filter/2`, or prepend with `[item | acc]` and call `Enum.reverse/1` once at the end.

```elixir
# Bad
Enum.reduce(orders, [], fn order, acc ->
  if order.status == :paid, do: acc ++ [order.id], else: acc
end)
```

```elixir
# Good
for order <- orders, order.status == :paid, do: order.id
```

**Caught by:** Credo `Credo.Check.Refactor.AppendSingleItem` (disabled by default)
**Source:** https://elixir.hexdocs.pm/lists-and-tuples.html

## 16. `length(list) == 0` to test for emptiness

**Avoid:** `length(list) == 0`, `length(list) > 0` or `Enum.count(enum) == 0`.
**Why:** `length/1` and `Enum.count/1` walk the entire list, which is O(n) for a question that needs one step.
**Instead:** Compare with `[]`, pattern match on `[]` and `[_ | _]`, or use `Enum.empty?/1`.

```elixir
# Bad
if length(items) == 0, do: {:error, :empty_cart}, else: {:ok, items}
```

```elixir
# Good
if items == [], do: {:error, :empty_cart}, else: {:ok, items}
```

**Caught by:** Credo `Credo.Check.Warning.ExpensiveEmptyEnumCheck`
**Source:** https://hexdocs.pm/credo/1.7.19/Credo.Check.Warning.ExpensiveEmptyEnumCheck.html

## Sources

- https://elixir.hexdocs.pm/what-anti-patterns.html
- https://elixir.hexdocs.pm/code-anti-patterns.html
- https://elixir.hexdocs.pm/design-anti-patterns.html
- https://elixir.hexdocs.pm/process-anti-patterns.html
- https://security.erlef.org/secure_coding_and_deployment_hardening/serialisation
- https://www.erlang.org/doc/system/system_limits.html
- https://hexdocs.pm/credo/1.7.19/Credo.Check.Warning.UnsafeToAtom.html
- https://hexdocs.pm/credo/1.7.19/Credo.Check.Warning.UnusedEnumOperation.html
- https://hexdocs.pm/credo/1.7.19/Credo.Check.Warning.ApplicationConfigInModuleAttribute.html
- https://hexdocs.pm/credo/1.7.19/Credo.Check.Warning.MixEnv.html
- https://hexdocs.pm/credo/1.7.19/Credo.Check.Refactor.AppendSingleItem.html
- https://hexdocs.pm/credo/1.7.19/Credo.Check.Warning.ExpensiveEmptyEnumCheck.html
- https://hexdocs.pm/sobelow/0.16.0/Sobelow.DOS.StringToAtom.html
- https://hexdocs.pm/sobelow/0.16.0/Sobelow.Misc.BinToTerm.html
- https://elixir.hexdocs.pm/Application.html#module-compile-time-environment
- https://mix.hexdocs.pm/Mix.html#env/0
- https://elixir.hexdocs.pm/Kernel.html#module-structural-comparison
- https://elixir.hexdocs.pm/DateTime.html
- https://github.com/elixir-lang/elixir/blob/v1.17/CHANGELOG.md
- https://elixir.hexdocs.pm/JSON.html
- https://elixir.hexdocs.pm/GenServer.html#module-when-not-to-use-a-genserver
- https://elixir.hexdocs.pm/Task.Supervisor.html
- https://elixir.hexdocs.pm/Stream.html
- https://elixir.hexdocs.pm/lists-and-tuples.html
