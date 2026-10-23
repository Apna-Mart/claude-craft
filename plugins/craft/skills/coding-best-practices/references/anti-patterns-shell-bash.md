# Shell / Bash anti-patterns

Read this whole file before writing or reviewing Shell / Bash code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Shell / Bash-specific traps.

## Contents

1. `rm -rf` on a path built from a possibly empty variable
2. Unquoted variable and command expansions
3. `cd` without checking that it worked
4. `eval` on strings that hold data
5. Looping over or parsing `ls` output
6. Reading lines with `for line in $(cat file)`
7. `read` without `-r`
8. `$*` or unquoted `$@` to forward arguments
9. Treating `set -euo pipefail` as complete error handling
10. Exit codes masked by `local`, pipelines and substitutions
11. Temp files with fixed names and no cleanup
12. `echo` or a `printf` format string carrying variable data
13. Bash features under a `#!/bin/sh` shebang
14. `[` with `-a`/`-o` and unquoted operands in Bash
15. Backticks for command substitution
16. `which` to test whether a command exists
17. Useless use of `cat`

## 1. `rm -rf` on a path built from a possibly empty variable

**Avoid:** `rm -rf "$DIR/"` or `rm -rf "$DIR"/*` when `DIR` can be unset or empty.
**Why:** An empty `DIR` turns the path into `/` or `/*`, and the script deletes from the filesystem root.
**Instead:** Expand with `${DIR:?}` so the shell aborts with an error when the variable is unset or empty, and end options with `--`.

```bash
# Bad
rm -rf "$STAGING_DIR/"
```

```bash
# Good
rm -rf -- "${STAGING_DIR:?}/"
```

**Caught by:** ShellCheck SC2115
**Source:** https://www.shellcheck.net/wiki/SC2115

## 2. Unquoted variable and command expansions

**Avoid:** Writing `$var` or `$(cmd)` unquoted as a command argument.
**Why:** The shell splits the value on whitespace and expands glob characters, so a file named `My Report.pdf` becomes two arguments and a value with `*` matches files in the current directory.
**Instead:** Double-quote every expansion unless you deliberately want splitting, and use an array when you need a list.

```bash
# Bad
file="My Report.pdf"
cp $file $dest
```

```bash
# Good
file="My Report.pdf"
cp -- "$file" "$dest"
```

**Caught by:** ShellCheck SC2086
**Source:** https://www.shellcheck.net/wiki/SC2086

## 3. `cd` without checking that it worked

**Avoid:** A bare `cd dir` followed by commands that assume the new directory.
**Why:** If `cd` fails (typo, missing directory, no permission), every later command runs in the old directory, including destructive ones.
**Instead:** Write `cd dir || exit` (or `|| return` in a function), or run the work in a subshell `( cd dir && ... )`.

```bash
# Bad
cd "$release_dir"
rm -rf ./*
```

```bash
# Good
cd "$release_dir" || exit 1
rm -rf ./*
```

**Caught by:** ShellCheck SC2164
**Source:** https://www.shellcheck.net/wiki/SC2164

## 4. `eval` on strings that hold data

**Avoid:** Building a command as a string and running it with `eval`.
**Why:** `eval` parses the data as shell code a second time, so a filename or user value containing `;`, `$(...)` or quotes runs arbitrary commands.
**Instead:** Store the command and its arguments in a Bash array and run `"${cmd[@]}"`; in POSIX `sh`, use a function or `set --`.

```bash
# Bad
cmd="grep -r $pattern $dir"
eval "$cmd"
```

```bash
# Good
cmd=(grep -r -- "$pattern" "$dir")
"${cmd[@]}"
```

**Source:** https://mywiki.wooledge.org/BashFAQ/048

## 5. Looping over or parsing `ls` output

**Avoid:** `for f in $(ls ...)`, `ls | grep`, or cutting fields out of `ls -l`.
**Why:** `ls` output is for humans: names with spaces, newlines or glob characters break apart, and the format differs between systems and locales.
**Instead:** Loop over a glob directly, with `nullglob` so an empty match runs zero times; use `find -print0` or `stat` for metadata.

```bash
# Bad
for f in $(ls *.log); do
  gzip "$f"
done
```

```bash
# Good
shopt -s nullglob
for f in ./*.log; do
  gzip -- "$f"
done
```

**Caught by:** ShellCheck SC2045 (loop over `ls`), SC2010 (`ls | grep`)
**Source:** https://mywiki.wooledge.org/ParsingLs

## 6. Reading lines with `for line in $(cat file)`

**Avoid:** `for line in $(cat file)` or `for line in $(cmd)` to process input line by line.
**Why:** The loop iterates over words, not lines, so a line with spaces becomes several iterations, and glob characters in the data expand against the filesystem.
**Instead:** Use `while IFS= read -r line; do ...; done < file`, or `mapfile -t` in Bash 4+ when you need an array.

```bash
# Bad
for host in $(cat hosts.txt); do
  ping -c1 "$host"
done
```

```bash
# Good
while IFS= read -r host; do
  ping -c1 "$host"
done < hosts.txt
```

**Caught by:** ShellCheck SC2013
**Source:** https://mywiki.wooledge.org/BashFAQ/001

## 7. `read` without `-r`

**Avoid:** Calling `read` without `-r`, and without `IFS=` when the value must stay intact.
**Why:** Without `-r`, `read` treats backslashes as escapes and drops them (`C:\temp` becomes `C:temp`); without `IFS=`, leading and trailing whitespace is stripped.
**Instead:** Always write `IFS= read -r var`.

```bash
# Bad
read -p "Path: " path
```

```bash
# Good
IFS= read -r -p "Path: " path
```

**Caught by:** ShellCheck SC2162
**Source:** https://www.shellcheck.net/wiki/SC2162

## 8. `$*` or unquoted `$@` to forward arguments

**Avoid:** Passing arguments on with `$*`, `"$*"` or unquoted `$@`.
**Why:** Unquoted forms re-split each argument on whitespace and glob it; `"$*"` joins all arguments into one string, so a loop over it runs once.
**Instead:** Forward with `"$@"`, which keeps every argument as one word exactly as received.

```bash
# Bad
run() {
  docker run $*
}
```

```bash
# Good
run() {
  docker run "$@"
}
```

**Caught by:** ShellCheck SC2048 (unquoted `$*`), SC2068 (unquoted `$@`), SC2066 (looping over `"$*"`)
**Source:** https://www.shellcheck.net/wiki/SC2048

## 9. Treating `set -euo pipefail` as complete error handling

**Avoid:** Leaving `set -euo pipefail` out of a script, and also assuming that once it is in, every failure stops the script.
**Why:** Without it, failed commands and typo'd variables are ignored. With it, `set -e` is still silently disabled inside any function run as an `if` or `while` condition, before the last `&&` or `||` of a list, or after `!`, and inside `$(...)` unless `inherit_errexit` is on; in Bash 4.1+ `((i++))` with `i=0` returns 1 and exits the script.
**Instead:** Turn the options on at the top, then check the commands that matter explicitly (`|| return`, `|| exit`) instead of relying on `set -e` inside functions.

```bash
# Bad
set -e
deploy() { build; upload; }
if deploy; then echo "deployed"; fi
```

```bash
# Good
set -euo pipefail
shopt -s inherit_errexit
deploy() { build || return; upload || return; }
if deploy; then echo "deployed"; fi
```

**Caught by:** ShellCheck SC2310 and SC2311 (optional, `-o check-set-e-suppressed`)
**Since:** `shopt -s inherit_errexit` needs Bash 4.4 (macOS `/bin/bash` is 3.2, where it is an error); `((...))` obeys `set -e` from Bash 4.1. `set -o pipefail` is in Bash, and in POSIX `sh` only from POSIX.1-2024, so older `/bin/sh` implementations reject it.
**Source:** https://mywiki.wooledge.org/BashFAQ/105

## 10. Exit codes masked by `local`, pipelines and substitutions

**Avoid:** `local var=$(cmd)`, `export var=$(cmd)`, and pipelines whose earlier stages can fail without `pipefail`.
**Why:** `local` and `export` return their own success, which replaces the status of `cmd`; a pipeline returns only the last command's status, so `curl ... | tar` reports success when the download failed.
**Instead:** Declare first and assign on the next line, and set `pipefail` (or inspect `${PIPESTATUS[@]}` in Bash) for pipelines whose early stages can fail.

```bash
# Bad
release() {
  local version=$(git describe --tags)
  curl -fsS "$url/$version.tgz" | tar -xz
}
```

```bash
# Good
set -o pipefail
release() {
  local version
  version=$(git describe --tags)
  curl -fsS "$url/$version.tgz" | tar -xz
}
```

**Caught by:** ShellCheck SC2155; SC2312 (optional, `-o check-extra-masked-returns`)
**Source:** https://www.shellcheck.net/wiki/SC2155

## 11. Temp files with fixed names and no cleanup

**Avoid:** Temp paths like `/tmp/myscript.$$` or `/tmp/out.txt`, and temp files with no cleanup on exit.
**Why:** A predictable name in a shared directory lets another user pre-create it or plant a symlink, so your script writes where they choose; without cleanup, every failed run leaves files behind.
**Instead:** Create the file or directory with `mktemp` (or `mktemp -d`), check that it succeeded, and register removal with `trap ... EXIT` right after.

```bash
# Bad
tmp=/tmp/report.$$
curl -fsS "$url" > "$tmp"
```

```bash
# Good
tmp=$(mktemp) || exit
trap 'rm -f -- "$tmp"' EXIT
curl -fsS "$url" > "$tmp"
```

**Source:** https://mywiki.wooledge.org/BashFAQ/062

## 12. `echo` or a `printf` format string carrying variable data

**Avoid:** `echo "$data"` for arbitrary data, and putting variables in the first (format) argument of `printf`.
**Why:** `echo` treats a leading `-n`, `-e` or `-E` in the data as an option and handles backslashes differently between shells (Bash, dash, `xpg_echo`); in a `printf` format, `%` and `\` in the data are interpreted.
**Instead:** Use `printf '%s\n' "$data"` with a constant format string.

```bash
# Bad
echo "$user_input"
printf "$message\n"
```

```bash
# Good
printf '%s\n' "$user_input"
printf '%s\n' "$message"
```

**Caught by:** ShellCheck SC2059 (variable in `printf` format)
**Source:** https://pubs.opengroup.org/onlinepubs/9799919799/utilities/echo.html

## 13. Bash features under a `#!/bin/sh` shebang

**Avoid:** Using `[[ ]]`, arrays, `source`, `function`, `&>` or `<<<` in a script whose shebang is `#!/bin/sh`.
**Why:** On Debian and Ubuntu `/bin/sh` is dash, so the script fails with errors like `[[: not found` there while working on a machine where `sh` is Bash.
**Instead:** Use `#!/usr/bin/env bash` (or `#!/bin/bash`) when you use Bash features; keep `#!/bin/sh` only for strictly POSIX code.

```bash
# Bad
#!/bin/sh
if [[ $1 == --dry-run ]]; then dry_run=1; fi
```

```bash
# Good
#!/usr/bin/env bash
if [[ $1 == --dry-run ]]; then dry_run=1; fi
```

**Caught by:** ShellCheck SC3010 (`[[` in sh) and the rest of the SC3xxx family, which ShellCheck applies based on the shebang
**Source:** https://www.shellcheck.net/wiki/SC3010

## 14. `[` with `-a`/`-o` and unquoted operands in Bash

**Avoid:** In a Bash script, `[ $x = y ]` with unquoted operands, and combining tests with `-a` or `-o`.
**Why:** Inside `[`, an empty or spaced value changes the number of arguments and the test errors or gives the wrong answer; `-a`/`-o` are ambiguous and were removed from `test` in POSIX.1-2024.
**Instead:** In Bash use `[[ ... ]]`, which does not word-split or glob its operands and supports `&&`, `||` and pattern matching; in POSIX `sh`, quote operands and chain `[ ] && [ ]`.

```bash
# Bad
if [ $status = "ok" -a -n $name ]; then deploy; fi
```

```bash
# Good
if [[ $status == ok && -n $name ]]; then deploy; fi
```

**Caught by:** ShellCheck SC2166 (`-a`/`-o`), SC2070 (`-n` with unquoted argument), SC2292 (optional, `-o require-double-brackets`)
**Source:** https://mywiki.wooledge.org/BashFAQ/031

## 15. Backticks for command substitution

**Avoid:** `` `cmd` `` for command substitution.
**Why:** Backticks need escaping to nest and treat backslashes inside them differently, which makes quoting bugs easy and hard to see.
**Instead:** Use `$(cmd)`, which nests cleanly and is POSIX.

```bash
# Bad
count=`grep -c "$pattern" "$file"`
```

```bash
# Good
count=$(grep -c -- "$pattern" "$file")
```

**Caught by:** ShellCheck SC2006
**Source:** https://www.shellcheck.net/wiki/SC2006

## 16. `which` to test whether a command exists

**Avoid:** `which tool` to check for a dependency.
**Why:** `which` is an external, non-POSIX program whose output and exit status differ between systems, and it does not see shell functions, aliases or builtins.
**Instead:** Use the POSIX builtin `command -v tool`.

```bash
# Bad
if which jq > /dev/null; then use_jq=1; fi
```

```bash
# Good
if command -v jq > /dev/null 2>&1; then use_jq=1; fi
```

**Caught by:** ShellCheck SC2230 (optional, `-o deprecate-which`)
**Source:** https://www.shellcheck.net/wiki/SC2230

## 17. Useless use of `cat`

**Avoid:** `cat file | cmd` when `cmd` can read the file itself.
**Why:** It spawns an extra process and a pipe for nothing; it is a style issue, not a bug, so flag it last and never churn working code for it alone.
**Instead:** Pass the file as an argument or redirect it with `< file`.

```bash
# Bad
cat access.log | grep -c ' 500 '
```

```bash
# Good
grep -c ' 500 ' access.log
```

**Caught by:** ShellCheck SC2002 (optional since ShellCheck 0.11.0, `-o useless-use-of-cat`)
**Source:** https://www.shellcheck.net/wiki/SC2002

## Sources

- https://www.shellcheck.net/wiki/SC2115
- https://www.shellcheck.net/wiki/SC2086
- https://www.shellcheck.net/wiki/SC2164
- https://mywiki.wooledge.org/BashFAQ/048
- https://mywiki.wooledge.org/ParsingLs
- https://mywiki.wooledge.org/BashFAQ/001
- https://www.shellcheck.net/wiki/SC2162
- https://www.shellcheck.net/wiki/SC2048
- https://mywiki.wooledge.org/BashFAQ/105
- https://www.shellcheck.net/wiki/SC2155
- https://mywiki.wooledge.org/BashFAQ/062
- https://pubs.opengroup.org/onlinepubs/9799919799/utilities/echo.html
- https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html
- https://www.shellcheck.net/wiki/SC3010
- https://mywiki.wooledge.org/BashFAQ/031
- https://pubs.opengroup.org/onlinepubs/9799919799/utilities/test.html
- https://www.shellcheck.net/wiki/SC2006
- https://www.shellcheck.net/wiki/SC2230
- https://www.shellcheck.net/wiki/SC2002
- https://github.com/koalaman/shellcheck/blob/master/CHANGELOG.md
- https://git.savannah.gnu.org/cgit/bash.git/plain/NEWS
