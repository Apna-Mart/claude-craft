import type { EngineInterface, Register } from 'claude-code'
import { judgeBash, type Probe } from './bash-rules'
import { lockfileDenial, manifestAsk } from './file-rules'
import { asksToFormat } from './format-rules'

const PROBE_TIMEOUT_MS = 5000
const USER_PROMPT_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger'])
const TASKS_FILE = 'TASKS.md'
const RESTORE_TASKS_NOTE = `${TASKS_FILE} is in this folder. Restore it before anything else: Read ${TASKS_FILE}, call TaskList first so nothing is duplicated, TaskCreate each open item that is missing, and TaskUpdate each one's status to match.`

const CLI_FIRST_NOTE = "Command line first: scaffold, install, upgrade, remove, build, test, lint, format, generate code and migrate only through the ecosystem's official command-line tool, never by editing files by hand or running a compiler directly. Manifests, lockfiles and generated files are written only by that tool: add dependencies with `npm install`, `bun add`, `pnpm add`, `yarn add`, `uv add`, `poetry add`, `cargo add`, `go get`, `flutter pub add`, `bundle add`, `composer require`, `dotnet add package`, `deno add` or `swift package add-dependency`, never by typing a version into a manifest. Use the tools the project already uses (read its lockfile and lint or format config first). For a new project or a one-off, these are the preferences: bun for JavaScript and TypeScript packages and scripts, biome for JavaScript and TypeScript linting and formatting, uv for Python packages, scripts and environments (`uv add`, `uv run`, `uv venv`), ruff for Python linting and formatting, xmake for C and C++ builds, cargo for Rust, go for Go and adb for Android devices. Repository work (clone, branch, commit, push, pull, merge, rebase) always goes through git; gh is only for GitHub-specific things: login and account, issues, pull requests, releases, Actions runs and the GitHub API. A project already on another tool (npm, yarn, pnpm, eslint, prettier, poetry, pip, pipenv, hatch, rye, black, flake8, CMake and so on) stays on it. If the right tool can't be used (missing, offline, sandboxed), say so before falling back; if a hand edit is unavoidable, rerun the install or sync right after and say why."

const hasTasksFile = async ($: EngineInterface) => $.fs.exists(`${await $.session.cwd()}/${TASKS_FILE}`)
const sessionNotes = async ($: EngineInterface) => [CLI_FIRST_NOTE, ...((await hasTasksFile($)) ? [RESTORE_TASKS_NOTE] : [])]

const filePathOf = (input: unknown) =>
  typeof input === 'object' && input !== null && 'file_path' in input && typeof input.file_path === 'string' ? input.file_path : undefined

export const register: Register = on => {
  let areSessionNotesDue = true
  let isFormattingAsked = false
  const changedFiles = new Set<string>()

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const probe: Probe = (argv, cwd) => $.process.run(argv, { cwd, timeoutMs: PROBE_TIMEOUT_MS }).catch(() => undefined)
    const formatting = { isAsked: isFormattingAsked, changedFiles }
    const verdict = await judgeBash(e.command, await $.session.cwd(), probe, await $.env.get('HOME'), formatting, e.run_in_background === true)
    if (verdict.kind === 'pass') return next(e)
    if (verdict.kind === 'deny') return { deny: `craft blocked this command: ${verdict.reason}` }
    if (verdict.kind === 'advise') {
      const ran = await next(e)
      return ran.deny !== undefined ? ran : { ...ran, context: [...(ran.context ?? []), ...verdict.advice] }
    }
    const ran = await next({ ...e, command: verdict.command })
    if (ran.deny !== undefined) return ran
    const note = `craft rewrote the command before it ran (${verdict.notes.join('; ')}). It ran as:\n${verdict.command}`
    return { ...ran, context: [...(ran.context ?? []), note, ...verdict.advice] }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'craft: its Bash guard failed, so the command did not run.' }))

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write') return next(e)
    const denial = lockfileDenial(e.file_path)
    if (denial !== undefined) return { deny: `craft blocked this edit: ${denial}` }
    const ran = await next(e)
    if (ran.deny === undefined) changedFiles.add(e.file_path)
    return ran
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'craft: its file guard failed, so the edit did not run.' }))

  for (const tool of ['Edit', 'Write'] as const) {
    on('tool.check', { tool }, async ($, e, next) => {
      const verdict = await next(e)
      const path = filePathOf(e.input)
      const reason = path === undefined ? undefined : manifestAsk(path)
      if (reason === undefined || verdict.decision !== 'allow') return verdict
      return { ...verdict, decision: 'ask', reason: `craft: ${reason}` }
    }).catch(() => ({ decision: 'ask', reason: 'craft: its manifest check failed, so this edit needs approval.' }))
  }

  on('prompt.submit', async ($, e, next) => {
    if (USER_PROMPT_ORIGINS.has(e.origin.kind)) isFormattingAsked = asksToFormat(e.text)
    if (!areSessionNotesDue || e.text.startsWith('/')) return next(e)
    const entered = await next({ ...e, context: [...(e.context ?? []), ...(await sessionNotes($))] })
    if (entered.drop === undefined) areSessionNotesDue = false
    return entered
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') areSessionNotesDue = true
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.trigger === 'precompute' || e.agentId !== undefined || compacted.skip !== undefined) return compacted
    if (e.trigger === 'manual') {
      areSessionNotesDue = true
      return compacted
    }
    const notes = (await sessionNotes($)).join('\n\n')
    return { ...compacted, messages: [...compacted.messages, { role: 'user', text: notes, toolUses: [] }] }
  })
}
