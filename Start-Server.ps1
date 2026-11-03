param([switch]$NoPause)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot 'server')
$volnaPort = if ($env:PORT) { $env:PORT } else { '8787' }
try {
    $volnaHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$volnaPort/health" -TimeoutSec 2
} catch { $volnaHealth = $null }
if ($volnaHealth -and $volnaHealth.ok -eq $true -and $volnaHealth.app -eq 'Volna') {
    Write-Host "Volna is already running: http://localhost:$volnaPort"
    Write-Host 'Use the PC Wi-Fi address in the phone app. A second server is not needed.'
    if (-not $NoPause) { Read-Host 'Press Enter to close this window' }
    exit 0
}
$volnaNode = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $volnaNode) {
    $volnaBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $volnaBundledNode) { $volnaExecutable = $volnaBundledNode }
    else { Write-Host 'Install Node.js 24 or newer from https://nodejs.org/'; Read-Host 'Press Enter'; exit 1 }
} else { $volnaExecutable = $volnaNode.Source }
& $volnaExecutable server.mjs
if (-not $NoPause) { Read-Host 'Server stopped. Press Enter' }
