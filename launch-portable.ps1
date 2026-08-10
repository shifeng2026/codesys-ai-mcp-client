param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverFile = Join-Path $packageRoot "server.js"
$logDir = Join-Path $packageRoot "logs"
$logFile = Join-Path $logDir "portable-launcher.log"
$codexHome = Join-Path $packageRoot "user-config\.codex"
$portableAppData = Join-Path $packageRoot "portable-runtime\appdata"
$portableLocalAppData = Join-Path $packageRoot "portable-runtime\localappdata"
$nodeFile = Join-Path $packageRoot "portable-runtime\node\node.exe"
$codesysMcpRoot = Join-Path $packageRoot "tools-integrations\codesys-codex-mcp"
$autocadMcpRoot = Join-Path $packageRoot "tools-integrations\autocad-codex-mcp"
$port = if ($env:PORT) { $env:PORT } else { "5177" }
$url = "http://127.0.0.1:$port"

function Ensure-Directory([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
}

function Write-Log([string]$message) {
  Ensure-Directory $logDir
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy/MM/dd HH:mm:ss"), $message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

function Stop-ExistingServer {
  try {
    $pattern = "127\.0\.0\.1:" + [regex]::Escape($port) + "\s+0\.0\.0\.0:0\s+LISTENING"
    $lines = netstat -ano -p tcp | Select-String -Pattern $pattern
    foreach ($line in $lines) {
      $parts = ($line.Line.Trim() -split "\s+")
      $pidText = $parts[$parts.Length - 1]
      $processId = 0
      if ([int]::TryParse($pidText, [ref]$processId) -and $processId -gt 0) {
        Write-Log ("stop_existing_pid=" + $processId)
        Stop-Process -Id $processId -Force
      }
    }
  } catch {
    Write-Log ("stop_existing_error=" + $_.Exception.Message)
  }
}

function File-Url([string]$path) {
  return "file:///" + (($path -replace "\\", "/") -replace " ", "%20")
}

Ensure-Directory $logDir
Ensure-Directory $codexHome
Ensure-Directory $portableAppData
Ensure-Directory $portableLocalAppData

$env:APPDATA = $portableAppData
$env:LOCALAPPDATA = $portableLocalAppData
$env:CODEX_HOME = $codexHome
$env:CODEX_CLIENT_CODEX_HOME = $codexHome
$env:CODEX_CLIENT_RUNTIME_CODEX_HOME = $codexHome
$env:CODEX_CLIENT_LOG_DIR = $logDir
$env:CODEX_CLIENT_HISTORY_MIRROR = Join-Path $logDir "codex-local-client-history-current.json"
$env:CODEX_CLIENT_MAINTENANCE_LOG_MIRROR = Join-Path $logDir "codex-local-client-maintenance-20260731-195311.md"
$env:PYTHON_COMMAND_MEMORY_PATH = Join-Path $portableLocalAppData "codesys-codex-mcp\python-command-memory.json"

if (Test-Path -LiteralPath $codesysMcpRoot) {
  $env:CODEX_CLIENT_CODESYS_MCP_ROOT = $codesysMcpRoot
}
if (Test-Path -LiteralPath $autocadMcpRoot) {
  $env:CODEX_CLIENT_AUTOCAD_MCP_ROOT = $autocadMcpRoot
}

if (Test-Path -LiteralPath $nodeFile) {
  $node = $nodeFile
} else {
  $node = "node.exe"
}

$env:PATH = (Join-Path $packageRoot "portable-runtime\node") + ";" +
  (Join-Path $packageRoot "portable-runtime\appdata\npm") + ";" +
  $env:PATH

Write-Log "portable_launch"
Write-Log ("package_root=" + $packageRoot)
Write-Log ("node=" + $node)
Write-Log ("CODEX_HOME=" + $env:CODEX_HOME)
Write-Log ("APPDATA=" + $env:APPDATA)
$codesysMcpLogValue = if ($env:CODEX_CLIENT_CODESYS_MCP_ROOT) { $env:CODEX_CLIENT_CODESYS_MCP_ROOT } else { "" }
$autocadMcpLogValue = if ($env:CODEX_CLIENT_AUTOCAD_MCP_ROOT) { $env:CODEX_CLIENT_AUTOCAD_MCP_ROOT } else { "" }
Write-Log ("CODESYS_MCP_ROOT=" + $codesysMcpLogValue)
Write-Log ("AUTOCAD_MCP_ROOT=" + $autocadMcpLogValue)

if (-not (Test-Path -LiteralPath (Join-Path $codexHome "auth.json"))) {
  Write-Log "auth=missing; create user-config\.codex\auth.json from auth.example.json"
}

Stop-ExistingServer

Start-Process -FilePath $node -ArgumentList @($serverFile) -WorkingDirectory $packageRoot -WindowStyle Hidden
Start-Sleep -Seconds 2

if (-not $NoBrowser) {
  try {
    $loadingFile = Join-Path $packageRoot "public\loading.html"
    if (Test-Path -LiteralPath $loadingFile) {
      $loadingUrl = (File-Url $loadingFile) + "?target=" + [uri]::EscapeDataString($url + "/")
      Start-Process -FilePath $loadingUrl
      Write-Log ("browser_loading=" + $loadingUrl)
    } else {
      Start-Process -FilePath $url
      Write-Log "browser"
    }
  } catch {
    Write-Log ("browser_error=" + $_.Exception.Message)
  }
}
