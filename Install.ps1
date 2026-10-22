[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z]:?$')][string]$Drive = 'R:',
    [ValidateRange(1,65535)][int]$ProxyPort = 7897,
    [string]$ProxifierPath,
    [switch]$PrepareOnly, [switch]$Rollback
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts\Common.ps1')
$localDir = Join-Path $PSScriptRoot 'local'
$statePath = Join-Path $localDir 'install-state.json'
$configPath = Join-Path $localDir 'startup.json'
$adapterExe = Join-Path $PSScriptRoot 'adapter\CodexPathAdapter.exe'
if ($Rollback) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ([Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User') -ne $adapterExe) {
        throw 'CODEX_CLI_PATH was changed elsewhere; no value was overwritten.'
    }
    [Environment]::SetEnvironmentVariable('CODEX_CLI_PATH', $state.previousUserCliPath, 'User')
    Send-KitEnvironmentNotice
    Write-Host 'Previous startup setting restored. Running Codex and chat history are unchanged.'
    Write-Host 'For network rollback, load local\proxifier-profile-before-install.ppx in Proxifier if it exists, or exit Proxifier.'
    return
}
# Rebuilding a live executable or its config could affect new child processes.
$active = @(Get-Process -Name CodexPathAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $adapterExe })
if ($active.Count) { throw 'This copy is active. Prepare a separate copy, or rerun after you normally close Codex. No process was stopped.' }
if ($env:CODEX_WINDOWS_REGISTERED_CORE -eq '1') { throw 'Registered-core mode has not been validated; no setting changed.' }
$Drive = $Drive.TrimEnd(':').ToUpperInvariant() + ':'
$scope = Get-KitMapping $Drive
if ($scope -notmatch '^\\\\[^\\/]+\\[^\\/]+$') { throw 'Only a mapped UNC share root is supported.' }
# Version/hash paths are snapshots only; every invocation resolves OS registration.
$runtime = (& (Join-Path $PSScriptRoot 'adapter\Resolve-Runtime.ps1') -NeedNode) | ConvertFrom-Json
$BackendPath = $runtime.backendPath
$NodePath = $runtime.nodePath
$backendVersion = (& $BackendPath --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Original backend version check failed.' }
if (-not $ProxifierPath) {
    $paths = @((Join-Path ${env:ProgramFiles(x86)} 'Proxifier\Proxifier.exe'), (Join-Path $env:ProgramFiles 'Proxifier\Proxifier.exe'))
    $ProxifierPath = $paths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
if (Test-Path -LiteralPath $configPath) { Copy-Item -LiteralPath $configPath -Destination (Join-Path $localDir "startup-before-$stamp.json") }
$config = [ordered]@{
    nodePath=$NodePath; backendPath=$BackendPath; appPath=$runtime.appPath
    appVersion=$runtime.appVersion; backendVersion=$backendVersion
    packageRoot=$runtime.packageRoot; runtimeManifest=$runtime.runtimeManifest
    runtimeArchiveVersion=$runtime.runtimeArchiveVersion; discovery=$runtime.discovery
    sandboxPackageFamily=$runtime.sandboxPackageFamily; drive=$Drive; scope=$scope
    proxyPort=$ProxyPort; proxifierPath=$ProxifierPath
    preparedUTC=[DateTime]::UtcNow.ToString('o')
}
Write-KitJson $configPath $config
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe /optimize+ "/out:$adapterExe" /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'adapter\CodexPathAdapter.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native adapter compilation failed.' }
[xml]$profile = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proxy\Codex-durable-DNS.ppx') -Raw
$profile.ProxifierProfile.ProxyList.Proxy.Port = [string]$ProxyPort
$profile.Save((Join-Path $localDir 'Codex-durable-DNS.ppx'))
Write-Host 'Testing entry passthrough, real policy reads, directory conversion, isolated save/reopen and sandbox boundaries...'
& $NodePath (Join-Path $PSScriptRoot 'tests\normalize.test.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Directory conversion test failed; startup setting was not changed.' }
& $NodePath (Join-Path $PSScriptRoot 'tests\verify-entry.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Entry and policy compatibility failed; startup setting was not changed. See local\checks.' }
& $NodePath (Join-Path $PSScriptRoot 'tests\verify-install.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Isolated validation failed; startup setting was not changed. See local\checks.' }
if ($PrepareOnly) { Write-Host 'Prepared and verified. No startup or proxy setting changed.'; return }
$currentCli = [Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User')
if ($currentCli -ne $adapterExe) {
    Write-KitJson $statePath ([ordered]@{ previousUserCliPath=$currentCli; installedUserCliPath=$adapterExe; installedUTC=[DateTime]::UtcNow.ToString('o') })
    [Environment]::SetEnvironmentVariable('CODEX_CLI_PATH', $adapterExe, 'User')
}
# Save a rollback copy, without loading or overwriting Proxifier's active profile.
$defaultProfile = Join-Path $env:APPDATA 'Proxifier4\Profiles\Default.ppx'
$profileBackup = Join-Path $localDir 'proxifier-profile-before-install.ppx'
if ((Test-Path -LiteralPath $defaultProfile) -and -not (Test-Path -LiteralPath $profileBackup)) {
    Copy-Item -LiteralPath $defaultProfile -Destination $profileBackup
}
Send-KitEnvironmentNotice
Write-Host 'Installed for your NEXT normal Codex launch. No app was restarted and no chat was rewritten.'
Write-Host 'When convenient, close and reopen Codex normally. Use Start-Proxifier.cmd when dot needs the proxy.'
if (-not $ProxifierPath) { Write-Host 'Proxifier is not installed. Install it separately if needed; no license is bundled.' }
