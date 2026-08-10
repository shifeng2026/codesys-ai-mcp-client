[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string[]]$ComputerName = @(),
    [string]$ComputerListPath = "",
    [Parameter(Mandatory = $true)]
    [string]$PackageZip,
    [string]$InstallRoot = "",
    [string]$CodesysExe = "",
    [string]$CodesysProfile = "",
    [string]$AdditionalFolder = "",
    [switch]$ReplaceExisting,
    [switch]$InstallNodeWithWinget,
    [System.Management.Automation.PSCredential]$Credential
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PackageZip)) {
    throw "Package zip not found: $PackageZip"
}

$targets = New-Object System.Collections.Generic.List[string]
foreach ($item in $ComputerName) {
    if ($item) {
        [void]$targets.Add($item)
    }
}
if ($ComputerListPath) {
    if (-not (Test-Path -LiteralPath $ComputerListPath)) {
        throw "Computer list not found: $ComputerListPath"
    }
    Get-Content -LiteralPath $ComputerListPath |
        Where-Object { $_ -and -not $_.Trim().StartsWith("#") } |
        ForEach-Object { [void]$targets.Add($_.Trim()) }
}

if ($targets.Count -eq 0) {
    throw "Specify -ComputerName or -ComputerListPath."
}

$packageFull = (Resolve-Path -LiteralPath $PackageZip).Path

foreach ($computer in $targets) {
    if (-not $PSCmdlet.ShouldProcess($computer, "Install CODESYS Codex MCP bridge")) {
        continue
    }

    Write-Host "[$computer] opening PowerShell session"
    $sessionParams = @{ ComputerName = $computer }
    if ($Credential) {
        $sessionParams.Credential = $Credential
    }
    $session = New-PSSession @sessionParams
    try {
        $remoteZip = Invoke-Command -Session $session -ScriptBlock {
            Join-Path $env:TEMP "codesys-codex-mcp.zip"
        }
        Copy-Item -LiteralPath $packageFull -Destination $remoteZip -ToSession $session -Force

        Invoke-Command -Session $session -ScriptBlock {
            param(
                [string]$RemoteZip,
                [string]$InstallRootValue,
                [string]$CodesysExeValue,
                [string]$CodesysProfileValue,
                [string]$AdditionalFolderValue,
                [bool]$ReplaceExistingValue,
                [bool]$InstallNodeValue
            )

            $stage = Join-Path $env:TEMP ("codesys-codex-mcp-" + [guid]::NewGuid().ToString("N"))
            New-Item -ItemType Directory -Force -Path $stage | Out-Null
            Expand-Archive -Path $RemoteZip -DestinationPath $stage -Force

            $installScript = Join-Path $stage "scripts\install-local.ps1"
            if (-not (Test-Path -LiteralPath $installScript)) {
                throw "Install script not found inside package."
            }

            $params = @{}
            if ($InstallRootValue) { $params.InstallRoot = $InstallRootValue }
            if ($CodesysExeValue) { $params.CodesysExe = $CodesysExeValue }
            if ($CodesysProfileValue) { $params.CodesysProfile = $CodesysProfileValue }
            if ($AdditionalFolderValue) { $params.AdditionalFolder = $AdditionalFolderValue }
            if ($ReplaceExistingValue) { $params.ReplaceExisting = $true }
            if ($InstallNodeValue) { $params.InstallNodeWithWinget = $true }

            & $installScript @params
        } -ArgumentList $remoteZip, $InstallRoot, $CodesysExe, $CodesysProfile, $AdditionalFolder, [bool]$ReplaceExisting, [bool]$InstallNodeWithWinget

        Write-Host "[$computer] installed"
    } finally {
        Remove-PSSession $session
    }
}
