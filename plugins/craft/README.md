# Craft

A Claude Code skill pack, bundled as a plugin. Skills are namespaced as `craft:<skill>` (for example `/craft:minimize-diff`).

## Skills

| Skill | What it covers |
| --- | --- |
| `backend-best-practices` | Server-side baseline: endpoints, transactions, queues, auth, retries, failure under load |
| `calculator` | Math, unit and currency conversion through the `qalc` CLI |
| `coding-best-practices` | Default code-quality baseline for writing, editing and reviewing code, plus anti-pattern files for 24 languages |
| `dashboard-best-practices` | Designing, reviewing and fixing analytics and observability dashboards |
| `database-best-practices` | Schema, index and query design, slow queries, database cost |
| `design-patterns-best-practices` | Deliberate pass on code structure and pattern choice |
| `event-tracking-best-practices` | Product event tracking for any stack: where each event is sent from, what it carries and how it is sent, so the data settles decisions and experiments |
| `explain-anything` | Explains any topic in plain words with one analogy and one example |
| `firebase-crash-fix` | Evidence-first fixes for Crashlytics crashes, non-fatals and ANRs |
| `github-bug-report` | Turns a bug report into a developer-ready GitHub issue |
| `minimize-diff` | Opt-in only: shrinks a diff and splits it into reviewable commits or PRs |
| `product-spec` | Interview-driven product spec (PRD) builder |
| `render-performance-best-practices` | Frame-rate and jank baseline for any frontend |
| `testing-best-practices` | Baseline for writing and fixing tests, plus case tables, simulation and screen sweeps with screenshots on every platform |
| `ui-state-best-practices` | Declarative frontend state shape and data flow |

## Guards

`hooks/register.ts` is a function hooks module (Claude Code's early-access plugin API, written against 2.1.296). It checks every Bash call and file edit before it runs, and adds standing rules to the first prompt of a session. It fixes what it can on its own and tells the model what actually ran. It blocks only what needs a person.

| Rule | What happens |
| --- | --- |
| Branch and commit names | Creating a branch (`checkout -b`, `switch -c`, `branch`, `worktree add -b`) is blocked unless it reads `<type>/<scope>-<description>`, lowercase, hyphenated, at most 50 characters, or is a long-lived branch (`main`, `master`, `trunk`, `develop`, `development`, `dev`, `next`, `staging`, `stage`, `uat`, `qa`, `sit`, `su`, `sd`, `preprod`, `production`, `prod`, `release`), a `release/…` or `hotfix/…` branch, or a copy of an existing branch; a commit subject or pull request title is blocked unless it reads `<type>(<scope>): <description>` |
| Trash, never delete | `rm` and `unlink` become `trash`; `git rm` becomes `git rm --cached` plus `trash`; `find -delete`, `xargs rm` and script deletes are blocked. Paths inside `node_modules`, `build`, `.gradle`, `target`, `dist` and the session scratch folder are left alone |
| Command line first | The first prompt, the first prompt after `/clear` or `/compact`, and an automatic summary carry the command-line-first rule: scaffold, install, build, test, lint, format, generate and migrate only through the ecosystem's official tool, match the tools the project already uses; for new projects and one-offs the preferences are bun, biome, uv, ruff, xmake, cargo, go and adb; repository work goes through git, and gh only for GitHub-specific things (account, issues, pull requests, releases, Actions, the API) |
| Lockfiles | Edits to `*.lock` (npm, bun, yarn, uv, poetry, Cargo, Bundler, Composer, pub, CocoaPods, Mix and others), `package-lock.json`, `pnpm-lock.yaml`, `go.sum`, `gradle.lockfile`, `Package.resolved`, `packages.lock.json` and `conda-lock.yml` are blocked |
| Manifests | A hand edit to `package.json`, `pyproject.toml`, `Pipfile`, `Cargo.toml`, `go.mod`, `pubspec.yaml`, `Gemfile`, `composer.json`, `*.csproj`/`*.fsproj`, `deno.json`, `Package.swift`, `environment.yml`, `vcpkg.json`, Gradle build files, `pom.xml`, `Podfile` or `mix.exs` needs approval, and the message names that ecosystem's command, or says it has none |
| Manifests and lockfiles from the shell | A `>` redirect, `tee`, `sponge`, `sed -i`, `perl -i`, `yq -i`, `cp`, `mv`, `install`, or a `writeFileSync`/`open(…, 'w')`/`write_text` call in a script that writes a manifest or lockfile is blocked; copies into temporary folders, `node_modules` and other build folders are left alone |
| The project's own tool | The tool is read from the lockfiles in the target folder (`--prefix`, `-C`, `--cwd`, `--dir`, `--directory` and `--project` are followed) and its parents, up to the repository top, or up to the home folder outside git. A JavaScript command for another package manager (`npm`, `npx`, `yarn`, `pnpm`, `bun`) is blocked with the right commands; `bun` running a script file is always allowed. In a uv project, bare `python` becomes `uv run python`, and `pip install` and `python -m venv` are blocked in favour of `uv`. With no JavaScript or Python project, bun and uv are only recommendations: the command runs as written and Claude is told which tool is preferred for a new project or a one-off. A project on poetry, pipenv, pdm, rye, hatch or plain pip (requirements files, `manage.py`, `setup.py`, `venv/`) stays on it, and `uv` commands that would convert it are blocked; `uvx` and `uv run --no-project` stay allowed for one-off scripts. A `package.json`, `pyproject.toml` or `.venv` with no lockfile decides nothing |
| Linters and formatters | The project's linter and formatter is read from its config files, `package.json` and `pyproject.toml`/`setup.cfg`/`tox.ini`, however it is run (directly, `npx`, `bunx`, `pnpm exec`, `uvx`, `uv run`, `python -m`). A biome project blocks eslint and prettier and the other way round; a ruff project blocks black, isort, flake8, pylint and yapf and the other way round. With no project, the command runs and Claude is told biome or ruff is preferred |
| Formatters only when asked | In a repository with commits, a formatter that writes files (`prettier --write`, `biome format --write`/`check --write`, `ruff format`, `black`, `isort`, `gofmt -w`, `go fmt`, `cargo fmt`, `rustfmt`, `dart format`, `swift format -i`, `swiftformat`, `clang-format -i`, `ktlint -F`, `ktfmt`, Gradle `spotlessApply`/`ktlintFormat`, Maven `spotless:apply`, `dotnet format`, `mix format`, `deno fmt`, `terraform fmt`, `shfmt -w`, `stylua`, `rubocop -a`, `php-cs-fixer fix`, `buf format -w`, and `format`/`fmt` package scripts or make targets) is blocked unless the user's latest message asks for formatting. Naming only files Claude wrote or edited in this session is allowed, and for files that already existed Claude is told to check `git diff` and undo changes to lines it did not edit. Check-only runs, and repositories with no commits yet, are left alone |
| No hand-run compiler | `rustc` in a Cargo project, `javac`/`kotlinc` in a Gradle or Maven project, `gcc`/`clang` in an xmake or CMake project, `swiftc` in a Swift package, `csc` in a .NET project, `scalac` in an sbt project, `ghc` in a Cabal or Stack project, `elixirc` in a Mix project, `gradle` where `gradlew` exists, `mvn` where `mvnw` exists, and `gem install` in a Bundler project are blocked in favour of the project's build command; compiling a scratch file outside the project is allowed |
| Commit identity | A commit in a repository with no local email is blocked until Claude asks the user for their email and sets it with `git config user.email`; the commit name is left as the user set it |
| Git safety | `--force` becomes `--force-with-lease`, `git pull` gains `--rebase`, SSH remotes become HTTPS, `gh repo clone owner/repo` becomes `git clone https://github.com/owner/repo.git`, and a global `user.*` config is blocked |
| Moving files | `mv` of tracked files becomes `git mv`; a `mv` or `git mv -f` onto an existing untracked file trashes that file first |
| Losing uncommitted work | `git clean` is blocked unless it is a dry run; `git restore`, `git checkout -- …`/`.`/`-f`, `git reset --hard` and `git switch --discard-changes` first save uncommitted changes to the stash as `craft backup before …` |
| Endless waits | A background command that would wait forever (a `while`/`until` loop, `tail -f`/`-F`, `watch`, `sleep infinity`) and has no `timeout` runs inside `timeout 600`. Foreground commands are left alone, because the Bash tool already stops them |
| Restore `TASKS.md` | When `TASKS.md` is in the session folder, the same notes also tell Claude to read it and rebuild the todo list |

Run its tests with `claude plugin test .`.

## Use it

Try it for one session:

```sh
claude --plugin-dir ./plugins/craft
```

Some skills shell out to external tools: `calculator` needs `qalc`, `github-bug-report` uses `gh`, and `minimize-diff` and `product-spec` run `python3` scripts.

## Evals

`evals/` holds 56 cases, at least three per skill for every skill except `product-spec`, which has none yet (should-trigger and should-not-trigger, each with an LLM grader and a skill-fired check). `evals/gen_evals.py` regenerates them. Run them with the plugin and without it:

```sh
claude plugin eval . --no-publish            # all cases, 3 runs each, with/without the plugin
claude plugin eval . --tag calculator --runs 1   # one skill, one run
```

## Authoring

Every skill here follows [skill-authoring-guide.md](skill-authoring-guide.md): structure, frontmatter, descriptions, reference files and budgets. Check a new or changed skill against its pre-ship checklist (section 16).
