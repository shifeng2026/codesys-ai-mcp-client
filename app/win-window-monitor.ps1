param(
  [ValidateSet('list', 'capture', 'fit')][string]$Mode = 'list',
  [string]$WindowId,
  [string]$OutputPath,
  [int]$ExpectedPid,
  [int]$CanvasWidth,
  [int]$CanvasHeight,
  [switch]$PreserveSize,
  [switch]$HideTaskbar,
  [switch]$AllowFixture
)

Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TaskHiveWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  public static long GetLong(IntPtr hWnd, int index) { return GetWindowLongPtr(hWnd, index).ToInt64(); }
  public static long SetLong(IntPtr hWnd, int index, long value) { return SetWindowLongPtr(hWnd, index, new IntPtr(value)).ToInt64(); }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int Size; public RECT Monitor; public RECT Work; public uint Flags; }
}
'@

if ($Mode -eq 'list') {
  $items = New-Object System.Collections.Generic.List[object]
  [TaskHiveWin]::EnumWindows({ param($handle, $unused)
    if (-not [TaskHiveWin]::IsWindowVisible($handle)) { return $true }
    $len = [TaskHiveWin]::GetWindowTextLength($handle)
    if ($len -le 0) { return $true }
    $titleBuffer = New-Object System.Text.StringBuilder ($len + 1)
    [void][TaskHiveWin]::GetWindowText($handle, $titleBuffer, $titleBuffer.Capacity)
    $title = $titleBuffer.ToString()
    $processId = 0
    [void][TaskHiveWin]::GetWindowThreadProcessId($handle, [ref]$processId)
    try { $process = Get-Process -Id $processId -ErrorAction Stop; $processName = $process.ProcessName } catch { $processName = '' }
    $taskHiveFixture = $env:TASKHIVE_CODESYS_TEST_FIXTURE -eq '1' -and $title -match '^CODESYS TaskHive Media Fixture(?: [AB])?$'
    if ($processName -match '(?i)^codesys' -or $taskHiveFixture) {
      $rect = New-Object TaskHiveWin+RECT
      if ([TaskHiveWin]::GetWindowRect($handle, [ref]$rect)) {
        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
        $minimized = [TaskHiveWin]::IsIconic($handle)
        $usable = (-not $minimized) -and $width -ge 320 -and $height -ge 200
        $items.Add([pscustomobject]@{
          id = ('0x{0:X}' -f $handle.ToInt64()); title = $title; processName = $processName; pid = $processId;
          left = $rect.Left; top = $rect.Top; width = $width; height = $height; minimized = $minimized; usable = $usable;
          reason = if ($usable) { $null } elseif ($minimized) { 'window-minimized' } else { 'window-frame-too-small' };
          fixture = $taskHiveFixture
        })
      }
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  $items | ConvertTo-Json -Compress
  exit 0
}

if (-not $WindowId) { throw "$Mode requires WindowId" }
$value = $WindowId.Trim()
if ($value -match '^0x') { $handle = [IntPtr]::new([Convert]::ToInt64($value.Substring(2), 16)) }
else { $handle = [IntPtr]::new([Convert]::ToInt64($value)) }

if ($Mode -eq 'fit') {
  if (-not [TaskHiveWin]::IsWindow($handle)) { throw 'CODESYS window handle is invalid' }
  $actualPid = 0
  [void][TaskHiveWin]::GetWindowThreadProcessId($handle, [ref]$actualPid)
  if ($ExpectedPid -le 0 -or $actualPid -ne $ExpectedPid) { throw 'CODESYS window PID identity changed' }
  try { $targetProcess = Get-Process -Id $actualPid -ErrorAction Stop } catch { throw 'CODESYS window process is unavailable' }
  if ($targetProcess.ProcessName -notmatch '(?i)^codesys' -and -not $AllowFixture) { throw 'window fit only accepts verified CODESYS processes' }
  if ($CanvasWidth -lt 320 -or $CanvasHeight -lt 200) { throw 'plugin canvas is too small for CODESYS window fit' }
  $monitor = [TaskHiveWin]::MonitorFromWindow($handle, 2)
  $monitorInfo = New-Object TaskHiveWin+MONITORINFO
  $monitorInfo.Size = [Runtime.InteropServices.Marshal]::SizeOf($monitorInfo)
  if (-not [TaskHiveWin]::GetMonitorInfo($monitor, [ref]$monitorInfo)) { throw 'cannot resolve CODESYS monitor work area' }
  $workWidth = [Math]::Max(320, $monitorInfo.Work.Right - $monitorInfo.Work.Left)
  $workHeight = [Math]::Max(200, $monitorInfo.Work.Bottom - $monitorInfo.Work.Top)
  $canvasRatio = [double]$CanvasWidth / [double]$CanvasHeight
  if ($PreserveSize) {
    $launchRect = New-Object TaskHiveWin+RECT
    if (-not [TaskHiveWin]::GetWindowRect($handle, [ref]$launchRect)) { throw 'cannot resolve CODESYS launch window bounds' }
    $targetWidth = [Math]::Min($workWidth, [Math]::Max(320, $launchRect.Right - $launchRect.Left))
    $targetHeight = [Math]::Min($workHeight, [Math]::Max(200, $launchRect.Bottom - $launchRect.Top))
  } else {
    $targetWidth = $workWidth
    $targetHeight = [Math]::Max(200, [int][Math]::Round($targetWidth / $canvasRatio))
    if ($targetHeight -gt $workHeight) {
      $targetHeight = $workHeight
      $targetWidth = [Math]::Max(320, [int][Math]::Round($targetHeight * $canvasRatio))
    }
  }
  $left = $monitorInfo.Work.Left + [int][Math]::Floor(($workWidth - $targetWidth) / 2)
  $top = $monitorInfo.Work.Top + [int][Math]::Floor(($workHeight - $targetHeight) / 2)
  # SW_RESTORE is only needed to leave a prior maximized/minimized placement.
  # SetWindowPos uses NOACTIVATE so later canvas resize never steals focus.
  [void][TaskHiveWin]::ShowWindowAsync($handle, 9)
  if (-not [TaskHiveWin]::SetWindowPos($handle, [IntPtr]::Zero, $left, $top, $targetWidth, $targetHeight, 0x0054)) { throw 'failed to fit CODESYS window to plugin canvas' }
  $taskbarHidden = $false
  if ($HideTaskbar -and -not $AllowFixture) {
    # Keep the real CODESYS window top-level and manually operable, while
    # removing only the taskbar/Alt-Tab app classification. Never re-parent it.
    $GWL_EXSTYLE = -20
    $WS_EX_TOOLWINDOW = 0x00000080L
    $WS_EX_APPWINDOW = 0x00040000L
    $oldExStyle = [TaskHiveWin]::GetLong($handle, $GWL_EXSTYLE)
    $newExStyle = ($oldExStyle -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW)
    [void][TaskHiveWin]::SetLong($handle, $GWL_EXSTYLE, $newExStyle)
    [void][TaskHiveWin]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, 0, 0, 0x0037)
    $taskbarHidden = $true
  }
  $actualRect = New-Object TaskHiveWin+RECT
  if (-not [TaskHiveWin]::GetWindowRect($handle, [ref]$actualRect)) { throw 'cannot verify fitted CODESYS window bounds' }
  $actualWidth = $actualRect.Right - $actualRect.Left
  $actualHeight = $actualRect.Bottom - $actualRect.Top
  [pscustomobject]@{
    windowId = ('0x{0:X}' -f $handle.ToInt64()); pid = $actualPid; fitted = $true;
    fitMode = if ($PreserveSize) { 'center-launch-window' } else { 'window-to-plugin-canvas' }; taskbarHidden = $taskbarHidden;
    canvasWidth = $CanvasWidth; canvasHeight = $CanvasHeight; canvasRatio = $canvasRatio;
    left = $actualRect.Left; top = $actualRect.Top; width = $actualWidth; height = $actualHeight;
    windowRatio = [double]$actualWidth / [Math]::Max(1, $actualHeight);
    workArea = [pscustomobject]@{ left = $monitorInfo.Work.Left; top = $monitorInfo.Work.Top; width = $workWidth; height = $workHeight }
  } | ConvertTo-Json -Compress
  exit 0
}

if (-not $OutputPath) { throw 'capture requires OutputPath' }
# Captured frames are handed to the AI as "the CODESYS screen", so the HWND must be
# re-validated exactly like fit: Windows recycles HWND values once a window is
# destroyed, and a stale handle can silently belong to an unrelated process.
$handleText = '0x{0:X}' -f $handle.ToInt64()
if (-not [TaskHiveWin]::IsWindow($handle)) { throw ('CODESYS capture window handle is invalid: {0}' -f $handleText) }
$actualPid = 0
[void][TaskHiveWin]::GetWindowThreadProcessId($handle, [ref]$actualPid)
if ($ExpectedPid -le 0 -or $actualPid -ne $ExpectedPid) {
  throw ('CODESYS capture window PID identity changed: expected pid {0} for window {1} but the window belongs to pid {2}' -f $ExpectedPid, $handleText, $actualPid)
}
try { $targetProcess = Get-Process -Id $actualPid -ErrorAction Stop } catch { throw 'CODESYS window process is unavailable' }
if ($targetProcess.ProcessName -notmatch '(?i)^codesys' -and -not $AllowFixture) { throw 'window capture only accepts verified CODESYS processes' }
$rect = New-Object TaskHiveWin+RECT
if (-not [TaskHiveWin]::GetWindowRect($handle, [ref]$rect)) { throw '无法获取窗口边界' }
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
if ([TaskHiveWin]::IsIconic($handle) -or $width -lt 320 -or $height -lt 200) { throw ('CODESYS window cannot provide a complete frame: {0}x{1}' -f [int]$width, [int]$height) }
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$ok = [TaskHiveWin]::PrintWindow($handle, $hdc, 2)
$graphics.ReleaseHdc($hdc)
if (-not $ok) {
  # No screen-region fallback: copying whatever desktop pixels currently sit at
  # these coordinates must never be reported to the AI as the CODESYS screen. A
  # failed PrintWindow is a real, reportable capture failure.
  $graphics.Dispose()
  $bitmap.Dispose()
  throw 'CODESYS window capture failed: PrintWindow could not render the window'
}
$graphics.Dispose()
$directory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Output ($OutputPath | ConvertTo-Json -Compress)
