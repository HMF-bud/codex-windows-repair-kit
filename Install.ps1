[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z]:?$')][string]$Drive = 'R:',
    [string]$BackendPath, [string]$NodePath,
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
$package = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
if (-not $package) { throw 'Install and launch the Windows Codex desktop app first.' }
$appPath = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $appPath)) { throw 'Unsupported Codex desktop package layout.' }
if (-not $NodePath) {
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
    else {
        $bundled = @(Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node\*\bin\node.exe') -ErrorAction SilentlyContinue)
        if ($bundled.Count -eq 1) { $NodePath = $bundled[0].FullName }
    }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) { throw 'Node.js 18+ required. Install Node.js LTS or pass -NodePath.' }
& $NodePath -e "if(Number(process.versions.node.split('.')[0])<18)process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Node.js 18+ required.' }
if (-not $BackendPath) {
    $candidates = @(Get-Process -Name codex -ErrorAction SilentlyContinue | ForEach-Object { $_.Path } | Where-Object { $_ } | Sort-Object -Unique)
    if ($candidates.Count -eq 1) { $BackendPath = $candidates[0] }
    elseif ($candidates.Count -gt 1) { throw 'Multiple Codex backends are running. Pass -BackendPath with the desktop backend.' }
    else {
        $existingLauncher = [Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User')
        if ($existingLauncher) {
            $oldConfig = Join-Path (Split-Path $existingLauncher) 'startup.json'
            if (Test-Path -LiteralPath $oldConfig) { $BackendPath = (Get-Content -LiteralPath $oldConfig -Raw | ConvertFrom-Json).backendPath }
        }
    }
}
if (-not $BackendPath -or -not (Test-Path -LiteralPath $BackendPath) -or [IO.Path]::GetFileName($BackendPath) -ne 'codex.exe') {
    throw 'Start Codex once or pass -BackendPath to its original codex.exe. Nothing changed.'
}
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
    nodePath=$NodePath; backendPath=$BackendPath; appPath=$appPath
    appVersion=[string]$package.Version; backendVersion=$backendVersion
    sandboxPackageFamily=$package.PackageFamilyName; drive=$Drive; scope=$scope
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
Write-Host 'Testing directory conversion, isolated save/reopen and sandbox boundaries...'
& $NodePath (Join-Path $PSScriptRoot 'tests\normalize.test.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Directory conversion test failed; startup setting was not changed.' }
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
