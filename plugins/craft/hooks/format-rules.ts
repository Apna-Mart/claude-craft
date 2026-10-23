import { toolIndex, toolName } from './lint-rules'

export type Formatting = { isAsked: boolean; changedFiles: ReadonlySet<string> }
export type FormatterRun = { tool: string; targets: string[] }

type Formatter = { subcommand?: string; writes: (args: string[]) => boolean; isProjectTask?: boolean }

const FORMAT_REQUEST = /\b(re)?format(s|ted|ting|ter|ters)?\b|\bfmt\b|\bprettier\b|\bspotless\w*|\bktlint\w*|\bgofmt\b|\brustfmt\b|\bclang-format\b/i
const FORMAT_SCRIPT = /^(format|fmt|prettify|beautify)(:(?!check).*)?$/
const GRADLE_FORMAT_TASK = /(^|:)(spotlessApply|ktlintFormat|ktfmtFormat|formatKotlin)$/
const MAVEN_FORMAT_GOAL = /^(spotless:apply|fmt:format|com\.spotify\.fmt:fmt-maven-plugin:format)$/
const SCRIPT_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const TASK_RUNNERS = new Set(['make', 'just'])
const NUMBER = /^\d+$/

const has = (args: string[], ...flags: string[]) => args.some(arg => flags.some(flag => arg === flag || (flag.startsWith('--') && arg.startsWith(`${flag}=`))))
const writesOutput = (args: string[]) => !args.some(arg => arg.startsWith('--output') || arg.startsWith('-o'))

const FORMATTERS = new Map<string, Formatter>([
  ['prettier', { writes: args => has(args, '--write', '-w') }],
  ['biome', { writes: args => (args[0] === 'format' || args[0] === 'check') && has(args, '--write', '--fix', '--apply', '--apply-unsafe'), subcommand: '*' }],
  ['ruff', { subcommand: 'format', writes: args => !has(args, '--check', '--diff') }],
  ['black', { writes: args => !has(args, '--check', '--diff') }],
  ['isort', { writes: args => !has(args, '--check-only', '--check', '-c', '--diff') }],
  ['yapf', { writes: args => has(args, '-i', '--in-place') }],
  ['autopep8', { writes: args => has(args, '-i', '--in-place') }],
  ['gofmt', { writes: args => has(args, '-w') }],
  ['goimports', { writes: args => has(args, '-w') }],
  ['go', { subcommand: 'fmt', writes: () => true }],
  ['rustfmt', { writes: args => !has(args, '--check') }],
  ['cargo', { subcommand: 'fmt', writes: args => !has(args, '--check') }],
  ['dart', { subcommand: 'format', writes: writesOutput }],
  ['flutter', { subcommand: 'format', writes: writesOutput }],
  ['swift', { subcommand: 'format', writes: args => has(args, '-i', '--in-place') }],
  ['swift-format', { writes: args => has(args, '-i', '--in-place') }],
  ['swiftformat', { writes: args => !has(args, '--lint', '--dryrun') }],
  ['clang-format', { writes: args => has(args, '-i') }],
  ['ktlint', { writes: args => has(args, '-F', '--format') }],
  ['ktfmt', { writes: args => !has(args, '--dry-run', '-n', '--set-exit-if-changed') }],
  ['dotnet', { subcommand: 'format', writes: args => !has(args, '--verify-no-changes') }],
  ['mix', { subcommand: 'format', writes: args => !has(args, '--check-formatted', '--dry-run') }],
  ['deno', { subcommand: 'fmt', writes: args => !has(args, '--check') }],
  ['terraform', { subcommand: 'fmt', writes: args => !has(args, '-check', '--check') }],
  ['tofu', { subcommand: 'fmt', writes: args => !has(args, '-check', '--check') }],
  ['shfmt', { writes: args => has(args, '-w', '--write') }],
  ['stylua', { writes: args => !has(args, '--check') }],
  ['rubocop', { writes: args => has(args, '-a', '-A', '-x', '--autocorrect', '--autocorrect-all', '--auto-correct', '--fix-layout') }],
  ['standardrb', { writes: args => has(args, '--fix') }],
  ['php-cs-fixer', { subcommand: 'fix', writes: args => !has(args, '--dry-run') }],
  ['buf', { subcommand: 'format', writes: args => has(args, '-w', '--write') }],
  ['gradle', { writes: args => args.some(arg => GRADLE_FORMAT_TASK.test(arg)), isProjectTask: true }],
  ['gradlew', { writes: args => args.some(arg => GRADLE_FORMAT_TASK.test(arg)), isProjectTask: true }],
  ['mvn', { writes: args => args.some(arg => MAVEN_FORMAT_GOAL.test(arg)), isProjectTask: true }],
  ['mvnw', { writes: args => args.some(arg => MAVEN_FORMAT_GOAL.test(arg)), isProjectTask: true }],
])

export const asksToFormat = (text: string) => FORMAT_REQUEST.test(text)

function scriptName(name: string, texts: string[]): string | undefined {
  if (TASK_RUNNERS.has(name)) return texts.slice(1).find(text => FORMAT_SCRIPT.test(text))
  if (!SCRIPT_MANAGERS.has(name)) return undefined
  if (texts[1] === 'run' || texts[1] === 'run-script') return texts[2]
  return name === 'npm' ? undefined : texts[1]
}

function targetsOf(formatter: Formatter, args: string[]): string[] {
  const subcommandAt = formatter.subcommand === undefined ? -1 : formatter.subcommand === '*' ? 0 : args.indexOf(formatter.subcommand)
  return args.slice(subcommandAt + 1).filter(arg => !arg.startsWith('-') && !NUMBER.test(arg))
}

export function formatterRun(texts: string[]): FormatterRun | undefined {
  const name = toolName(texts[0] ?? '')
  const script = scriptName(name, texts)
  if (script !== undefined && FORMAT_SCRIPT.test(script)) return { tool: `${name} ${script}`, targets: [] }
  const at = toolIndex(name, texts) ?? 0
  const tool = toolName(texts[at] ?? '')
  const formatter = FORMATTERS.get(tool)
  const args = texts.slice(at + 1)
  if (formatter === undefined || !formatter.writes(args)) return undefined
  if (formatter.subcommand !== undefined && formatter.subcommand !== '*' && args.find(arg => !arg.startsWith('-')) !== formatter.subcommand) return undefined
  return { tool, targets: formatter.isProjectTask ? [] : targetsOf(formatter, args) }
}

export function formatterDenial(tool: string, unchanged: string[]): string {
  const what = unchanged.length === 0 ? 'the whole project' : `files you did not change (${unchanged.join(', ')})`
  return `${tool} would reformat ${what}. In an existing project, code you did not change keeps its current formatting, so the diff shows only your work. Run the formatter only on the files you changed, naming each one, or across the project only when the user asks for formatting. If formatting more really is needed, ask the user first.`
}

export function formatterAdvice(tool: string, tracked: string[]): string {
  return `craft: ${tool} formats whole files. Check \`git diff -- ${tracked.join(' ')}\` and undo any change to lines you did not edit, so the diff holds only your changes.`
}
