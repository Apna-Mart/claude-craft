import type { Probe } from './bash-rules'
import { judgeLint, lintInvocation } from './lint-rules'
import type { Word } from './shell'

export type ToolchainOutcome = { deny: string } | { prefix: string; note: string } | { advice: string } | undefined

type JsTool = 'bun' | 'npm' | 'pnpm' | 'yarn'
type PythonTool = 'uv' | 'poetry' | 'pipenv' | 'pdm' | 'rye' | 'hatch' | 'pip'
export type Level = { path: string; names: Set<string> }
type Marker = { marker: string; level: string }
type Found<T> = Marker & { tool: T }
type Detected<T> = Found<T> | 'greenfield' | 'undecided'
type Judge = (words: Word[], name: string, levels: Level[]) => ToolchainOutcome

const READ_ONLY = new Set([
  'view', 'info', 'show', 'v', 'search', 'whoami', 'login', 'logout', 'publish', 'pack', 'config', 'help', 'ls', 'list',
  'outdated', 'audit', 'why', 'doctor', 'freeze', 'check', 'tree', 'index', 'inspect', 'cache', '--version', '-v', '-V',
  '--help', '-h',
])
const DIR_OPTIONS = ['--prefix', '-C', '--dir', '--cwd', '--directory', '--project']
const BUN_EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print'])
const UV_OUTSIDE_PROJECT_FLAGS = new Set(['--no-project', '--script'])
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/
const SOURCE_FILE = /\.(c|cc|cpp|cxx|m|mm|rs|java|kt|swift|cs|scala|hs|ex)$/
const PYTHON = /^python(3(\.\d+)?)?$/
const PIP = /^pip3?(\.\d+)?$/

const JS_COMMANDS = new Map<string, JsTool>([
  ['npm', 'npm'], ['npx', 'npm'], ['yarn', 'yarn'], ['pnpm', 'pnpm'], ['pnpx', 'pnpm'], ['bun', 'bun'], ['bunx', 'bun'],
])
const JS_RUNNERS = new Set(['npx', 'pnpx', 'bunx'])
const JS_LOCKFILES = new Map<string, JsTool>([
  ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
])
const JS_USAGE = new Map<JsTool, string>([
  ['bun', '`bun install`, `bun add <pkg>`, `bun remove <pkg>`, `bun run <script>`, `bunx <tool>`'],
  ['npm', '`npm install`, `npm install <pkg>`, `npm uninstall <pkg>`, `npm run <script>`, `npx <tool>`'],
  ['pnpm', '`pnpm install`, `pnpm add <pkg>`, `pnpm remove <pkg>`, `pnpm run <script>`, `pnpm exec <tool>` for a project tool, `pnpm dlx <tool>` for a one-off'],
  ['yarn', '`yarn install`, `yarn add <pkg>`, `yarn remove <pkg>`, `yarn run <script>`, `yarn exec <tool>` for a project tool, `yarn dlx <tool>` for a one-off'],
])

const PYTHON_LOCKFILES = new Map<string, PythonTool>([
  ['uv.lock', 'uv'], ['poetry.lock', 'poetry'], ['Pipfile.lock', 'pipenv'], ['Pipfile', 'pipenv'], ['pdm.lock', 'pdm'],
  ['requirements.lock', 'rye'], ['hatch.toml', 'hatch'],
])
const PYTHON_UNDECIDED = ['pyproject.toml', '.venv']
const PIP_PROJECT = /^(requirements.*\.(txt|in)|requirements|environment\.ya?ml|manage\.py|setup\.py|setup\.cfg|venv)$/
const PYTHON_MANAGERS = new Set(['uv', 'uvx', 'poetry', 'pipenv', 'pdm', 'rye', 'hatch'])
const UV_PROJECT_CHANGES = new Set(['add', 'remove', 'lock', 'sync', 'init'])
const PYTHON_USAGE = new Map<PythonTool, string>([
  ['uv', '`uv add <pkg>`, `uv remove <pkg>`, `uv sync`, `uv run python <file>`, `uv venv`'],
  ['poetry', '`poetry add <pkg>`, `poetry remove <pkg>`, `poetry install`, `poetry run python <file>`'],
  ['pipenv', '`pipenv install <pkg>`, `pipenv uninstall <pkg>`, `pipenv sync`, `pipenv run python <file>`'],
  ['pdm', '`pdm add <pkg>`, `pdm remove <pkg>`, `pdm install`, `pdm run python <file>`'],
  ['rye', '`rye add <pkg>`, `rye remove <pkg>`, `rye sync`, `rye run python <file>`'],
  ['hatch', '`hatch run <script>`, `hatch env create`'],
  ['pip', '`pip install -r <requirements file>`, `python <file>`'],
])
const UV_ONE_OFF = 'For a one-off script outside the project, use `uv run --no-project --with <pkg> python <file>` or `uvx <tool>`.'

const GRADLE_MARKERS = ['gradlew', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
const C_COMPILERS = ['gcc', 'g++', 'cc', 'c++', 'clang', 'clang++']
const WRAPPED_TOOLS = new Set(['gradle', 'mvn'])
const BUILD_SYSTEMS = [
  { commands: ['gradle'], markers: ['gradlew'], use: "`./gradlew <task>`, the project's own Gradle, one task per call" },
  { commands: ['mvn'], markers: ['mvnw'], use: "`./mvnw <phase>`, the project's own Maven" },
  { commands: ['gem'], markers: ['Gemfile'], use: '`bundle add <gem>`, `bundle install`, `bundle exec <tool>`' },
  { commands: ['javac', 'kotlinc'], markers: GRADLE_MARKERS, use: '`./gradlew <task>`, one task per call' },
  { commands: ['javac', 'kotlinc'], markers: ['pom.xml'], use: '`mvn <phase>`, or `./mvnw <phase>` when the project has it' },
  { commands: ['rustc'], markers: ['Cargo.toml'], use: '`cargo build`, `cargo run`, `cargo test`' },
  { commands: C_COMPILERS, markers: ['xmake.lua'], use: '`xmake`, `xmake run`' },
  { commands: C_COMPILERS, markers: ['CMakeLists.txt'], use: '`cmake --build <build folder>`' },
  { commands: ['swiftc'], markers: ['Package.swift'], use: '`swift build`, `swift run`, `swift test`' },
  { commands: ['csc'], markers: ['*.csproj', '*.sln'], use: '`dotnet build`, `dotnet run`, `dotnet test`' },
  { commands: ['scalac'], markers: ['build.sbt'], use: '`sbt compile`, `sbt run`, `sbt test`' },
  { commands: ['ghc'], markers: ['stack.yaml', 'cabal.project', '*.cabal'], use: '`cabal build` or `stack build`, whichever the project uses' },
  { commands: ['elixirc'], markers: ['mix.exs'], use: '`mix compile`, `mix test`' },
]
const BUILD_COMMANDS = new Set(BUILD_SYSTEMS.flatMap(system => system.commands))

function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

async function levelsUp(dir: string, probe: Probe, home: string | undefined): Promise<Level[] | undefined> {
  const start = normalize(dir)
  const top = await probe(['git', 'rev-parse', '--show-toplevel'], start)
  const repositoryTop = top?.exitCode === 0 ? top.stdout.trim() : undefined
  const paths = [start]
  for (let path = start; ; ) {
    const parent = parentOf(path)
    const isAbove = repositoryTop === undefined ? parent === '/' || parent === home : !path.startsWith(`${repositoryTop}/`)
    if (isAbove) break
    paths.push(parent)
    path = parent
  }
  const listings = await Promise.all(paths.map(path => probe(['/bin/ls', '-A'], path)))
  if (listings.some(listing => listing?.exitCode !== 0)) return undefined
  return paths.map((path, i) => ({ path, names: new Set(listings[i]!.stdout.split('\n').filter(Boolean)) }))
}

const matchesMarker = (name: string, marker: string) => (marker.startsWith('*.') ? name.endsWith(marker.slice(1)) : name === marker)

function findMarker(levels: Level[], markers: readonly string[]): Marker | undefined {
  for (const level of levels) {
    for (const marker of markers) {
      const name = [...level.names].find(candidate => matchesMarker(candidate, marker))
      if (name) return { marker: name, level: level.path }
    }
  }
  return undefined
}

function findMatching(levels: Level[], pattern: RegExp): Marker | undefined {
  for (const level of levels) {
    const marker = [...level.names].find(name => pattern.test(name))
    if (marker) return { marker, level: level.path }
  }
  return undefined
}

function findTool<T>(levels: Level[], lockfiles: Map<string, T>): Found<T> | undefined {
  const found = findMarker(levels, [...lockfiles.keys()])
  return found && { ...found, tool: lockfiles.get(found.marker)! }
}

function detectJs(levels: Level[]): Detected<JsTool> {
  return findTool(levels, JS_LOCKFILES) ?? (findMarker(levels, ['package.json']) ? 'undecided' : 'greenfield')
}

function detectPython(levels: Level[]): Detected<PythonTool> {
  const locked = findTool(levels, PYTHON_LOCKFILES)
  if (locked) return locked
  if (findMarker(levels, PYTHON_UNDECIDED)) return 'undecided'
  const plain = findMatching(levels, PIP_PROJECT)
  return plain ? { ...plain, tool: 'pip' } : 'greenfield'
}

const located = (found: Marker) => `${found.marker} in ${found.level}`

function optionAt(args: Word[], i: number): string | undefined {
  const text = args[i]!.text
  if (DIR_OPTIONS.includes(text)) return args[i + 1]?.text
  const attached = DIR_OPTIONS.find(option => option.startsWith('--') && text.startsWith(`${option}=`))
  return attached && text.slice(attached.length + 1)
}

function subcommandOf(args: Word[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const text = args[i]!.text
    if (DIR_OPTIONS.includes(text)) i++
    else if (!text.startsWith('-')) return text
  }
  return undefined
}

function targetDir(args: Word[], dir: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const value = optionAt(args, i)
    if (value === undefined) continue
    if (value.startsWith('~') || value.includes('$')) return undefined
    return value.startsWith('/') ? value : `${dir}/${value}`
  }
  return dir
}

const runsBunScript = (args: Word[]) =>
  args.some(w => BUN_EVAL_FLAGS.has(w.text) || (!w.text.startsWith('-') && SCRIPT_FILE.test(w.text)))

const judgeJs: Judge = (words, name, levels) => {
  const args = words.slice(1)
  if (!JS_RUNNERS.has(name)) {
    const sub = subcommandOf(args)
    if (READ_ONLY.has(args[0]?.text ?? '') || (sub !== undefined && READ_ONLY.has(sub))) return undefined
    if (sub === undefined && name !== 'yarn') return undefined
    if (name === 'bun' && runsBunScript(args)) return undefined
  }
  const detected = detectJs(levels)
  if (detected === 'undecided') return undefined
  const expected = detected === 'greenfield' ? 'bun' : detected.tool
  if (expected === JS_COMMANDS.get(name)) return undefined
  if (detected === 'greenfield') {
    return { advice: `craft recommendation: there is no JavaScript project here. For a new project or a one-off, bun is preferred over ${name}: \`bun init\`, \`bun add <pkg>\`, \`bunx <tool>\`, \`bun create <template>\`. Keep ${name} if it was chosen on purpose.` }
  }
  return { deny: `this project uses ${expected} (${located(detected)}), so use it instead of ${name}: ${JS_USAGE.get(expected)}.` }
}

function pythonDenial(detected: Found<PythonTool>, used: string): ToolchainOutcome {
  const oneOff = detected.tool === 'uv' ? '' : ` ${UV_ONE_OFF}`
  return { deny: `this project uses ${detected.tool} (${located(detected)}), so use it instead of ${used}: ${PYTHON_USAGE.get(detected.tool)}.${oneOff}` }
}

function judgeUv(words: Word[], name: string, detected: Found<PythonTool>): ToolchainOutcome {
  const args = words.slice(1)
  if (name === 'uvx' || args.some(w => UV_OUTSIDE_PROJECT_FLAGS.has(w.text))) return undefined
  const sub = subcommandOf(args) ?? ''
  const changesProject = UV_PROJECT_CHANGES.has(sub) || (sub === 'run' && detected.tool !== 'pip')
  return changesProject ? pythonDenial(detected, `uv ${sub}`) : undefined
}

function startsPythonSetup(words: Word[], name: string, module: string | undefined): boolean {
  if (PIP.test(name) || module === 'pip') {
    const sub = words[module === 'pip' ? 3 : 1]?.text
    return sub !== undefined && !READ_ONLY.has(sub)
  }
  if (module === 'venv') return true
  const sub = subcommandOf(words.slice(1))
  return PYTHON_MANAGERS.has(name) && !name.startsWith('uv') && sub !== undefined && !READ_ONLY.has(sub)
}

const judgePython: Judge = (words, name, levels) => {
  const detected = detectPython(levels)
  if (detected === 'undecided') return undefined
  const isPython = PYTHON.test(name)
  const module = isPython && words[1]?.text === '-m' ? words[2]?.text : undefined
  if (detected === 'greenfield') {
    return startsPythonSetup(words, name, module)
      ? { advice: 'craft recommendation: there is no Python project here. For a new project or a one-off script, uv is preferred: `uv init` then `uv add <pkg>`, `uv run --with <pkg> python <file>`, `uv venv`. Keep the current tool if it was chosen on purpose.' }
      : undefined
  }
  const expected = detected.tool
  if (PIP.test(name) || module === 'pip') {
    const sub = words[module === 'pip' ? 3 : 1]?.text
    if (sub === undefined || READ_ONLY.has(sub) || expected === 'pip' || expected === 'hatch') return undefined
    return pythonDenial(detected, 'pip')
  }
  if (isPython) {
    if (expected !== 'uv' || words[0]!.text !== name) return undefined
    if (module === 'venv') return pythonDenial(detected, 'python -m venv')
    return { prefix: 'uv run ', note: `${name} → uv run ${name}` }
  }
  if (name === 'uv' || name === 'uvx') return expected === 'uv' ? undefined : judgeUv(words, name, detected)
  const sub = subcommandOf(words.slice(1))
  if (name === expected || sub === undefined || READ_ONLY.has(sub)) return undefined
  return pythonDenial(detected, name)
}

const isInside = (path: string, dir: string) => (path.startsWith('/') ? path.startsWith(`${dir}/`) : !path.startsWith('~'))

function buildsProject(name: string, args: Word[], projectDir: string): boolean {
  if (WRAPPED_TOOLS.has(name)) return args.length > 0 && !READ_ONLY.has(args[0]!.text)
  if (name === 'gem') return args[0]?.text === 'install' && args[1]?.text !== 'bundler'
  return args.some(w => SOURCE_FILE.test(w.text) && isInside(w.text, projectDir))
}

const judgeBuild: Judge = (words, name, levels) => {
  const args = words.slice(1)
  for (const system of BUILD_SYSTEMS) {
    if (!system.commands.includes(name)) continue
    const found = findMarker(levels, system.markers)
    if (found && buildsProject(name, args, found.level)) {
      return { deny: `this project uses ${located(found)}, so go through its own command instead of running ${name} directly: ${system.use}.` }
    }
  }
  return undefined
}

function judgeFor(name: string): Judge | undefined {
  if (JS_COMMANDS.has(name)) return judgeJs
  if (PYTHON.test(name) || PIP.test(name) || PYTHON_MANAGERS.has(name)) return judgePython
  if (BUILD_COMMANDS.has(name)) return judgeBuild
  return undefined
}

const isGreenfield = (family: 'js' | 'python', levels: Level[]) =>
  (family === 'js' ? detectJs(levels) : detectPython(levels)) === 'greenfield'

export async function guardToolchain(words: Word[], dir: string | undefined, probe: Probe, home?: string): Promise<ToolchainOutcome> {
  const name = words[0]?.text.split('/').at(-1) ?? ''
  const judge = judgeFor(name)
  const lint = lintInvocation(words)
  if ((!judge && !lint) || dir === undefined) return undefined
  const takesDirOption = JS_COMMANDS.has(name) || PYTHON_MANAGERS.has(name)
  const projectDir = takesDirOption ? targetDir(words.slice(1), dir) : dir
  if (projectDir === undefined) return undefined
  const levels = await levelsUp(projectDir, probe, home)
  if (!levels) return undefined
  const toolOutcome = judge?.(words, name, levels)
  if (toolOutcome && 'deny' in toolOutcome) return toolOutcome
  const lintOutcome = lint && (await judgeLint(lint, levels, probe, isGreenfield(lint.family.id, levels)))
  if (lintOutcome && 'deny' in lintOutcome) return lintOutcome
  if (toolOutcome && 'prefix' in toolOutcome) return toolOutcome
  const advice = [toolOutcome, lintOutcome].flatMap(outcome => (outcome && 'advice' in outcome ? [outcome.advice] : []))
  return advice.length > 0 ? { advice: advice.join('\n') } : undefined
}
