# PowerShell anti-patterns

Read this whole file before writing or reviewing PowerShell code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the PowerShell-specific traps.

## Contents

1. `Invoke-Expression` on strings built from input
2. Passwords as plain strings
3. Expecting `try/catch` to catch non-terminating errors and native exit codes
4. `$null` on the right side of a comparison
5. Uncaptured values leaking into function output
6. `ConvertTo-Json` without `-Depth`
7. Reading `$Matches` without checking that `-match` succeeded
8. Caller variables inside remote, job and parallel script blocks
9. Relying on default file encodings across 5.1 and 7
10. PowerShell 7-only syntax in scripts that may run on 5.1
11. `Write-Host` for data output
12. `+=` on arrays inside loops
13. Aliases in scripts
14. Functions without `[CmdletBinding()]` and parameter validation
15. Positional parameters in scripts
16. Unapproved verbs in function names
17. Global variables for shared state

## 1. `Invoke-Expression` on strings built from input

**Avoid:** Building a command string from user input, file content or parameters and running it with `Invoke-Expression` (`iex`).
**Why:** The string is parsed as code, so a value containing `;`, `$(...)` or a quote runs arbitrary commands with the script's rights.
**Instead:** Call the command directly with the value as a parameter; for a dynamic command name use `& $command @params` with splatting.

```powershell
# Bad
$filter = Read-Host 'Filter'
Invoke-Expression "Get-ChildItem -Path C:\Logs -Filter $filter"
```

```powershell
# Good
$filter = Read-Host 'Filter'
Get-ChildItem -Path C:\Logs -Filter $filter
```

**Caught by:** PSScriptAnalyzer `PSAvoidUsingInvokeExpression`
**Source:** https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/avoidusinginvokeexpression

## 2. Passwords as plain strings

**Avoid:** `[string]$Password` parameters, `$UserName`/`$Password` parameter pairs, and `ConvertTo-SecureString -AsPlainText -Force` on a literal or variable.
**Why:** Plain strings end up in command history, transcripts, logs and process memory; `-AsPlainText` means the secret already existed in clear text. `SecureString` only shortens exposure: on non-Windows its storage is not encrypted, and .NET recommends against it for new development.
**Instead:** Take a `[pscredential]` parameter and let the caller supply it (`Get-Credential`, a vault, the CI secret store); treat it as a way to pass and not log secrets, not as encryption.

```powershell
# Bad
param([string]$ComputerName, [string]$UserName, [string]$Password)
$secure = ConvertTo-SecureString $Password -AsPlainText -Force
$cred = [pscredential]::new($UserName, $secure)
```

```powershell
# Good
param(
    [Parameter(Mandatory)] [string]$ComputerName,
    [Parameter(Mandatory)] [pscredential]$Credential
)
New-PSSession -ComputerName $ComputerName -Credential $Credential
```

**Caught by:** PSScriptAnalyzer `PSAvoidUsingPlainTextForPassword`, `PSAvoidUsingUsernameAndPasswordParams`, `PSAvoidUsingConvertToSecureStringWithPlainText`, `PSUsePSCredentialType`
**Source:** https://learn.microsoft.com/en-us/dotnet/api/system.security.securestring

## 3. Expecting `try/catch` to catch non-terminating errors and native exit codes

**Avoid:** Wrapping cmdlet calls and external programs in `try/catch` without `-ErrorAction Stop` or `$ErrorActionPreference = 'Stop'`, and without checking `$LASTEXITCODE`.
**Why:** Most cmdlet failures (file not found, access denied) are non-terminating, so `catch` never runs and the script continues; a native program that exits non-zero raises no error at all by default.
**Instead:** Set `$ErrorActionPreference = 'Stop'` (or pass `-ErrorAction Stop`) and check `$LASTEXITCODE` after every native command, or opt in to `$PSNativeCommandUseErrorActionPreference = $true` on 7.4+.

```powershell
# Bad
try {
    Remove-Item -Path $target
    Copy-Item -Path $source -Destination $target
    git push origin main
}
catch { Write-Warning "Deploy failed: $_" }
```

```powershell
# Good
$ErrorActionPreference = 'Stop'
Remove-Item -Path $target
Copy-Item -Path $source -Destination $target
git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed with exit code $LASTEXITCODE" }
```

**Since:** `$PSNativeCommandUseErrorActionPreference` is stable from PowerShell 7.4 (default `$false`); on 5.1 and earlier 7.x, check `$LASTEXITCODE`.
**Source:** https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_error_handling

## 4. `$null` on the right side of a comparison

**Avoid:** `$value -eq $null` and `$value -ne $null`.
**Why:** When the left side is a collection, `-eq` and `-ne` filter its elements and return an array instead of a Boolean, so the `if` tests the truthiness of the filtered array, not whether the variable is null.
**Instead:** Put `$null` on the left: `$null -eq $value`.

```powershell
# Bad
if ($servers -eq $null) { throw 'No servers configured' }
```

```powershell
# Good
if ($null -eq $servers) { throw 'No servers configured' }
```

**Caught by:** PSScriptAnalyzer `PSPossibleIncorrectComparisonWithNull`
**Source:** https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_comparison_operators

## 5. Uncaptured values leaking into function output

**Avoid:** Calling methods or commands whose return value you ignore inside a function that returns data, such as `ArrayList.Add()`, `New-Item` or `mkdir`.
**Why:** Every uncaptured value in a function is written to its output, not just the `return` value, so callers get an array of indexes, `DirectoryInfo` objects and the real result mixed together.
**Instead:** Use `List[T]` (its `Add` returns nothing), assign unwanted values to `$null`, and emit only the data the function promises.

```powershell
# Bad
function Get-ActiveUserName {
    param([object[]]$User)
    $names = [System.Collections.ArrayList]::new()
    foreach ($u in $User) { $names.Add($u.Name) }
    return $names
}
```

```powershell
# Good
function Get-ActiveUserName {
    param([object[]]$User)
    $names = [System.Collections.Generic.List[string]]::new()
    foreach ($u in $User) { $names.Add($u.Name) }
    $names
}
```

**Source:** https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_return

## 6. `ConvertTo-Json` without `-Depth`

**Avoid:** Serializing nested objects with `ConvertTo-Json` and its default depth.
**Why:** The default `-Depth` is 2; deeper levels are flattened to their type name string (such as `"System.Collections.Hashtable"`), silently corrupting config files and API payloads. Windows PowerShell 5.1 gives no warning.
**Instead:** Pass an explicit `-Depth` large enough for the data (maximum 100).

```powershell
# Bad
$body = @{ app = @{ db = @{ host = 'db1'; port = 5432 } } } | ConvertTo-Json
```

```powershell
# Good
$body = @{ app = @{ db = @{ host = 'db1'; port = 5432 } } } | ConvertTo-Json -Depth 10
```

**Since:** PowerShell 7.1 emits a warning when input is deeper than `-Depth`; earlier versions truncate silently.
**Source:** https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/convertto-json

## 7. Reading `$Matches` without checking that `-match` succeeded

**Avoid:** Running `-match` as a statement and then reading `$Matches`.
**Why:** `$Matches` is only overwritten when a match on scalar input succeeds; after a failed match, or when the left side is a collection, it still holds the previous value, so the loop reuses old captures.
**Instead:** Read `$Matches` only inside `if ($text -match ...)`.

```powershell
# Bad
$ids = foreach ($line in $lines) {
    $null = $line -match 'id=(\d+)'
    $Matches[1]
}
```

```powershell
# Good
$ids = foreach ($line in $lines) {
    if ($line -match 'id=(\d+)') { $Matches[1] }
}
```

**Source:** https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_comparison_operators

## 8. Caller variables inside remote, job and parallel script blocks

**Avoid:** Referencing a local variable directly inside a script block passed to `Invoke-Command`, `Start-Job`, `Start-ThreadJob` or `ForEach-Object -Parallel`.
**Why:** The block runs in another runspace or process, so the variable is `$null` there and the command acts on the wrong target or fails.
**Instead:** Reference it as `$using:name`, or pass it with `-ArgumentList` on `Invoke-Command` and `Start-Job`.

```powershell
# Bad
$serviceName = 'Spooler'
Invoke-Command -ComputerName $servers -ScriptBlock {
    Restart-Service -Name $serviceName
}
```

```powershell
# Good
$serviceName = 'Spooler'
Invoke-Command -ComputerName $servers -ScriptBlock {
    Restart-Service -Name $using:serviceName
}
```

**Caught by:** PSScriptAnalyzer `PSUseUsingScopeModifierInNewRunspaces`
**Source:** https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/useusingscopemodifierinnewrunspaces

## 9. Relying on default file encodings across 5.1 and 7

**Avoid:** Writing files with `>`, `Out-File` or `Set-Content` without thinking about encoding when the script can run on Windows PowerShell 5.1.
**Why:** In 5.1, `>` and `Out-File` write UTF-16LE and `Set-Content` writes the ANSI code page, and `-Encoding UTF8` adds a BOM; PowerShell 7 writes UTF-8 without BOM. Linux tools, JSON parsers and Git diffs break on the 5.1 output.
**Instead:** Choose the encoding explicitly, or use `[System.IO.File]::WriteAllText`, which writes UTF-8 without BOM on both, with a full path.

```powershell
# Bad
$config | ConvertTo-Json -Depth 10 > settings.json
```

```powershell
# Good
$path = Join-Path -Path $PSScriptRoot -ChildPath 'settings.json'
$json = $config | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($path, $json)
```

**Source:** https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding

## 10. PowerShell 7-only syntax in scripts that may run on 5.1

**Avoid:** Using `??`, `??=`, the ternary `? :`, pipeline chain operators `&&`/`||` or `ForEach-Object -Parallel` in a script with no version requirement.
**Why:** Windows PowerShell 5.1 is still the default `powershell.exe` on Windows; the new operators are parse errors there, so no line of the script runs, and `-Parallel` fails with a parameter error when reached.
**Instead:** Declare `#Requires -Version 7.0` when you use 7-only features, or write the 5.1-compatible form (`if/else`).

```powershell
# Bad
$port = $env:APP_PORT ?? 8080
$mode = $IsWindows ? 'win' : 'unix'
```

```powershell
# Good
#Requires -Version 7.0
$port = $env:APP_PORT ?? 8080
$mode = $IsWindows ? 'win' : 'unix'
```

**Caught by:** PSScriptAnalyzer `PSUseCompatibleSyntax` (disabled by default; enable it with `TargetVersions`)
**Since:** `??`, `??=`, `? :`, `&&`/`||` and `ForEach-Object -Parallel` need PowerShell 7.0.
**Source:** https://learn.microsoft.com/en-us/previous-versions/powershell/scripting/whats-new/what-s-new-in-powershell-70

## 11. `Write-Host` for data output

**Avoid:** Emitting a function's results with `Write-Host`.
**Why:** `Write-Host` writes to the host and the information stream, not the success output, so callers cannot pipe, assign or filter the result; objects are flattened to `ToString()` text.
**Instead:** Emit objects as output (implicit output or `Write-Output`); use `Write-Verbose` or `Write-Information` for status messages.

```powershell
# Bad
function Get-DiskReport {
    Get-PSDrive -PSProvider FileSystem | ForEach-Object {
        Write-Host "$($_.Name): $($_.Free)"
    }
}
```

```powershell
# Good
function Get-DiskReport {
    Get-PSDrive -PSProvider FileSystem |
        Select-Object -Property Name, Free
}
```

**Caught by:** PSScriptAnalyzer `PSAvoidUsingWriteHost`
**Source:** https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/write-host

## 12. `+=` on arrays inside loops

**Avoid:** Starting with `@()` and growing it with `+=` in a loop.
**Why:** Arrays are fixed size, so on 5.1 through 7.4 every `+=` allocates a new array and copies all elements, which is quadratic and very slow on large loops. PowerShell 7.5 optimized it, but scripts that also run on older versions still pay the cost.
**Instead:** Assign the loop's output to a variable, or use `[System.Collections.Generic.List[T]]` when you must add conditionally.

```powershell
# Bad
$sizes = @()
foreach ($file in $files) {
    $sizes += (Get-Item -LiteralPath $file).Length
}
```

```powershell
# Good
$sizes = foreach ($file in $files) {
    (Get-Item -LiteralPath $file).Length
}
```

**Source:** https://learn.microsoft.com/en-us/powershell/scripting/dev-cross-plat/performance/script-authoring-considerations

## 13. Aliases in scripts

**Avoid:** `gci`, `%`, `?`, `ls`, `rm`, `cat`, `sort` and other aliases in saved scripts and modules.
**Why:** Aliases hide which command runs and can be redefined; on Linux and macOS, PowerShell 7 has no `ls`, `rm`, `cat`, `sort`, `cp`, `mv` or `ps` aliases, so those names run the native Unix tools, which take different arguments and return text instead of objects.
**Instead:** Use full cmdlet names in scripts; keep aliases for the interactive prompt.

```powershell
# Bad
gci -Recurse -Filter *.log | ? { $_.Length -gt 1MB } | % { rm $_.FullName }
```

```powershell
# Good
Get-ChildItem -Recurse -Filter *.log |
    Where-Object { $_.Length -gt 1MB } |
    Remove-Item
```

**Caught by:** PSScriptAnalyzer `PSAvoidUsingCmdletAliases`
**Source:** https://learn.microsoft.com/en-us/powershell/scripting/whats-new/unix-support

## 14. Functions without `[CmdletBinding()]` and parameter validation

**Avoid:** Simple `function Name($a, $b)` definitions for reusable or state-changing functions.
**Why:** Without `[CmdletBinding()]` the function gets no `-Verbose`, `-ErrorAction` or `-WhatIf`; without validation attributes, bad input (empty path, negative count) reaches the destructive part of the body.
**Instead:** Use an advanced function with a typed `param()` block, `[Parameter(Mandatory)]` and validation attributes, and `SupportsShouldProcess` with `$PSCmdlet.ShouldProcess` for anything that changes state.

```powershell
# Bad
function Remove-OldLog($Path, $Days) {
    Get-ChildItem $Path | Where-Object LastWriteTime -lt (Get-Date).AddDays(-$Days) | Remove-Item
}
```

```powershell
# Good
function Remove-OldLog {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$Path,
        [ValidateRange(1, 3650)] [int]$Days = 30
    )
    $old = Get-ChildItem -LiteralPath $Path -File | Where-Object LastWriteTime -lt (Get-Date).AddDays(-$Days)
    if ($PSCmdlet.ShouldProcess($Path, "Delete $($old.Count) files")) { $old | Remove-Item }
}
```

**Caught by:** PSScriptAnalyzer `PSUseShouldProcessForStateChangingFunctions` (state-changing verbs without `SupportsShouldProcess`), `PSShouldProcess` (declaration and call must be paired)
**Source:** https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_functions_advanced_parameters

## 15. Positional parameters in scripts

**Avoid:** Relying on parameter position in saved scripts, especially with several arguments.
**Why:** The reader has to know each cmdlet's parameter order to see which value is the source and which the destination, and a parameter set or version change can rebind them.
**Instead:** Name every parameter in scripts.

```powershell
# Bad
Copy-Item $source $destination
```

```powershell
# Good
Copy-Item -Path $source -Destination $destination
```

**Caught by:** PSScriptAnalyzer `PSAvoidUsingPositionalParameters` (flags calls with three or more positional arguments)
**Source:** https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/avoidusingpositionalparameters

## 16. Unapproved verbs in function names

**Avoid:** Function names like `Fetch-Report`, `Delete-User` or `Create-Thing`.
**Why:** `Import-Module` warns about unapproved verbs, users cannot discover the command with `Get-Command -Verb`, and the verb no longer signals behavior such as `-WhatIf` support.
**Instead:** Pick a verb from `Get-Verb` (`Get`, `Remove`, `New`, `Set`, `Invoke`).

```powershell
# Bad
function Fetch-Report { param([string]$Name) Get-Content -LiteralPath "$Name.txt" }
```

```powershell
# Good
function Get-Report { param([string]$Name) Get-Content -LiteralPath "$Name.txt" }
```

**Caught by:** PSScriptAnalyzer `PSUseApprovedVerbs`
**Source:** https://learn.microsoft.com/en-us/powershell/scripting/developer/cmdlet/approved-verbs-for-windows-powershell-commands

## 17. Global variables for shared state

**Avoid:** Passing data between functions or scripts through `$global:` variables.
**Why:** Global state outlives the script in the session, leaks into the next run, and any script can overwrite it, which makes behavior depend on what ran before.
**Instead:** Pass values as parameters and return results; use `$script:` scope for state private to one module.

```powershell
# Bad
$global:ApiToken = Get-Token
function Invoke-Api { param([string]$Uri) Invoke-RestMethod -Uri $Uri -Headers @{ Authorization = "Bearer $global:ApiToken" } }
```

```powershell
# Good
function Invoke-Api {
    param([Parameter(Mandatory)] [string]$Uri, [Parameter(Mandatory)] [string]$Token)
    Invoke-RestMethod -Uri $Uri -Headers @{ Authorization = "Bearer $Token" }
}
```

**Caught by:** PSScriptAnalyzer `PSAvoidGlobalVars`
**Source:** https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/avoidglobalvars

## Sources

- https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/readme
- https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/avoidusinginvokeexpression
- https://learn.microsoft.com/en-us/dotnet/api/system.security.securestring
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_error_handling
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_comparison_operators
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_return
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/convertto-json
- https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/useusingscopemodifierinnewrunspaces
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding
- https://learn.microsoft.com/en-us/previous-versions/powershell/scripting/whats-new/what-s-new-in-powershell-70
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/write-host
- https://learn.microsoft.com/en-us/powershell/scripting/dev-cross-plat/performance/script-authoring-considerations
- https://learn.microsoft.com/en-us/powershell/scripting/whats-new/what-s-new-in-powershell-75
- https://learn.microsoft.com/en-us/powershell/scripting/whats-new/unix-support
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_functions_advanced_parameters
- https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/shouldprocess
- https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/avoidusingpositionalparameters
- https://learn.microsoft.com/en-us/powershell/scripting/developer/cmdlet/approved-verbs-for-windows-powershell-commands
- https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/avoidglobalvars
