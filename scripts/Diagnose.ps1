$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$root = Split-Path $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root 'local\startup.json') -Raw | ConvertFrom-Json
$mapping = $null
try { $mapping = Get-KitMapping $config.drive } catch { Write-Warning $_.Exception.Message }
$log = Join-Path $root 'local\activation.jsonl'
$latest = $null
if (Test-Path -LiteralPath $log) {
    $latest = Get-Content -LiteralPath $log -Tail 30 | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { -not $_.isolatedHome } | Select-Object -Last 1
}
$running = @(Get-Process -Name CodexPathAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $root 'adapter\CodexPathAdapter.exe') })
[ordered]@{
    configuredLauncher=[Environment]::GetEnvironmentVariable('CODEX_CLI_PATH','User')
    expectedLauncher=(Join-Path $root 'adapter\CodexPathAdapter.exe')
    expectedShare=$config.scope; actualShare=$mapping; mappingMatches=($mapping -eq $config.scope)
    adapterProcessCount=$running.Count; lastRealActivation=$latest
    proxifierRunning=(@(Get-Process -Name Proxifier -ErrorAction SilentlyContinue).Count -gt 0)
    originalBackendExists=(Test-Path -LiteralPath $config.backendPath)
    configuredAppExists=(Test-Path -LiteralPath $config.appPath)
    note='Activation and process checks do not replace dot read_thread acceptance.'
} | ConvertTo-Json -Depth 5
