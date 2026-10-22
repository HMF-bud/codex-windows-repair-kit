[CmdletBinding()]
param([switch]$NeedNode)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

# Query the current user's OS-registered package each time. Never guess a version,
# scan for the newest directory, or use startup.json as an executable authority.
$packages = @(Get-AppxPackage -Name 'OpenAI.Codex' | Where-Object {
    $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' -and -not $_.IsFramework
})
if ($packages.Count -ne 1) { throw 'Cannot uniquely resolve the installed Codex package. Use Install.ps1 -Rollback.' }
$package = $packages[0]
$resources = Join-Path $package.InstallLocation 'app\resources'
$backend = Join-Path $resources 'codex.exe'
foreach ($name in @('codex.exe','codex-code-mode-host.exe','codex-windows-sandbox-setup.exe','codex-command-runner.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $resources $name) -PathType Leaf)) {
        throw "Current Codex package is incomplete ($name). No policy result was substituted; use -Rollback."
    }
}
$result = [ordered]@{
    discovery='registered-package'; packageRoot=$package.InstallLocation
    appPath=(Join-Path $package.InstallLocation 'app\ChatGPT.exe')
    appVersion=[string]$package.Version; backendPath=$backend
    sandboxPackageFamily=$package.PackageFamilyName
}
if ($NeedNode) {
    $runtimeRoot = Join-Path $resources 'cua_node'
    $manifestPath = Join-Path $runtimeRoot 'manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.platform -ne 'windows' -or [string]$manifest.arch -ne ([string]$package.Architecture).ToLowerInvariant()) {
        throw 'Current package Node manifest does not match this Windows package architecture.'
    }
    $relative = [string]$manifest.node_path
    if ([IO.Path]::IsPathRooted($relative) -or (($relative -split '[\\/]') -contains '..')) {
        throw 'Node manifest points outside the trusted runtime directory.'
    }
    $node = Join-Path $runtimeRoot $relative
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Node from the current package manifest is missing. Use -Rollback.' }
    $result.nodePath=$node
    $result.runtimeManifest=$manifestPath
    $result.runtimeArchiveVersion=$manifest.runtime_archive_version
}
Write-Output ($result | ConvertTo-Json -Compress)
