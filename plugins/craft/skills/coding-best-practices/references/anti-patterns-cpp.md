# C++ anti-patterns

Read this whole file before writing or reviewing C++ code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the C++-specific traps.

## Contents

1. Raw `new` and `delete`
2. Owning raw pointers in interfaces
3. Views and references bound to temporaries
4. Range-for over a member of a temporary
5. Capturing by reference in a lambda that outlives the scope
6. Using an iterator, pointer or reference after the container changed
7. Using an object after `std::move`
8. Polymorphic base without a virtual destructor
9. Breaking the rule of zero, three or five
10. Uninitialized members
11. Catching exceptions by value
12. `std::shared_ptr` by default
13. `return std::move(local)` and moving from `const`
14. Implicit single-argument constructors
15. C-style casts
16. `auto` copies in range-for
17. `using namespace` in a header
18. `std::endl` in loops
19. Treating `std::vector<bool>` like a container of `bool`

## 1. Raw `new` and `delete`

**Avoid:** calling `new` and `delete` (or `new[]` and `delete[]`) directly in application code.
**Why:** any early `return` or exception between the two leaks the object, and a mismatched `delete` versus `delete[]` is undefined behavior.
**Instead:** create owned objects with `std::make_unique` (or `std::make_shared` when ownership is truly shared) and hold arrays in `std::vector`.

```cpp
// Bad
Widget* widget = new Widget(config);
widget->start();
delete widget;
```

```cpp
// Good
auto widget = std::make_unique<Widget>(config);
widget->start();
```

**Caught by:** clang-tidy `cppcoreguidelines-owning-memory`, `modernize-make-unique`, `modernize-make-shared`
**Since:** C++14 for `std::make_unique`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-newdelete

## 2. Owning raw pointers in interfaces

**Avoid:** returning or accepting a `T*` that the receiver is expected to `delete`.
**Why:** nothing in the type says who frees it, so callers leak it or free it twice.
**Instead:** return `std::unique_ptr<T>` to hand over ownership, and take `T&` or `T*` only for non-owning access.

```cpp
// Bad
Connection* open_connection(const std::string& url);
```

```cpp
// Good
std::unique_ptr<Connection> open_connection(const std::string& url);
void send(Connection& connection, std::string_view payload);
```

**Caught by:** clang-tidy `cppcoreguidelines-owning-memory`
**Since:** C++17 for `std::string_view`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-raw

## 3. Views and references bound to temporaries

**Avoid:** storing a `std::string_view`, `std::span`, reference or iterator that points into a temporary, or returning one that points into a local.
**Why:** the temporary dies at the end of the full expression, so the view reads freed memory; it usually works in tests and fails under a different allocator or optimization level.
**Instead:** keep an owning `std::string` or container alive for as long as the view is used, and return owning types from functions.

```cpp
// Bad
std::string_view host = make_host() + ":443";
connect(host);
```

```cpp
// Good
std::string host = make_host() + ":443";
connect(host);
```

**Caught by:** Clang `-Wdangling-gsl`, `-Wreturn-stack-address`; clang-tidy `bugprone-dangling-handle`
**Source:** https://clang.llvm.org/extra/clang-tidy/checks/bugprone/dangling-handle.html

## 4. Range-for over a member of a temporary

**Avoid:** `for (auto& x : make_obj().items())` where `items()` returns a reference into the temporary.
**Why:** before C++23 only the reference returned by `items()` is kept, the temporary object is destroyed before the loop body runs, and the loop walks freed memory.
**Instead:** bind the temporary to a named variable first; do not rely on the C++23 fix while any supported compiler or language mode predates it.

```cpp
// Bad
for (const auto& line : load_order().lines()) ship(line);
```

```cpp
// Good
const Order order = load_order();
for (const auto& line : order.lines()) ship(line);
```

**Since:** C++23 extends the temporary's lifetime (P2718R0; GCC 15, Clang 20)
**Source:** https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p2718r0.html

## 5. Capturing by reference in a lambda that outlives the scope

**Avoid:** `[&]` or `[&x]` in a lambda that is returned, stored, queued as a callback, or run on another thread.
**Why:** the captured locals are destroyed when the enclosing function returns, so the lambda later reads and writes dead stack memory.
**Instead:** capture by value or move the data in with an init-capture.

```cpp
// Bad
std::function<int()> make_counter() {
    int count = 0;
    return [&] { return ++count; };
}
```

```cpp
// Good
std::function<int()> make_counter() {
    return [count = 0]() mutable { return ++count; };
}
```

**Since:** C++14 for init-capture
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-value-capture

## 6. Using an iterator, pointer or reference after the container changed

**Avoid:** erasing from a container inside an iterator loop, or keeping a reference to an element across `push_back`, `insert` or `erase`.
**Why:** `erase` invalidates the erased iterator and everything after it, and growth reallocates a `std::vector`, so the next access is undefined behavior.
**Instead:** use `std::erase_if` to remove elements, and use indices or re-fetch the element after the container changes.

```cpp
// Bad
for (auto it = users.begin(); it != users.end(); ++it) {
    if (it->expired()) users.erase(it);
}
```

```cpp
// Good
std::erase_if(users, [](const User& user) { return user.expired(); });
```

**Since:** C++20 for `std::erase_if`
**Source:** https://en.cppreference.com/cpp/container/vector/erase2

## 7. Using an object after `std::move`

**Avoid:** reading a variable after it was passed to `std::move`.
**Why:** a moved-from object is in a valid but unspecified state, so a moved-from `std::string` is usually empty and the read silently uses the wrong value.
**Instead:** finish every use before the move, or reassign the variable before using it again.

```cpp
// Bad
names.push_back(std::move(name));
log_added(name);
```

```cpp
// Good
log_added(name);
names.push_back(std::move(name));
```

**Caught by:** clang-tidy `bugprone-use-after-move`
**Source:** https://clang.llvm.org/extra/clang-tidy/checks/bugprone/use-after-move.html

## 8. Polymorphic base without a virtual destructor

**Avoid:** a base class with virtual functions and a public non-virtual destructor.
**Why:** deleting a derived object through a base pointer, which `std::unique_ptr<Base>` does, is undefined behavior and in practice skips the derived destructor.
**Instead:** declare `virtual ~Base() = default;`, or make the destructor `protected` and non-virtual when deletion through the base is never allowed.

```cpp
// Bad
struct Shape {
    virtual double area() const = 0;
};
```

```cpp
// Good
struct Shape {
    virtual ~Shape() = default;
    virtual double area() const = 0;
};
```

**Caught by:** Clang and GCC `-Wnon-virtual-dtor`, `-Wdelete-non-virtual-dtor`; clang-tidy `cppcoreguidelines-virtual-class-destructor`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor-virtual

## 9. Breaking the rule of zero, three or five

**Avoid:** writing a destructor that frees a resource while leaving copy and move to the compiler.
**Why:** the generated copy duplicates the raw handle, so both copies free it and the program double-frees.
**Instead:** hold the resource in a member that already manages it (`std::vector`, `std::unique_ptr`, a small RAII wrapper) and declare no special members; if you must declare one, declare or `= delete` all five.

```cpp
// Bad
class Buffer {
public:
    explicit Buffer(std::size_t size) : data_(new char[size]) {}
    ~Buffer() { delete[] data_; }
private:
    char* data_;
};
```

```cpp
// Good
class Buffer {
public:
    explicit Buffer(std::size_t size) : data_(size) {}
private:
    std::vector<char> data_;
};
```

**Caught by:** clang-tidy `cppcoreguidelines-special-member-functions`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-five

## 10. Uninitialized members

**Avoid:** built-in members (`int`, `bool`, pointers, enums) with no initializer in a class or aggregate.
**Why:** default-initializing the object leaves them holding stack or heap garbage, and reading them is undefined behavior (C++26 calls it erroneous behavior for locals, still a bug).
**Instead:** give every member a default member initializer.

```cpp
// Bad
struct RetryPolicy {
    int max_attempts;
    bool backoff;
    std::chrono::milliseconds delay;
};
```

```cpp
// Good
struct RetryPolicy {
    int max_attempts = 3;
    bool backoff = true;
    std::chrono::milliseconds delay{100};
};
```

**Caught by:** clang-tidy `cppcoreguidelines-pro-type-member-init`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-in-class-initializer

## 11. Catching exceptions by value

**Avoid:** `catch (std::exception e)` or catching any polymorphic exception type by value.
**Why:** the handler copies only the base part, so `what()` and the dynamic type of the derived exception are lost, and `throw e;` rethrows the sliced copy.
**Instead:** catch by `const&` and rethrow with a bare `throw;`.

```cpp
// Bad
catch (std::exception e) { log_error(e.what()); throw e; }
```

```cpp
// Good
catch (const std::exception& e) { log_error(e.what()); throw; }
```

**Caught by:** clang-tidy `misc-throw-by-value-catch-by-reference`; GCC `-Wcatch-value`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-exception-ref

## 12. `std::shared_ptr` by default

**Avoid:** reaching for `std::shared_ptr` when one owner is enough, and passing smart pointers to functions that only use the object.
**Why:** shared ownership hides who controls the lifetime, costs an atomic reference count on every copy, and lets cycles form that leak.
**Instead:** own with `std::unique_ptr` (it converts to `std::shared_ptr` later if sharing becomes real) and pass `T&` or `const T&` to functions that do not take ownership.

```cpp
// Bad
std::shared_ptr<Parser> make_parser() { return std::make_shared<Parser>(); }
void run(std::shared_ptr<Parser> parser) { parser->parse(); }
```

```cpp
// Good
std::unique_ptr<Parser> make_parser() { return std::make_unique<Parser>(); }
void run(Parser& parser) { parser.parse(); }
```

**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-unique

## 13. `return std::move(local)` and moving from `const`

**Avoid:** wrapping a returned local in `std::move`, and calling `std::move` on a `const` object.
**Why:** `return std::move(local)` blocks copy elision, and moving a `const` object silently copies it, so both cost the copy you meant to avoid.
**Instead:** `return local;` and drop `const` from objects you intend to move from.

```cpp
// Bad
std::string build_key() {
    std::string key = prefix();
    key += suffix();
    return std::move(key);
}
```

```cpp
// Good
std::string build_key() {
    std::string key = prefix();
    key += suffix();
    return key;
}
```

**Caught by:** Clang and GCC `-Wpessimizing-move`, `-Wredundant-move`; clang-tidy `performance-move-const-arg`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-return-move-local

## 14. Implicit single-argument constructors

**Avoid:** constructors callable with one argument that are not marked `explicit`.
**Why:** the compiler uses them as silent conversions, so `travel(42.0)` compiles with no unit named and the type safety of the wrapper is gone.
**Instead:** mark single-argument constructors (and conversion operators) `explicit` unless the conversion is lossless and intended.

```cpp
// Bad
class Meters {
public:
    Meters(double value) : value_(value) {}
private:
    double value_;
};
```

```cpp
// Good
class Meters {
public:
    explicit Meters(double value) : value_(value) {}
private:
    double value_;
};
```

**Caught by:** clang-tidy `google-explicit-constructor`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-explicit

## 15. C-style casts

**Avoid:** `(T)expr` and `T(expr)` function-style casts on non-trivial conversions.
**Why:** a C-style cast tries `const_cast`, `static_cast` and `reinterpret_cast` in turn, so it can silently drop `const` or reinterpret unrelated types where a named cast would fail to compile.
**Instead:** use `static_cast` for value conversions, `dynamic_cast` for checked downcasts, and reach for `reinterpret_cast` or `const_cast` only where you mean exactly that.

```cpp
// Bad
auto* circle = (Circle*)shape;
int count = (int)items.size();
```

```cpp
// Good
auto* circle = dynamic_cast<Circle*>(shape);
int count = static_cast<int>(items.size());
```

**Caught by:** Clang and GCC `-Wold-style-cast`; clang-tidy `cppcoreguidelines-pro-type-cstyle-cast`, `google-readability-casting`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-casts-named

## 16. `auto` copies in range-for

**Avoid:** `for (auto x : container)` when the elements are strings, containers or other types that are expensive to copy.
**Why:** each iteration copies the element, and edits to `x` change the copy, not the container.
**Instead:** use `const auto&` to read and `auto&` to modify.

```cpp
// Bad
for (auto user : users) total += user.score;
```

```cpp
// Good
for (const auto& user : users) total += user.score;
```

**Caught by:** clang-tidy `performance-for-range-copy`; Clang `-Wrange-loop-construct` (the `const auto x` form)
**Source:** https://clang.llvm.org/extra/clang-tidy/checks/performance/for-range-copy.html

## 17. `using namespace` in a header

**Avoid:** `using namespace std;` (or any using-directive) at namespace scope in a header.
**Why:** every file that includes the header inherits the directive, which causes ambiguous calls and silent overload changes far from the header.
**Instead:** qualify names in headers; keep using-directives, if any, inside function bodies in `.cpp` files.

```cpp
// Bad
#include <string>
using namespace std;
string trim(const string& text);
```

```cpp
// Good
#include <string>
std::string trim(const std::string& text);
```

**Caught by:** clang-tidy `google-global-names-in-headers`, `google-build-using-namespace`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-using-directive

## 18. `std::endl` in loops

**Avoid:** ending each line with `std::endl` when writing many lines.
**Why:** `std::endl` flushes the stream every time, which turns buffered output into one system call per line.
**Instead:** write `'\n'` and flush once, when the output must be visible.

```cpp
// Bad
for (const auto& row : rows) out << row << std::endl;
```

```cpp
// Good
for (const auto& row : rows) out << row << '\n';
```

**Caught by:** clang-tidy `performance-avoid-endl`
**Source:** https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rio-endl

## 19. Treating `std::vector<bool>` like a container of `bool`

**Avoid:** taking `bool&` or `bool*` into a `std::vector<bool>`, holding its elements with `auto`, or writing different elements from different threads.
**Why:** it packs bits and `operator[]` returns a proxy, so `auto flag = v[0]` aliases the vector instead of copying, and writes to neighboring elements race.
**Instead:** copy into a plain `bool`, or store `std::vector<char>` (or `std::bitset` for a fixed size) when you need real references or per-element thread safety.

```cpp
// Bad
std::vector<bool> seen(count);
auto first = seen[0];
seen[0] = true;
```

```cpp
// Good
std::vector<char> seen(count);
bool first = seen[0];
seen[0] = true;
```

**Source:** https://en.cppreference.com/cpp/container/vector_bool

## Sources

- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-newdelete
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#ri-raw
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-value-capture
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-dtor-virtual
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-five
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-in-class-initializer
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#re-exception-ref
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rr-unique
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rf-return-move-local
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rc-explicit
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#res-casts-named
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rs-using-directive
- https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#rio-endl
- https://clang.llvm.org/extra/clang-tidy/checks/bugprone/dangling-handle.html
- https://clang.llvm.org/extra/clang-tidy/checks/bugprone/use-after-move.html
- https://clang.llvm.org/extra/clang-tidy/checks/performance/for-range-copy.html
- https://clang.llvm.org/extra/clang-tidy/checks/list.html
- https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p2718r0.html
- https://clang.llvm.org/cxx_status.html
- https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2024/p2795r5.html
- https://gcc.gnu.org/projects/cxx-status.html
- https://en.cppreference.com/cpp/container/vector/erase2
- https://en.cppreference.com/cpp/container/vector_bool
- https://gcc.gnu.org/onlinedocs/gcc/C_002b_002b-Dialect-Options.html
