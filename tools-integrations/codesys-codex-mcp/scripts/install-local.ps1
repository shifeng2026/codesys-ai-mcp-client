[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "codesys-codex-mcp"),
    [string]$CodexConfig = (Join-Path $HOME ".codex\config.toml"),
    [string]$CodesysExe = "",
    [string]$CodesysProfile = "",
    [string]$AdditionalFolder = "",
    [switch]$NoCopy,
    [switch]$ReplaceExisting,
    [switch]$InstallNodeWithWinget
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[codesys-codex-mcp] $Message"
}

function Resolve-NodeExe {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        return $node.Source
    }

    $common = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe"
    )
    foreach ($candidate in $common) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    if ($InstallNodeWithWinget) {
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if (-not $winget) {
            throw "Node.js is missing and winget is not available. Install Node.js 18+ manually, then rerun this script."
        }
        Write-Step "Installing Node.js LTS with winget..."
        & $winget.Source install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
        $node = Get-Command node -ErrorAction SilentlyContinue
        if ($node) {
            return $node.Source
        }
    }

    throw "Node.js 18+ is required. Install Node.js or rerun with -InstallNodeWithWinget."
}

function Resolve-CodesysExe {
    param([string]$ExplicitPath)

    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath)) {
            throw "CODESYS.exe was not found at: $ExplicitPath"
        }
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    if ($env:CODESYS_EXE -and (Test-Path -LiteralPath $env:CODESYS_EXE)) {
        return (Resolve-Path -LiteralPath $env:CODESYS_EXE).Path
    }

    $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    foreach ($root in $roots) {
        $candidate = Get-ChildItem -LiteralPath $root -Filter "CODESYS.exe" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "\\CODESYS\\Common\\CODESYS\.exe$" -or $_.FullName -match "\\Common\\CODESYS\.exe$" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($candidate) {
            return $candidate.FullName
        }
    }

    return ""
}

function ConvertTo-TomlString {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value) {
        $Value = ""
    }
    $escaped = $Value.Replace("\", "\\").Replace('"', '\"')
    return '"' + $escaped + '"'
}

function Remove-TomlTables {
    param(
        [string]$Content,
        [string[]]$TableNames
    )

    $lines = $Content -split "`r?`n"
    $output = New-Object System.Collections.Generic.List[string]
    $skip = $false
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        $isTarget = $false
        foreach ($tableName in $TableNames) {
            if ($trimmed -eq "[$tableName]") {
                $isTarget = $true
                break
            }
        }
        if ($isTarget) {
            $skip = $true
            continue
        }
        if ($skip -and $trimmed.StartsWith("[") -and $trimmed.EndsWith("]")) {
            $skip = $false
        }
        if (-not $skip) {
            [void]$output.Add($line)
        }
    }
    return ($output -join [Environment]::NewLine).TrimEnd()
}

function Update-CodexConfig {
    param(
        [string]$ConfigPath,
        [string]$NodeExe,
        [string]$ServerScript,
        [string]$InstalledRoot,
        [string]$ResolvedCodesysExe,
        [string]$Profile,
        [string]$AdditionalFolderValue,
        [switch]$Replace
    )

    $configDir = Split-Path -Parent $ConfigPath
    if (-not (Test-Path -LiteralPath $configDir)) {
        New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    }

    $content = ""
    if (Test-Path -LiteralPath $ConfigPath) {
        $content = [System.IO.File]::ReadAllText($ConfigPath)
    }

    $markedPattern = "(?ms)^# BEGIN codesys-codex-mcp\r?\n.*?# END codesys-codex-mcp\r?\n?"
    $content = [regex]::Replace($content, $markedPattern, "")

    $hasUnmarked = $content -match "(?m)^\[mcp_servers\.codesys\]\s*$" -or
        $content -match "(?m)^\[mcp_servers\.codesys\.env\]\s*$"
    if ($hasUnmarked) {
        if (-not $Replace) {
            throw "Existing unmarked [mcp_servers.codesys] config found in $ConfigPath. Rerun with -ReplaceExisting to replace it."
        }
        $content = Remove-TomlTables -Content $content -TableNames @("mcp_servers.codesys", "mcp_servers.codesys.env")
    }

    $envLines = New-Object System.Collections.Generic.List[string]
    [void]$envLines.Add("CODESYS_MCP_ROOT = $(ConvertTo-TomlString $InstalledRoot)")
    [void]$envLines.Add("CODESYS_MCP_ALLOW_ARBITRARY_SCRIPT = ""0""")
    if ($ResolvedCodesysExe) {
        [void]$envLines.Add("CODESYS_EXE = $(ConvertTo-TomlString $ResolvedCodesysExe)")
    }
    if ($Profile) {
        [void]$envLines.Add("CODESYS_PROFILE = $(ConvertTo-TomlString $Profile)")
    }
    if ($AdditionalFolderValue) {
        [void]$envLines.Add("CODESYS_ADDITIONAL_FOLDER = $(ConvertTo-TomlString $AdditionalFolderValue)")
    }

    $block = @(
        "# BEGIN codesys-codex-mcp",
        "[mcp_servers.codesys]",
        "command = $(ConvertTo-TomlString $NodeExe)",
        "args = [$(ConvertTo-TomlString $ServerScript)]",
        "startup_timeout_sec = 30",
        "tool_timeout_sec = 300",
        "",
        "[mcp_servers.codesys.env]"
    ) + $envLines + @(
        "# END codesys-codex-mcp"
    )

    $newContent = $content.TrimEnd()
    if ($newContent.Length -gt 0) {
        $newContent += [Environment]::NewLine + [Environment]::NewLine
    }
    $newContent += ($block -join [Environment]::NewLine) + [Environment]::NewLine

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($ConfigPath, $newContent, $utf8NoBom)
}

$sourceRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceRoot = $sourceRoot.Path
$installRootFull = [System.IO.Path]::GetFullPath($InstallRoot)

if (-not $NoCopy) {
    $sourceFull = [System.IO.Path]::GetFullPath($sourceRoot)
    if ($installRootFull.TrimEnd("\") -ieq $sourceFull.TrimEnd("\")) {
        $NoCopy = $true
    }
}

if (-not $NoCopy) {
    Write-Step "Copying package to $installRootFull"
    if (-not (Test-Path -LiteralPath $installRootFull)) {
        New-Item -ItemType Directory -Force -Path $installRootFull | Out-Null
    }
    Copy-Item -Path (Join-Path $sourceRoot "*") -Destination $installRootFull -Recurse -Force
} else {
    $installRootFull = $sourceRoot
    Write-Step "Using source directory as install root: $installRootFull"
}

$nodeExe = Resolve-NodeExe
$serverScript = Join-Path $installRootFull "server\index.js"
if (-not (Test-Path -LiteralPath $serverScript)) {
    throw "MCP server script not found after install: $serverScript"
}

$resolvedCodesysExe = Resolve-CodesysExe -ExplicitPath $CodesysExe
if (-not $resolvedCodesysExe) {
    Write-Warning "CODESYS.exe was not auto-detected. The MCP server can still start; pass codesysExe per tool call or set CODESYS_EXE later."
}

Write-Step "Running MCP server self-test"
& $nodeExe $serverScript --self-test | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "MCP server self-test failed."
}

Write-Step "Updating Codex config: $CodexConfig"
Update-CodexConfig `
    -ConfigPath $CodexConfig `
    -NodeExe $nodeExe `
    -ServerScript $serverScript `
    -InstalledRoot $installRootFull `
    -ResolvedCodesysExe $resolvedCodesysExe `
    -Profile $CodesysProfile `
    -AdditionalFolderValue $AdditionalFolder `
    -Replace:$ReplaceExisting

Write-Step "Installed. Restart Codex or open a new Codex session to load the codesys MCP server."
