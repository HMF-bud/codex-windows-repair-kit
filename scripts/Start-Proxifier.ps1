[CmdletBinding()]
param([string]$ProxifierPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root 'local\startup.json') -Raw | ConvertFrom-Json
if (-not $ProxifierPath) { $ProxifierPath = $config.proxifierPath }
if (-not $ProxifierPath -or -not (Test-Path -LiteralPath $ProxifierPath)) { throw 'Install Proxifier or pass -ProxifierPath. No program was launched.' }
$profile = Join-Path $root 'local\Codex-durable-DNS.ppx'
if (-not (Test-Path -LiteralPath $profile)) { throw 'Run Install.cmd first to create this computer''s profile.' }
$client = New-Object Net.Sockets.TcpClient
try {
    $connect = $client.ConnectAsync('127.0.0.1', [int]$config.proxyPort)
    if (-not $connect.Wait(2000) -or -not $client.Connected) { throw 'Local proxy is not listening. Start your existing proxy client first.' }
} finally { $client.Dispose() }
# Loading this profile also replaces an already-running Proxifier's active rules.
# No Codex/Clash processes are stopped; the previous profile backup is in local/.
Start-Process -FilePath $ProxifierPath -ArgumentList @(('"' + $profile + '"'), 'silent-load') -WindowStyle Hidden
Write-Host 'Requested profile load. If a trial prompt appears, handle it in Proxifier; a paid license is not included.'
Write-Host 'Verify the loaded profile and connection log. This command does not prove dot has reconnected.'
