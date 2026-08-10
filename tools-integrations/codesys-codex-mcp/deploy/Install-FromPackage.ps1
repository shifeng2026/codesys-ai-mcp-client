[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageZip,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "codesys-codex-mcp"),
    [string]$CodexConfig = (Join-Path $HOME ".codex\config.toml"),
    [string]$CodesysExe = "",
    [string]$CodesysProfile = "",
    [string]$AdditionalFolder = "",
    [switch]$ReplaceExisting,
    [switch]$InstallNodeWithWinget
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PackageZip)) {
    throw "Package zip not found: $PackageZip"
}

$stage = Join-Path $env:TEMP ("codesys-codex-mcp-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Expand-Archive -Path $PackageZip -DestinationPath $stage -Force

$installScript = Join-Path $stage "scripts\install-local.ps1"
if (-not (Test-Path -LiteralPath $installScript)) {
    throw "Install script not found inside package: scripts\install-local.ps1"
}

& $installScript `
    -InstallRoot $InstallRoot `
    -CodexConfig $CodexConfig `
    -CodesysExe $CodesysExe `
    -CodesysProfile $CodesysProfile `
    -AdditionalFolder $AdditionalFolder `
    -ReplaceExisting:$ReplaceExisting `
    -InstallNodeWithWinget:$InstallNodeWithWinget
