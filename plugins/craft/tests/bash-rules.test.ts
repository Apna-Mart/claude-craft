import { describe, expect, test } from 'claude-code/testing'
import { judgeBash, type Probe, type Verdict } from '../hooks/bash-rules'
import { lockfileDenial, manifestAsk } from '../hooks/file-rules'
import { asksToFormat } from '../hooks/format-rules'

type Repo = {
  email?: string
  name?: string
  tracked?: string[]
  files?: string[]
  isRepository?: boolean
  hasCommits?: boolean
  listings?: Record<string, string[]>
  contents?: Record<string, string>
}

function fakeGrep(pattern: string, text: string | undefined) {
  const matches = text?.match(new RegExp(pattern.replace('[[:space:]]', '\\s'), 'gm')) ?? []
  return { exitCode: matches.length > 0 ? 0 : 1, stdout: matches.join('\n') }
}

function fakeHost({ email = 'me@example.com', name = 'Ana Example', tracked = [], files = [], isRepository = true, hasCommits = true, listings, contents = {} }: Repo = {}): Probe {
  return async (argv, cwd) => {
    if (argv[0] === '/bin/ls') return listings ? { exitCode: 0, stdout: (listings[cwd] ?? []).join('\n') } : { exitCode: 1, stdout: '' }
    if (argv[0] === '/usr/bin/grep') return fakeGrep(argv[2] ?? '', contents[`${cwd}/${argv[3]}`])
    if (argv[0] === '/bin/test') return { exitCode: files.includes(argv[2] ?? '') ? 0 : 1, stdout: '' }
    const rest = argv.slice(1)
    if (!isRepository) return { exitCode: 128, stdout: '' }
    if (rest[0] === 'config' && rest[2] === 'user.email') return email ? { exitCode: 0, stdout: `${email}\n` } : { exitCode: 1, stdout: '' }
    if (rest[0] === 'config' && rest[2] === 'user.name') return name ? { exitCode: 0, stdout: `${name}\n` } : { exitCode: 1, stdout: '' }
    if (rest[0] === 'rev-parse' && rest[1] === '--verify') return { exitCode: hasCommits ? 0 : 1, stdout: '' }
    if (rest[0] === 'rev-parse') return { exitCode: 0, stdout: '/repo\n' }
    if (rest[0] === 'ls-files') return { exitCode: tracked.includes(rest.at(-1) ?? '') ? 0 : 1, stdout: '' }
    return { exitCode: 1, stdout: '' }
  }
}

const judge = (command: string, repo?: Repo) => judgeBash(command, '/repo', fakeHost(repo), '/Users/me')
const judgeInBackground = (command: string) => judgeBash(command, '/repo', fakeHost(), '/Users/me', undefined, true)
const rewritten = (verdict: Verdict) => (verdict.kind === 'rewrite' ? verdict.command : verdict.kind)
const advised = (verdict: Verdict) => (verdict.kind === 'advise' ? verdict.advice.join('\n') : verdict.kind)
const denied = (verdict: Verdict) => (verdict.kind === 'deny' ? verdict.reason : verdict.kind)

describe('deleting', () => {
  test('rm -rf becomes a trash that tolerates a missing path', async () => {
    expect(rewritten(await judge('rm -rf src/old'))).toBe('{ trash src/old 2>/dev/null || true; }')
  })
  test('rm after cd keeps the cd and every path', async () => {
    expect(rewritten(await judge('cd app && rm a.txt "b c.txt"'))).toBe('cd app && trash a.txt "b c.txt"')
  })
  test('unlink becomes trash', async () => {
    expect(rewritten(await judge('unlink f'))).toBe('trash f')
  })
  test('rm inside build and cache folders or the scratch folder runs as written', async () => {
    expect((await judge('rm -rf node_modules')).kind).toBe('pass')
    expect((await judge('rm -rf app/build/out')).kind).toBe('pass')
    expect((await judge('rm /private/tmp/claude-502/x.txt')).kind).toBe('pass')
  })
  test('rm mixing a cache path with a real path is trashed', async () => {
    expect(rewritten(await judge('rm dist src'))).toBe('trash dist src')
  })
  test('rm named inside a string is not a command', async () => {
    expect((await judge('echo "rm -rf /"')).kind).toBe('pass')
  })
  test('rm after a semicolon is still caught', async () => {
    expect(rewritten(await judge('echo hi; rm x'))).toBe('echo hi; trash x')
  })
  test('a heredoc line that starts with rm is text, not a command', async () => {
    expect((await judge("cat <<'EOF' > notes.txt\nrm the cache\nEOF")).kind).toBe('pass')
  })
  test('git rm untracks and trashes', async () => {
    expect(rewritten(await judge('git rm -r docs'))).toBe('git rm --cached -r docs && { trash docs 2>/dev/null || true; }')
  })
  test('git rm --cached runs as written', async () => {
    expect((await judge('git rm --cached x')).kind).toBe('pass')
  })
  test('find -delete, find -exec rm and xargs rm are refused', async () => {
    expect(denied(await judge("find . -name '*.tmp' -delete"))).toContain('trash')
    expect(denied(await judge("find . -name '*.tmp' -exec rm {} +"))).toContain('trash')
    expect(denied(await judge('ls | xargs rm'))).toContain('xargs trash')
  })
  test('a script deleting files is refused, a search for the same call is not', async () => {
    expect(denied(await judge(`python3 -c "import shutil; shutil.rmtree('x')"`))).toContain('trash')
    expect((await judge('grep -rn shutil.rmtree src')).kind).toBe('pass')
  })
})

describe('attribution', () => {
  const heredocCommit = [
    `git commit -m "$(cat <<'EOF'`,
    'feat(hooks): add guards',
    '',
    'Ref: https://example.com/1',
    '',
    'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
    'EOF',
    ')"',
  ].join('\n')

  test('a Claude co-author trailer in a heredoc commit stays', async () => {
    expect((await judge(heredocCommit)).kind).toBe('pass')
  })
  test('a Claude co-author trailer in a separate -m stays', async () => {
    expect((await judge('git commit -m "fix(core): x" -m "Co-Authored-By: Claude <noreply@anthropic.com>"')).kind).toBe('pass')
  })
  test('a human co-author stays', async () => {
    expect((await judge('git commit -m "fix(core): x" -m "Co-Authored-By: Ana <ana@example.com>"')).kind).toBe('pass')
  })
  test('the generated-with footer in a pull request body stays', async () => {
    expect((await judge("gh pr create --title \"docs(readme): t\" --body \"$(cat <<'EOF'\n## Issue\nx\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\nEOF\n)\"")).kind).toBe('pass')
  })
})

describe('commit identity', () => {
  test('a repository with no local email is refused until the user gives theirs', async () => {
    const reason = denied(await judge('git commit -m "fix(core): x"', { email: '' }))
    expect(reason).toContain('AskUserQuestion')
    expect(reason).toContain('git config user.email')
    expect(reason).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]+/)
  })
  test('the commit name is left as the user set it', async () => {
    expect((await judge('git commit -m "fix(core): x"', { name: 'Ana Example' })).kind).toBe('pass')
    expect((await judge('git -C sub commit -m "fix(core): x"', { name: '' })).kind).toBe('pass')
  })
  test('outside a repository the commit is left to git', async () => {
    expect((await judge('git commit -m "fix(core): x"', { isRepository: false })).kind).toBe('pass')
  })
  test('a setup commit runs as written', async () => {
    expect((await judge('git commit -m "fix(core): x"')).kind).toBe('pass')
  })
})

describe('git safety', () => {
  test('--force and -f become --force-with-lease', async () => {
    expect(rewritten(await judge('git push --force origin main'))).toBe('git push --force-with-lease origin main')
    expect(rewritten(await judge('git push -uf origin x'))).toBe('git push -u --force-with-lease origin x')
  })
  test('--force-with-lease runs as written', async () => {
    expect((await judge('git push --force-with-lease')).kind).toBe('pass')
  })
  test('pull gains --rebase unless a mode is chosen', async () => {
    expect(rewritten(await judge('git pull'))).toBe('git pull --rebase')
    expect(rewritten(await judge('git -C repo pull origin main'))).toBe('git -C repo pull --rebase origin main')
    expect((await judge('git pull --ff-only')).kind).toBe('pass')
  })
  test('SSH remotes become HTTPS', async () => {
    expect(rewritten(await judge('git remote add origin git@github.com:octo-org/craft.git'))).toBe('git remote add origin https://github.com/octo-org/craft.git')
    expect(rewritten(await judge('git clone ssh://git@github.com/a/b.git'))).toBe('git clone https://github.com/a/b.git')
  })
  test('a global commit identity is refused, a local one is not', async () => {
    expect(denied(await judge('git config --global user.email a@b.c'))).toContain('globally')
    expect((await judge('git config user.email a@b.c')).kind).toBe('pass')
  })
})

describe('moving files', () => {
  test('a tracked file moves with git mv', async () => {
    expect(rewritten(await judge('mv a.ts b.ts', { tracked: ['a.ts'] }))).toBe('git mv a.ts b.ts')
  })
  test('an untracked file moves with mv', async () => {
    expect((await judge('mv a.ts b.ts')).kind).toBe('pass')
  })
  test('tracked and untracked together are refused', async () => {
    expect(denied(await judge('mv a.ts new.txt dir/', { tracked: ['a.ts'] }))).toContain('git mv')
  })
})

describe('waiting', () => {
  test('a bare sleep runs', async () => {
    expect((await judge('sleep 5 && curl localhost')).kind).toBe('pass')
  })
  test('a foreground polling loop runs as written, because the Bash tool already limits its time', async () => {
    expect((await judge('until curl -s localhost; do sleep 1; done')).kind).toBe('pass')
  })
  test('an endless background loop is bounded by timeout', async () => {
    expect(rewritten(await judgeInBackground('while true; do curl -s localhost; sleep 5; done'))).toBe(
      `timeout 600 "\${SHELL:-sh}" -c 'while true; do curl -s localhost; sleep 5; done'`,
    )
  })
  test('tail -f, watch and sleep infinity in the background are bounded by timeout', async () => {
    for (const command of ['tail -f app.log', 'tail -n 20 -F app.log', 'watch -n 1 ls', 'sleep infinity']) {
      expect(rewritten(await judgeInBackground(command))).toBe(`timeout 600 "\${SHELL:-sh}" -c '${command}'`)
    }
  })
  test('single quotes survive the bound', async () => {
    expect(rewritten(await judgeInBackground("until grep -q 'ready' app.log; do sleep 1; done"))).toBe(
      `timeout 600 "\${SHELL:-sh}" -c 'until grep -q '\\''ready'\\'' app.log; do sleep 1; done'`,
    )
  })
  test('other rewrites happen inside the bound', async () => {
    expect(rewritten(await judgeInBackground('rm -rf old; while true; do sleep 1; done'))).toBe(
      `timeout 600 "\${SHELL:-sh}" -c '{ trash old 2>/dev/null || true; }; while true; do sleep 1; done'`,
    )
  })
  test('a background command that already has a timeout, or does not wait, runs as written', async () => {
    for (const command of ['timeout 60 tail -f app.log', 'tail -n 20 app.log', 'for f in a b; do echo $f; done', 'sleep 30']) {
      expect((await judgeInBackground(command)).kind).toBe('pass')
    }
  })
})

describe('plain commands', () => {
  test('pipes and redirects pass untouched', async () => {
    expect((await judge('ls -la 2>&1 | head -5 && git status')).kind).toBe('pass')
  })
})

describe('lockfiles', () => {
  test('lockfiles are refused, manifests are not', () => {
    expect(lockfileDenial('/r/bun.lock')).toContain('lockfile')
    expect(lockfileDenial('/r/package-lock.json')).toContain('lockfile')
    expect(lockfileDenial('/r/Cargo.lock')).toContain('lockfile')
    expect(lockfileDenial('/r/package.json')).toBeUndefined()
  })
})

describe('review findings', () => {
  test('a message that only mentions a robot or Claude Code stays', async () => {
    expect((await judge('git commit -m "feat(ui): add 🤖 robot icon"')).kind).toBe('pass')
    expect((await judge('git commit -m "docs(skills): x\n\nGenerated by the build script for Claude Code skills"')).kind).toBe('pass')
  })
  test('a commit after environment assignments runs unchanged', async () => {
    expect((await judge('HUSKY=0 git commit -m "fix(core): x"', { name: '' })).kind).toBe('pass')
  })
  test('git rm dry run is left alone', async () => {
    expect((await judge('git rm -n old.txt')).kind).toBe('pass')
  })
  test('mv that git mv cannot do the same way is left alone', async () => {
    expect((await judge('mv -n a.ts b.ts', { tracked: ['a.ts'] })).kind).toBe('pass')
    expect((await judge('mv a.ts ~/Desktop/', { tracked: ['a.ts'] })).kind).toBe('pass')
    expect((await judge('mv a.ts /elsewhere/', { tracked: ['a.ts'] })).kind).toBe('pass')
  })
  test('rm -f keeps tolerating a missing file', async () => {
    expect(rewritten(await judge('rm -f out.txt && ./build.sh > out.txt'))).toBe('{ trash out.txt 2>/dev/null || true; } && ./build.sh > out.txt')
  })
  test('an SSH address with a port becomes the right HTTPS address', async () => {
    expect(rewritten(await judge('git clone ssh://git@github.com:22/me/r.git'))).toBe('git clone https://github.com/me/r.git')
  })
  test('redirects are not paths', async () => {
    expect((await judge('rm -rf node_modules 2>/dev/null')).kind).toBe('pass')
  })
  test('script-delete words outside a script are not refused', async () => {
    expect((await judge('git commit -m "fix(scripts): replace fs.rm in node helper"')).kind).toBe('pass')
    expect((await judge("bun test | grep 'os.remove'")).kind).toBe('pass')
  })
  test('more script deletes are refused', async () => {
    expect(denied(await judge(`node -e "require('fs').rmSync('x', { recursive: true })"`))).toContain('trash')
    expect(denied(await judge("python3 - <<'EOF'\nfrom pathlib import Path\nPath('a').unlink()\nEOF"))).toContain('trash')
  })
  test('rm by path or behind command is caught', async () => {
    expect(rewritten(await judge('/bin/rm -r src'))).toBe('trash src')
    expect(rewritten(await judge('command rm -r src'))).toBe('command trash src')
    expect(denied(await judge('find . -exec /bin/rm {} +'))).toContain('trash')
  })
  test('a path that climbs out of a build folder is trashed', async () => {
    expect(rewritten(await judge('rm -r build/../src'))).toBe('trash build/../src')
  })
  test('a plus refspec push uses --force-with-lease', async () => {
    expect(rewritten(await judge('git push origin +main'))).toBe('git push --force-with-lease origin main')
  })
  test('loop words in comments or strings are not a wait', async () => {
    expect((await judgeInBackground('sleep 5 # until the server is up')).kind).toBe('pass')
    expect((await judgeInBackground("echo 'while you wait'; tail -n 5 app.log")).kind).toBe('pass')
  })
  test('the identity check follows a home-relative cd', async () => {
    expect(denied(await judge('cd ~/proj && git commit -m "fix(core): x"', { email: '' }))).toContain('AskUserQuestion')
  })
})

describe('branch names', () => {
  test('a branch that follows type/scope-description is created', async () => {
    expect((await judge('git checkout -b feat/auth-add-login')).kind).toBe('pass')
    expect((await judge('git switch -c fix/api-null-token origin/main')).kind).toBe('pass')
    expect((await judge('git branch chore/ci-cache-deps')).kind).toBe('pass')
    expect((await judge('git branch -m old fix/core-rename-thing')).kind).toBe('pass')
    expect((await judge('git worktree add -b refactor/db-split-repo ../wt')).kind).toBe('pass')
  })
  test('a branch that breaks the pattern is refused', async () => {
    expect(denied(await judge('git checkout -b my-branch'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git checkout -b Feat/Auth-Login'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git switch -c feat/login'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git branch wip'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git worktree add -b wip ../wt'))).toContain('<type>/<scope>-<description>')
  })
  test('a branch name over 50 characters is refused', async () => {
    expect(denied(await judge('git checkout -b feat/auth-add-a-very-long-description-that-keeps-going'))).toContain('50')
  })
  test('switching, listing and deleting branches are not checked', async () => {
    expect((await judge('git checkout main')).kind).toBe('pass')
    expect((await judge('git branch -d old-thing')).kind).toBe('pass')
    expect((await judge('git branch')).kind).toBe('pass')
    expect((await judge('git switch develop')).kind).toBe('pass')
  })
})

describe('commit subjects', () => {
  test('a subject that follows type(scope): description passes', async () => {
    expect((await judge('git commit -m "feat(hooks)!: drop the old guard"')).kind).toBe('pass')
    expect((await judge('git commit --message="fix(core): x"')).kind).toBe('pass')
    expect((await judge('git commit -m "fixup! feat(core): x"')).kind).toBe('pass')
  })
  test('a subject that breaks the pattern is refused', async () => {
    expect(denied(await judge('git commit -m "fix stuff"'))).toContain('<type>(<scope>): <description>')
    expect(denied(await judge('git commit -m "fix: no scope"'))).toContain('<type>(<scope>): <description>')
    expect(denied(await judge('git commit -m "Feat(core): x"'))).toContain('<type>(<scope>): <description>')
    expect(denied(await judge("git commit -m \"$(cat <<'EOF'\nadd guards\n\nRef: https://x/1\nEOF\n)\""))).toContain('<type>(<scope>): <description>')
  })
  test('a commit with no message on the command line is not checked', async () => {
    expect((await judge('git commit --amend --no-edit')).kind).toBe('pass')
    expect((await judge('git commit -F msg.txt')).kind).toBe('pass')
  })
  test('a pull request title follows the same pattern', async () => {
    expect(denied(await judge('gh pr create --title "add guards" --body x'))).toContain('<type>(<scope>): <description>')
    expect((await judge('gh pr create --title "feat(hooks): add guards" --body x')).kind).toBe('pass')
    expect((await judge('gh pr edit 12 --body x')).kind).toBe('pass')
  })
})

describe('manifests', () => {
  test('a hand edit to a manifest needs approval, other files do not', () => {
    expect(manifestAsk('/r/package.json')).toContain('package.json')
    expect(manifestAsk('/r/app/build.gradle.kts')).toContain('build.gradle.kts')
    expect(manifestAsk('/r/gradle/libs.versions.toml')).toContain('libs.versions.toml')
    expect(manifestAsk('/r/pubspec.yaml')).toContain('pubspec.yaml')
    expect(manifestAsk('/r/src/main.ts')).toBeUndefined()
  })
  test('each ecosystem names its own command, or says it has none', () => {
    expect(manifestAsk('/r/Gemfile')).toContain('`bundle add <gem>`')
    expect(manifestAsk('/r/composer.json')).toContain('`composer require <pkg>`')
    expect(manifestAsk('/r/src/App/App.csproj')).toContain('`dotnet add package <name>`')
    expect(manifestAsk('/r/deno.json')).toContain('`deno add <pkg>`')
    expect(manifestAsk('/r/Package.swift')).toContain('`swift package add-dependency <url>`')
    expect(manifestAsk('/r/Cargo.toml')).toContain('`cargo add <crate>`')
    expect(manifestAsk('/r/pom.xml')).toContain('Maven has no command')
    expect(manifestAsk('/r/ios/Podfile')).toContain('`pod install`')
  })
  test('lockfiles of every ecosystem are recognised', () => {
    for (const name of ['Gemfile.lock', 'composer.lock', 'pubspec.lock', 'Podfile.lock', 'mix.lock', 'uv.lock', 'packages.lock.json', 'conda-lock.yml']) {
      expect(lockfileDenial(`/r/${name}`)).toContain(`${name} is a lockfile`)
    }
  })
})

describe('naming review findings', () => {
  test('long-lived branch names and copies of an existing branch pass', async () => {
    expect((await judge('git branch -M main')).kind).toBe('pass')
    expect((await judge('git checkout -B main origin/main')).kind).toBe('pass')
    expect((await judge('git switch -C main origin/main')).kind).toBe('pass')
    expect((await judge('git checkout -b develop origin/develop')).kind).toBe('pass')
    expect((await judge('git checkout -b feat/x-y origin/feat/x-y')).kind).toBe('pass')
  })
  test('scopes may hold capitals, @, slashes and commas', async () => {
    expect((await judge('git commit -m "fix(iOS): crash on launch"')).kind).toBe('pass')
    expect((await judge('git commit -m "feat(@acme/ui): add button"')).kind).toBe('pass')
    expect((await judge('git commit -m "fix(api, auth): token refresh"')).kind).toBe('pass')
  })
  test('a tab-indented heredoc subject is read without its tabs', async () => {
    expect((await judge("git commit -m \"$(cat <<-'EOF'\n\tfeat(x): y\n\tEOF\n)\"")).kind).toBe('pass')
  })
  test('values attached to the option are checked', async () => {
    expect(denied(await judge('git commit -m"bad subject"'))).toContain('<type>(<scope>): <description>')
    expect(denied(await judge("git commit -m'bad subject'"))).toContain('<type>(<scope>): <description>')
    expect(denied(await judge('gh pr create -t"bad title"'))).toContain('<type>(<scope>): <description>')
    expect(denied(await judge('git switch -cBadName'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git checkout -bBadName'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git worktree add -bBadName ../wt'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git switch --create=BadName'))).toContain('<type>/<scope>-<description>')
  })
  test('git branch with tracking or force flags is checked', async () => {
    expect(denied(await judge('git branch --track BadName origin/main'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git branch -t BadName origin/main'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git branch --no-track BadName main'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git branch -f BadName main'))).toContain('<type>/<scope>-<description>')
    expect((await judge('git branch --set-upstream-to=origin/main')).kind).toBe('pass')
  })
  test('gh with a repository option or the new alias is checked', async () => {
    expect(denied(await judge('gh -R o/r pr create --title "bad title"'))).toContain('<type>(<scope>): <description>')
    expect(denied(await judge('gh pr new --title "bad title"'))).toContain('<type>(<scope>): <description>')
    expect((await judge('gh pr create --fill')).kind).toBe('pass')
    expect((await judge('gh pr edit 12 -t "fix(core): x"')).kind).toBe('pass')
  })
})

describe('long-lived branches', () => {
  test('environment and release-line branches can be created under their plain names', async () => {
    for (const name of ['main', 'development', 'dev', 'su', 'sd', 'staging', 'next', 'uat', 'qa', 'sit', 'preprod', 'prod']) {
      expect((await judge(`git checkout -b ${name}`)).kind).toBe('pass')
    }
  })
  test('other plain names are still refused', async () => {
    expect(denied(await judge('git checkout -b wip'))).toContain('<type>/<scope>-<description>')
  })
})

describe('release and hotfix lines', () => {
  test('release/ and hotfix/ branches pass with any name after the slash', async () => {
    for (const name of ['release/1.2.0', 'release/2026-10', 'hotfix/1.2.1', 'hotfix/login/crash', 'release/v3']) {
      expect((await judge(`git checkout -b ${name}`)).kind).toBe('pass')
    }
  })
  test('an empty release or hotfix name is still refused', async () => {
    expect(denied(await judge('git checkout -b release/'))).toContain('<type>/<scope>-<description>')
    expect(denied(await judge('git checkout -b hotfix/'))).toContain('<type>/<scope>-<description>')
  })
})

const backupBefore = (git: string, subcommand: string) =>
  `{ craft_backup=$(${git}stash create "craft backup before ${subcommand}") && { [ -z "$craft_backup" ] || ${git}stash store -m "craft backup before ${subcommand}" "$craft_backup"; }; } && `

describe('git commands that lose work', () => {
  test('git clean is refused unless it is a dry run', async () => {
    expect(denied(await judge('git clean -fd'))).toContain('git clean -n')
    expect(denied(await judge('git clean -fdx'))).toContain('trash')
    expect((await judge('git clean -n -d')).kind).toBe('pass')
    expect((await judge('git clean --dry-run')).kind).toBe('pass')
  })
  test('discarding uncommitted changes backs them up to the stash first', async () => {
    expect(rewritten(await judge('git restore src/a.ts'))).toBe(`${backupBefore('git ', 'restore')}git restore src/a.ts`)
    expect(rewritten(await judge('git checkout -- a.ts'))).toBe(`${backupBefore('git ', 'checkout')}git checkout -- a.ts`)
    expect(rewritten(await judge('git checkout .'))).toBe(`${backupBefore('git ', 'checkout')}git checkout .`)
    expect(rewritten(await judge('git checkout a.ts', { files: ['a.ts'] }))).toBe(`${backupBefore('git ', 'checkout')}git checkout a.ts`)
    expect(rewritten(await judge('git reset --hard origin/main'))).toBe(`${backupBefore('git ', 'reset')}git reset --hard origin/main`)
    expect(rewritten(await judge('git switch --discard-changes main'))).toBe(`${backupBefore('git ', 'switch')}git switch --discard-changes main`)
    expect(rewritten(await judge('git restore --staged --worktree a'))).toBe(`${backupBefore('git ', 'restore')}git restore --staged --worktree a`)
    expect(rewritten(await judge('git -C sub restore a'))).toBe(`${backupBefore('git -C sub ', 'restore')}git -C sub restore a`)
  })
  test('commands that keep the working files run as written', async () => {
    expect((await judge('git restore --staged a.ts')).kind).toBe('pass')
    expect((await judge('git checkout main')).kind).toBe('pass')
    expect((await judge('git checkout -b feat/x-y')).kind).toBe('pass')
    expect((await judge('git reset --soft HEAD~1')).kind).toBe('pass')
    expect((await judge('git reset HEAD a.ts')).kind).toBe('pass')
    expect((await judge('git switch main')).kind).toBe('pass')
  })
  test('a move onto an existing untracked file trashes that file first', async () => {
    expect(rewritten(await judge('mv draft.txt notes.txt', { files: ['notes.txt'] }))).toBe('trash notes.txt && mv draft.txt notes.txt')
    expect(rewritten(await judge('git mv -f a.ts b.ts', { files: ['b.ts'], tracked: ['a.ts'] }))).toBe('trash b.ts && git mv -f a.ts b.ts')
  })
  test('a move onto a tracked file, a folder or a free name adds no trash', async () => {
    expect(rewritten(await judge('mv a.ts b.ts', { files: ['b.ts'], tracked: ['a.ts', 'b.ts'] }))).toBe('git mv a.ts b.ts')
    expect((await judge('mv a.txt dir/')).kind).toBe('pass')
    expect((await judge('git mv a.ts c.ts', { tracked: ['a.ts'] })).kind).toBe('pass')
  })
  test('git rm -f still untracks and trashes', async () => {
    expect(rewritten(await judge('git rm -f x'))).toBe('git rm --cached -f x && { trash x 2>/dev/null || true; }')
  })
})

const inFolder = (...names: string[]) => ({ listings: { '/repo': names } })

describe('CLI-first', () => {
  test('a JavaScript command that is not the project tool is refused, naming the right one', async () => {
    expect(denied(await judge('npm install lodash', inFolder('bun.lock', 'package.json')))).toContain('`bun add <pkg>`')
    expect(denied(await judge('npx vitest', inFolder('pnpm-lock.yaml')))).toContain('`pnpm exec <tool>` for a project tool')
    expect(denied(await judge('yarn', inFolder('package-lock.json')))).toContain('this project uses npm (package-lock.json in /repo)')
    expect(denied(await judge('bun install', inFolder('yarn.lock')))).toContain('`yarn add <pkg>`')
  })
  test('the lockfile is found in a parent folder of the package', async () => {
    const monorepo = { listings: { '/repo/packages/app': ['package.json'], '/repo': ['bun.lock'] } }
    expect(denied(await judge('cd packages/app && npm i react', monorepo))).toContain('bun.lock in /repo')
  })
  test('the project tool, read-only lookups and bun scripts run as written', async () => {
    expect((await judge('bun add zod', inFolder('bun.lock'))).kind).toBe('pass')
    expect((await judge('npm view react version', inFolder('bun.lock'))).kind).toBe('pass')
    expect((await judge('npm --version', inFolder('bun.lock'))).kind).toBe('pass')
    expect((await judge('bun scripts/seed.ts', inFolder('package-lock.json'))).kind).toBe('pass')
  })
  test('with no JavaScript project, another package manager runs and bun is only recommended', async () => {
    expect(advised(await judge('npx create-vite app', inFolder()))).toContain('bun is preferred over npx')
    expect(advised(await judge('npm init -y', inFolder()))).toContain('Keep npm if it was chosen on purpose')
    expect((await judge('bunx create-vite app', inFolder())).kind).toBe('pass')
    expect((await judge('npm view react version', inFolder())).kind).toBe('pass')
  })
  test('a package.json with no lockfile or an unreadable folder decides nothing', async () => {
    expect((await judge('npm install', inFolder('package.json'))).kind).toBe('pass')
    expect((await judge('npm install')).kind).toBe('pass')
    expect((await judge('python3 x.py')).kind).toBe('pass')
  })
  test('bare python runs through uv in a uv project and as written with no Python project', async () => {
    expect(rewritten(await judge('python3 scripts/x.py', inFolder('uv.lock')))).toBe('uv run python3 scripts/x.py')
    expect(rewritten(await judge("FOO=1 python -c 'print(1)'", inFolder('uv.lock')))).toBe("FOO=1 uv run python -c 'print(1)'")
    expect((await judge("python3 -c 'print(1)'", inFolder())).kind).toBe('pass')
    expect(rewritten(await judge('rm a && python3 b.py', inFolder('uv.lock')))).toBe('trash a && uv run python3 b.py')
    expect((await judge('.venv/bin/python x.py', inFolder('uv.lock'))).kind).toBe('pass')
  })
  test('pip and python -m venv are refused in a uv project', async () => {
    expect(denied(await judge('pip install requests', inFolder('uv.lock')))).toContain('`uv add <pkg>`')
    expect(denied(await judge('python3 -m pip install requests', inFolder('uv.lock')))).toContain('this project uses uv')
    expect(denied(await judge('python3 -m venv .venv', inFolder('uv.lock')))).toContain('`uv venv`')
    expect((await judge('pip list', inFolder('uv.lock'))).kind).toBe('pass')
  })
  test('with no Python project, pip, venv and other managers run and uv is only recommended', async () => {
    expect(advised(await judge('pip install requests', inFolder()))).toContain('uv is preferred')
    expect(advised(await judge('python3 -m venv .venv', inFolder()))).toContain('`uv venv`')
    expect(advised(await judge('poetry new app', inFolder()))).toContain('uv is preferred')
    expect((await judge('pip list', inFolder())).kind).toBe('pass')
    expect((await judge('uv init', inFolder())).kind).toBe('pass')
  })
  test('a recommendation rides along with a rewrite in the same command', async () => {
    const verdict = await judge('rm old && npm init -y', inFolder())
    expect(rewritten(verdict)).toBe('trash old && npm init -y')
    expect(verdict.kind === 'rewrite' && verdict.advice.join()).toContain('bun is preferred over npm')
  })
  test('a project on poetry, pipenv or plain pip stays on it', async () => {
    expect((await judge('python app.py', inFolder('poetry.lock'))).kind).toBe('pass')
    expect(denied(await judge('pip install x', inFolder('poetry.lock')))).toContain('`poetry add <pkg>`')
    expect(denied(await judge('uv add x', inFolder('Pipfile')))).toContain('`pipenv install <pkg>`')
    expect(denied(await judge('uv run pytest', inFolder('poetry.lock')))).toContain('this project uses poetry')
    expect((await judge('pip install -r requirements.txt', inFolder('requirements.txt'))).kind).toBe('pass')
    expect((await judge('uv run x.py', inFolder('requirements.txt'))).kind).toBe('pass')
    expect(denied(await judge('uv init', inFolder('requirements.txt')))).toContain('this project uses pip')
    expect(denied(await judge('poetry add x', inFolder('uv.lock')))).toContain('`uv add <pkg>`')
  })
  test('a pyproject.toml with no lockfile decides nothing', async () => {
    expect((await judge('pip install x', inFolder('pyproject.toml'))).kind).toBe('pass')
  })
  test('script deletes are still refused before python is rerouted', async () => {
    expect(denied(await judge(`python3 -c "import os; os.remove('x')"`, inFolder()))).toContain('trash')
  })
  test('a hand-run compiler inside a project with a build tool is refused', async () => {
    expect(denied(await judge('rustc src/main.rs', inFolder('Cargo.toml')))).toContain('`cargo build`')
    expect(denied(await judge('javac App.java', inFolder('build.gradle.kts')))).toContain('`./gradlew <task>`')
    expect(denied(await judge('gradle assembleDebug', inFolder('gradlew')))).toContain("the project's own Gradle")
    expect(denied(await judge('clang++ main.cpp -o main', inFolder('xmake.lua')))).toContain('`xmake`')
  })
  test('compilers with no source file, outside a project, or Gradle without a wrapper run as written', async () => {
    expect((await judge('rustc --version', inFolder('Cargo.toml'))).kind).toBe('pass')
    expect((await judge('gcc a.c', inFolder())).kind).toBe('pass')
    expect((await judge('gradle build', inFolder('build.gradle'))).kind).toBe('pass')
  })
  test('Ruby, Maven, .NET, Scala, Haskell and Elixir projects go through their own command', async () => {
    expect(denied(await judge('gem install rails', inFolder('Gemfile')))).toContain('`bundle add <gem>`')
    expect(denied(await judge('mvn package', inFolder('pom.xml', 'mvnw')))).toContain('`./mvnw <phase>`')
    expect(denied(await judge('csc Program.cs', inFolder('App.csproj')))).toContain('App.csproj in /repo')
    expect(denied(await judge('scalac Main.scala', inFolder('build.sbt')))).toContain('`sbt compile`')
    expect(denied(await judge('ghc Main.hs', inFolder('app.cabal')))).toContain('`cabal build`')
    expect(denied(await judge('elixirc lib/a.ex', inFolder('mix.exs')))).toContain('`mix compile`')
  })
  test('gem outside a Bundler project, gem install bundler and mvn without a wrapper run as written', async () => {
    expect((await judge('gem install rails', inFolder())).kind).toBe('pass')
    expect((await judge('gem install bundler', inFolder('Gemfile'))).kind).toBe('pass')
    expect((await judge('mvn package', inFolder('pom.xml'))).kind).toBe('pass')
  })
  test('compiling a scratch file outside the project runs as written', async () => {
    expect((await judge('gcc /tmp/t.c -o /tmp/t', inFolder('CMakeLists.txt'))).kind).toBe('pass')
    expect((await judge('rustc /tmp/claude-1/t.rs', inFolder('Cargo.toml'))).kind).toBe('pass')
    expect(denied(await judge('gcc /repo/src/a.c', inFolder('CMakeLists.txt')))).toContain('`cmake --build <build folder>`')
  })
  test('a project on plain pip is recognised by its requirements folder, manage.py or venv', async () => {
    const django = inFolder('requirements', 'manage.py', 'venv')
    expect((await judge('pip install -r requirements/dev.txt', django)).kind).toBe('pass')
    expect((await judge('python manage.py runserver', django)).kind).toBe('pass')
    expect((await judge('python3 x.py', inFolder('requirements-dev.txt'))).kind).toBe('pass')
    expect((await judge('python3 x.py', inFolder('.venv'))).kind).toBe('pass')
  })
  test('a one-off uv script outside the project is allowed in a poetry project, and the refusal says how', async () => {
    expect((await judge('uv run --no-project --with httpx python /tmp/p.py', inFolder('poetry.lock'))).kind).toBe('pass')
    expect((await judge('uvx ruff check .', inFolder('poetry.lock'))).kind).toBe('pass')
    expect(denied(await judge('uv run pytest', inFolder('poetry.lock')))).toContain('uv run --no-project --with <pkg>')
  })
  test('a command pointed at a subfolder is judged by that subfolder', async () => {
    const web = (lockfile: string) => ({ listings: { '/repo': [], '/repo/web': [lockfile] } })
    expect((await judge('npm --prefix web install', web('package-lock.json'))).kind).toBe('pass')
    expect((await judge('pnpm -C web add zod', web('pnpm-lock.yaml'))).kind).toBe('pass')
    expect((await judge('yarn --cwd=web add zod', web('yarn.lock'))).kind).toBe('pass')
    expect(denied(await judge('npm --prefix web install', web('bun.lock')))).toContain('bun.lock in /repo/web')
    expect(denied(await judge('poetry -C web add x', { listings: { '/repo': [], '/repo/web': ['uv.lock'] } }))).toContain('`uv add <pkg>`')
  })
  test('bun running a script in any form is allowed in another project, bun managing packages is not', async () => {
    const npmProject = inFolder('package-lock.json')
    expect((await judge('bun run scripts/seed.ts', npmProject)).kind).toBe('pass')
    expect((await judge('bun --watch scripts/seed.ts', npmProject)).kind).toBe('pass')
    expect((await judge(`bun -e 'console.log(1)'`, npmProject)).kind).toBe('pass')
    expect((await judge('yarn --version', npmProject)).kind).toBe('pass')
    expect(denied(await judge('bun run build', npmProject))).toContain('this project uses npm')
  })
  test('outside git the folders above are scanned up to the home folder, not past it', async () => {
    const poetryAbove = { isRepository: false, listings: { '/repo/scripts': [], '/repo': ['poetry.lock'] } }
    expect((await judge('cd scripts && python3 x.py', poetryAbove)).kind).toBe('pass')
    const lockInHome = { isRepository: false, listings: { '/Users/me/scratch': [], '/Users/me': ['bun.lock'] } }
    expect(advised(await judge('cd /Users/me/scratch && npm i x', lockInHome))).toContain('no JavaScript project here')
  })
})

describe('manifests and lockfiles from the shell', () => {
  test('a redirect, tee, in-place edit or copy onto a manifest is refused', async () => {
    expect(denied(await judge(`echo '{}' > package.json`))).toContain('package.json is a manifest')
    expect(denied(await judge('jq . package.json > tmp && mv tmp package.json'))).toContain('manifest')
    expect(denied(await judge(`sed -i '' 's/1.0/2.0/' Cargo.toml`))).toContain('Cargo.toml is a manifest')
    expect(denied(await judge('printf x | tee -a go.mod'))).toContain('go.mod is a manifest')
    expect(denied(await judge(`perl -pi -e 's/a/b/' app/build.gradle`))).toContain('build.gradle is a manifest')
    expect(denied(await judge('cat <<EOF > pyproject.toml\n[project]\nEOF'))).toContain('pyproject.toml is a manifest')
  })
  test('yq -i, sponge and script write calls onto a manifest are refused', async () => {
    expect(denied(await judge(`node -e "const p=require('./package.json');require('fs').writeFileSync('package.json',JSON.stringify(p))"`))).toContain('package.json is a manifest')
    expect(denied(await judge(`yq -i '.dependencies.http = "^1.2.0"' pubspec.yaml`))).toContain('pubspec.yaml is a manifest')
    expect(denied(await judge(`jq '.x=1' package.json | sponge package.json`))).toContain('package.json is a manifest')
    expect(denied(await judge(`python3 -c "open('pyproject.toml', 'w').write('')"`))).toContain('pyproject.toml is a manifest')
    expect((await judge(`node -e "console.log(require('./package.json').version)"`)).kind).toBe('pass')
  })
  test('copies and snapshots into temporary folders run as written', async () => {
    expect((await judge('git show HEAD:package.json > /tmp/package.json')).kind).toBe('pass')
    expect((await judge('cp Cargo.lock /tmp/Cargo.lock')).kind).toBe('pass')
    expect((await judge('echo $$ > /tmp/build.lock')).kind).toBe('pass')
  })
  test('a write onto a lockfile is refused, even with no command', async () => {
    expect(denied(await judge('> package-lock.json'))).toContain('lockfile')
    expect(denied(await judge('cp ../other/bun.lock bun.lock'))).toContain('lockfile')
  })
  test('reads, descriptor redirects and copies inside dependency folders run as written', async () => {
    expect((await judge('cat package.json 2>&1')).kind).toBe('pass')
    expect((await judge('echo hi >&2')).kind).toBe('pass')
    expect((await judge(`sed 's/a/b/' package.json`)).kind).toBe('pass')
    expect((await judge('cat bun.lock > /dev/null')).kind).toBe('pass')
    expect((await judge('cp patched.json node_modules/x/package.json')).kind).toBe('pass')
    expect((await judge('cp package.json package.json.bak')).kind).toBe('pass')
  })
})

describe('linters and formatters', () => {
  test('with no project, another linter runs and biome or ruff is recommended', async () => {
    const newRepository = { ...inFolder(), hasCommits: false }
    const npx = advised(await judge('npx prettier --write a.js', newRepository))
    expect(npx).toContain('biome is preferred over prettier')
    expect(npx).toContain('bun is preferred over npx')
    expect(advised(await judge('black x.py', newRepository))).toContain('ruff is preferred over black')
    expect(advised(await judge('python3 -m isort x.py', newRepository))).toContain('ruff is preferred over isort')
    expect((await judge('bunx @biomejs/biome check .', inFolder())).kind).toBe('pass')
    expect((await judge('uvx ruff check .', inFolder())).kind).toBe('pass')
  })
  test('a project on biome refuses eslint and prettier', async () => {
    const biomeProject = inFolder('package.json', 'package-lock.json', 'biome.json')
    expect(denied(await judge('npx eslint .', biomeProject))).toContain('biome (biome.json in /repo)')
    expect(denied(await judge('prettier --check .', biomeProject))).toContain('instead of prettier')
  })
  test('a project on eslint or prettier refuses biome', async () => {
    expect(denied(await judge('npx @biomejs/biome check .', inFolder('package.json', 'package-lock.json', '.eslintrc.json')))).toContain('eslint (.eslintrc.json in /repo)')
    const prettierInPackage = { listings: { '/repo': ['package.json', 'package-lock.json'] }, contents: { '/repo/package.json': '{ "devDependencies": { "prettier": "^3.0.0" } }' } }
    expect(denied(await judge('npx @biomejs/biome format .', prettierInPackage))).toContain('prettier (package.json in /repo)')
  })
  test('an existing project with no lint settings, or tools that live side by side, run as written', async () => {
    expect((await judge('npx prettier --check .', inFolder('package.json', 'package-lock.json'))).kind).toBe('pass')
    expect((await judge('npx eslint .', inFolder('package.json', 'package-lock.json', '.prettierrc'))).kind).toBe('pass')
  })
  test('a Python project on ruff refuses black and flake8, and one on black refuses ruff', async () => {
    const ruffProject = inFolder('uv.lock', 'ruff.toml')
    expect(denied(await judge('uv run black .', ruffProject))).toContain('ruff (ruff.toml in /repo)')
    expect(denied(await judge('flake8 src', ruffProject))).toContain('instead of flake8')
    expect((await judge('uv run ruff check', ruffProject)).kind).toBe('pass')
    const blackProject = { listings: { '/repo': ['uv.lock', 'pyproject.toml'] }, contents: { '/repo/pyproject.toml': '[project]\nname = "a"\n[tool.black]\nline-length = 100\n' } }
    expect(denied(await judge('uvx ruff format .', blackProject))).toContain('black (pyproject.toml in /repo)')
  })
})

describe('git for repository work', () => {
  test('gh repo clone becomes git clone over HTTPS, keeping the folder and git options', async () => {
    expect(rewritten(await judge('gh repo clone octo-org/craft'))).toBe('git clone https://github.com/octo-org/craft.git')
    expect(rewritten(await judge('gh repo clone o/r app -- --depth 1'))).toBe('git clone --depth 1 https://github.com/o/r.git app')
    expect(rewritten(await judge('gh repo clone https://github.com/o/r'))).toBe('git clone https://github.com/o/r')
  })
  test('a clone gh must resolve itself, and other gh commands, run as written', async () => {
    expect((await judge('gh repo clone craft')).kind).toBe('pass')
    expect((await judge('gh issue list')).kind).toBe('pass')
    expect((await judge('gh pr checkout 12')).kind).toBe('pass')
    expect((await judge('gh auth status')).kind).toBe('pass')
  })
})

describe('formatters in an existing project', () => {
  const changed = (...paths: string[]) => ({ isAsked: false, changedFiles: new Set(paths) })
  const judgeFormat = (command: string, formatting = changed(), repo: Repo = {}) => judgeBash(command, '/repo', fakeHost(repo), '/Users/me', formatting)

  test('a formatter across the project is refused when nobody asked', async () => {
    expect(denied(await judgeFormat('npx prettier --write .'))).toContain('files you did not change (.)')
    expect(denied(await judgeFormat('cargo fmt'))).toContain('cargo would reformat the whole project')
    expect(denied(await judgeFormat('./gradlew spotlessApply'))).toContain('gradlew would reformat the whole project')
    expect(denied(await judgeFormat('npm run format'))).toContain('npm format would reformat the whole project')
    expect(denied(await judgeFormat('cd app && uv run ruff format'))).toContain('ruff would reformat the whole project')
    expect(denied(await judgeFormat('dart format lib'))).toContain('files you did not change (lib)')
  })
  test('a formatter on a file Claude did not change is refused', async () => {
    expect(denied(await judgeFormat('black src/a.py src/b.py', changed('/repo/src/a.py')))).toContain('files you did not change (src/b.py)')
  })
  test('a formatter on files Claude changed runs, with a reminder to check the diff of files that existed before', async () => {
    const formatting = changed('/repo/src/a.py', '/repo/src/new.py')
    expect(advised(await judgeFormat('black -l 100 ./src/a.py src/new.py', formatting, { tracked: ['./src/a.py'] }))).toContain('`git diff -- ./src/a.py`')
    expect((await judgeFormat('cd src && ruff format new.py', formatting)).kind).toBe('pass')
  })
  test('when the user asked for formatting, the project formatter runs as written', async () => {
    expect((await judgeFormat('npx prettier --write .', { isAsked: true, changedFiles: new Set() })).kind).toBe('pass')
  })
  test('a repository with no commits yet, or a folder outside git, is not guarded', async () => {
    expect((await judgeFormat('cargo fmt', changed(), { hasCommits: false })).kind).toBe('pass')
    expect((await judgeFormat('cargo fmt', changed(), { isRepository: false })).kind).toBe('pass')
  })
  test('check-only formatter runs and build tasks are not formatting', async () => {
    for (const command of ['npx prettier --check .', 'cargo fmt -- --check', 'ruff format --check', 'black --check .', 'dart format --output=none .', './gradlew spotlessCheck', 'npm run format:check', 'ruff check .', 'gofmt -l .', 'make test']) {
      expect((await judgeFormat(command)).kind).toBe('pass')
    }
  })
  test('a formatter refused by the project toolchain names the project tool first', async () => {
    expect(denied(await judgeFormat('uv run black .', changed(), inFolder('uv.lock', 'ruff.toml')))).toContain('ruff (ruff.toml in /repo)')
  })
  test('a request to format is read from the words the user typed', () => {
    expect(asksToFormat('please format the files you touched')).toBe(true)
    expect(asksToFormat('run prettier on src')).toBe(true)
    expect(asksToFormat('fix the login bug')).toBe(false)
  })
})
