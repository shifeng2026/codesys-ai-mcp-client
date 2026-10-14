param(
  # User-requested deletion (2026-10): the "AI live monitoring" capability is gone, so
  # this script now only ENUMERATES windows. The former capture mode (PrintWindow frame
  # grab) and fit mode (rewriting the CODESYS window geometry to the plugin canvas
  # ratio) are removed together with their OutputPath / ExpectedPid / CanvasWidth /
  # CanvasHeight / PreserveSize / PreserveAspect / HideTaskbar parameters. Native window
  # hosting is owned by win-window-host.ps1.
  #
  # NOTE: keep comments ASCII -- Windows PowerShell 5.1 reads this file as ANSI when it
  # has no BOM, and non-ASCII bytes break parsing around this block.
  [ValidateSet('list')][string]$Mode = 'list',
  # T194: hidden-window scan for the native host's self-heal.
  #
  # The enumeration below is deliberately visibility-filtered -- that is exactly what
  # the surface dropdown wants -- but it also means a window the native host hid with
  # SW_HIDE can never be seen again by ANY caller in this build: not by the dropdown,
  # not by project detection, not by the startup cleanup (which then answers "no
  # window", keeps the instance and leaves it unreachable). With -IncludeHidden the
  # enumeration ALSO returns windows whose WS_VISIBLE style bit is clear, but only for
  # the PIDs named in -PluginPids, i.e. the instances this plugin launched. No other
  # window on the desktop is enumerated even then, and this script still never mutates
  # anything: it reports, and the caller decides.
  [switch]$IncludeHidden,
  [string]$PluginPids = ''
)

# T137: Windows PowerShell 5.1 writes stdout in the console code page (GBK / 936 on
# this machine), so a Chinese window title reached Node as mojibake
# (observed: the CODESYS "profile chooser" dialog title rendered as garbage in the
# surface dropdown). Emit UTF-8 so the caller's UTF-8 decode is correct.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [System.Text.Encoding]::UTF8

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
  // T194: the WS_VISIBLE style bit. IsWindowVisible is the EFFECTIVE answer and also
  // goes false while a window's owner is minimized (measured, see the T188 note in
  // win-window-host.ps1), so it cannot tell "hidden with SW_HIDE" from "hidden because
  // the shell is minimized". Only the style bit can, and that distinction is what the
  // self-heal decides on.
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong32(IntPtr hWnd, int index);
  public static IntPtr GetLong(IntPtr hWnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : new IntPtr(GetWindowLong32(hWnd, index)); }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  // T187: DPI awareness -- same reasoning and same measurement as win-window-host.ps1.
  // Without it this process is DPI-UNAWARE and GetWindowRect answers in a virtualised 96-DPI
  // space: on this machine a 2560x1600 desktop at 150% is reported as 1707x1067, so every
  // rectangle comes back divided by 1.5. Those rectangles are not decoration -- the native
  // host stores them as the restore geometry it writes back when a window is released, so
  // the two scripts have to agree on one unit. Per-monitor-v2 pins that unit to physical
  // pixels, which is what the caller (screen.dipToScreenRect) already speaks.
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
}
'@

# T187: must run before the first rectangle is read. The call is refused only when the process
# awareness is already fixed by a manifest, which is not the case for powershell.exe 5.1 on
# this machine (measured: awareness 0 = unaware by default, and this call then succeeds). The
# shape of the list output is deliberately unchanged -- only the unit is pinned.
try { [void][TaskHiveWin]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) } catch { }

if ($Mode -eq 'list') {
  $WS_VISIBLE = 0x10000000L
  $GWL_STYLE = -16
  # T194: an allow-list is mandatory for the hidden scan. "Every hidden top-level
  # window on this desktop" is precisely the population the caller must never touch,
  # so an empty -PluginPids means the scan enumerates NOTHING and says so by
  # returning no items (the caller treats empty output as "no candidates").
  $hiddenPids = New-Object System.Collections.Generic.List[int]
  if ($IncludeHidden) {
    foreach ($part in ($PluginPids -split ',')) {
      $parsedPid = 0
      if ([int]::TryParse($part.Trim(), [ref]$parsedPid) -and $parsedPid -gt 0) { $hiddenPids.Add($parsedPid) }
    }
    if ($hiddenPids.Count -eq 0) { exit 0 }
  }
  $items = New-Object System.Collections.Generic.List[object]
  [TaskHiveWin]::EnumWindows({ param($handle, $unused)
    $processId = 0
    [void][TaskHiveWin]::GetWindowThreadProcessId($handle, [ref]$processId)
    if ($IncludeHidden) {
      # T194: scan mode is STRICTLY confined to the named PIDs. Enumerating everything
      # else and then filtering in the caller was measured to leak: a VISIBLE window of
      # an unrelated PID passed the old "not in scope and not visible" test and ended up
      # in the revive scan's input (found by tests/codesys-native-host-revive-contract.js
      # -- 3 foreign windows in one result). A hidden-window scan must never widen the
      # population it looks at, so the allow-list is the only admission.
      if (-not $hiddenPids.Contains([int]$processId)) { return $true }
    } elseif (-not [TaskHiveWin]::IsWindowVisible($handle)) {
      return $true
    }
    $len = [TaskHiveWin]::GetWindowTextLength($handle)
    if ($len -le 0) { return $true }
    $titleBuffer = New-Object System.Text.StringBuilder ($len + 1)
    [void][TaskHiveWin]::GetWindowText($handle, $titleBuffer, $titleBuffer.Capacity)
    $title = $titleBuffer.ToString()
    try { $process = Get-Process -Id $processId -ErrorAction Stop; $processName = $process.ProcessName } catch { $processName = '' }
    $taskHiveFixture = $env:TASKHIVE_CODESYS_TEST_FIXTURE -eq '1' -and $title -match '^CODESYS TaskHive Media Fixture(?: [AB])?$'
    if ($processName -match '(?i)^codesys' -or $taskHiveFixture) {
      $rect = New-Object TaskHiveWin+RECT
      if ([TaskHiveWin]::GetWindowRect($handle, [ref]$rect)) {
        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
        $minimized = [TaskHiveWin]::IsIconic($handle)
        $visible = [TaskHiveWin]::IsWindowVisible($handle)
        $style = [TaskHiveWin]::GetLong($handle, $GWL_STYLE).ToInt64()
        $usable = (-not $minimized) -and $width -ge 320 -and $height -ge 200
        $items.Add([pscustomobject]@{
          id = ('0x{0:X}' -f $handle.ToInt64()); title = $title; processName = $processName; pid = $processId;
          left = $rect.Left; top = $rect.Top; width = $width; height = $height; minimized = $minimized; usable = $usable;
          visible = $visible; styleVisible = (($style -band $WS_VISIBLE) -ne 0); style = $style;
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

exit 0
