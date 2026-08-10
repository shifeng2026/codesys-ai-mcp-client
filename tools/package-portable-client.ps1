param(
  [string]$OutputDir = "",
  [switch]$SkipRuntime,
  [switch]$SkipEngineeringSnapshots,
  [switch]$KeepStage
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$clientDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir ".."))
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageName = "codex-local-client-portable-$timestamp"

if (-not $OutputDir) {
  $OutputDir = Join-Path $clientDir "portable-packages"
}

$outputRoot = [System.IO.Path]::GetFullPath($OutputDir)
$stageRoot = [System.IO.Path]::GetFullPath((Join-Path $outputRoot $packageName))
$zipPath = [System.IO.Path]::GetFullPath((Join-Path $outputRoot ($packageName + ".zip")))
$manifestPath = Join-Path $stageRoot "portable-package-manifest.json"

function Ensure-Directory([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
}

function Test-WithinDirectory([string]$child, [string]$parent) {
  $childFull = [System.IO.Path]::GetFullPath($child).TrimEnd("\")
  $parentFull = [System.IO.Path]::GetFullPath($parent).TrimEnd("\")
  return $childFull.StartsWith($parentFull + "\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-SkipItem(
  [System.IO.FileSystemInfo]$item,
  [string[]]$excludeNames,
  [string[]]$excludePatterns
) {
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    return $true
  }
  foreach ($name in $excludeNames) {
    if ($item.Name -ieq $name) {
      return $true
    }
  }
  foreach ($pattern in $excludePatterns) {
    if ($item.Name -like $pattern) {
      return $true
    }
  }
  return $false
}

function Copy-DirectoryFiltered(
  [string]$source,
  [string]$destination,
  [string[]]$excludeNames = @(),
  [string[]]$excludePatterns = @()
) {
  if (-not (Test-Path -LiteralPath $source)) {
    return $false
  }
  Ensure-Directory $destination
  foreach ($item in Get-ChildItem -LiteralPath $source -Force -ErrorAction SilentlyContinue) {
    if (Test-SkipItem $item $excludeNames $excludePatterns) {
      continue
    }
    $target = Join-Path $destination $item.Name
    if ($item.PSIsContainer) {
      [void](Copy-DirectoryFiltered $item.FullName $target $excludeNames $excludePatterns)
    } else {
      Ensure-Directory (Split-Path -Parent $target)
      Copy-Item -LiteralPath $item.FullName -Destination $target -Force
    }
  }
  return $true
}

function Copy-FileIfExists([string]$source, [string]$destination) {
  if (Test-Path -LiteralPath $source) {
    Ensure-Directory (Split-Path -Parent $destination)
    Copy-Item -LiteralPath $source -Destination $destination -Force
    return $true
  }
  return $false
}

function Read-TomlString([string]$text, [string]$key, [string]$fallback) {
  $pattern = '(?m)^\s*' + [regex]::Escape($key) + '\s*=\s*"([^"]*)"'
  $match = [regex]::Match($text, $pattern)
  if ($match.Success) {
    return $match.Groups[1].Value
  }
  return $fallback
}

function Write-PortableCodexConfig([string]$destination) {
  $sourceConfig = Join-Path $env:USERPROFILE ".codex\config.toml"
  $text = ""
  if (Test-Path -LiteralPath $sourceConfig) {
    $text = Get-Content -LiteralPath $sourceConfig -Raw -Encoding UTF8
  }

  $provider = Read-TomlString $text "model_provider" "cch"
  if ($provider -notmatch '^[A-Za-z0-9_-]+$') {
    $provider = "cch"
  }
  $model = Read-TomlString $text "model" "gpt-5.6-sol"
  $effort = Read-TomlString $text "model_reasoning_effort" "xhigh"
  $baseUrl = Read-TomlString $text "base_url" "https://ai.discover-42.com/v1"
  $wireApi = Read-TomlString $text "wire_api" "responses"

  $config = @"
model_provider = "$provider"
model = "$model"
model_reasoning_effort = "$effort"
sandbox_mode = "workspace-write"
approval_policy = "never"

[model_providers.$provider]
base_url = "$baseUrl"
wire_api = "$wireApi"
"@

  Ensure-Directory (Split-Path -Parent $destination)
  Set-Content -LiteralPath $destination -Value $config -Encoding UTF8
  Set-Content -LiteralPath ($destination -replace 'config\.toml$', 'config.example.toml') -Value $config -Encoding UTF8
}

function Write-AuthExample([string]$destination) {
  $authExample = @"
{
  "OPENAI_API_KEY": "replace-with-your-key-on-the-new-computer"
}
"@
  Ensure-Directory (Split-Path -Parent $destination)
  Set-Content -LiteralPath $destination -Value $authExample -Encoding UTF8
}

Ensure-Directory $outputRoot
if (-not (Test-WithinDirectory $stageRoot $outputRoot)) {
  throw "Refusing to stage outside output directory: $stageRoot"
}
if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Ensure-Directory $stageRoot

$warnings = New-Object System.Collections.Generic.List[string]
$included = New-Object System.Collections.Generic.List[string]

$commonExcludeNames = @(
  ".git",
  ".hg",
  ".svn",
  ".sandbox",
  ".sandbox-bin",
  ".sandbox-secrets",
  ".tmp",
  "tmp",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  "env"
)
$commonExcludePatterns = @("*.pyc", "*.pyo", "*.sqlite", "*.sqlite-*", "auth.json", "*.key", "*.pem")

$clientExcludeNames = $commonExcludeNames + @(
  ".codex-runtime",
  ".codex-runtime-watchdog-test",
  "portable-packages"
)

[void](Copy-DirectoryFiltered $clientDir $stageRoot $clientExcludeNames $commonExcludePatterns)
$included.Add("client:$clientDir")

$codexConfigDir = Join-Path $stageRoot "user-config\.codex"
Write-PortableCodexConfig (Join-Path $codexConfigDir "config.toml")
Write-AuthExample (Join-Path $codexConfigDir "auth.example.json")

$userCodex = Join-Path $env:USERPROFILE ".codex"
[void](Copy-DirectoryFiltered (Join-Path $userCodex "skills") (Join-Path $codexConfigDir "skills") @(".git", "__pycache__") @("*.pyc", "auth.json", "*.sqlite", "*.sqlite-*"))
[void](Copy-DirectoryFiltered (Join-Path $userCodex "rules") (Join-Path $codexConfigDir "rules") @(".git", "__pycache__") @("*.pyc", "auth.json", "*.sqlite", "*.sqlite-*"))
$included.Add("codex-user-resources:$userCodex\skills,$userCodex\rules")

if (-not $SkipRuntime) {
  $programFiles = if ($env:ProgramFiles) { $env:ProgramFiles } else { "C:\Program Files" }
  $programFilesX86 = if (${env:ProgramFiles(x86)}) { ${env:ProgramFiles(x86)} } else { "C:\Program Files (x86)" }
  $nodeCandidates = @(
    (Join-Path $programFiles "nodejs\node.exe"),
    (Join-Path $programFilesX86 "nodejs\node.exe")
  )
  $nodeSource = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($nodeSource) {
    Copy-FileIfExists $nodeSource (Join-Path $stageRoot "portable-runtime\node\node.exe") | Out-Null
    $included.Add("node:$nodeSource")
  } else {
    $warnings.Add("Node runtime not found; new computer must have node.exe in PATH.")
  }

  $codexCliRoot = Join-Path $env:APPDATA "npm\node_modules\@openai\codex"
  if (Test-Path -LiteralPath $codexCliRoot) {
    [void](Copy-DirectoryFiltered $codexCliRoot (Join-Path $stageRoot "portable-runtime\appdata\npm\node_modules\@openai\codex") @(".git") @())
    Copy-FileIfExists (Join-Path $env:APPDATA "npm\codex.cmd") (Join-Path $stageRoot "portable-runtime\appdata\npm\codex.cmd") | Out-Null
    Copy-FileIfExists (Join-Path $env:APPDATA "npm\codex") (Join-Path $stageRoot "portable-runtime\appdata\npm\codex") | Out-Null
    $included.Add("codex-cli:$codexCliRoot")
  } else {
    $warnings.Add("@openai/codex CLI package not found; new computer must install Codex CLI.")
  }
}

$userProfileRoot = $env:USERPROFILE
$localAppData = $env:LOCALAPPDATA
$codesysMcpSource = Join-Path $userProfileRoot "codesys-codex-mcp"
$codesysMcpDestination = Join-Path $stageRoot "tools-integrations\codesys-codex-mcp"
if (Copy-DirectoryFiltered $codesysMcpSource $codesysMcpDestination @(".git", "node_modules", "__pycache__") @("*.pyc", "*.pyo", "auth.json", "*.sqlite", "*.sqlite-*")) {
  $included.Add("codesys-mcp:$codesysMcpSource")
  $codesysMemory = Join-Path $localAppData "codesys-codex-mcp\python-command-memory.json"
  Copy-FileIfExists $codesysMemory (Join-Path $stageRoot "portable-runtime\localappdata\codesys-codex-mcp\python-command-memory.json") | Out-Null
} else {
  $warnings.Add("CODESYS MCP source not found: $codesysMcpSource")
}

$autocadMcpSource = Join-Path $userProfileRoot "autocad-codex-mcp"
if (Copy-DirectoryFiltered $autocadMcpSource (Join-Path $stageRoot "tools-integrations\autocad-codex-mcp") @(".git", "node_modules", "__pycache__") @("*.pyc", "*.pyo", "auth.json", "*.sqlite", "*.sqlite-*")) {
  $included.Add("autocad-mcp:$autocadMcpSource")
} else {
  $warnings.Add("AutoCAD MCP source not found: $autocadMcpSource")
}

$logsSource = "C:\logs"
if (Copy-DirectoryFiltered $logsSource (Join-Path $stageRoot "logs-snapshot\C_logs") @(".git", "node_modules", "__pycache__", ".sandbox-secrets") @("auth.json", "*.key", "*.pem", "*.sqlite", "*.sqlite-*")) {
  $included.Add("logs-snapshot:$logsSource")
} else {
  $warnings.Add("C:\logs not found or not readable.")
}

Ensure-Directory (Join-Path $stageRoot "logs")
Copy-FileIfExists (Join-Path $clientDir "codex-history.json") (Join-Path $stageRoot "logs\codex-local-client-history-current.json") | Out-Null
Copy-FileIfExists (Join-Path $clientDir "maintenance-log-20260731-195311.md") (Join-Path $stageRoot "logs\codex-local-client-maintenance-20260731-195311.md") | Out-Null

if (-not $SkipEngineeringSnapshots) {
  $engineeringSources = @(
    @{ Name = "python-daqctrl"; Path = "C:\Users\29925\Documents\工作资料\daqctrl" },
    @{ Name = "codesys-plc-git"; Path = "C:\Users\29925\codesys-plc-git" },
    @{ Name = "c-path"; Path = "C:\path" }
  )
  foreach ($item in $engineeringSources) {
    $destination = Join-Path $stageRoot ("engineering-snapshots\" + $item.Name)
    if (Copy-DirectoryFiltered $item.Path $destination $commonExcludeNames $commonExcludePatterns) {
      $included.Add(("engineering:" + $item.Path))
    } else {
      $warnings.Add("Engineering snapshot not found or not readable: " + $item.Path)
    }
  }
}

$sourcePaths = @(
  "client=$clientDir",
  "codex_user_config=$userCodex",
  "codesys_mcp=$codesysMcpSource",
  "autocad_mcp=$autocadMcpSource",
  "logs=$logsSource",
  "python_workspace=C:\Users\29925\Documents\工作资料\daqctrl",
  "codesys_git=C:\Users\29925\codesys-plc-git",
  "codesys_cache=C:\path"
)
Set-Content -LiteralPath (Join-Path $stageRoot "source-paths.txt") -Value $sourcePaths -Encoding UTF8

$manifest = [ordered]@{
  createdAt = (Get-Date).ToString("s")
  packageName = $packageName
  clientDir = $clientDir
  included = $included
  warnings = $warnings
  excludedSensitive = @(
    "auth.json",
    "API keys",
    "tokens",
    ".sandbox-secrets",
    "Codex SQLite session databases",
    "temporary sandbox directories"
  )
  launch = "run-portable.cmd"
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath
$sizeMb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
$hashLine = "{0}  {1}" -f $zipHash.Hash, (Split-Path -Leaf $zipPath)
Set-Content -LiteralPath ($zipPath + ".sha256") -Value $hashLine -Encoding ASCII

if (-not $KeepStage) {
  if (-not (Test-WithinDirectory $stageRoot $outputRoot)) {
    throw "Refusing to remove stage outside output directory: $stageRoot"
  }
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}

[pscustomobject]@{
  ZipPath = $zipPath
  Sha256 = $zipHash.Hash
  SizeMB = $sizeMb
  Warnings = $warnings -join "; "
}
