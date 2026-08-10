[CmdletBinding()]
param(
    [string]$OutputZip = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $OutputZip) {
    $OutputZip = Join-Path $root "dist\codesys-codex-mcp.zip"
}
$outputFull = [System.IO.Path]::GetFullPath($OutputZip)
$outputDir = Split-Path -Parent $outputFull
if (-not (Test-Path -LiteralPath $outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$items = @(
    (Join-Path $root "server"),
    (Join-Path $root "scripts"),
    (Join-Path $root "deploy"),
    (Join-Path $root "templates"),
    (Join-Path $root "config"),
    (Join-Path $root "package.json"),
    (Join-Path $root "README.md")
) | Where-Object { Test-Path -LiteralPath $_ }

Compress-Archive -Path $items -DestinationPath $outputFull -Force
Write-Host "Created deployment package: $outputFull"
