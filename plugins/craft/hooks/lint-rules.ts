import type { Probe } from './bash-rules'
import type { Level, ToolchainOutcome } from './cli-first'
import type { Word } from './shell'

type SettingsFile = { file: string; pattern: string; read: (match: string) => string | undefined }
type Family = {
  id: 'js' | 'python'
  label: string
  preferred: string
  usage: string
  configs: Map<string, string[]>
  settingsFiles: SettingsFile[]
}
export type LintInvocation = { tool: string; family: Family }

const JS_FAMILY: Family = {
  id: 'js',
  label: 'JavaScript',
  preferred: 'biome',
  usage: '`bunx @biomejs/biome check --write <files>` for a one-off, or `bun add -d @biomejs/biome` then `bunx biome init` for a project',
  configs: new Map([
    ['biome', ['biome.json', 'biome.jsonc']],
    ['eslint', ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml']],
    ['prettier', ['.prettierrc', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.toml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts']],
  ]),
  settingsFiles: [
    {
      file: 'package.json',
      pattern: '"(@biomejs/biome|eslint|prettier|eslintConfig)"[[:space:]]*:',
      read: match => {
        const key = /"([^"]+)"/.exec(match)?.[1]
        return key === '@biomejs/biome' ? 'biome' : key === 'eslintConfig' ? 'eslint' : key
      },
    },
  ],
}

const PYTHON_FAMILY: Family = {
  id: 'python',
  label: 'Python',
  preferred: 'ruff',
  usage: '`uvx ruff check --fix <files>` and `uvx ruff format <files>` for a one-off, or `uv add --dev ruff` then `uv run ruff check` for a project',
  configs: new Map([
    ['ruff', ['ruff.toml', '.ruff.toml']],
    ['black', []],
    ['isort', ['.isort.cfg']],
    ['flake8', ['.flake8']],
    ['pylint', ['.pylintrc', 'pylintrc']],
    ['yapf', ['.style.yapf']],
  ]),
  settingsFiles: [
    { file: 'pyproject.toml', pattern: '^\\[tool\\.(ruff|black|isort|pylint|yapf)', read: match => match.slice('[tool.'.length) },
    { file: 'setup.cfg', pattern: '^\\[(flake8|isort|pylint)', read: match => match.slice(1) },
    { file: 'tox.ini', pattern: '^\\[(flake8|isort|pylint)', read: match => match.slice(1) },
  ],
}

const FAMILY_OF_TOOL = new Map<string, Family>([
  ...[...JS_FAMILY.configs.keys()].map(tool => [tool, JS_FAMILY] as const),
  ...[...PYTHON_FAMILY.configs.keys()].map(tool => [tool, PYTHON_FAMILY] as const),
])
const PACKAGE_RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'uvx'])
const EXEC_SUBCOMMANDS = new Set(['exec', 'dlx', 'x'])
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const SCRIPT_RUNNERS = new Set(['uv', 'poetry', 'pdm', 'pipenv', 'pipx'])
const PYTHON = /^python(3(\.\d+)?)?$/

function firstOperand(texts: string[], from: number): number {
  let i = from
  while (i < texts.length && texts[i]!.startsWith('-')) i++
  return i
}

export function toolIndex(name: string, texts: string[]): number | undefined {
  if (FAMILY_OF_TOOL.has(name)) return 0
  if (PACKAGE_RUNNERS.has(name)) return firstOperand(texts, 1)
  if (PACKAGE_MANAGERS.has(name)) return EXEC_SUBCOMMANDS.has(texts[1] ?? '') ? firstOperand(texts, 2) : name === 'yarn' ? 1 : undefined
  if (SCRIPT_RUNNERS.has(name) && texts[1] === 'tool' && texts[2] === 'run') return firstOperand(texts, 3)
  if (SCRIPT_RUNNERS.has(name) && texts[1] === 'run') return firstOperand(texts, 2)
  if (PYTHON.test(name) && texts[1] === '-m') return 2
  return undefined
}

export function toolName(spec: string): string {
  const bare = spec.replace(/(?!^)@.*$/, '')
  return bare === '@biomejs/biome' ? 'biome' : (bare.split('/').at(-1) ?? bare)
}

export function lintInvocation(words: Word[]): LintInvocation | undefined {
  const texts = words.map(w => w.text)
  const at = toolIndex(toolName(texts[0] ?? ''), texts)
  const tool = at === undefined ? undefined : toolName(texts[at] ?? '')
  const family = tool === undefined ? undefined : FAMILY_OF_TOOL.get(tool)
  return tool !== undefined && family !== undefined ? { tool, family } : undefined
}

async function configuredTools(family: Family, levels: Level[], probe: Probe): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  for (const level of levels) {
    for (const [tool, files] of family.configs) {
      const file = files.find(name => level.names.has(name))
      if (file && !found.has(tool)) found.set(tool, `${file} in ${level.path}`)
    }
  }
  for (const { file, pattern, read } of family.settingsFiles) {
    const level = levels.find(candidate => candidate.names.has(file))
    if (!level) continue
    const result = await probe(['/usr/bin/grep', '-ohE', pattern, file], level.path)
    for (const match of result?.exitCode === 0 ? result.stdout.split('\n') : []) {
      const tool = read(match)
      if (tool && family.configs.has(tool) && !found.has(tool)) found.set(tool, `${file} in ${level.path}`)
    }
  }
  return found
}

function conflictsWith(tool: string, preferred: string, configured: Map<string, string>): string[] {
  if (tool === preferred) return configured.has(preferred) ? [] : [...configured.keys()]
  return configured.has(preferred) && !configured.has(tool) ? [preferred] : []
}

export async function judgeLint({ tool, family }: LintInvocation, levels: Level[], probe: Probe, isGreenfield: boolean): Promise<ToolchainOutcome> {
  const configured = await configuredTools(family, levels, probe)
  if (configured.size === 0) {
    if (!isGreenfield || tool === family.preferred) return undefined
    return { advice: `craft recommendation: there is no ${family.label} project here. For a new project or a one-off, ${family.preferred} is preferred over ${tool} for linting and formatting: ${family.usage}. Keep ${tool} if it was chosen on purpose.` }
  }
  const conflicts = conflictsWith(tool, family.preferred, configured)
  if (conflicts.length === 0) return undefined
  const where = conflicts.map(name => `${name} (${configured.get(name)})`).join(', ')
  return { deny: `this project already uses ${where} for linting and formatting, so run that instead of ${tool}.` }
}
