# C anti-patterns

Read this whole file before writing or reviewing C code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the C-specific traps.

## Contents

1. Unbounded string copies: `gets`, `strcpy`, `strcat`, `sprintf`
2. User data as a format string
3. `scanf("%s")` without a field width
4. Forgetting the terminator when sizing a string buffer
5. Trusting `strncpy` to terminate
6. Unchecked size multiplication in an allocation
7. Use after free, double free, and dangling pointers after `free`
8. Returning a pointer to a local
9. Reading an uninitialized variable
10. Signed integer overflow
11. Ignoring return values of `malloc`, `fwrite`, `fclose` and friends
12. `p = realloc(p, n)`
13. `memset` to wipe secrets
14. `sizeof` on an array parameter
15. Storing `getchar()` in a `char`
16. `atoi` and friends for untrusted input
17. Type punning through a pointer cast
18. Function-like macros with unparenthesized or repeated arguments

## 1. Unbounded string copies: `gets`, `strcpy`, `strcat`, `sprintf`

**Avoid:** writing into a fixed buffer with a function that does not take the buffer size, and never call `gets` (removed from the language in C11).
**Why:** input longer than the buffer overwrites the stack or heap, which is the classic exploitable buffer overflow.
**Instead:** read with `fgets(buf, sizeof buf, stream)`, build strings with `snprintf`, and check its return value for truncation.

```c
// Bad
strcpy(greeting, "Hello, ");
strcat(greeting, name);
sprintf(path, "/home/%s/.config", name);
```

```c
// Good
int n = snprintf(path, sizeof path, "/home/%s/.config", name);
if (n < 0 || (size_t)n >= sizeof path) return -1;
```

**Caught by:** clang-tidy `clang-analyzer-security.insecureAPI.strcpy` (strcpy, strcat), `clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling` (sprintf family), `bugprone-unsafe-functions` (gets)
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/characters-and-strings-str/str31-c/

## 2. User data as a format string

**Avoid:** passing a string that came from outside the program as the format argument of `printf`, `fprintf`, `snprintf` or `syslog`.
**Why:** `%x` sequences in the data leak stack memory and `%n` writes to memory, so the input controls the process.
**Instead:** use a literal format and pass the data as an argument, or call `fputs`.

```c
// Bad
void log_message(const char *msg) { printf(msg); }
```

```c
// Good
void log_message(const char *msg) { printf("%s", msg); }
```

**Caught by:** Clang and GCC `-Wformat-security`
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/input-output-fio/fio30-c/

## 3. `scanf("%s")` without a field width

**Avoid:** `%s` or `%[` conversions in `scanf`, `fscanf` or `sscanf` without a maximum width.
**Why:** the conversion writes as many characters as the input holds, so a long word overflows the destination.
**Instead:** give a width one less than the buffer size, or read the line with `fgets` and parse it.

```c
// Bad
char word[16];
if (scanf("%s", word) != 1) return -1;
```

```c
// Good
char word[16];
if (scanf("%15s", word) != 1) return -1;
```

**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/characters-and-strings-str/str31-c/

## 4. Forgetting the terminator when sizing a string buffer

**Avoid:** allocating `strlen(s)` bytes for a copy of `s`, or a `char[N]` for a string of exactly `N` characters.
**Why:** the copy writes the `'\0'` one byte past the end, corrupting the heap or the next variable.
**Instead:** allocate `strlen(s) + 1`, or use `strdup`, which does it for you.

```c
// Bad
char *copy = malloc(strlen(src));
strcpy(copy, src);
```

```c
// Good
char *copy = strdup(src);
if (copy == NULL) return NULL;
```

**Since:** C23 for `strdup` in ISO C (POSIX had it before)
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/characters-and-strings-str/str31-c/

## 5. Trusting `strncpy` to terminate

**Avoid:** using `strncpy(dst, src, sizeof dst)` as a "safe `strcpy`".
**Why:** when `src` fills the buffer, `strncpy` writes no `'\0'`, and the next `strlen` or `printf` reads past the end.
**Instead:** use `snprintf(dst, sizeof dst, "%s", src)` and check for truncation.

```c
// Bad
char host[64];
strncpy(host, input, sizeof host);
```

```c
// Good
char host[64];
int n = snprintf(host, sizeof host, "%s", input);
if (n < 0 || (size_t)n >= sizeof host) return -1;
```

**Caught by:** GCC `-Wstringop-truncation`
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/characters-and-strings-str/str32-c/

## 6. Unchecked size multiplication in an allocation

**Avoid:** `malloc(count * size)` or `realloc(p, count * size)` when `count` comes from input.
**Why:** the product wraps around to a small number, the allocation succeeds, and the following writes run off the end of it.
**Instead:** use `calloc(count, size)`, which fails instead of wrapping; for `realloc` growth, compute the byte count with `ckd_mul` and bail out when it reports overflow.

```c
// Bad
struct item *items = malloc(count * sizeof *items);
```

```c
// Good
struct item *items = calloc(count, sizeof *items);
if (items == NULL) return NULL;
```

**Caught by:** clang-tidy `bugprone-implicit-widening-of-multiplication-result` (the `int * int` form only)
**Since:** C23 for `ckd_mul` in `<stdckdint.h>` (the `realloc` case); C23 also states the `calloc` overflow check in the standard
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/integers-int/int30-c/

## 7. Use after free, double free, and dangling pointers after `free`

**Avoid:** reading, writing or freeing memory through a pointer after it was passed to `free`, and leaving a freed pointer in a struct or global.
**Why:** the allocator reuses the block, so a stale read returns someone else's data and a second `free` corrupts the heap; both are common exploit primitives.
**Instead:** set the pointer to `NULL` right after `free` whenever it outlives the call, so a later `free` is a no-op and a later read fails loudly.

```c
// Bad
free(session->token);
if (expired) free(session->token);
log_token(session->token);
```

```c
// Good
free(session->token);
session->token = NULL;
```

**Caught by:** clang-tidy `clang-analyzer-unix.Malloc`; GCC `-Wuse-after-free`, `-Wanalyzer-double-free`, `-Wanalyzer-use-after-free` (with `-fanalyzer`); AddressSanitizer `-fsanitize=address` at run time
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/memory-management-mem/mem30-c/

## 8. Returning a pointer to a local

**Avoid:** returning the address of an automatic array or variable, or storing it somewhere that outlives the function.
**Why:** the stack frame is reused by the next call, so the caller reads garbage that often looks right in tests.
**Instead:** let the caller pass the buffer and its size, or return heap memory that the caller frees.

```c
// Bad
const char *format_id(unsigned id) {
    char buf[16];
    snprintf(buf, sizeof buf, "id-%u", id);
    return buf;
}
```

```c
// Good
int format_id(char *buf, size_t size, unsigned id) {
    int n = snprintf(buf, size, "id-%u", id);
    return (n < 0 || (size_t)n >= size) ? -1 : 0;
}
```

**Caught by:** Clang `-Wreturn-stack-address`, GCC `-Wreturn-local-addr` (both on by default)
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/declarations-and-initialization-dcl/dcl30-c/

## 9. Reading an uninitialized variable

**Avoid:** declaring a local without a value and assigning it only on some paths, or reading `malloc` memory before writing it.
**Why:** the value is whatever was on the stack or heap, so behavior changes between builds and optimization levels, and the read is undefined behavior.
**Instead:** initialize at the declaration (`= 0`, `= {0}`, or a named failure value), and use `calloc` when the buffer must start zeroed.

```c
// Bad
int status;
if (fd >= 0) status = 0;
return status;
```

```c
// Good
int status = -1;
if (fd >= 0) status = 0;
return status;
```

**Caught by:** Clang `-Wsometimes-uninitialized`, GCC `-Wmaybe-uninitialized`, clang-tidy `cppcoreguidelines-init-variables`, MemorySanitizer `-fsanitize=memory`
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/expressions-exp/exp33-c/

## 10. Signed integer overflow

**Avoid:** adding or multiplying signed integers that can exceed their range, and detecting it afterwards with `if (sum < a)`.
**Why:** signed overflow is undefined behavior, so the optimizer assumes it never happens and is allowed to delete the after-the-fact check.
**Instead:** check before the operation, or use `ckd_add`, `ckd_sub` and `ckd_mul`, which report overflow without performing it.

```c
// Bad
int total = a + b;
if (total < a) return -1;
```

```c
// Good
int total;
if (ckd_add(&total, a, b)) return -1;
```

**Caught by:** UndefinedBehaviorSanitizer `-fsanitize=signed-integer-overflow` at run time
**Since:** C23 for `<stdckdint.h>`; older GCC and Clang offer `__builtin_add_overflow`
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/integers-int/int32-c/

## 11. Ignoring return values of `malloc`, `fwrite`, `fclose` and friends

**Avoid:** calling a standard library function that reports failure through its return value and discarding that value.
**Why:** a `NULL` from `malloc` becomes a crash far away, and an ignored `fwrite` or `fclose` failure means data silently never reached the disk.
**Instead:** check every result that can signal failure, and mark your own fallible functions `[[nodiscard]]`.

```c
// Bad
char *buf = malloc(len);
memcpy(buf, src, len);
fwrite(buf, 1, len, out);
fclose(out);
```

```c
// Good
char *buf = malloc(len);
if (buf == NULL) return -1;
memcpy(buf, src, len);
size_t written = fwrite(buf, 1, len, out);
free(buf);
int closed = fclose(out);
if (written != len || closed != 0) return -1;
```

**Caught by:** clang-tidy `cert-err33-c` (an alias of `bugprone-unused-return-value` with the CERT function list); Clang and GCC `-Wunused-result` for `[[nodiscard]]` functions
**Since:** C23 for `[[nodiscard]]`
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/error-handling-err/err33-c/

## 12. `p = realloc(p, n)`

**Avoid:** assigning the result of `realloc` straight back to the pointer you passed in.
**Why:** on failure `realloc` returns `NULL` and leaves the old block alive, so the only pointer to it is overwritten and the memory leaks.
**Instead:** assign to a temporary, check it, then replace the original.

```c
// Bad
buf = realloc(buf, new_size);
if (buf == NULL) return -1;
```

```c
// Good
char *grown = realloc(buf, new_size);
if (grown == NULL) return -1;
buf = grown;
```

**Caught by:** clang-tidy `bugprone-suspicious-realloc-usage`
**Source:** https://clang.llvm.org/extra/clang-tidy/checks/bugprone/suspicious-realloc-usage.html

## 13. `memset` to wipe secrets

**Avoid:** clearing a password, key or token with `memset` just before the buffer goes out of scope or is freed.
**Why:** the compiler sees a dead store and removes it, so the secret stays in memory and can end up in a core dump or swap.
**Instead:** use `memset_explicit`; where the C library lacks it, use `explicit_bzero` (glibc 2.25+, BSDs) or `memset_s` (C11 Annex K, available on macOS).

```c
// Bad
char password[64];
read_password(password, sizeof password);
authenticate(password);
memset(password, 0, sizeof password);
```

```c
// Good
char password[64];
read_password(password, sizeof password);
authenticate(password);
memset_explicit(password, 0, sizeof password);
```

**Since:** C23 for `memset_explicit`; glibc ships it from 2.43
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc06-c/

## 14. `sizeof` on an array parameter

**Avoid:** computing an element count with `sizeof arr / sizeof arr[0]` when `arr` is a function parameter.
**Why:** an array parameter is a pointer, so the expression yields the pointer size divided by the element size, not the length.
**Instead:** pass the element count as a separate `size_t` parameter.

```c
// Bad
int sum(const int values[]) {
    int total = 0;
    for (size_t i = 0; i < sizeof values / sizeof values[0]; i++) total += values[i];
    return total;
}
```

```c
// Good
int sum(const int *values, size_t count) {
    int total = 0;
    for (size_t i = 0; i < count; i++) total += values[i];
    return total;
}
```

**Caught by:** Clang `-Wsizeof-array-argument`, `-Wsizeof-pointer-div`; clang-tidy `bugprone-sizeof-expression`
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/arrays-arr/arr01-c/

## 15. Storing `getchar()` in a `char`

**Avoid:** keeping the result of `getchar`, `fgetc` or `getc` in a `char` and comparing it with `EOF`.
**Why:** where `char` is unsigned the loop never sees `EOF` and spins forever; where it is signed a `0xFF` byte in the input ends the loop early.
**Instead:** store the result in an `int` until you have compared it with `EOF`.

```c
// Bad
char c;
while ((c = getchar()) != EOF) putchar(c);
```

```c
// Good
int c;
while ((c = getchar()) != EOF) putchar(c);
```

**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/input-output-fio/fio34-c/

## 16. `atoi` and friends for untrusted input

**Avoid:** `atoi`, `atol` and `atof` on input you did not produce.
**Why:** they return `0` for garbage and have undefined behavior when the value is out of range, so "abc" and "0" look the same and huge numbers are not rejected.
**Instead:** use `strtol`, `strtoul` or `strtod` and check `errno`, the end pointer and the range.

```c
// Bad
int port = atoi(arg);
```

```c
// Good
char *end;
errno = 0;
long value = strtol(arg, &end, 10);
if (errno != 0 || end == arg || *end != '\0' || value < 1 || value > 65535) return -1;
int port = (int)value;
```

**Caught by:** clang-tidy `bugprone-unchecked-string-to-number-conversion` (alias `cert-err34-c`)
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/error-handling-err/err34-c/

## 17. Type punning through a pointer cast

**Avoid:** reading an object through a pointer to an unrelated type, such as `*(uint32_t *)&some_float` or casting a `char` buffer to a struct pointer.
**Why:** it breaks the strict aliasing rule, so the optimizer may reorder or drop the access, and the cast pointer may also be misaligned.
**Instead:** copy the bytes with `memcpy`, which compilers turn into a single register move.

```c
// Bad
uint32_t bits = *(uint32_t *)&value;
```

```c
// Good
uint32_t bits;
memcpy(&bits, &value, sizeof bits);
```

**Caught by:** GCC `-Wstrict-aliasing` (active with `-fstrict-aliasing`, which `-O2` enables)
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/expressions-exp/exp39-c/

## 18. Function-like macros with unparenthesized or repeated arguments

**Avoid:** macros that use a parameter without parentheses, or use it more than once, when a function would do.
**Why:** `SQUARE(w + 1)` expands to `w + 1 * w + 1`, and `SQUARE(i++)` increments twice, which is undefined behavior.
**Instead:** write a `static inline` function; when a macro is unavoidable, parenthesize every parameter and the whole body, and evaluate each argument once.

```c
// Bad
#define SQUARE(x) x * x
int area = SQUARE(width + 1);
int next = SQUARE(i++);
```

```c
// Good
static inline int square(int x) { return x * x; }
```

**Caught by:** clang-tidy `bugprone-macro-parentheses`, `bugprone-macro-repeated-side-effects`; Clang `-Wunsequenced` (the double increment)
**Source:** https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/preprocessor-pre/pre00-c/

## Sources

- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/characters-and-strings-str/str31-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/characters-and-strings-str/str32-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/input-output-fio/fio30-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/input-output-fio/fio34-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/integers-int/int30-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/integers-int/int32-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/memory-management-mem/mem30-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/declarations-and-initialization-dcl/dcl30-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/expressions-exp/exp33-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/expressions-exp/exp39-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/error-handling-err/err33-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/error-handling-err/err34-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc06-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/arrays-arr/arr01-c/
- https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/preprocessor-pre/pre00-c/
- https://clang.llvm.org/extra/clang-tidy/checks/bugprone/suspicious-realloc-usage.html
- https://clang.llvm.org/extra/clang-tidy/checks/list.html
- https://clang.llvm.org/docs/analyzer/checkers.html
- https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html
- https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html
- https://gcc.gnu.org/onlinedocs/gcc/Static-Analyzer-Options.html
- https://www.open-std.org/jtc1/sc22/wg14/www/docs/n2810.pdf
- https://sourceware.org/git/?p=glibc.git;a=blob_plain;f=NEWS;hb=HEAD
