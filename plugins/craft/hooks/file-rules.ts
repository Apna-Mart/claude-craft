const LOCKFILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'bun.lockb', 'go.sum', 'gradle.lockfile', 'Package.resolved',
  'packages.lock.json', 'conda-lock.yml',
])

const GRADLE_HINT = 'Gradle has no command for adding a dependency, so a hand edit can be right; run a `./gradlew` task after it.'
const DOTNET_HINT = 'Change dependencies with `dotnet add package <name>`.'
const PROJECT_FILE_EXTENSIONS = ['.csproj', '.fsproj', '.vbproj']
const MANIFESTS = new Map<string, string>([
  ['package.json', "Change dependencies with the project's package manager: `npm install <pkg>`, `bun add <pkg>`, `pnpm add <pkg>` or `yarn add <pkg>`."],
  ['pyproject.toml', "Change dependencies with the project's tool: `uv add <pkg>`, `poetry add <pkg>` or `pdm add <pkg>`."],
  ['Pipfile', 'Change dependencies with `pipenv install <pkg>`.'],
  ['Cargo.toml', 'Change dependencies with `cargo add <crate>`.'],
  ['go.mod', 'Change dependencies with `go get <module>` and `go mod tidy`.'],
  ['pubspec.yaml', 'Change dependencies with `flutter pub add <pkg>` or `dart pub add <pkg>`.'],
  ['Gemfile', 'Change dependencies with `bundle add <gem>`.'],
  ['composer.json', 'Change dependencies with `composer require <pkg>`.'],
  ['deno.json', 'Change dependencies with `deno add <pkg>`.'],
  ['deno.jsonc', 'Change dependencies with `deno add <pkg>`.'],
  ['Package.swift', 'Change dependencies with `swift package add-dependency <url>`.'],
  ['environment.yml', 'Change dependencies with `conda install <pkg>` or `conda env update`.'],
  ['vcpkg.json', 'Change dependencies with `vcpkg add port <name>`.'],
  ['build.gradle', GRADLE_HINT],
  ['build.gradle.kts', GRADLE_HINT],
  ['settings.gradle', GRADLE_HINT],
  ['settings.gradle.kts', GRADLE_HINT],
  ['libs.versions.toml', GRADLE_HINT],
  ['pom.xml', 'Maven has no command for adding a dependency, so a hand edit can be right.'],
  ['Podfile', 'CocoaPods has no command for adding a pod, so a hand edit can be right; run `pod install` after it.'],
  ['mix.exs', 'Mix has no command for adding a dependency, so a hand edit can be right; run `mix deps.get` after it.'],
])

const fileName = (path: string) => path.split('/').at(-1) ?? ''

function manifestHint(name: string): string | undefined {
  return MANIFESTS.get(name) ?? (PROJECT_FILE_EXTENSIONS.some(extension => name.endsWith(extension)) ? DOTNET_HINT : undefined)
}

export function manifestAsk(path: string): string | undefined {
  const name = fileName(path)
  const hint = manifestHint(name)
  if (hint === undefined) return undefined
  return `${name} is a manifest. ${hint} Approve only if this hand edit is something the tool cannot do.`
}

export function manifestShellDenial(path: string): string | undefined {
  const name = fileName(path)
  const hint = manifestHint(name)
  if (hint === undefined) return undefined
  return `${name} is a manifest, so the shell never writes it. ${hint} If a hand edit is truly needed, make it with the Edit tool so the user can approve it.`
}

export function lockfileDenial(path: string): string | undefined {
  const name = fileName(path)
  if (!LOCKFILES.has(name) && !name.endsWith('.lock')) return undefined
  return `${name} is a lockfile, and only the package manager writes it. Run the project's own command instead (for example \`npm install\`, \`bun add\`, \`uv add\`, \`cargo add\`, \`go get\`, \`flutter pub add\`, \`bundle add\`, \`composer require\`, \`dotnet add package\`), then its install or sync.`
}
