# Skill Authoring Guide: Structure, Format, Index, References and Budgets

A single reference for building Agent Skills (folders with a `SKILL.md`) that trigger reliably, stay small in context, and work well on current Claude models. It is built from six sources, listed in [section 17](#17-sources), all read on 2026-10-06.

Two kinds of numbers appear below. **Official** values are stated in the docs. **Recommended** values are my own guidance where the docs give no number. Every table marks which is which.

## Contents

0. [The rules on one screen](#0-the-rules-on-one-screen)
1. [Limits and budgets](#1-limits-and-budgets)
2. [How a skill loads, and why structure matters](#2-how-a-skill-loads-and-why-structure-matters)
3. [Folder layout](#3-folder-layout)
4. [Where skills live](#4-where-skills-live)
5. [Frontmatter](#5-frontmatter)
6. [Writing the description](#6-writing-the-description)
7. [The SKILL.md body is the index](#7-the-skillmd-body-is-the-index)
8. [Reference files](#8-reference-files)
9. [Scripts](#9-scripts)
10. [Claude Code features](#10-claude-code-features)
11. [Hooks with skills](#11-hooks-with-skills)
12. [Writing for current models](#12-writing-for-current-models)
13. [Evaluate and iterate](#13-evaluate-and-iterate)
14. [Troubleshooting](#14-troubleshooting)
15. [Templates](#15-templates)
16. [Pre-ship checklist](#16-pre-ship-checklist)
17. [Sources](#17-sources)

---

## 0. The rules on one screen

1. **A skill is a folder with a `SKILL.md`.** Everything else (references, scripts, assets) is optional.
2. **Only `name` and `description` are always in context.** The description is the trigger, so write it for selection, not for documentation.
3. **The description is written in the third person and says what the skill does and when to use it.** Put the key use case first and keep it at or under 1,024 characters.
4. **The `SKILL.md` body stays under 500 lines.** It works as an index and a playbook, not an encyclopedia.
5. **The most important instructions go at the top.** After compaction, Claude Code keeps only the first 5,000 tokens of each skill.
6. **Write standing instructions.** The file isn't re-read on later turns, so write "Run the tests after every edit", not "Run the tests".
7. **Reference files sit one level deep from `SKILL.md`.** Link each one with a line saying what it holds and when to read it.
8. **Any reference file over 100 lines opens with a table of contents.**
9. **Scripts are executed, not read.** Say which you intend, and call them through `${CLAUDE_SKILL_DIR}`.
10. **A rule that must hold every time belongs in a hook, not in prose.**
11. **Current models need less prescription.** Give the reason behind a rule, never ask for the model's reasoning in the response, and use `effort` rather than "think hard".
12. **Build at least three evals before writing much.** Test in a fresh session, with the skill and without it.

---

## 1. Limits and budgets

| Item | Limit or target | Source |
| :- | :- | :- |
| `name` | 64 characters at most; lowercase letters, digits and hyphens only; no XML tags; can't contain `anthropic` or `claude` | Official (Agent Skills / API) |
| `description` | Must be non-empty; 1,024 characters at most; no XML tags | Official (Agent Skills / API) |
| `description` plus `when_to_use` in the Claude Code skill listing | Truncated at 1,536 characters (setting: `skillListingMaxDescChars`) | Official (Claude Code) |
| Whole skill listing | About 1% of the model's context window (setting: `skillListingBudgetFraction`). On overflow, the least-used skills lose their descriptions first | Official (Claude Code) |
| `compatibility` field | 500 characters at most | Official |
| `SKILL.md` body | Under 500 lines | Official (both skill docs) |
| Reference file that needs a table of contents | Over 100 lines | Official |
| Reference depth | One level from `SKILL.md` | Official |
| Skill content kept after auto-compaction | First 5,000 tokens of each invoked skill; 25,000 tokens shared across skills, filled from the most recently invoked | Official (Claude Code) |
| Evals before shipping | At least 3 scenarios | Official |
| Skills stacked in one message | The first skill plus up to 5 more | Official (Claude Code) |
| `` !`command` `` injection | 2-minute timeout per command; a non-zero exit aborts the whole invocation | Official (Claude Code) |
| Hook text sent to Claude (`additionalContext`, `systemMessage`, stdout) | 10,000 characters per field. Anything longer becomes a file path plus a 2,000-character preview | Official (hooks) |
| Hook timeouts | `command`, `http` and `mcp_tool`: 600 s (30 s on `UserPromptSubmit`); `prompt`: 30 s; `agent`: 60 s | Official (hooks) |
| Stop-hook continuations | 8 in a row, then the turn ends | Official (hooks) |
| Description length to aim for | 1 to 3 sentences, about 150 to 600 characters | Recommended |
| `SKILL.md` body to aim for | 50 to 250 lines for most skills; start splitting into references at about 300 | Recommended |
| One reference file | One topic or domain per file, any length (it costs nothing until read) | Recommended |
| Folder nesting | `reference/`, `scripts/`, `assets/` and `evals/`, each one level deep | Recommended |

---

## 2. How a skill loads, and why structure matters

| Level | What loads | When | Cost |
| :- | :- | :- | :- |
| 1. Metadata | `name` and `description` (plus `when_to_use` in Claude Code) for every skill | At startup, on every turn | Paid always, for every installed skill |
| 2. Body | The rendered `SKILL.md` content | When you type `/name` or Claude invokes the skill | Enters the conversation as one message and stays there across turns |
| 3. Bundled files | Reference files, scripts, assets | Only when Claude reads or runs them | Nothing until used. A script's code never enters context; only its output does |

What this means for authoring:

- **Description quality decides whether the skill triggers. Body quality decides what happens next.** References carry the depth.
- **The body is a recurring cost.** Once loaded it stays in context, so every line is paid on every later turn. Cut anything Claude already knows.
- **Claude Code doesn't re-read `SKILL.md` on later turns.** Phrase rules as standing instructions that apply to the whole task.
- **Put priorities at the top.** After compaction only the first 5,000 tokens survive, and older skills can drop out entirely when many are invoked.
- **Re-invoking a skill is cheap when nothing changed.** Identical rendered content adds only a short note. Different arguments or new `!` output append the full content again.
- **Subagents with preloaded skills are the exception.** The full skill content is injected when the subagent starts.

---

## 3. Folder layout

```text
my-skill/
├── SKILL.md              # required: frontmatter + index/playbook (< 500 lines)
├── reference/            # read on demand; every file linked from SKILL.md
│   ├── finance.md        # one domain per file, named by content
│   ├── sales.md
│   └── examples.md
├── scripts/              # executed, not read
│   ├── validate.py
│   └── fill_form.py
├── assets/               # templates, schemas, sample inputs (recommended name)
│   └── report-template.md
└── evals/
    └── evals.json        # test cases (skill-creator format)
```

Layout rules:

- **Name files by their content**, as in `form_validation_rules.md`, never `doc2.md`.
- **Organize by domain or feature**, as in `reference/finance.md` and `reference/sales.md`, never `docs/file1.md`.
- **Use forward slashes in every path**, even on Windows.
- **Pick one folder name and keep it.** The docs show both a flat layout (`reference.md` and `FORMS.md` next to `SKILL.md`) and a `reference/` folder. Either works; use the same choice across your whole library.
- **Avoid reserved folder names.** Don't call a skill folder `synced` or `anthropic-skills`, in any capitalization.
- **A skill folder can also be a plugin.** Adding `.claude-plugin/plugin.json` turns it into a plugin, so it can bundle agents, hooks and MCP servers.

Choose a layout from the skill's shape:

| Skill shape | Layout |
| :- | :- |
| A short convention or reference, under 150 lines in total | `SKILL.md` only |
| One workflow plus a deep API | `SKILL.md` plus `reference.md` (and `examples.md`). This is "Pattern 1: high-level guide with references" |
| Several independent domains | `SKILL.md` routes to `reference/<domain>.md`, so Claude reads only the domain it needs. This is "Pattern 2" |
| A common basic path plus rare advanced paths | The basic path lives in `SKILL.md` and advanced files are linked. This is "Pattern 3: conditional details" |
| Fragile or deterministic operations | `SKILL.md` plus `scripts/`, including a validation step |

---

## 4. Where skills live

| Location | Path | Loads in |
| :- | :- | :- |
| Enterprise | `.claude/skills/<name>/SKILL.md` in the managed settings directory | Every user on machines your organization manages |
| Personal | `~/.claude/skills/<name>/SKILL.md` | All your projects on this machine. Not loaded in Cowork or cloud sessions |
| Project | `.claude/skills/<name>/SKILL.md` | This repository. Commit it to share it |
| Nested | `<subdir>/.claude/skills/<name>/SKILL.md` | Sessions started in or below `<subdir>`, or once Claude touches files there |
| Plugin | `<plugin>/skills/<name>/SKILL.md` | Wherever the plugin is enabled, as `/plugin-name:skill-name` |
| claude.ai account | Enabled on claude.ai | Cowork, cloud and signed-in terminal sessions |

How name clashes resolve: enterprise beats personal, and personal beats project. A skill beats a file in `.claude/commands/` with the same name. Plugin skills never clash because they're namespaced. Your own skill replaces a bundled skill of the same name, but not that skill's aliases.

Skills synced from claude.ai behave differently on your machine. Outside cloud and Cowork sessions, their `` !`cmd` `` lines don't run, `@` file references aren't attached, and `${CLAUDE_PROJECT_DIR}` and `${CLAUDE_SESSION_ID}` reach Claude as literal text. Don't rely on those features in a skill you'll distribute through claude.ai.

---

## 5. Frontmatter

### Parsing rules

- The opening `---` must be the file's first line. Otherwise the whole file, markers included, is treated as body text.
- If the YAML doesn't parse, the skill still loads, but with no fields. Typing `/name` works, but auto-triggering breaks because the description is gone. Check with `claude plugin validate .claude/skills` or `--debug`.
- Field names must match exactly, hyphens included; `when_to_use` is the one field spelled with underscores. Claude Code ignores unknown fields without reporting an error.
- Boolean fields accept `true`, `false`, `yes`, `no`, `on`, `off`, `1` and `0`.

### Portable fields (Agent Skills spec)

A claude.ai upload, the Skills API and `package_skill.py` accept only these six fields. Any other field fails with a hard error: `Unexpected key(s) in SKILL.md frontmatter`.

| Field | Notes |
| :- | :- |
| `name` | Required by the API. Optional in Claude Code, where it defaults to the folder name. **Always set it and keep it equal to the folder name.** |
| `description` | Required by the API. Recommended in Claude Code; without it, Claude Code uses the body's first non-empty line |
| `license` | Accepted; Claude Code doesn't act on it |
| `compatibility` | Environment requirements, up to 500 characters; Claude Code doesn't act on it |
| `metadata` | A free-form map for your own tooling. Don't reuse frontmatter field names as keys |
| `allowed-tools` | Tools pre-approved for the turn that invokes the skill (details in [10.5](#105-tools-model-effort-and-paths)) |

### Claude Code-only fields

| Field | Use it when |
| :- | :- |
| `when_to_use` | You want extra trigger phrases or example requests. It's appended to `description` and counts toward the 1,536-character cap |
| `argument-hint` | You want an autocomplete hint, such as `[issue-number] [branch]` |
| `arguments` | You want named placeholders: `arguments: [issue, branch]` gives `$issue` and `$branch` |
| `disable-model-invocation: true` | The skill has side effects or you control its timing (deploy, commit, send). Its description leaves Claude's context |
| `user-invocable: false` | The skill is background knowledge that makes no sense as a `/command` |
| `disallowed-tools` | Certain tools must be unavailable while the skill is active, such as `AskUserQuestion` in an autonomous loop |
| `model` | The skill needs a specific model for the rest of the turn |
| `effort` | The skill needs more or less reasoning: `low`, `medium`, `high`, `xhigh` or `max` |
| `context: fork` | The skill should run in an isolated subagent (see [10.4](#104-run-in-a-subagent)) |
| `agent` | You've set `context: fork` and want a specific subagent type: `Explore`, `Plan`, `general-purpose` or a custom agent |
| `background: false` | You've set `context: fork` and want to wait for the result in the same turn |
| `hooks` | You need rules enforced every time (see [section 11](#11-hooks-with-skills)) |
| `paths` | The skill should auto-load only when Claude works on files matching these globs |
| `shell` | The skill's `!` commands should run in `powershell` instead of `bash` |

**Rule of thumb:** a skill meant for claude.ai or the API should use only the six portable fields. A skill used only in Claude Code can use everything.

---

## 6. Writing the description

Claude picks one skill from potentially more than 100 using only the name and description. Treat the description as the skill's search query.

**Formula:**

```text
<What it does: concrete verbs and objects>. Use when <user phrases, file types, contexts, tool names>. [Not for <near-miss case>; use <other skill> instead.]
```

Rules:

- **Write in the third person.** "Processes Excel files…", never "I can help…" and never "You can use this to…". The description is injected into the system prompt, and a mixed point of view hurts discovery.
- **Cover both what and when.**
- **Use the words users actually say**, plus file extensions (`.xlsx`, `.pdf`) and product or tool names.
- **Put the key use case first.** In Claude Code, truncation cuts from the end.
- **Be specific.** A vague description never triggers. An overly broad one triggers too often.
- **Separate it from sibling skills.** A short "not for X" clause is an effective way to make it specific (my recommendation, not a doc rule).
- **Avoid XML tags and angle brackets.** Synced skills have their angle brackets escaped anyway.

| Good | Bad |
| :- | :- |
| `Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.` | `Helps with documents` |
| `Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.` | `Processes data` |
| `Generate descriptive commit messages by analyzing git diffs. Use when the user asks for help writing commit messages or reviewing staged changes.` | `Does stuff with files` |

**Naming:** the preferred form is the gerund (`processing-pdfs`, `analyzing-spreadsheets`). Noun phrases (`pdf-processing`) and action names (`process-pdfs`) are also fine. Avoid `helper`, `utils`, `tools`, `documents`, `data` and `files`, and pick one pattern for your whole library.

---

## 7. The SKILL.md body is the index

`SKILL.md` is the table of contents and the default playbook. It holds what Claude needs on every run and points to everything else.

### Recommended section order

The order follows priority, because compaction keeps only the top of the file.

```markdown
# <Skill title>                       ← 1 line; optional 1-line purpose

## Rules                               ← non-negotiables, standing instructions (top = survives compaction)
## Quick start                         ← the default 80% path, with one concrete example
## Workflow                            ← numbered steps; a copyable checklist for complex tasks
## Decision points                     ← "Creating? → X. Editing? → Y." (route to references)
## Output format                       ← strict template or flexible default
## Validate                            ← feedback loop: run check → fix → repeat
## Additional resources                ← THE INDEX: every reference/script, what it holds, when to use it
## Old patterns                        ← optional, inside <details>, for deprecated approaches
```

### The index block

Every bundled file gets one line. Each line gives the topic, what's in the file, when to load it, and the path, and it says whether to execute or read.

```markdown
## Additional resources

- **Form filling**: field-mapping rules and edge cases. Read [reference/forms.md](reference/forms.md) when the PDF has fillable fields.
- **API reference**: every method with parameters. See [reference/api.md](reference/api.md); search it with `grep -n "def " reference/api.md`.
- **Validation**: run `python ${CLAUDE_SKILL_DIR}/scripts/validate.py fields.json` before writing. Execute it; don't read it.
- **Examples**: input and output pairs in [reference/examples.md](reference/examples.md). Read them when the output style is unclear.
```

### Writing rules for the body

| Rule | Do | Don't |
| :- | :- | :- |
| Concise | "Use pdfplumber for text extraction:" plus 3 lines of code (about 50 tokens) | Explain what PDFs are and why libraries exist (about 150 tokens) |
| Degrees of freedom | Match specificity to how fragile the task is. **High:** heuristics for reviews. **Medium:** a template or pseudocode. **Low:** "Run exactly this script. Do not modify the command." | Give the same rigidity to everything |
| One default | "Use pdfplumber. For scanned PDFs needing OCR, use pdf2image with pytesseract instead." | "You can use pypdf, or pdfplumber, or PyMuPDF, or…" |
| Consistent terms | Always "field", always "extract" | Mix "field", "box" and "element"; or "extract", "pull" and "get" |
| Timeless | Describe the current method, and put legacy material in a `<details>` "Old patterns" block | "If before August 2025, use the old API" |
| Concrete examples | Input and output pairs for style-sensitive output | Abstract descriptions of the desired style |
| Templates | Strict: "ALWAYS use this exact template". Flexible: "a sensible default; adapt as needed" | Leave the output format implied |
| Checklists | A checklist Claude copies into its response and ticks off as it goes | A long paragraph of steps |
| Feedback loops | "Validate, fix, repeat. Only proceed when validation passes." | Validate once at the end, or never |
| Standing instructions | "Run the tests after every edit" | "Run the tests" (reads as a one-time step) |
| Reasons | One clause giving why for any non-obvious rule | Paragraphs of background Claude already knows |

**Two kinds of content:**

- **Reference content** covers conventions and domain knowledge. It runs inline alongside your conversation.
- **Task content** is step-by-step action such as deploy or commit. It usually gets `disable-model-invocation: true`, and sometimes `context: fork`.

---

## 8. Reference files

- **Link every reference directly from `SKILL.md`.** When a referenced file points to yet another file, Claude may preview it with something like `head -100` and miss content.
- **Open any file over 100 lines with a `## Contents` list**, so Claude sees its full scope even on a partial read.
- **Keep one topic or domain per file and name it by content.** Claude then loads only the relevant slice.
- **Big files are fine.** Complete API docs, long example sets and datasets cost nothing until read.
- **Add grep hints for large files**, for example `grep -i "revenue" reference/finance.md`.
- **Don't duplicate content between `SKILL.md` and references** (recommended). Duplicates drift apart and waste tokens.
- **Use behavior to move content:**

| What you observe | What to do |
| :- | :- |
| Claude reads the same file on nearly every run | Move that content into `SKILL.md` |
| Claude never opens a file | Remove the file, or signal it more clearly in the index |
| Claude reads files in an unexpected order | Restructure the index or rename the files |
| Claude misses an important file | Make the link more explicit and say when to read it |

---

## 9. Scripts

- **Prefer scripts for deterministic work.** They're more reliable than generated code, save tokens and time, and give consistent results.
- **State the intent.** "Run `analyze_form.py` to extract fields" means execute it; "See `analyze_form.py` for the algorithm" means read it. Execution is the usual case.
- **Solve problems instead of deferring them.** Handle errors inside the script, for example by creating a missing file with a default, rather than crashing and leaving Claude to work it out.
- **Avoid "voodoo constants".** Every timeout or retry count gets a comment explaining its value.
- **Write verbose validation errors.** For example: `Field 'signature_date' not found. Available fields: customer_name, order_total, signature_date_signed`.
- **Use plan, validate, then execute for batch or destructive changes.** Analyze the input, write a plan file such as `changes.json`, validate it with a script, execute it, then verify the result.
- **Declare dependencies explicitly**, with the install command (`pip install pypdf`). On claude.ai, Claude can install packages from PyPI and npm. In the Claude API's code execution environment there's no network access and no runtime install.
- **Use path variables.** Write `${CLAUDE_SKILL_DIR}/scripts/x.py`, which resolves wherever the skill is installed. Pair it with `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh *)` so the script runs without a permission prompt.
- **Name MCP tools in full.** The skill best-practices doc uses the format `Server:tool_name`. In Claude Code the tools appear as `mcp__<server>__<tool>`, and plugin servers as `mcp__plugin_<plugin>_<server>__<tool>`. Write the exact name that the target environment exposes.
- **Use visual analysis when it helps.** Convert inputs such as PDF forms to images and let Claude read the layout.

---

## 10. Claude Code features

### 10.1 Who can invoke a skill

| Frontmatter | You can invoke it | Claude can invoke it | Description in context |
| :- | :- | :- | :- |
| (default) | Yes | Yes | Always |
| `disable-model-invocation: true` | Yes | No | No; the body loads only when you invoke it |
| `user-invocable: false` | No | Yes | Always |

You can also control visibility without editing the file, through `skillOverrides` in settings: `"on"`, `"name-only"`, `"user-invocable-only"` or `"off"`. That setting doesn't apply to plugin skills. Permission rules work too: `Skill(name)` matches one skill exactly and `Skill(name *)` matches it with any arguments.

### 10.2 Arguments and substitutions

| Variable | Expands to |
| :- | :- |
| `$ARGUMENTS` | Everything typed after the skill name. If the body has no placeholder at all, Claude Code appends `ARGUMENTS: <value>` |
| `$ARGUMENTS[N]` or `$N` | The argument at 0-based position N, with shell-style quoting (`"hello world"` is one argument) |
| `$name` | A named argument declared in `arguments:` (empty string when missing) |
| `${CLAUDE_SKILL_DIR}` | This skill's folder, for bundled scripts and files |
| `${CLAUDE_PROJECT_DIR}` | The project root |
| `${CLAUDE_SESSION_ID}` | The session ID, useful for logs and per-session files |
| `${CLAUDE_EFFORT}` | The current effort level, so the instructions can adapt |
| `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` | The plugin's install directory and its persistent data directory (plugin skills only) |

To write a literal dollar sign before a digit or argument name, escape it: `\$1.00`.

### 10.3 Dynamic context injection

- `` !`git diff HEAD` `` runs **before** Claude sees the skill, and its output replaces the line. For multi-line commands, use a fenced block opened with ` ```! `.
- The `!` must be at the start of a line or follow whitespace. In ``KEY=!`cmd` `` it stays literal text.
- The docs don't say whether `$ARGUMENTS` placeholders are filled in before `!` commands run, so don't build `!` commands from arguments. Have Claude run those commands itself, pre-approved through `allowed-tools`.
- Substitution runs once. Command output isn't re-scanned for further `!` commands.
- **Any non-zero exit aborts the whole invocation.** The exception is exit code 1 from search and compare commands such as `grep`. Append `|| true` to any other command that can legitimately exit non-zero.
- Injected commands never prompt for permission. A command that isn't allowed aborts the skill, so pre-approve it with `allowed-tools`.
- Each command times out after 2 minutes. Use `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PROJECT_DIR}` in paths, because the working directory moves when Claude runs `cd`.
- Admins can turn this off with `disableSkillShellExecution`. It never runs for skills synced from claude.ai on your machine.

### 10.4 Run in a subagent

`context: fork` runs the body as the prompt of a fresh subagent, which is `general-purpose` unless you set `agent`.

- **The subagent doesn't see your conversation**, so the body must be a complete, explicit task. A body that's only guidelines produces nothing useful.
- `Explore` and `Plan` skip CLAUDE.md, so the subagent sees only the skill and the agent's own prompt.
- Forked skills run in the background by default with a narrower tool set. Set `background: false` when you need the full tool set or want to wait for the result.
- Background edits happen outside checkpoints, so `/rewind` can't undo them. Revert with git instead.

### 10.5 Tools, model, effort and paths

- **`allowed-tools`** pre-approves tools only for the turn that invoked the skill. The grant clears at your next message. It doesn't restrict other tools, and deny and ask rules still win over it.
- **`disallowed-tools`** removes tools while the skill is active. The restriction also clears at your next message.
- **`model`** applies for the rest of the current turn, and the session model resumes at your next message. **`effort`** overrides the session's effort level while the skill is active.
- **`paths`** loads the skill automatically only when Claude works on files matching the globs.
- **`ultrathink`** anywhere in the body requests deeper reasoning for that run.

### 10.6 Special names and behaviors

- A project or personal skill named `verify` or `simplify` makes Claude run it before each commit (except for docs-only or test-only changes).
- A file at `.claude/commands/<name>.md` still works and supports the same frontmatter except `name` and `paths`. Prefer the skill format, because only skills can bundle supporting files.
- Edits to `SKILL.md` are picked up live during a session. A newly created top-level skills directory needs `/reload-skills`.

---

## 11. Hooks with skills

### When to use a hook instead of skill text

Prose is followed with judgment, and Claude can drift from it later in a session. **A rule that must hold every time belongs in a hook.** Hooks run on every matching event whether or not Claude is following the skill. You can keep the hook with the skill by declaring it in the skill's frontmatter.

### Frontmatter format

The format is the same as in settings files, written as YAML:

```yaml
---
name: safe-migrations
description: Writes and reviews database migrations. Use when creating or editing files under migrations/.
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          if: "Bash(psql *)"
          command: "${CLAUDE_PROJECT_DIR}/.claude/skills/safe-migrations/scripts/block-prod.sh"
          args: []
---
```

- **Lifetime:** a skill's hooks register when the skill is invoked and keep running **for the rest of the session**, on later turns too. Design each hook to do nothing when its rule doesn't apply. Set `once: true` to remove a hook after its first successful run; that option works only in skill frontmatter.
- **Paths:** the hooks docs list `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` as hook path placeholders, and don't list `${CLAUDE_SKILL_DIR}`, so don't rely on it inside hook commands. Prefer the exec form (`args: []`) whenever a command uses a placeholder.
- **Handler types:** `command`, `http`, `mcp_tool`, `prompt` (a one-shot LLM judgment that returns `{"ok": bool, "reason": ...}`) and `agent` (an experimental verifier that can use tools for up to 50 turns).
- **When a hook asks for confirmation**, the prompt is labeled `[skill]`.

### Exit codes

| Exit | Effect |
| :- | :- |
| `0` | Success. Stdout is parsed as JSON when it starts with `{` and ends with `}` |
| `2` | **Blocks** on events that can block. Stderr becomes the reason, and JSON can't override the block |
| `1` or any other code | **A non-blocking error. The action still proceeds.** Use `exit 2` to enforce a policy |

### JSON output basics

- Stdout must contain only the JSON object. A shell profile that prints text on startup breaks parsing.
- Event-specific fields go in `hookSpecificOutput` with `hookEventName`. `PreToolUse` uses `permissionDecision` (`allow`, `deny`, `ask` or `defer`), plus optional `updatedInput` and `additionalContext`. `PostToolUse`, `Stop` and `UserPromptExpansion` use top-level `decision: "block"` with `reason`.
- **Write `additionalContext` as statements of fact**, such as "This repo uses `bun test`", not as commands. Text framed as system instructions can trip Claude's prompt-injection defenses.

### Events most useful with skills

| Event | Use it to |
| :- | :- |
| `PreToolUse` (matcher `Bash`, `Edit\|Write` or `mcp__srv__.*`; narrow further with `if: "Bash(git *)"`) | Block, rewrite or ask for confirmation on a tool call before it runs |
| `PreToolUse` with matcher `Skill` | Gate or add context when **Claude** invokes a skill through the Skill tool |
| `UserPromptExpansion` (matcher is the command name) | Gate or add context when the **user types** `/skill`. This path bypasses `PreToolUse` |
| `PostToolUse` (matcher `Edit\|Write`) | Run a linter, formatter or validator after edits, and feed problems back through `additionalContext` |
| `Stop` with `type: prompt` or `type: agent` | Refuse to finish until a condition holds, such as tests passing |
| `SessionStart` returning `reloadSkills: true` | Install or sync skills at session start and have them available from the first prompt |
| `ConfigChange` with matcher `skills` | Audit or block edits to skill files in `.claude/skills/` |

### Security

- Command hooks run with your full user permissions.
- **A project skill's `allowed-tools` and frontmatter hooks take effect even in a `claude -p` run in a folder you've never trusted.** Review the skills in any repository before running Claude Code there.
- The hooks docs recommend quoting variables (`"$VAR"`), blocking `..` in paths, using absolute paths and skipping sensitive files (`.env`, `.git/`, keys).
- To debug, use `/hooks`, which lists every hook and where it came from, and `claude --debug-file <path>`.

---

## 12. Writing for current models

These points come from the prompting guides for Claude Fable 5, Opus 5.5 and Sonnet 5.5.

### What changes for skills

| Guidance | Why | Source |
| :- | :- | :- |
| **Make old skills less prescriptive.** Review them, and remove instructions the model does better without | "Skills developed for prior models are often too prescriptive … and can degrade output quality" | Fable 5 |
| **Steer with one brief instruction** instead of listing every behavior | Instruction following is strong enough that a short line works as well as a list | Fable 5 |
| **Name specific patterns when one is a known default.** For example, name the exact UI styles or kinds of early stop to avoid | A vague "avoid generic X" just swaps one default for another | Opus 5.5 |
| **Give the reason, not only the request**, in one clause | The model connects the task to relevant context better | Fable 5 |
| **Never ask the model to write out its reasoning in the response.** Remove "show your thinking" and "explain your reasoning step by step" | This can trigger the `reasoning_extraction` refusal. A short explanation of the answer or a summary of actions is fine | Fable 5, Opus 5.5, Sonnet 5.5 |
| **Set the `effort` field instead of writing "think carefully"** | Effort is the main control. Prompt lines asking for less thinking aren't reliable | Opus 5.5, Sonnet 5.5 |
| The one exception: for a reasoning task with JSON output, add "Think the problem through before you answer." | It raises accuracy when the model would otherwise skip thinking | Sonnet 5.5 |
| **State the scope boundary**: don't add features, files or refactors beyond the request; mention them at the end instead | At higher effort the model adds tests, docs and cleanup | Fable 5, Sonnet 5.5 |
| **Require a real check**: tests, a type-check, a build or running the command, never a syntax-only check | At low effort, changes can be reported done without one | Sonnet 5.5 |
| **Prefer a fresh-context verifier subagent** to self-critique for long tasks | Separate verifiers tend to outperform self-review | Fable 5 |
| **Ground progress claims**: audit each claim against a tool result from this session | This nearly eliminated fabricated status reports | Fable 5 |
| **Define when to pause**: only for destructive or irreversible actions, real scope changes, or input only the user can give | This stops both unnecessary check-ins and runaway actions | Fable 5, Sonnet 5.5 |
| **Remove "minimize tool calls" language.** For changeable facts, tell the model to search | Otherwise the model answers from stale training knowledge | Sonnet 5.5 |
| **Write tool and file names exactly** | Sonnet 5.5 sometimes gets letter case or parameter names slightly wrong | Sonnet 5.5 |
| **Final summaries lead with the outcome, in plain sentences**, with no arrow chains or invented labels | Long agentic runs drift into shorthand the reader never saw | Fable 5 |
| **For skills that learn across runs, give them a notes file**: one lesson per file, update rather than duplicate, delete wrong notes | Fable 5 does well with a memory system | Fable 5 |

**Strong wording such as MUST or ALWAYS** (my synthesis): the best-practices doc suggests stronger wording when a rule is being missed, while the Fable 5 guide warns against over-prescription. Use emphasis only on a rule your evals show is being skipped, and if it still slips, move it into a hook.

### Snippets you can paste into a skill body

```text
Don't add features, refactor, or introduce abstractions beyond what the task requires. If you think one would help, mention it at the end instead of doing it.
```

```text
When you change code that can be run, built, or type-checked, run a real check that exercises the change before reporting it done. A syntax-only check does not count. If no real check can run, say which one you did not run and why.
```

```text
Pause for the user only when the work genuinely requires them: a destructive or irreversible action, a real scope change, or input that only they can provide.
```

```text
Lead with the outcome. Your first sentence after finishing should say what happened or what you found. Supporting detail comes after.
```

### Test matrix

Test every model you plan to use. What works on Opus may need more detail on Haiku.

| Model | Question to ask |
| :- | :- |
| Haiku 4.5 | Does the skill give enough guidance? |
| Sonnet 5.5 | Is it clear and efficient? Does it still verify its work at `low` or `medium` effort? |
| Opus 5.5 | Does it avoid over-explaining? Does it keep going through unattended runs? |
| Fable 5 | Is it too prescriptive? Is output quality better with some rules removed? |

---

## 13. Evaluate and iterate

### Evaluation-driven development

1. Run representative tasks **without** the skill and write down the specific failures.
2. Write **at least three** eval scenarios that target those gaps.
3. Measure the baseline without the skill.
4. Write the **minimum** instructions that close the gaps.
5. Re-run, compare against the baseline, and refine.

```json
{
  "skills": ["pdf-processing"],
  "query": "Extract all text from this PDF file and save it to output.txt",
  "files": ["test-files/document.pdf"],
  "expected_behavior": [
    "Reads the PDF with an appropriate library or CLI tool",
    "Extracts text from all pages without missing any",
    "Saves the text to output.txt in a readable format"
  ]
}
```

### Measure two things separately

- **Triggering:** does Claude invoke the skill on the prompts it should, and skip it on near-misses?
- **Output:** when it's invoked, does the result match what you expect?

Run every check in a **fresh session**, once with the skill and once with it turned off. Leftover context from writing the skill hides gaps in it. To turn a personal or project skill off, set `"off"` in `skillOverrides`. For plugin skills, `claude plugin eval` runs each prompt with and without the plugin and can gate CI on a threshold.

### Tools

- **The skill-creator plugin** (`/plugin install skill-creator@claude-plugins-official`) stores test cases in `evals/evals.json`, runs each one in an isolated subagent, grades it, benchmarks with and without the skill, runs blind A/B tests between versions, and tunes the description.
- **The Claude A / Claude B loop:** one Claude instance helps you write and refine the skill, and a fresh instance with the skill loaded does real tasks. Bring what you observe back to the first instance.
- **Maintenance:** `/skill-doctor` shows each skill's context cost and usage, `/doctor` shows the listing's cost, and `/context` shows the Skills row.

---

## 14. Troubleshooting

| Symptom | Fix |
| :- | :- |
| The skill never triggers | Add the keywords users actually say to the description. Check that the skill appears in "What skills are available?". Validate the YAML with `claude plugin validate` or `--debug` |
| The skill triggers too often | Make the description more specific, add a "not for X" clause, or set `disable-model-invocation: true` |
| The description seems ignored with many skills installed | The listing is over budget. Shorten descriptions with the key use case first, set rarely used skills to `"name-only"`, or raise `skillListingBudgetFraction` |
| A rule is followed once, then skipped | Make it a standing instruction, or move it into a hook |
| The skill is forgotten after compaction | Invoke it again, and move the critical rules into the first 5,000 tokens |
| `` !`cmd` `` aborts the skill | The command exited non-zero (append `\|\| true`), wasn't allowed (add it to `allowed-tools`), or timed out after 2 minutes |
| A forked skill returns nothing | The body holds guidelines but no task. Add an explicit task, or drop `context: fork` |
| Upload to claude.ai or the API fails with `Unexpected key(s)` | Keep only the six portable frontmatter fields |
| A policy hook never blocks | It exits 1 instead of 2, or its path is wrong. Look for a `Failed with non-blocking status code` notice |
| Personal skills disappeared | Look in `~/.claude/skills/.trash/` and move them back before the 30-day cleanup |

---

## 15. Templates

### 15.1 Portable SKILL.md (claude.ai, API and Claude Code)

The script paths are relative, as in the best-practices doc. A skill used only in Claude Code should prefix them with `${CLAUDE_SKILL_DIR}/` so they resolve from any working directory.

````markdown
---
name: processing-invoices
description: Extracts line items, totals and vendor data from invoice PDFs and writes them to CSV. Use when the user shares invoices, receipts or billing PDFs, or asks to reconcile vendor charges. Not for bank statements.
license: Proprietary
compatibility: Requires Python 3.10+ with pdfplumber.
---

# Processing invoices

## Rules
- Totals in the CSV must equal the invoice total; if they don't, stop and report the mismatch (finance reconciles on this field).
- Never guess a missing value; leave it empty and list it in the summary.

## Quick start
```bash
python scripts/extract.py invoice.pdf > items.json
python scripts/validate.py items.json
python scripts/to_csv.py items.json out.csv
```

## Workflow
Copy this checklist and tick it off:
```
- [ ] 1. Extract (scripts/extract.py)
- [ ] 2. Validate (scripts/validate.py); fix and re-run until it passes
- [ ] 3. Write CSV (scripts/to_csv.py)
- [ ] 4. Summarize: outcome first, then any empty fields
```

## Output format
Use exactly these CSV columns: `vendor,invoice_no,date,description,qty,unit_price,line_total`.

## Additional resources
- **Vendor quirks**: per-vendor layouts and known extraction errors. Read [reference/vendors.md](reference/vendors.md) when a vendor name matches.
- **Validation rules**: what `validate.py` checks and its error codes, in [reference/validation.md](reference/validation.md).
- **Scanned invoices**: OCR fallback in [reference/ocr.md](reference/ocr.md). Read it only when extract.py returns no text.
````

### 15.2 Claude Code task skill (arguments, tools, fork)

```markdown
---
name: fix-issue
description: Fixes a GitHub issue end to end with a test that fails before the fix. Use when the user asks to fix, resolve or close a GitHub issue by number.
argument-hint: [issue-number]
arguments: [issue]
disable-model-invocation: true
allowed-tools: Bash(gh issue view *) Bash(git status *) Bash(git diff *)
effort: high
---

## Rules
- Write a failing test before changing code; the fix is done only when that test passes.
- Change only what the issue requires. Mention other problems at the end instead of fixing them.

## Steps
1. Read the issue with `gh issue view $issue --json title,body,labels`.
1. Reproduce the issue with a failing test.
2. Make the smallest fix that passes it.
3. Run the full test suite and report the result with its output.
```

### 15.3 Reference file over 100 lines

```markdown
# Vendor quirks

## Contents
- Acme Corp: two-column layout, totals on page 2
- Globex: VAT included in line totals
- Initech: dates in DD/MM/YYYY
- Unknown vendors: fallback rules

## Acme Corp
...
```

### 15.4 A skill-enforced hook script (block with exit 2)

```bash
#!/bin/bash
# Blocks psql against production; everything else falls through to normal permissions.
cmd=$(jq -r '.tool_input.command')
if grep -q 'prod' <<<"$cmd"; then
  echo "Blocked: migrations must target staging first. Use the staging connection string." >&2
  exit 2
fi
exit 0
```

---

## 16. Pre-ship checklist

**Format**
- [ ] The folder name equals `name`, which is lowercase with hyphens, at most 64 characters, and contains no reserved words
- [ ] The frontmatter starts on line 1 and the YAML parses (`claude plugin validate`)
- [ ] Portable skills use only the six spec fields

**Description**
- [ ] It's in the third person and says what the skill does and when to use it
- [ ] It contains the key terms and file types users actually mention
- [ ] The key use case comes first, and it's at most 1,024 characters
- [ ] It's distinct from sibling skills, using a "not for X" clause if needed

**Body (the index)**
- [ ] It's under 500 lines (aim for under 250), with critical rules at the top
- [ ] Rules are standing instructions, with a one-clause reason for anything non-obvious
- [ ] It has one default approach, consistent terms and nothing time-sensitive
- [ ] It includes concrete examples and an explicit output format
- [ ] Workflows have numbered steps, and complex ones have a copyable checklist
- [ ] Quality-critical steps have a validation loop
- [ ] It ends with an index listing every bundled file: what it holds, when to use it, and whether to execute or read it

**References and scripts**
- [ ] Every reference is linked directly from `SKILL.md`, one level deep
- [ ] Files over 100 lines open with a table of contents
- [ ] Files are named by content, organized by domain, and use forward slashes
- [ ] Scripts handle errors, explain their constants and print actionable messages
- [ ] Dependencies are listed with install commands
- [ ] Scripts are called through `${CLAUDE_SKILL_DIR}` and pre-approved in `allowed-tools`
- [ ] MCP tools are referenced by their exact fully qualified names

**Claude Code behavior**
- [ ] Skills with side effects set `disable-model-invocation: true`
- [ ] `!` commands can't fail spuriously (`|| true` where needed) and are covered by `allowed-tools`
- [ ] `context: fork` is used only when the body is a complete task
- [ ] Must-hold rules are hooks, which exit 2 to block and do nothing when the rule doesn't apply

**Model fit**
- [ ] There's no "show your reasoning" or "think carefully" text; `effort` is used instead
- [ ] There's no "minimize tool calls" language
- [ ] The scope boundary, verification requirement and pause rule are stated once, briefly
- [ ] Emphasis such as MUST is used only on rules that evals showed being skipped

**Testing**
- [ ] There are at least 3 evals, with a baseline measured without the skill
- [ ] Triggering is tested on should-trigger and should-not-trigger prompts, in fresh sessions
- [ ] It's tested on every model you'll run it on
- [ ] Real-usage observations are folded back into the skill

---

## 17. Sources

1. Skill authoring best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
2. Extend Claude with skills (Claude Code): https://code.claude.com/docs/en/skills
3. Hooks reference (Claude Code): https://code.claude.com/docs/en/hooks
4. Prompting Claude Fable 5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5
5. Prompting Claude Opus 5.5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
6. Prompting Claude Sonnet 5.5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5
