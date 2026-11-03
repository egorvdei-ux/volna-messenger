$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot 'server')
$volnaNode = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $volnaNode) {
    $volnaBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $volnaBundledNode) { $volnaExecutable = $volnaBundledNode }
    else { Write-Host 'Install Node.js 24 or newer from https://nodejs.org/'; Read-Host 'Press Enter'; exit 1 }
} else { $volnaExecutable = $volnaNode.Source }
& $volnaExecutable server.mjs
Read-Host 'Server stopped. Press Enter'
