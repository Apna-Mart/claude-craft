import { guardToolchain } from './cli-first'
import { lockfileDenial, manifestShellDenial } from './file-rules'
import { formatterAdvice, formatterDenial, formatterRun, type Formatting } from './format-rules'
import { commandStart, commandWords, parseSegments, type Segment, type Word } from './shell'

export type ProbeResult = { exitCode: number; stdout: string }
export type Probe = (argv: readonly string[], cwd: string) => Promise<ProbeResult | undefined>

export type Verdict =
  | { kind: 'pass' }
  | { kind: 'advise'; advice: string[] }
  | { kind: 'rewrite'; command: string; notes: string[]; advice: string[] }
  | { kind: 'deny'; reason: string }

type Edit = { start: number; end: number; text: string }
type Rewrite = { edits: Edit[]; note: string }
type SegmentOutcome = Rewrite | { deny: string } | { advice: string } | undefined
type Context = {
  command: string
  segment: Segment
  words: Word[]
  dir: string | undefined
  home: string | undefined
  probe: Probe
  formatting: Formatting
}

const NOTHING_ASKED: Formatting = { isAsked: false, changedFiles: new Set() }
const NOT_A_REPOSITORY = 128
const DISPOSABLE_DIRS = new Set(['node_modules', 'build', '.gradle', 'target', 'dist'])
const SCRATCH_PREFIXES = ['/tmp/claude-', '/private/tmp/claude-']
const INTERPRETERS = new Set(['python', 'python3', 'node', 'bun', 'deno', 'ruby', 'perl', 'uv'])
const DELETION_APIS = /\b(rmtree|rmSync|unlinkSync|rmdirSync)\b|\bos\.(remove|unlink|rmdir)\b|\.unlink\(|\.rmdir\(|\bfs\.rm\(|\bpromises\.rm\(/
const SSH_SCP_REMOTE = /^git@([^:/]+):(.+)$/
const SSH_URL_REMOTE = /^ssh:\/\/git@([^:/]+)(?::\d+)?\/(.+)$/
const CHANGE_TYPES = 'feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'
const BRANCH_NAME = new RegExp(`^(${CHANGE_TYPES})/[a-z0-9]+(-[a-z0-9]+)+$`)
const BRANCH_NAME_MAX_LENGTH = 50
const RELEASE_LINE_BRANCH = /^(release|hotfix)\/[^/\s]/
const SUBJECT = new RegExp(`^(${CHANGE_TYPES})\\([^()\\s][^()]*\\)!?: \\S`)
const LONG_LIVED_BRANCHES = new Set([
  'main', 'master', 'trunk', 'develop', 'development', 'dev', 'next', 'staging', 'stage', 'uat', 'qa', 'sit', 'su', 'sd',
  'preprod', 'production', 'prod', 'release',
])
const GIT_GENERATED_SUBJECT = /^((fixup|squash|amend)! |Revert "|Merge )/
const BRANCH_CREATE_FLAGS: Record<string, { short: readonly string[]; long: readonly string[] }> = {
  checkout: { short: ['-b', '-B'], long: [] },
  switch: { short: ['-c', '-C'], long: ['--create', '--force-create'] },
  worktree: { short: ['-b', '-B'], long: [] },
}
const BRANCH_RENAME_FLAGS = new Set(['-m', '-M', '-c', '-C', '--move', '--copy', '-f', '--force'])
const BRANCH_CREATE_OK_FLAGS = /^(-t|--track(=.*)?|--no-track|-f|--force|--recurse-submodules|-q|--quiet)$/
const GH_VALUE_OPTIONS = new Set(['-R', '--repo'])
const GITHUB_REPOSITORY = /^[\w.-]+\/[\w.-]+$/
const HTTPS_URL = /^https:\/\//
const PULL_MODES = /^(--rebase(=.*)?|-r|--no-rebase|--ff-only|--ff|--no-ff|--squash)$/
const WAIT_LOOP_KEYWORDS = new Set(['while', 'until'])
const TAIL_FOLLOW_FLAG = /^(-[a-zA-Z0-9]*[fF][a-zA-Z0-9]*|--follow(=.*)?)$/
const ENDLESS_SLEEP = /^inf(inity)?$/
const BACKGROUND_WAIT_LIMIT_SECONDS = 600
const MV_FLAGS_GIT_KEEPS = new Set(['-f', '-v'])
const COPY_COMMANDS = new Set(['cp', 'mv', 'install'])
const SED_IN_PLACE = /^(-i|--in-place)/
const PERL_IN_PLACE = /^-[a-zA-HJ-Z]*i/
const YQ_IN_PLACE = /^(-i|--inplace)$/
const TEMP_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/', '/dev/']
const SCRIPT_WRITE_CALLS = [
  /(?:writeFileSync|writeFile|Bun\.write)\(\s*['"`]([^'"`]+)['"`]/g,
  /\bopen\(\s*['"]([^'"]+)['"]\s*,\s*['"][wax]/g,
  /Path\(\s*['"]([^'"]+)['"]\s*\)\.write_(?:text|bytes)/g,
]

const raw = (ctx: Context, word: Word) => ctx.command.slice(word.start, word.end)
const isFlag = (text: string) => text.startsWith('-') && text !== '-'
const baseName = (text: string) => text.split('/').at(-1) ?? text

function operands(words: Word[]): Word[] {
  const dashDash = words.findIndex(w => w.text === '--')
  if (dashDash === -1) return words.filter(w => !isFlag(w.text))
  return [...words.slice(0, dashDash).filter(w => !isFlag(w.text)), ...words.slice(dashDash + 1)]
}

function resolveDir(base: string | undefined, target: string, home: string | undefined): string | undefined {
  if (target.startsWith('/')) return target
  if (target === '~' || target.startsWith('~/')) return home === undefined ? undefined : home + target.slice(1)
  if (base === undefined || target === '' || target === '-' || target.startsWith('~') || target.includes('$')) return undefined
  return `${base}/${target}`
}

function isDisposable(path: string): boolean {
  const parts = path.split('/')
  if (parts.includes('..')) return false
  return SCRATCH_PREFIXES.some(prefix => path.startsWith(prefix)) || parts.some(part => DISPOSABLE_DIRS.has(part))
}

const tolerantTrash = (paths: string) => `{ trash ${paths} 2>/dev/null || true; }`

function deleteToTrash(ctx: Context): SegmentOutcome {
  const args = ctx.words.slice(1)
  const paths = operands(args)
  if (paths.length === 0 || paths.every(p => isDisposable(p.text))) return undefined
  const isForced = args.some(w => w.text === '--force' || /^-[a-zA-Z]*f/.test(w.text))
  const joined = paths.map(p => raw(ctx, p)).join(' ')
  const text = isForced ? tolerantTrash(joined) : `trash ${joined}`
  return { edits: [{ start: ctx.words[0]!.start, end: ctx.words.at(-1)!.end, text }], note: `${baseName(ctx.words[0]!.text)} → trash` }
}

type CreatedBranch = { name: string; startPoint?: string }

function branchDenial({ name, startPoint }: CreatedBranch): string | undefined {
  const copiesExisting = startPoint !== undefined && (startPoint === name || startPoint.endsWith(`/${name}`))
  if (LONG_LIVED_BRANCHES.has(name) || RELEASE_LINE_BRANCH.test(name) || copiesExisting) return undefined
  if (BRANCH_NAME.test(name) && name.length <= BRANCH_NAME_MAX_LENGTH) return undefined
  return `branch names follow <type>/<scope>-<description>: lowercase, hyphenated, at most ${BRANCH_NAME_MAX_LENGTH} characters, type one of ${CHANGE_TYPES.split('|').join(', ')} (for example feat/auth-add-login). "${name}" doesn't.`
}

function branchFromCreateFlag(subcommand: string, args: Word[]): CreatedBranch | undefined {
  const spec = BRANCH_CREATE_FLAGS[subcommand]
  if (!spec || (subcommand === 'worktree' && args[0]?.text !== 'add')) return undefined
  for (let i = 0; i < args.length; i++) {
    const text = args[i]!.text
    const long = spec.long.find(flag => text === flag || text.startsWith(`${flag}=`))
    const short = spec.short.find(flag => text.startsWith(flag))
    if (!long && !short) continue
    const isAttached = long ? text !== long : text !== short
    const name = isAttached ? text.slice(long ? long.length + 1 : 2) : args[i + 1]?.text
    if (!name) return undefined
    const rest = operands(args.slice(isAttached ? i + 1 : i + 2))
    return { name, startPoint: (subcommand === 'worktree' ? rest[1] : rest[0])?.text }
  }
  return undefined
}

function createdBranch(subcommand: string, args: Word[]): CreatedBranch | undefined {
  if (subcommand !== 'branch') return branchFromCreateFlag(subcommand, args)
  const flags = args.filter(w => isFlag(w.text))
  const names = operands(args)
  if (flags.every(w => BRANCH_CREATE_OK_FLAGS.test(w.text))) return names[0] ? { name: names[0].text, startPoint: names[1]?.text } : undefined
  if (flags.every(w => BRANCH_RENAME_FLAGS.has(w.text))) return names.at(-1) ? { name: names.at(-1)!.text } : undefined
  return undefined
}

function optionValue(args: Word[], letter: string, long: string): string | undefined {
  const cluster = new RegExp(`^-[a-zA-Z]*${letter}$`)
  for (let i = 0; i < args.length; i++) {
    const text = args[i]!.text
    if (text === long || cluster.test(text)) return args[i + 1]?.text
    if (text.startsWith(`${long}=`)) return text.slice(long.length + 1)
    if (text.startsWith(`-${letter}`) && !text.startsWith('--')) return text.slice(2)
  }
  return undefined
}

function subjectOf(message: string): string | undefined {
  if (!message.startsWith('$')) return message.split('\n')[0]
  const lines = message.split('\n')
  const heredocLine = lines.findIndex(line => line.includes('<<'))
  if (heredocLine === -1) return undefined
  return lines.slice(heredocLine + 1).map(line => line.replace(/^\t+/, '')).find(line => line.trim() !== '')
}

function subjectDenial(message: string | undefined, what: string): string | undefined {
  const subject = message === undefined ? undefined : subjectOf(message)
  if (subject === undefined || SUBJECT.test(subject) || GIT_GENERATED_SUBJECT.test(subject)) return undefined
  return `${what} follow <type>(<scope>): <description>, type one of ${CHANGE_TYPES.split('|').join(', ')} (for example feat(auth): add login screen). "${subject}" doesn't.`
}

function guardPullRequest(args: Word[]): SegmentOutcome {
  const titleProblem = subjectDenial(optionValue(args, 't', '--title'), 'pull request titles')
  return titleProblem ? { deny: titleProblem } : undefined
}

function cloneWithGit(ctx: Context, args: Word[]): SegmentOutcome {
  const dashDash = args.findIndex(w => w.text === '--')
  const own = dashDash === -1 ? args : args.slice(0, dashDash)
  const gitOptions = dashDash === -1 ? [] : args.slice(dashDash + 1)
  const [repository, directory, ...extra] = own
  if (!repository || extra.length > 0 || own.some(w => isFlag(w.text))) return undefined
  const url = GITHUB_REPOSITORY.test(repository.text) ? `https://github.com/${repository.text}.git` : HTTPS_URL.test(repository.text) ? repository.text : undefined
  if (url === undefined) return undefined
  const text = ['git clone', ...gitOptions.map(w => raw(ctx, w)), url, ...(directory ? [raw(ctx, directory)] : [])].join(' ')
  return { edits: [{ start: ctx.words[0]!.start, end: ctx.words.at(-1)!.end, text }], note: 'gh repo clone → git clone' }
}

function guardGitHubCli(ctx: Context): SegmentOutcome {
  let index = 1
  while (index < ctx.words.length && isFlag(ctx.words[index]!.text)) index += GH_VALUE_OPTIONS.has(ctx.words[index]!.text) ? 2 : 1
  const [group, action] = [ctx.words[index]?.text, ctx.words[index + 1]?.text ?? '']
  const args = ctx.words.slice(index + 2)
  if (group === 'pr' && /^(create|new|edit)$/.test(action)) return guardPullRequest(args)
  if (group === 'repo' && action === 'clone') return cloneWithGit(ctx, args)
  return undefined
}

async function guardCommit(ctx: Context, gitDir: string | undefined, args: Word[]): Promise<SegmentOutcome> {
  const subjectProblem = subjectDenial(optionValue(args, 'm', '--message'), 'commit subjects')
  if (subjectProblem) return { deny: subjectProblem }
  if (gitDir === undefined) return undefined
  const email = await ctx.probe(['git', 'config', '--local', 'user.email'], gitDir)
  if (email === undefined || email.exitCode === NOT_A_REPOSITORY || email.stdout.trim() !== '') return undefined
  return {
    deny: 'this repository has no local commit email. Ask the user with AskUserQuestion which email to commit with, then run `git config user.email "<their email>"` and commit again.',
  }
}

function forceWithLease(subcommand: Word, args: Word[]): SegmentOutcome {
  const edits: Edit[] = []
  for (const word of args) {
    if (word.text === '--force' || word.text === '-f') edits.push({ start: word.start, end: word.end, text: '--force-with-lease' })
    else if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(word.text)) edits.push({ start: word.start, end: word.end, text: `${word.text.replace('f', '')} --force-with-lease` })
    else if (word.text.startsWith('+')) edits.push({ start: word.start, end: word.start + 1, text: '' })
  }
  const plusRefspecs = args.filter(w => w.text.startsWith('+'))
  if (plusRefspecs.length > 0 && edits.length === plusRefspecs.length) {
    edits.push({ start: subcommand.end, end: subcommand.end, text: ' --force-with-lease' })
  }
  return edits.length > 0 ? { edits, note: '--force → --force-with-lease' } : undefined
}

function pullWithRebase(subcommand: Word, args: Word[]): SegmentOutcome {
  return args.some(w => PULL_MODES.test(w.text))
    ? undefined
    : { edits: [{ start: subcommand.end, end: subcommand.end, text: ' --rebase' }], note: 'added --rebase' }
}

function httpsRemotes(args: Word[]): SegmentOutcome {
  const edits = args.flatMap(word => {
    const match = SSH_URL_REMOTE.exec(word.text) ?? SSH_SCP_REMOTE.exec(word.text)
    return match ? [{ start: word.start, end: word.end, text: `https://${match[1]}/${match[2]}` }] : []
  })
  return edits.length > 0 ? { edits, note: 'SSH remote → HTTPS' } : undefined
}

function gitRmCached(ctx: Context, subcommand: Word, args: Word[]): SegmentOutcome {
  if (args.some(w => ['--cached', '-n', '--dry-run'].includes(w.text))) return undefined
  const paths = operands(args)
  if (paths.length === 0) return undefined
  return {
    edits: [
      { start: subcommand.end, end: subcommand.end, text: ' --cached' },
      { start: ctx.words.at(-1)!.end, end: ctx.words.at(-1)!.end, text: ` && ${tolerantTrash(paths.map(p => raw(ctx, p)).join(' '))}` },
    ],
    note: 'git rm → git rm --cached + trash',
  }
}

async function guardGit(ctx: Context): Promise<SegmentOutcome> {
  let gitDir = ctx.dir
  let index = 1
  while (index < ctx.words.length && isFlag(ctx.words[index]!.text)) {
    const option = ctx.words[index]!.text
    if (option === '-C') gitDir = resolveDir(gitDir, ctx.words[index + 1]?.text ?? '', ctx.home)
    index += option === '-C' || option === '-c' ? 2 : 1
  }
  const subcommand = ctx.words[index]
  if (!subcommand) return undefined
  const args = ctx.words.slice(index + 1)
  const prefix = ctx.command.slice(ctx.words[0]!.start, subcommand.start)
  const branch = createdBranch(subcommand.text, args)
  const branchProblem = branch === undefined ? undefined : branchDenial(branch)
  if (branchProblem) return { deny: branchProblem }
  switch (subcommand.text) {
    case 'commit':
      return guardCommit(ctx, gitDir, args)
    case 'push':
      return forceWithLease(subcommand, args)
    case 'pull':
      return pullWithRebase(subcommand, args)
    case 'clone':
    case 'remote':
    case 'submodule':
      return httpsRemotes(args)
    case 'rm':
      return gitRmCached(ctx, subcommand, args)
    case 'mv':
      return guardGitMove(ctx, args, gitDir)
    case 'clean':
      return args.some(w => w.text === '--dry-run' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w.text))
        ? undefined
        : { deny: 'git clean deletes untracked files for good. List them with `git clean -n` and the same flags, then move them with `trash`.' }
    case 'checkout':
    case 'restore':
    case 'reset':
    case 'switch':
      return (await discardsChanges(ctx, subcommand.text, args, gitDir)) ? backupBeforeDiscard(ctx, subcommand, prefix) : undefined
    case 'config':
      return args.some(w => w.text === '--global') && args.some(w => w.text.startsWith('user.'))
        ? { deny: 'never set the commit name or email globally. Set it for this repository only with `git config user.email "<chosen>"`.' }
        : undefined
    default:
      return undefined
  }
}

async function existsInRepository(ctx: Context, path: string, dir: string | undefined, kind: '-e' | '-f'): Promise<boolean> {
  if (dir === undefined) return false
  return (await ctx.probe(['/bin/test', kind, path], dir))?.exitCode === 0
}

async function discardsChanges(ctx: Context, subcommand: string, args: Word[], dir: string | undefined): Promise<boolean> {
  const has = (...flags: string[]) => args.some(w => flags.includes(w.text))
  switch (subcommand) {
    case 'restore':
      return !has('-S', '--staged') || has('-W', '--worktree')
    case 'reset':
      return has('--hard')
    case 'switch':
      return has('--discard-changes', '-f', '--force')
    case 'checkout': {
      if (has('-b', '-B', '--orphan')) return false
      if (has('--', '.', '-f', '--force')) return true
      const checks = await Promise.all(operands(args).map(w => existsInRepository(ctx, w.text, dir, '-e')))
      return checks.some(Boolean)
    }
    default:
      return false
  }
}

function backupBeforeDiscard(ctx: Context, subcommand: Word, git: string): SegmentOutcome {
  const label = `craft backup before ${subcommand.text}`
  const at = (commandStart(ctx.segment) ?? ctx.words[0]!).start
  const text = `{ craft_backup=$(${git}stash create "${label}") && { [ -z "$craft_backup" ] || ${git}stash store -m "${label}" "$craft_backup"; }; } && `
  return { edits: [{ start: at, end: at, text }], note: 'saved uncommitted changes to the stash first' }
}

async function trashOverwrittenFile(ctx: Context, destination: Word, dir: string | undefined): Promise<Edit | undefined> {
  if (!(await existsInRepository(ctx, destination.text, dir, '-f'))) return undefined
  const tracked = await ctx.probe(['git', 'ls-files', '--error-unmatch', '--', destination.text], dir!)
  if (tracked?.exitCode === 0) return undefined
  const at = (commandStart(ctx.segment) ?? ctx.words[0]!).start
  return { start: at, end: at, text: `trash ${raw(ctx, destination)} && ` }
}

async function guardGitMove(ctx: Context, args: Word[], dir: string | undefined): Promise<SegmentOutcome> {
  const destination = operands(args).at(-1)
  if (!destination || !args.some(w => w.text === '-f' || w.text === '--force')) return undefined
  const trash = await trashOverwrittenFile(ctx, destination, dir)
  return trash ? { edits: [trash], note: 'trashed the untracked file being overwritten' } : undefined
}

async function isInsideRepository(ctx: Context, destination: string): Promise<boolean> {
  if (destination.startsWith('~')) return false
  if (!destination.startsWith('/')) return true
  const root = await ctx.probe(['git', 'rev-parse', '--show-toplevel'], ctx.dir!)
  const rootPath = root?.stdout.trim()
  return rootPath !== undefined && rootPath !== '' && (destination === rootPath || destination.startsWith(`${rootPath}/`))
}

async function moveToGitMove(ctx: Context): Promise<Rewrite | { deny: string } | undefined> {
  if (ctx.dir === undefined) return undefined
  const flags = ctx.words.slice(1).filter(w => isFlag(w.text))
  if (flags.some(w => w.text !== '-i' && !MV_FLAGS_GIT_KEEPS.has(w.text))) return undefined
  const paths = operands(ctx.words.slice(1))
  const sources = paths.slice(0, -1)
  const destination = paths.at(-1)
  if (sources.length === 0 || !destination) return undefined
  const checks = await Promise.all(sources.map(s => ctx.probe(['git', 'ls-files', '--error-unmatch', '--', s.text], ctx.dir!)))
  const trackedCount = checks.filter(r => r?.exitCode === 0).length
  if (trackedCount === 0 || !(await isInsideRepository(ctx, destination.text))) return undefined
  if (trackedCount < sources.length) {
    return { deny: 'some of these files are tracked by git and some are not. Move the tracked ones with `git mv` and the others with `mv`, in separate commands.' }
  }
  return {
    edits: [
      { start: ctx.words[0]!.start, end: ctx.words[0]!.end, text: 'git mv' },
      ...flags.filter(w => w.text === '-i').map(w => ({ start: w.start - 1, end: w.end, text: '' })),
    ],
    note: 'mv → git mv',
  }
}

async function guardMove(ctx: Context): Promise<SegmentOutcome> {
  const paths = operands(ctx.words.slice(1))
  const destination = paths.at(-1)
  const isNoClobber = ctx.words.some(w => w.text === '-n')
  const trash = paths.length < 2 || !destination || isNoClobber ? undefined : await trashOverwrittenFile(ctx, destination, ctx.dir)
  const move = await moveToGitMove(ctx)
  if (move && 'deny' in move) return move
  const edits = [...(move?.edits ?? []), ...(trash ? [trash] : [])]
  const notes = [move?.note, trash ? 'trashed the untracked file being overwritten' : undefined].filter(note => note !== undefined)
  return edits.length > 0 ? { edits, note: notes.join(', ') } : undefined
}

function isEndlessWait(segment: Segment): boolean {
  if (WAIT_LOOP_KEYWORDS.has(segment.words[0]?.text ?? '')) return true
  const [name, ...args] = commandWords(segment).map(w => w.text)
  switch (baseName(name ?? '')) {
    case 'watch':
      return true
    case 'tail':
      return args.some(arg => TAIL_FOLLOW_FLAG.test(arg))
    case 'sleep':
      return args.some(arg => ENDLESS_SLEEP.test(arg))
    default:
      return false
  }
}

const singleQuoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`

function boundBackgroundWait(command: string): string {
  return `timeout ${BACKGROUND_WAIT_LIMIT_SECONDS} "\${SHELL:-sh}" -c ${singleQuoted(command)}`
}

function guardScript(ctx: Context): SegmentOutcome {
  return DELETION_APIS.test(ctx.command.slice(ctx.segment.start, ctx.segment.end))
    ? { deny: 'no permanent deletes from scripts. Move files to the Trash with the `trash` command instead.' }
    : undefined
}

function writtenFiles(words: Word[], segmentText: string): string[] {
  const name = baseName(words[0]?.text ?? '')
  const args = words.slice(1)
  const paths = operands(args).map(w => w.text)
  if (name === 'tee' || name === 'truncate' || name === 'sponge') return paths
  if (COPY_COMMANDS.has(name)) return paths.length > 1 ? paths.slice(-1) : []
  if ((name === 'sed' || name === 'gsed') && args.some(w => SED_IN_PLACE.test(w.text))) return paths
  if (name === 'perl' && args.some(w => PERL_IN_PLACE.test(w.text))) return paths
  if (name === 'yq' && args.some(w => YQ_IN_PLACE.test(w.text))) return paths
  if (INTERPRETERS.has(name)) return SCRIPT_WRITE_CALLS.flatMap(call => [...segmentText.matchAll(call)].map(match => match[1]!))
  return []
}

function dependencyFileDenial(targets: string[], dir: string | undefined, home: string | undefined): string | undefined {
  for (const target of targets) {
    const path = resolveDir(dir, target, home) ?? target
    if (isDisposable(path) || TEMP_PREFIXES.some(prefix => path.startsWith(prefix))) continue
    const denial = lockfileDenial(path) ?? manifestShellDenial(path)
    if (denial) return denial
  }
  return undefined
}

async function guardCliFirst(ctx: Context): Promise<SegmentOutcome> {
  const outcome = await guardToolchain(ctx.words, ctx.dir, ctx.probe, ctx.home)
  if (!outcome || 'deny' in outcome || 'advice' in outcome) return outcome
  const at = ctx.words[0]!.start
  return { edits: [{ start: at, end: at, text: outcome.prefix }], note: outcome.note }
}

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return `/${parts.join('/')}`
}

async function guardFormatter(ctx: Context): Promise<{ deny: string } | { advice: string } | undefined> {
  const run = formatterRun(ctx.words.map(w => w.text))
  if (!run || ctx.formatting.isAsked || ctx.dir === undefined) return undefined
  const head = await ctx.probe(['git', 'rev-parse', '--verify', '--quiet', 'HEAD'], ctx.dir)
  if (head?.exitCode !== 0) return undefined
  const unchanged = run.targets.filter(target => {
    const path = resolveDir(ctx.dir, target, ctx.home)
    return path === undefined || !ctx.formatting.changedFiles.has(normalizePath(path))
  })
  if (run.targets.length === 0 || unchanged.length > 0) return { deny: formatterDenial(run.tool, unchanged) }
  const checks = await Promise.all(run.targets.map(target => ctx.probe(['git', 'ls-files', '--error-unmatch', '--', target], ctx.dir!)))
  const tracked = run.targets.filter((_, i) => checks[i]?.exitCode === 0)
  return tracked.length > 0 ? { advice: formatterAdvice(run.tool, tracked) } : undefined
}

async function judgeSegment(ctx: Context): Promise<SegmentOutcome> {
  const name = baseName(ctx.words[0]?.text ?? '')
  const mentionsRm = ctx.words.some(w => baseName(w.text) === 'rm')
  if (name === 'rm' || name === 'unlink') return deleteToTrash(ctx)
  if (name === 'git') return guardGit(ctx)
  if (name === 'gh') return guardGitHubCli(ctx)
  if (name === 'mv') return guardMove(ctx)
  if (name === 'find' && (mentionsRm || ctx.words.some(w => w.text === '-delete'))) {
    return { deny: 'no permanent deletes. Pipe the matches to trash instead: `find … -print0 | xargs -0 trash`.' }
  }
  if (name === 'xargs' && mentionsRm) {
    return { deny: 'no permanent deletes. Use `xargs trash` instead of `xargs rm`.' }
  }
  return (INTERPRETERS.has(name) ? guardScript(ctx) : undefined) ?? guardCliFirst(ctx)
}

function applyEdits(command: string, edits: Edit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), command)
}

export async function judgeBash(
  command: string,
  cwd: string | undefined,
  probe: Probe,
  home?: string,
  formatting = NOTHING_ASKED,
  isBackground = false,
): Promise<Verdict> {
  const segments = parseSegments(command)
  const edits: Edit[] = []
  const notes: string[] = []
  const advice: string[] = []
  let dir = cwd
  for (const segment of segments) {
    const words = commandWords(segment)
    const segmentText = command.slice(segment.start, segment.end)
    const writes = [...segment.writes.map(w => w.text), ...writtenFiles(words, segmentText)]
    const fileProblem = dependencyFileDenial(writes, dir, home)
    if (fileProblem) return { kind: 'deny', reason: fileProblem }
    if (words.length === 0) continue
    if (words[0]!.text === 'cd') {
      dir = resolveDir(dir, words[1]?.text ?? '', home)
      continue
    }
    const ctx = { command, segment, words, dir, home, probe, formatting }
    const outcome = await judgeSegment(ctx)
    if (outcome && 'deny' in outcome) return { kind: 'deny', reason: outcome.deny }
    const formatOutcome = await guardFormatter(ctx)
    if (formatOutcome && 'deny' in formatOutcome) return { kind: 'deny', reason: formatOutcome.deny }
    if (formatOutcome) advice.push(formatOutcome.advice)
    if (!outcome) continue
    if ('advice' in outcome) {
      advice.push(outcome.advice)
      continue
    }
    edits.push(...outcome.edits)
    notes.push(outcome.note)
  }
  const edited = applyEdits(command, edits)
  if (isBackground && segments.some(isEndlessWait)) {
    const note = `a background wait never ends on its own → timeout ${BACKGROUND_WAIT_LIMIT_SECONDS} (wrap it in your own \`timeout\` to choose another limit)`
    return { kind: 'rewrite', command: boundBackgroundWait(edited), notes: [...notes, note], advice }
  }
  if (edits.length > 0) return { kind: 'rewrite', command: edited, notes, advice }
  return advice.length > 0 ? { kind: 'advise', advice } : { kind: 'pass' }
}
