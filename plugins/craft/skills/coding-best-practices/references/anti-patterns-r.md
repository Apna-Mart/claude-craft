# R anti-patterns

Read this whole file before writing or reviewing R code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the R-specific traps.

## Contents

1. Vector conditions in `if`, and `&` / `|` where `&&` / `||` belong
2. `1:length(x)` and `1:nrow(df)`
3. `sample(x)` on a vector that can have length 1
4. `==` on floating-point numbers
5. `x == NA`
6. `class(x) == "name"`
7. Single-column subsetting that drops to a vector
8. Converting factors with `as.numeric()`
9. `sapply()` where the result type matters
10. `ifelse()` on Dates and factors
11. Partial matching with `$` and argument names
12. `T` and `F` instead of `TRUE` and `FALSE`
13. Growing a vector inside a loop
14. `library()` / `require()` inside functions
15. `attach()`
16. `setwd()` and absolute paths in scripts
17. `rm(list = ls())` at the top of a script

## 1. Vector conditions in `if`, and `&` / `|` where `&&` / `||` belong

**Avoid:** Passing a vector of length greater than one to `if` or `while`, or combining scalar conditions with `&` and `|`.
**Why:** Since R 4.2.0 a condition of length greater than one is an error, and since R 4.3.0 so is `&&` or `||` with a longer operand; older code that relied on R silently using the first element now stops.
**Instead:** Reduce vectors with `any()` or `all()`, and use `&&` / `||` for scalar logic.

```r
# Bad
if (scores > 50) message("pass")
if (is_admin | is_owner) grant_access()
```

```r
# Good
if (all(scores > 50)) message("pass")
if (is_admin || is_owner) grant_access()
```

**Caught by:** lintr `vector_logic_linter` (for `&` / `|` in conditions)
**Since:** R 4.2.0 (error for `if`), R 4.3.0 (error for `&&` / `||`)
**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/Control.html

## 2. `1:length(x)` and `1:nrow(df)`

**Avoid:** Building loop indices with `1:length(x)`, `1:nrow(df)` or `1:n`.
**Why:** When the input is empty, `1:0` is `c(1, 0)`, so the loop runs twice on indices that do not exist.
**Instead:** Use `seq_along(x)` or `seq_len(n)`, which return an empty sequence for empty input.

```r
# Bad
for (i in 1:length(files)) process(files[i], i)
```

```r
# Good
for (i in seq_along(files)) process(files[i], i)
```

**Caught by:** lintr `seq_linter`
**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/seq.html

## 3. `sample(x)` on a vector that can have length 1

**Avoid:** Calling `sample(x, ...)` on a numeric vector whose length depends on the data.
**Why:** When `x` has length 1, is numeric and is at least 1, `sample(x)` samples from `1:x`, so `sample(c(7), 1)` can return 3.
**Instead:** Sample indices with `sample.int(length(x))` and subset.

```r
# Bad
winner <- sample(candidate_ids, 1)
```

```r
# Good
winner <- candidate_ids[sample.int(length(candidate_ids), 1)]
```

**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/sample.html

## 4. `==` on floating-point numbers

**Avoid:** Comparing computed doubles with `==`, and passing `all.equal()` straight to `if`.
**Why:** Binary floating point cannot represent most decimals exactly, so `0.1 + 0.2 == 0.3` is `FALSE`; `all.equal()` returns a character description, not `FALSE`, when values differ, which makes `if` fail.
**Instead:** Use `isTRUE(all.equal(a, b))`, or compare with an explicit tolerance.

```r
# Bad
if (total == expected_total) mark_reconciled()
```

```r
# Good
if (isTRUE(all.equal(total, expected_total))) mark_reconciled()
```

**Source:** https://cran.r-project.org/doc/FAQ/R-FAQ.html#Why-doesn_0027t-R-think-these-numbers-are-equal_003f

## 5. `x == NA`

**Avoid:** Testing for missing values with `== NA` or `!= NA`.
**Why:** Any comparison with `NA` returns `NA`, so the result is all `NA` and never identifies the missing values.
**Instead:** Use `is.na(x)`, or `anyNA(x)` for a single answer.

```r
# Bad
missing_age <- patients$age == NA
```

```r
# Good
missing_age <- is.na(patients$age)
```

**Caught by:** lintr `equals_na_linter`
**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/NA.html

## 6. `class(x) == "name"`

**Avoid:** Checking an object's type with `class(x) == "name"` or `class(x) %in% ...`.
**Why:** Objects often have several classes: a tibble is `c("tbl_df", "tbl", "data.frame")`, and since R 4.0.0 a matrix is `c("matrix", "array")`. The comparison returns a vector, which is wrong and, inside `if`, an error.
**Instead:** Use `inherits(x, "name")` or a specific predicate such as `is.matrix()`.

```r
# Bad
if (class(data) == "data.frame") summarise_frame(data)
```

```r
# Good
if (inherits(data, "data.frame")) summarise_frame(data)
```

**Caught by:** lintr `class_equals_linter`
**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/class.html

## 7. Single-column subsetting that drops to a vector

**Avoid:** Writing `df[, cols]` or `m[, cols]` where `cols` can select a single column.
**Why:** By default `[` drops to the lowest dimension, so one column comes back as a plain vector and later `nrow()`, `colnames()` or `df$x` calls break.
**Instead:** Pass `drop = FALSE` when you need a data frame or matrix back, and use `df[[col]]` when you want the vector.

```r
# Bad
selected <- sales[, input_columns]
```

```r
# Good
selected <- sales[, input_columns, drop = FALSE]
```

**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/Extract.data.frame.html

## 8. Converting factors with `as.numeric()`

**Avoid:** Calling `as.numeric()` or `as.integer()` directly on a factor.
**Why:** It returns the internal level codes, not the values, so a factor of prices `"10", "5", "20"` becomes `1, 3, 2`. Code that assumed strings became factors also changed behavior when R 4.0.0 switched the default to `stringsAsFactors = FALSE`.
**Instead:** Convert through the levels with `as.numeric(as.character(f))` or `as.numeric(levels(f))[f]`, and pass `stringsAsFactors` explicitly when you need factors.

```r
# Bad
prices <- as.numeric(orders$price)
```

```r
# Good
prices <- as.numeric(as.character(orders$price))
```

**Source:** https://cran.r-project.org/doc/FAQ/R-FAQ.html#How-do-I-convert-factors-to-numeric_003f

## 9. `sapply()` where the result type matters

**Avoid:** Using `sapply()` in functions and pipelines whose callers expect a fixed type.
**Why:** `sapply()` guesses the output shape: it returns a vector, a matrix or a list depending on the input, and an empty `list()` for empty input, so downstream code breaks on edge cases.
**Instead:** Use `vapply()` with an explicit `FUN.VALUE`, or `lapply()` when you want a list.

```r
# Bad
sizes <- sapply(paths, file.size)
```

```r
# Good
sizes <- vapply(paths, file.size, numeric(1))
```

**Caught by:** lintr `undesirable_function_linter` (`sapply` is in the default list)
**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/lapply.html

## 10. `ifelse()` on Dates and factors

**Avoid:** Using `ifelse()` to choose between Dates, factors or other classed values.
**Why:** `ifelse()` takes its attributes from the test, not from `yes` and `no`, so Dates come back as plain numbers and factors as integer codes.
**Instead:** Assign into a copy by index, or use `if` / `else` for a scalar.

```r
# Bad
due_date <- ifelse(is_late, start_date + 7, start_date)
```

```r
# Good
due_date <- start_date
due_date[is_late] <- due_date[is_late] + 7
```

**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/ifelse.html

## 11. Partial matching with `$` and argument names

**Avoid:** Relying on `list$name` or abbreviated argument names, such as `len =` for `length.out =`.
**Why:** `$` on lists and argument matching both accept unique prefixes, so `config$timeout` silently returns `config$timeout_seconds`, and a new element or argument can change which one matches.
**Instead:** Use `[[` (exact by default) for lookups, write full argument names, and turn on the partial-match warnings.

```r
# Bad
timeout <- config$timeout
steps <- seq(0, 1, len = 11)
```

```r
# Good
options(warnPartialMatchDollar = TRUE, warnPartialMatchArgs = TRUE)
timeout <- config[["timeout_seconds"]]
steps <- seq(0, 1, length.out = 11)
```

**Source:** https://cran.r-project.org/doc/manuals/r-release/R-lang.html#Argument-matching

## 12. `T` and `F` instead of `TRUE` and `FALSE`

**Avoid:** Writing `T` and `F` for logical constants.
**Why:** `TRUE` and `FALSE` are reserved words, but `T` and `F` are ordinary variables that any code, such as `T <- 0` or a column named `F`, can overwrite.
**Instead:** Always spell out `TRUE` and `FALSE`.

```r
# Bad
sales <- read.csv(path, header = T, stringsAsFactors = F)
```

```r
# Good
sales <- read.csv(path, header = TRUE, stringsAsFactors = FALSE)
```

**Caught by:** lintr `T_and_F_symbol_linter`
**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/logical.html

## 13. Growing a vector inside a loop

**Avoid:** Appending to a vector or list with `c()` or `x[length(x) + 1] <-` on every iteration.
**Why:** Each append copies the whole object, so the loop is quadratic and slows sharply on large inputs.
**Instead:** Use `vapply()` / `lapply()`, or preallocate with `vector("list", n)` or `numeric(n)` and fill by index.

```r
# Bad
scores <- c()
for (path in paths) scores <- c(scores, read_score(path))
```

```r
# Good
scores <- vapply(paths, read_score, numeric(1))
```

**Source:** https://www.burns-stat.com/pages/Tutor/R_inferno.pdf

## 14. `library()` / `require()` inside functions

**Avoid:** Calling `library()` or `require()` inside functions or package code.
**Why:** It changes the global search path for the whole session as a side effect, and `require()` only returns `FALSE` when a package is missing, so the failure surfaces later as a confusing "could not find function" error.
**Instead:** Call functions as `pkg::fun()`, declare package dependencies in `Imports`, and use `requireNamespace()` for optional ones.

```r
# Bad
summarise_sales <- function(sales) {
  library(dplyr)
  summarise(sales, total = sum(amount))
}
```

```r
# Good
summarise_sales <- function(sales) {
  dplyr::summarise(sales, total = sum(amount))
}
```

**Caught by:** lintr `undesirable_function_linter` (`library` and `require` are in the default list), `library_call_linter` (calls not at the top of a script)
**Source:** https://r-pkgs.org/dependencies-in-practice.html

## 15. `attach()`

**Avoid:** Calling `attach()` on data frames or lists.
**Why:** It copies the object onto the search path, so later edits to the data frame are not seen, and its columns can mask or be masked by other variables with the same name.
**Instead:** Refer to columns explicitly with `df$col` or `df[["col"]]`, or scope them with `with()`.

```r
# Bad
attach(sales)
total <- sum(amount)
```

```r
# Good
total <- sum(sales$amount)
```

**Caught by:** lintr `undesirable_function_linter` (`attach` is in the default list)
**Source:** https://stat.ethz.ch/R-manual/R-devel/library/base/html/attach.html

## 16. `setwd()` and absolute paths in scripts

**Avoid:** Calling `setwd()` with a machine-specific path, or reading files by absolute path.
**Why:** The script only runs on the author's machine, and `setwd()` changes global state for everything that runs after it.
**Instead:** Run scripts from the project root and build relative paths with `file.path()`.

```r
# Bad
setwd("C:/Users/ana/projects/sales")
sales <- read.csv("data/sales.csv")
```

```r
# Good
sales <- read.csv(file.path("data", "sales.csv"))
```

**Caught by:** lintr `absolute_path_linter`, `nonportable_path_linter`, `undesirable_function_linter` (`setwd` is in the default list)
**Source:** https://www.tidyverse.org/blog/2017/12/workflow-vs-script/

## 17. `rm(list = ls())` at the top of a script

**Avoid:** Starting scripts with `rm(list = ls())` to get a clean state.
**Why:** It deletes only objects in the global environment; attached packages, options, the working directory and environment variables survive, so the script still depends on hidden session state.
**Instead:** Restart R, or run the script with `Rscript`, so every run starts from a fresh session.

```r
# Bad
rm(list = ls())
sales <- read.csv(file.path("data", "sales.csv"))
```

```r
# Good
sales <- read.csv(file.path("data", "sales.csv"))
```

**Source:** https://www.tidyverse.org/blog/2017/12/workflow-vs-script/

## Sources

- https://stat.ethz.ch/R-manual/R-devel/library/base/html/Control.html
- https://cran.r-project.org/doc/manuals/r-release/NEWS.html
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/seq.html
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/sample.html
- https://cran.r-project.org/doc/FAQ/R-FAQ.html#Why-doesn_0027t-R-think-these-numbers-are-equal_003f
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/all.equal.html
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/NA.html
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/class.html
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/Extract.data.frame.html
- https://cran.r-project.org/doc/FAQ/R-FAQ.html#How-do-I-convert-factors-to-numeric_003f
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/lapply.html
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/ifelse.html
- https://cran.r-project.org/doc/manuals/r-release/R-lang.html#Argument-matching
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/options.html
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/logical.html
- https://www.burns-stat.com/pages/Tutor/R_inferno.pdf
- https://r-pkgs.org/dependencies-in-practice.html
- https://stat.ethz.ch/R-manual/R-devel/library/base/html/attach.html
- https://www.tidyverse.org/blog/2017/12/workflow-vs-script/
- https://lintr.r-lib.org/reference/index.html
