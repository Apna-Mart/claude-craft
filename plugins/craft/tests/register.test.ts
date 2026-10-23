import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NO_OUTPUT = { stdout: '', stderr: '', interrupted: false }
const TYPED = { kind: 'composer' as const }
const SUMMARY = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

function fakeEngine(on: On, commandsRun: string[], isFolderReadable = false) {
  on('session.cwd', () => ({ value: '/repo' }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('process.run', ($, e) => {
    const exitCode = isFolderReadable && e.argv[0] === '/bin/ls' ? 0 : 1
    return { value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    commandsRun.push(e.command)
    return { result: NO_OUTPUT }
  })
}

test('rm reaches the shell as trash and the model is told what ran', async ($, on) => {
  const commandsRun: string[] = []
  fakeEngine(on, commandsRun)
  const ran = await $.tool.call({ tool: 'Bash', command: 'rm -rf old' })
  expect(commandsRun).toEqual(['{ trash old 2>/dev/null || true; }'])
  expect(ran.context?.at(-1)).toContain('trash old')
})

test('a refused command never reaches the shell', async ($, on) => {
  const commandsRun: string[] = []
  fakeEngine(on, commandsRun)
  const ran = await $.tool.call({ tool: 'Bash', command: 'git clean -fd' })
  expect(commandsRun).toEqual([])
  expect(ran.deny).toContain('git clean')
})

test('an endless wait in the background reaches the shell bounded by timeout', async ($, on) => {
  const commandsRun: string[] = []
  fakeEngine(on, commandsRun)
  const ran = await $.tool.call({ tool: 'Bash', command: 'tail -f app.log', run_in_background: true })
  expect(commandsRun).toEqual([`timeout 600 "\${SHELL:-sh}" -c 'tail -f app.log'`])
  expect(ran.context?.at(-1)).toContain('timeout 600')
})

test('the same wait in the foreground runs as written', async ($, on) => {
  const commandsRun: string[] = []
  fakeEngine(on, commandsRun)
  await $.tool.call({ tool: 'Bash', command: 'tail -f app.log' })
  expect(commandsRun).toEqual(['tail -f app.log'])
})

test('a plain command runs unchanged', async ($, on) => {
  const commandsRun: string[] = []
  fakeEngine(on, commandsRun)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(commandsRun).toEqual(['git status'])
})

test('with no JavaScript project npm runs unchanged and the model is told bun is preferred', async ($, on) => {
  const commandsRun: string[] = []
  fakeEngine(on, commandsRun, true)
  const ran = await $.tool.call({ tool: 'Bash', command: 'npm init -y' })
  expect(commandsRun).toEqual(['npm init -y'])
  expect(ran.context?.at(-1)).toContain('bun is preferred over npm')
})

test('an edit to a lockfile is refused', async ($, on) => {
  on('ui.toast', () => ({ value: undefined }))
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/repo/bun.lock', old_string: 'a', new_string: 'b' })
  expect(ran.deny).toContain('lockfile')
})


test('a hand edit to a manifest is put to the person', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  const verdict = await $.tool.check({ tool: 'Edit', input: { file_path: '/repo/package.json', old_string: 'a', new_string: 'b' } })
  expect(verdict.decision).toBe('ask')
  expect(verdict.reason).toContain('package.json')
})

test('a manifest edit already refused stays refused, other files keep their verdict', async ($, on) => {
  on('tool.check', ($, e) => ({ decision: (e.input as { file_path: string }).file_path.endsWith('Cargo.toml') ? 'deny' : 'allow' }))
  expect((await $.tool.check({ tool: 'Write', input: { file_path: '/repo/Cargo.toml', content: '' } })).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Edit', input: { file_path: '/repo/src/main.rs', old_string: 'a', new_string: 'b' } })).decision).toBe('allow')
})

function fakeTasksFolder(on: On, hasTasks = true) {
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.exists', ($, e) => ({ value: hasTasks && e.path === '/repo/TASKS.md' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
}

test('the first prompt beside TASKS.md carries the restore note, later prompts do not', async ($, on) => {
  fakeTasksFolder(on)
  expect((await $.prompt.submit({ text: 'hi', wait: false, origin: TYPED })).context?.join('\n')).toContain('Read TASKS.md')
  expect((await $.prompt.submit({ text: 'again', wait: false, origin: TYPED })).context).toBeUndefined()
})

test('after /clear or a manual summary the next prompt carries the note again', async ($, on) => {
  fakeTasksFolder(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.compact', () => ({ messages: SUMMARY }))
  await $.prompt.submit({ text: 'first', wait: false, origin: TYPED })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect((await $.prompt.submit({ text: 'after clear', wait: false, origin: TYPED })).context?.join('\n')).toContain('Read TASKS.md')
  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  expect((await $.prompt.submit({ text: 'after compact', wait: false, origin: TYPED })).context?.join('\n')).toContain('Read TASKS.md')
})

test('an automatic summary beside TASKS.md ends with the restore note', async ($, on) => {
  fakeTasksFolder(on)
  on('session.compact', () => ({ messages: SUMMARY }))
  const compacted = await $.session.compact({ trigger: 'auto', messages: SUMMARY })
  expect(compacted.messages?.at(-1)?.text).toContain('Read TASKS.md')
  expect(compacted.messages?.length).toBe(2)
})

test('a dropped prompt or a slash command does not use up the note', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.exists', ($, e) => ({ value: e.path === '/repo/TASKS.md' }))
  on('prompt.submit', ($, e) => (e.text === 'blocked' ? { drop: 'blocked by a settings hook' } : { text: e.text, context: e.context }))
  await $.prompt.submit({ text: 'blocked', wait: false, origin: TYPED })
  await $.prompt.submit({ text: '/model', wait: false, origin: TYPED })
  expect((await $.prompt.submit({ text: 'hi', wait: false, origin: TYPED })).context?.join('\n')).toContain('Read TASKS.md')
})

test('the manifest check leaves other tools alone', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/repo/package.json' } })).decision).toBe('allow')
})

test('with no TASKS.md the first prompt carries only the command-line-first note', async ($, on) => {
  const session = mock.session(on)
  fakeTasksFolder(on, false)
  on('session.compact', ($, e) => (e.trigger === 'precompute' ? { messages: SUMMARY } : { skip: 'nothing to compact' }))
  await $.session.compact({ trigger: 'precompute', messages: SUMMARY })
  await $.session.compact({ trigger: 'auto', messages: SUMMARY })
  const notes = (await $.prompt.submit({ text: 'hi', wait: false, origin: TYPED })).context?.join('\n')
  expect(notes).toContain('Command line first')
  expect(notes).toContain('biome for JavaScript and TypeScript linting and formatting')
  expect(notes).toContain('always goes through git; gh is only for GitHub-specific things')
  expect(notes).not.toContain('TASKS.md')
  expect(JSON.stringify(session.appended())).not.toContain('TASKS.md')
})

test('an automatic summary always ends with the command-line-first note', async ($, on) => {
  fakeTasksFolder(on, false)
  on('session.compact', () => ({ messages: SUMMARY }))
  const compacted = await $.session.compact({ trigger: 'auto', messages: SUMMARY })
  expect(compacted.messages?.at(-1)?.text).toContain('Command line first')
  expect(compacted.messages?.at(-1)?.text).not.toContain('TASKS.md')
})

test('a precompute or a skipped summary adds nothing', async ($, on) => {
  fakeTasksFolder(on)
  on('session.compact', ($, e) => (e.trigger === 'precompute' ? { messages: SUMMARY } : { skip: 'nothing to compact' }))
  expect((await $.session.compact({ trigger: 'precompute', messages: SUMMARY })).messages?.length).toBe(1)
  expect((await $.session.compact({ trigger: 'auto', messages: SUMMARY })).skip).toBe('nothing to compact')
})

function fakeExistingRepository(on: On, commandsRun: string[]) {
  on('session.cwd', () => ({ value: '/repo' }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('process.run', ($, e) => {
    const isRepositoryProbe = e.argv[1] === 'rev-parse'
    const stdout = e.argv[2] === '--show-toplevel' ? '/repo\n' : ''
    return { value: { exitCode: isRepositoryProbe ? 0 : 1, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    commandsRun.push(e.command)
    return { result: NO_OUTPUT }
  })
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create', filePath: '/repo/src/new.ts', content: '', structuredPatch: [], originalFile: null } }))
}

test('a project formatter is refused until the user asks, and a file Claude wrote can always be formatted', async ($, on) => {
  const commandsRun: string[] = []
  fakeExistingRepository(on, commandsRun)
  await $.prompt.submit({ text: 'add a login screen', wait: false, origin: TYPED })
  expect((await $.tool.call({ tool: 'Bash', command: 'npx prettier --write .' })).deny).toContain('would reformat')
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'npx prettier --write src/new.ts' })
  await $.prompt.submit({ text: 'now format the whole project', wait: false, origin: TYPED })
  await $.tool.call({ tool: 'Bash', command: 'npx prettier --write .' })
  expect(commandsRun).toEqual(['npx prettier --write src/new.ts', 'npx prettier --write .'])
})
