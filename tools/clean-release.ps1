<#
.SYNOPSIS
  Removes pre-release QA state and build-only artefacts from a TaskHive release
  directory.

.DESCRIPTION
  A TaskHive release directory is a plain copy of the Electron shell plus
  `resources\app`, so anything the QA runs wrote there ships with the product.
  That previously included:

    * 42 root `_qa_runtime_*` Electron user-data profiles (~596 MB) and 18 more
      inside `resources\app` (~224 MB). Each one contains a real
      `profiles\dsh\.credentials.yaml` session secret, Chromium cookie
      databases and IndexedDB stores.
    * `harness\runtime\slot-before-*` upgrade backups (~71 MB).
    * `resources\app\logs` probe output, screenshots and a 1 MB trajectory log.
    * `plugins\backups` smoke fixtures, including whole `.git` object stores.
    * Debug symbols (`*.pdb`) and source maps (`*.map`) inside
      `plugins\installed\*\node_modules`.
    * Unreferenced icon generations.

  The script is DRY-RUN by default. Pass -Apply to actually delete.

  It never touches: user workspaces, CODESYS project data, `profiles\dsh`
  (the live DSH home), `plugins\installed` package sources, the application
  code, or `TaskHive.exe`.

.PARAMETER ReleaseRoot
  Release directory to clean. Defaults to the parent of this script's repo root.

.PARAMETER Apply
  Actually delete. Without it the script only reports what it would remove.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/clean-release.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/clean-release.ps1 -Apply
#>
[CmdletBinding()]
param(
  [string]$ReleaseRoot,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

if (-not $ReleaseRoot) {
  # tools/ -> resources/app/ -> resources/ -> release root
  $ReleaseRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}
if (-not (Test-Path -LiteralPath $ReleaseRoot)) { throw "Release root not found: $ReleaseRoot" }

$appRoot = Join-Path $ReleaseRoot 'resources\app'
if (-not (Test-Path -LiteralPath $appRoot)) { throw "Not a TaskHive release directory (missing resources\app): $ReleaseRoot" }

function Get-SizeMB {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  $sum = (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) { return 0 }
  return [math]::Round($sum / 1MB, 1)
}

# Targets are explicit so the script can never widen its own blast radius.
$targets = New-Object System.Collections.Generic.List[object]

function Add-Target {
  param([string]$Kind, [string]$Path, [string]$Reason)
  $targets.Add([pscustomobject]@{ Kind = $Kind; Path = $Path; Reason = $Reason })
}

# 1. QA Electron user-data profiles, both levels.
foreach ($dir in @(Get-ChildItem -LiteralPath $ReleaseRoot -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '_qa_*' })) {
  Add-Target 'dir' $dir.FullName 'isolated QA profile (contains DSH session secrets and Chromium cookies)'
}
foreach ($dir in @(Get-ChildItem -LiteralPath $appRoot -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '_qa_*' })) {
  Add-Target 'dir' $dir.FullName 'isolated QA profile inside the app payload'
}

# 2. Pre-upgrade runtime backup slots.
foreach ($dir in @(Get-ChildItem -LiteralPath (Join-Path $appRoot 'harness\runtime') -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'slot-before-*' })) {
  Add-Target 'dir' $dir.FullName 'pre-upgrade Harness slot backup'
}

# 3. QA logs and probe evidence.
Add-Target 'dir' (Join-Path $appRoot 'logs') 'QA probe output, screenshots and runtime logs'

# 4. Plugin smoke fixtures.
Add-Target 'dir' (Join-Path $appRoot 'plugins\backups') 'plugin smoke fixtures (some contain whole .git stores)'
Add-Target 'dir' (Join-Path $appRoot 'plugins\staging') 'plugin staging area'

# 5. Build-only artefacts inside plugin dependencies.
$buildOnly = @()
foreach ($pluginRoot in @(Get-ChildItem -LiteralPath (Join-Path $appRoot 'plugins\installed') -Directory -Force -ErrorAction SilentlyContinue)) {
  $nm = Join-Path $pluginRoot.FullName 'node_modules'
  if (-not (Test-Path -LiteralPath $nm)) { continue }
  $buildOnly += Get-ChildItem -LiteralPath $nm -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @('.pdb', '.map') -or $_.Name -eq '.DS_Store' }
}
foreach ($file in $buildOnly) { Add-Target 'file' $file.FullName 'build-only artefact shipped in node_modules' }

# 6. Source-control and probe leftovers inside shipped plugin packages.
foreach ($pluginRoot in @(Get-ChildItem -LiteralPath (Join-Path $appRoot 'plugins\installed') -Directory -Force -ErrorAction SilentlyContinue)) {
  foreach ($name in @('.git', '.github', 'probe.mjs', 'tsconfig.json')) {
    $candidate = Join-Path $pluginRoot.FullName $name
    if (Test-Path -LiteralPath $candidate) { Add-Target $(if ($name -like '.*' -and $name -ne 'probe.mjs') { 'dir' } else { 'file' }) $candidate 'development-only file shipped in the plugin package' }
  }
}

# 7. Superseded icon generations. `taskhive-icon-v3-*` is the live set: the main
#    process, `release-manifest.json` and the desktop shell templates all
#    reference it. The v1 (`taskhive-*.png`, `taskhive.ico`) and v2
#    (`taskhive-icon-v2-*`) sets were migrated to v3 and are now unreferenced;
#    re-grep before deleting if the renderer templates change again.
$assets = Join-Path $appRoot 'app\assets'
$legacyIcons = @(Get-ChildItem -LiteralPath $assets -File -Force -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -like 'taskhive-icon-v2*' -or
    $_.Name -eq 'taskhive.ico' -or
    $_.Name -match '^taskhive-(?:16|20|24|32|40|48|64|128|256)\.png$'
  })
foreach ($file in $legacyIcons) {
  Add-Target 'file' $file.FullName 'superseded icon generation (v3 is live)'
}

# ---------------------------------------------------------------------------
# Report / apply
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Pre-flight: never propose a legacy icon that is still referenced. A template
# change that reintroduces `taskhive-32.png` must fail loudly here rather than
# ship a release with a broken shell.
# ---------------------------------------------------------------------------
$iconReason = 'superseded icon generation (v3 is live)'
$iconTargets = @($targets | Where-Object { $_.Reason -eq $iconReason })
if ($iconTargets.Count) {
  $iconNames = @($iconTargets | ForEach-Object { [System.IO.Path]::GetFileName($_.Path) })
  $pattern = ($iconNames | ForEach-Object { [regex]::Escape($_) }) -join '|'
  $searchRoots = @(
    (Join-Path $appRoot 'app'),
    (Join-Path $appRoot 'tests'),
    (Join-Path $appRoot 'plugins\installed'),
    (Join-Path $appRoot 'profiles')
  )
  $hits = @()
  foreach ($searchRoot in $searchRoots) {
    if (-not (Test-Path -LiteralPath $searchRoot)) { continue }
    $hits += Get-ChildItem -LiteralPath $searchRoot -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\node_modules\\|\\assets\\|\\_qa_|\\logs\\' -and $_.Extension -in @('.js', '.html', '.css', '.json', '.yml', '.yaml') } |
      Select-String -Pattern $pattern -ErrorAction SilentlyContinue
  }
  if ($hits) {
    $targets = @($targets | Where-Object { $_.Reason -ne $iconReason })
    Write-Warning 'Legacy icons are still referenced and were excluded from the cleanup:'
    $hits | ForEach-Object { Write-Warning ("  {0}:{1}  {2}" -f $_.Path, $_.LineNumber, $_.Line.Trim()) }
  } else {
    Write-Host ("Legacy icon pre-flight OK: {0} unreferenced icon files" -f $iconTargets.Count)
  }
}

if (-not $targets.Count) { Write-Host 'Nothing to clean.'; exit 0 }

$totalBytes = 0
$totalFiles = 0
$groups = @{}
$highlights = New-Object System.Collections.Generic.List[object]

foreach ($target in $targets) {
  $exists = Test-Path -LiteralPath $target.Path
  $mb = if ($target.Kind -eq 'dir') { Get-SizeMB $target.Path } else { if ($exists) { [math]::Round((Get-Item -LiteralPath $target.Path).Length / 1MB, 2) } else { 0 } }
  $count = if ($target.Kind -eq 'dir' -and $exists) { @(Get-ChildItem -LiteralPath $target.Path -Recurse -File -Force -ErrorAction SilentlyContinue).Count } else { 1 }
  $totalBytes += $mb
  $totalFiles += $count

  if (-not $groups.ContainsKey($target.Reason)) {
    $groups[$target.Reason] = [pscustomobject]@{ Reason = $target.Reason; Targets = 0; Files = 0; MB = 0.0 }
  }
  $groups[$target.Reason].Targets += 1
  $groups[$target.Reason].Files += $count
  $groups[$target.Reason].MB += $mb

  # Directories are the meaningful units; individual build artefacts are rolled up.
  if ($target.Kind -eq 'dir' -or $mb -ge 1) {
    $highlights.Add([pscustomobject]@{ MB = $mb; Files = $count; Path = $target.Path.Replace($ReleaseRoot + '\', '') })
  }
}

Write-Host '--- largest individual targets ---'
$highlights | Sort-Object MB -Descending | Select-Object -First 25 | Format-Table -AutoSize

Write-Host ''
Write-Host '--- by category ---'
$groups.Values | Sort-Object MB -Descending | Format-Table -AutoSize

Write-Host ''
Write-Host ("Release root : {0}" -f $ReleaseRoot)
Write-Host ("Targets      : {0}" -f $targets.Count)
Write-Host ("Files        : {0}" -f $totalFiles)
Write-Host ("Reclaimable  : {0:N1} MB" -f $totalBytes)
Write-Host ''

if (-not $Apply) {
  Write-Host 'DRY RUN - nothing was deleted. Re-run with -Apply to remove the entries above.' -ForegroundColor Yellow
  exit 0
}

# Safety: never delete the release root itself, the executable, or the live DSH home.
$forbidden = @(
  (Resolve-Path -LiteralPath $ReleaseRoot).Path,
  (Join-Path $ReleaseRoot 'TaskHive.exe'),
  (Join-Path $appRoot 'profiles\dsh')
)
foreach ($target in $targets) {
  $resolved = (Resolve-Path -LiteralPath $target.Path -ErrorAction SilentlyContinue).Path
  if (-not $resolved) { continue }
  foreach ($guard in $forbidden) {
    if ($resolved -eq $guard) { throw "Refusing to delete protected path: $resolved" }
  }
}

$removed = 0
foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target.Path)) { continue }
  try {
    Remove-Item -LiteralPath $target.Path -Recurse -Force -ErrorAction Stop
    $removed += 1
  } catch {
    Write-Warning ("Failed to remove {0}: {1}" -f $target.Path, $_.Exception.Message)
  }
}

Write-Host ("Removed {0} of {1} targets, about {2:N1} MB." -f $removed, $targets.Count, $totalBytes) -ForegroundColor Green
Write-Host 'Rotate the DSH session secrets that were stored in the removed QA profiles:' -ForegroundColor Yellow
Write-Host '  the files are gone from this copy, but any copy already distributed still carries them.'
