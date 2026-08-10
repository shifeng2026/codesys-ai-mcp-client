param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$appDir = "C:\Users\29925\codex-local-client"
$serverFile = Join-Path $appDir "server.js"
$logFile = Join-Path $appDir "launcher.log"
$codexHome = "C:\Users\29925\.codex"
$authFile = Join-Path $codexHome "auth.json"
$port = if ($env:PORT) { $env:PORT } else { "5177" }
$url = "http://127.0.0.1:$port"

function Write-Log([string]$message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy/MM/dd HH:mm:ss"), $message
  Add-Content -LiteralPath $logFile -Value $line
}

function Find-Node {
  $candidate = Join-Path $env:ProgramFiles "nodejs\node.exe"
  if (Test-Path -LiteralPath $candidate) {
    return $candidate
  }

  $candidate = Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"
  if (Test-Path -LiteralPath $candidate) {
    return $candidate
  }

  return "node.exe"
}

function Configure-CodexEnvironment {
  $env:CODEX_HOME = $codexHome
  $env:CODEX_CLIENT_CODEX_HOME = $codexHome
  $env:OPENAI_BASE_URL = "https://ai.discover-42.com/v1"

  if (-not $env:OPENAI_API_KEY -and (Test-Path -LiteralPath $authFile)) {
    try {
      $auth = Get-Content -LiteralPath $authFile -Raw | ConvertFrom-Json
      if ($auth.OPENAI_API_KEY) {
        $env:OPENAI_API_KEY = [string]$auth.OPENAI_API_KEY
        Write-Log ("auth=loaded length=" + $env:OPENAI_API_KEY.Length)
      } else {
        Write-Log "auth=missing_OPENAI_API_KEY"
      }
    } catch {
      Write-Log ("auth_error=" + $_.Exception.Message)
    }
  }

  Write-Log ("CODEX_HOME=" + $env:CODEX_HOME)
  Write-Log ("OPENAI_BASE_URL=" + $env:OPENAI_BASE_URL)
}

function Stop-ExistingServer {
  try {
    $lines = netstat -ano -p tcp | Select-String -Pattern ("127\.0\.0\.1:" + [regex]::Escape($port) + "\s+0\.0\.0\.0:0\s+LISTENING")
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

Write-Log "launch"
Configure-CodexEnvironment
Stop-ExistingServer
$node = Find-Node
Write-Log ("node=" + $node)

Start-Process -FilePath $node -ArgumentList @($serverFile) -WorkingDirectory $appDir -WindowStyle Hidden
Start-Sleep -Seconds 2
if (-not $NoBrowser) {
  try {
    Start-Process -FilePath (Join-Path $env:WINDIR "explorer.exe") -ArgumentList $url
    Write-Log "browser"
  } catch {
    Write-Log ("browser_error=" + $_.Exception.Message)
  }
}
