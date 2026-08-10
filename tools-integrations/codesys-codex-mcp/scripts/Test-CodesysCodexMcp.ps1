[CmdletBinding()]
param(
    [string]$ServerScript = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $ServerScript) {
    $ServerScript = Join-Path $root "server\index.js"
}

$node = Get-Command node -ErrorAction Stop
& $node.Source (Join-Path $root "tests\smoke-test.js") -ServerScript $ServerScript
if ($LASTEXITCODE -ne 0) {
    throw "Smoke test failed."
}
