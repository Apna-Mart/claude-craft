# Ruby anti-patterns

Read this whole file before writing or reviewing Ruby code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Ruby-specific traps.

## Contents

1. `eval`, `send` and `public_send` with user input
2. `Kernel#open`, `URI.open` and `IO.read` with dynamic paths
3. Shell commands built from one interpolated string
4. `Marshal.load` and `YAML.unsafe_load` on untrusted data
5. `rescue Exception`
6. Inline `rescue` modifier
7. `Hash.new` with a mutable default object
8. `and` / `or` in assignments and conditions
9. `return` inside a block or proc
10. Mutable constants
11. Mutating string literals without the frozen string literal comment
12. Class variables (`@@`)
13. `==` without matching `eql?` and `hash`
14. `method_missing` without `respond_to_missing?` and `super`
15. `Hash#[]` for keys that must exist
16. Monkey-patching core classes
17. `OpenStruct` for data objects
18. Options hashes instead of keyword arguments

## 1. `eval`, `send` and `public_send` with user input

**Avoid:** Passing user-controlled strings to `eval`, `instance_eval`, `class_eval`, `send`, `public_send` or `constantize`.
**Why:** `eval` runs arbitrary code, and a user-chosen method name lets an attacker call any method; even `public_send("send", "eval", ...)` reaches `eval` because `send` is public.
**Instead:** Map input to an allowlist of known method names or objects, then dispatch.

```ruby
# Bad
result = eval(params_expression)
report.send(format)
```

```ruby
# Good
ALLOWED_FORMATS = %w[csv pdf].freeze
raise ArgumentError, "unknown format: #{format}" unless ALLOWED_FORMATS.include?(format)
report.public_send(:"to_#{format}")
```

**Caught by:** RuboCop `Security/Eval`
**Source:** https://docs.ruby-lang.org/en/master/security/security_rdoc.html

## 2. `Kernel#open`, `URI.open` and `IO.read` with dynamic paths

**Avoid:** Calling `open`, `URI.open`, `IO.read`, `IO.readlines` or `IO.foreach` with a path or URL built from input.
**Why:** Before Ruby 4.0 a string starting with `|` makes these methods start a shell command, and `URI.open` falls back to opening local files when the string is not a URL.
**Instead:** Say what you mean: `File.open` or `File.read` for files, `URI.parse(url).open` or `Net::HTTP` for validated URLs.

```ruby
# Bad
content = open(upload_path).read
lines = IO.readlines(log_path)
```

```ruby
# Good
content = File.read(upload_path)
lines = File.readlines(log_path)
```

**Caught by:** RuboCop `Security/Open`, `Security/IoMethods` (pending, opt in)
**Source:** https://docs.rubocop.org/rubocop/latest/cops_security.html#securityopen

## 3. Shell commands built from one interpolated string

**Avoid:** Running commands with backticks, `%x[]`, or `system` / `spawn` given a single string that interpolates input.
**Why:** A single command string goes through the shell, so input such as `x; rm -rf ~` runs as a second command.
**Instead:** Pass the program and each argument separately to `system` or `Open3`, which skips the shell.

```ruby
# Bad
log = `git log #{branch}`
system("convert #{upload_path} out.png")
```

```ruby
# Good
require "open3"

log, status = Open3.capture2("git", "log", branch)
system("convert", upload_path, "out.png")
```

**Source:** https://docs.ruby-lang.org/en/master/security/command_injection_rdoc.html

## 4. `Marshal.load` and `YAML.unsafe_load` on untrusted data

**Avoid:** Deserializing cookies, request bodies, cache entries from shared stores or uploaded files with `Marshal.load`, `YAML.unsafe_load`, or `YAML.load` on Psych before 4.0 (Ruby before 3.1).
**Why:** Both formats can instantiate arbitrary Ruby classes, which leads to remote code execution.
**Instead:** Use `JSON.parse`, or `YAML.safe_load` with an explicit, minimal `permitted_classes` list.

```ruby
# Bad
session = Marshal.load(cookie_value)
config = YAML.unsafe_load(body)
```

```ruby
# Good
session = JSON.parse(cookie_value)
config = YAML.safe_load(body, permitted_classes: [Date])
```

**Caught by:** RuboCop `Security/MarshalLoad`; `Security/YAMLLoad` flags only `YAML.load`, and only when `TargetRubyVersion` is 3.0 or lower
**Source:** https://docs.ruby-lang.org/en/master/security/security_rdoc.html

## 5. `rescue Exception`

**Avoid:** Writing `rescue Exception`.
**Why:** `Exception` also covers `Interrupt`, `SignalException`, `SystemExit` and `NoMemoryError`, so Ctrl-C, `exit` and process signals get swallowed.
**Instead:** Rescue the specific error classes the block raises; a bare `rescue` already means `StandardError`.

```ruby
# Bad
begin
  sync_orders
rescue Exception => e
  logger.error(e.message)
end
```

```ruby
# Good
begin
  sync_orders
rescue Net::ReadTimeout, Net::OpenTimeout => e
  logger.error(e.message)
end
```

**Caught by:** RuboCop `Lint/RescueException`
**Source:** https://docs.rubocop.org/rubocop/latest/cops_lint.html#lintrescueexception

## 6. Inline `rescue` modifier

**Avoid:** Writing `expression rescue fallback`.
**Why:** The modifier rescues every `StandardError`, including `NoMethodError` from a typo, so real bugs turn into a silent fallback value.
**Instead:** Use an API that reports failure without raising, or a `begin`/`rescue` that names the error class.

```ruby
# Bad
count = Integer(input) rescue 0
```

```ruby
# Good
count = Integer(input, exception: false) || 0
```

**Caught by:** RuboCop `Style/RescueModifier`
**Since:** Ruby 2.6 (`exception: false` on `Integer`, `Float`, `Rational`, `Complex`)
**Source:** https://docs.ruby-lang.org/en/master/syntax/exceptions_rdoc.html

## 7. `Hash.new` with a mutable default object

**Avoid:** Creating a hash with `Hash.new([])` or `Hash.new({})` and then mutating `hash[key]`.
**Why:** The default is one shared object returned for every missing key, and it is not stored, so `groups[:admin] << user` changes the shared array and leaves the hash empty.
**Instead:** Use the block form, which stores a fresh object per key, or `group_by` / `each_with_object`.

```ruby
# Bad
groups = Hash.new([])
users.each { |user| groups[user.role] << user }
```

```ruby
# Good
groups = Hash.new { |hash, key| hash[key] = [] }
users.each { |user| groups[user.role] << user }
```

**Caught by:** RuboCop `Lint/SharedMutableDefault` (pending, opt in)
**Source:** https://docs.ruby-lang.org/en/master/Hash.html#class-Hash-label-Hash+Default

## 8. `and` / `or` in assignments and conditions

**Avoid:** Using `and`, `or` and `not` in boolean expressions.
**Why:** They bind looser than `=`, so `valid = active? and verified?` assigns only `active?` and then discards the second check.
**Instead:** Use `&&`, `||` and `!`.

```ruby
# Bad
valid = user.active? and user.verified?
```

```ruby
# Good
valid = user.active? && user.verified?
```

**Caught by:** RuboCop `Style/AndOr` with `EnforcedStyle: always` (the default `conditionals` style skips assignments)
**Source:** https://docs.ruby-lang.org/en/master/syntax/precedence_rdoc.html

## 9. `return` inside a block or proc

**Avoid:** Using `return` inside a block or `proc` to skip one element.
**Why:** In a block or proc, `return` exits the enclosing method, not the block, so one element ends the whole computation; if the method has already returned, it raises `LocalJumpError`.
**Instead:** Use `next` to produce a value for the current element, and use a lambda when you store a callable.

```ruby
# Bad
def totals(orders)
  orders.map do |order|
    return 0 if order.cancelled?
    order.amount
  end
end
```

```ruby
# Good
def totals(orders)
  orders.map do |order|
    next 0 if order.cancelled?

    order.amount
  end
end
```

**Source:** https://docs.ruby-lang.org/en/master/Proc.html#class-Proc-label-Lambda+and+non-lambda+semantics

## 10. Mutable constants

**Avoid:** Assigning an unfrozen array, hash or string to a constant.
**Why:** Constants only block reassignment, not mutation, so any caller can change the shared object for the whole process.
**Instead:** Freeze the constant and build new objects from it.

```ruby
# Bad
DEFAULT_HEADERS = { "Accept" => "application/json" }
DEFAULT_HEADERS["Authorization"] = token
```

```ruby
# Good
DEFAULT_HEADERS = { "Accept" => "application/json" }.freeze
headers = DEFAULT_HEADERS.merge("Authorization" => token)
```

**Caught by:** RuboCop `Style/MutableConstant`
**Source:** https://docs.rubocop.org/rubocop/latest/cops_style.html#stylemutableconstant

## 11. Mutating string literals without the frozen string literal comment

**Avoid:** Leaving out `# frozen_string_literal: true` and mutating string literals in place with `<<`, `gsub!` or `upcase!`.
**Why:** Since Ruby 3.4, mutating a literal in a file without the comment emits a deprecation warning (with `-W:deprecated`) because literals will be frozen by default; once frozen, that code raises `FrozenError`.
**Instead:** Add the magic comment, build new strings with interpolation, and create mutable buffers with `+""` or `String.new`.

```ruby
# Bad
def greeting(name)
  message = "Hello, "
  message << name
end
```

```ruby
# Good
# frozen_string_literal: true

def greeting(name)
  "Hello, #{name}"
end
```

**Caught by:** RuboCop `Style/FrozenStringLiteralComment`
**Since:** Ruby 2.3 (the magic comment)
**Source:** https://docs.ruby-lang.org/en/master/syntax/comments_rdoc.html#label-frozen_string_literal+Directive

## 12. Class variables (`@@`)

**Avoid:** Storing class-level state in `@@` variables.
**Why:** A class variable is shared by the whole inheritance tree, so a subclass assignment overwrites the parent's value; since Ruby 3.0, reading one that an ancestor also defines later raises `RuntimeError` ("overtaken").
**Instead:** Use a class-level instance variable with a reader on the singleton class.

```ruby
# Bad
class Plugin
  @@registry = []

  def self.register(name)
    @@registry << name
  end
end
```

```ruby
# Good
class Plugin
  @registry = []

  class << self
    attr_reader :registry

    def register(name) = registry << name
  end
end
```

**Caught by:** RuboCop `Style/ClassVars`
**Source:** https://docs.rubocop.org/rubocop/latest/cops_style.html#styleclassvars

## 13. `==` without matching `eql?` and `hash`

**Avoid:** Defining `==` on a value object without also defining `eql?` and `hash`, or using `equal?` to compare values.
**Why:** `Hash` keys, `uniq` and `Set` use `eql?` and `hash`, so two equal objects are treated as different keys; `equal?` checks identity and is false for two equal copies.
**Instead:** Use `Data.define` or `Struct`, which implement all three, or define `eql?` and `hash` from the same fields as `==`.

```ruby
# Bad
class Money
  attr_reader :cents, :currency

  def initialize(cents, currency)
    @cents = cents
    @currency = currency
  end

  def ==(other) = other.is_a?(Money) && cents == other.cents && currency == other.currency
end
```

```ruby
# Good
Money = Data.define(:cents, :currency)
```

**Since:** Ruby 3.2 (`Data`)
**Source:** https://docs.ruby-lang.org/en/master/Hash.html#class-Hash-label-User-Defined+Hash+Keys

## 14. `method_missing` without `respond_to_missing?` and `super`

**Avoid:** Overriding `method_missing` without defining `respond_to_missing?` and without calling `super` for names you do not handle.
**Why:** `respond_to?` and `method` then lie about the object, and misspelled calls return `nil` instead of raising `NoMethodError`.
**Instead:** Handle only the names you recognize, call `super` for the rest, and mirror the same check in `respond_to_missing?`.

```ruby
# Bad
class Settings
  def initialize(values) = @values = values

  def method_missing(name, *args)
    @values[name.to_s]
  end
end
```

```ruby
# Good
class Settings
  def initialize(values) = @values = values

  def method_missing(name, *args)
    @values.key?(name.to_s) ? @values[name.to_s] : super
  end

  def respond_to_missing?(name, include_private = false)
    @values.key?(name.to_s) || super
  end
end
```

**Caught by:** RuboCop `Style/MissingRespondToMissing`
**Source:** https://docs.ruby-lang.org/en/master/Object.html#method-i-respond_to_missing-3F

## 15. `Hash#[]` for keys that must exist

**Avoid:** Reading required configuration or payload keys with `hash[key]` or `ENV["NAME"]`.
**Why:** A missing or misspelled key returns `nil`, which fails later and far away as a `NoMethodError` on `nil`.
**Instead:** Use `fetch`, which raises `KeyError` naming the key, and give an explicit default only where one is valid.

```ruby
# Bad
timeout = config[:timeout_seconds]
api_key = ENV["API_KEY"]
```

```ruby
# Good
timeout = config.fetch(:timeout_seconds)
api_key = ENV.fetch("API_KEY")
```

**Caught by:** RuboCop `Style/FetchEnvVar` (pending, opt in; `ENV` only; set `DefaultToNil: false` so it suggests `ENV.fetch("X")` instead of `ENV.fetch("X", nil)`)
**Source:** https://docs.ruby-lang.org/en/master/Hash.html#method-i-fetch

## 16. Monkey-patching core classes

**Avoid:** Reopening `String`, `Array`, `Hash`, `Integer` or other core classes to add or change methods globally.
**Why:** The change applies to every gem in the process, and a later Ruby or library method with the same name silently overrides yours or is overridden by it.
**Instead:** Write a plain module function, or use a refinement scoped to the files that opt in with `using`.

```ruby
# Bad
class String
  def to_slug
    downcase.strip.gsub(/\W+/, "-")
  end
end
```

```ruby
# Good
module StringSlug
  refine String do
    def to_slug = downcase.strip.gsub(/\W+/, "-")
  end
end

using StringSlug
```

**Source:** https://docs.ruby-lang.org/en/master/syntax/refinements_rdoc.html

## 17. `OpenStruct` for data objects

**Avoid:** Using `OpenStruct` to model records or value objects.
**Why:** It is slow, accepts any attribute so typos return `nil`, and is officially discouraged; Ruby 4.0 moved `ostruct` from a default gem to a bundled gem.
**Instead:** Use `Data.define` for immutable values, `Struct` when you need setters, or a plain `Hash`.

```ruby
# Bad
point = OpenStruct.new(x: 1, y: 2)
```

```ruby
# Good
Point = Data.define(:x, :y)
point = Point.new(x: 1, y: 2)
```

**Caught by:** RuboCop `Style/OpenStructUse` (pending, opt in)
**Since:** Ruby 3.2 (`Data`)
**Source:** https://docs.rubocop.org/rubocop/latest/cops_style.html#styleopenstructuse

## 18. Options hashes instead of keyword arguments

**Avoid:** Taking an `options = {}` hash and reading keys from it.
**Why:** Unknown or misspelled keys are silently ignored, and `options[:x] || default` overrides an explicit `false`.
**Instead:** Declare keyword arguments with defaults; Ruby raises `ArgumentError` on unknown keywords.

```ruby
# Bad
def connect(options = {})
  host = options[:host] || "localhost"
  port = options[:port] || 5432
  Connection.new(host, port)
end
```

```ruby
# Good
def connect(host: "localhost", port: 5432)
  Connection.new(host, port)
end
```

**Caught by:** RuboCop `Style/OptionHash` (disabled by default)
**Source:** https://docs.ruby-lang.org/en/master/syntax/methods_rdoc.html#label-Keyword+Arguments

## Sources

- https://docs.ruby-lang.org/en/master/security/security_rdoc.html
- https://docs.rubocop.org/rubocop/latest/cops_security.html#securityopen
- https://docs.ruby-lang.org/en/4.0/NEWS_md.html
- https://docs.ruby-lang.org/en/master/security/command_injection_rdoc.html
- https://docs.rubocop.org/rubocop/latest/cops_lint.html#lintrescueexception
- https://docs.ruby-lang.org/en/master/syntax/exceptions_rdoc.html
- https://docs.ruby-lang.org/en/master/Hash.html#class-Hash-label-Hash+Default
- https://docs.ruby-lang.org/en/master/syntax/precedence_rdoc.html
- https://docs.ruby-lang.org/en/master/Proc.html#class-Proc-label-Lambda+and+non-lambda+semantics
- https://docs.rubocop.org/rubocop/latest/cops_style.html#stylemutableconstant
- https://docs.ruby-lang.org/en/master/syntax/comments_rdoc.html#label-frozen_string_literal+Directive
- https://docs.ruby-lang.org/en/3.4/NEWS_md.html
- https://docs.rubocop.org/rubocop/latest/cops_style.html#styleclassvars
- https://docs.ruby-lang.org/en/master/Hash.html#class-Hash-label-User-Defined+Hash+Keys
- https://docs.ruby-lang.org/en/master/Object.html#method-i-respond_to_missing-3F
- https://docs.ruby-lang.org/en/master/Hash.html#method-i-fetch
- https://docs.ruby-lang.org/en/master/syntax/refinements_rdoc.html
- https://docs.rubocop.org/rubocop/latest/cops_style.html#styleopenstructuse
- https://docs.ruby-lang.org/en/master/syntax/methods_rdoc.html#label-Keyword+Arguments
