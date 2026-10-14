param(
  [ValidateSet('attach', 'move', 'suspend', 'resume', 'detach')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$WindowId,
  [Parameter(Mandatory=$true)][int]$ExpectedPid,
  [string]$HostWindowId = '0x0',
  [long]$RestoreStyle = 0,
  [long]$RestoreExStyle = 0,
  [string]$RestoreOwner = '0x0',
  [int]$Left = 0,
  [int]$Top = 0,
  [int]$Width = 800,
  [int]$Height = 600,
  [switch]$AllowFixture,
  # T188: non-mutating liveness probe. -Mode keeps its exact ValidateSet (the contract
  # pins it), so the probe is a separate switch rather than a sixth mode.
  [switch]$Probe,
  # T192: the ONLY reload entry this build can offer. It reads the target window's
  # native Win32 menu bar (GetMenu) and, if and only if a top-level File/Project menu
  # carries an item whose caption is EXACTLY one of the reload captions below, posts
  # WM_COMMAND with that item's command id. It never expands a menu, never focuses,
  # never moves/resizes/styles the window, never closes or opens anything.
  # CODESYS V3.5 SP20 has no such menu item at all (its full 709-entry menu
  # definition lives in CODESYS\Settings\*.opt.menu) and its menu bar is not a native
  # Win32 menu, so in practice this answers "no-native-menubar" / "no-reload-command"
  # and the caller must fall back to close-project/open-project. Anything else would
  # be an invented command, so this switch deliberately reports what it SAW.
  [switch]$ReloadProject,
  # T194: the visibility half of -Mode resume, as its own switch.
  #
  # Why this has to exist at all: suspend() is the ONE native-host operation whose
  # effect is stored IN THE WINDOW (ShowWindowAsync(SW_HIDE) clears the WS_VISIBLE
  # style bit and it stays cleared) while the state that explains it (which surface
  # is in front) is memory-only in the host process. Measured on this machine
  # 2026-10-04: hwnd 0x2D709C4 / pid 38816 was left WS_VISIBLE=0 with the live
  # rect 288,77,1188x1012 -- alive, reachable by no enumeration and by no user
  # gesture, because a hidden tool-window is absent from the taskbar and Alt-Tab.
  # Nothing else in this build would ever show it again.
  #
  # What it changes: SW_SHOWNA + SetWindowPos(SWP_NOACTIVATE|SWP_SHOWWINDOW) at the
  # bounds the window already has -- exactly the resume pair, no activation call of
  # any kind, no style/owner/geometry rewrite. It refuses a minimized window
  # (IsIconic: the operator's own state, never ours) and a window whose WS_VISIBLE
  # bit is already set (nothing to do), and it treats only the STYLE BIT as the
  # decision: the effective IsWindowVisible also goes false while an owner is
  # minimized (T188), so deciding on that would show a window the operator never
  # asked to see.
  [switch]$Revive
)

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TaskHiveNativeHost {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  // T194: the probe reports the window title and owning process name so the caller
  // can re-check identity before showing a hidden window. The probe branch returns
  // before the process-name gate below, so without these two fields a probe-only
  // caller would have to TRUST the recorded pid instead of verifying it.
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
// T161: a MAXIMIZED window also needs SW_RESTORE before docking, otherwise
// SetWindowPos only changes its restore rectangle while it stays full screen.
[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
// T162: async variant for suspend/resume -- ShowWindow blocks on the target thread.
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong32(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] public static extern int SetWindowLong32(IntPtr hWnd, int index, int value);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  public static IntPtr GetLong(IntPtr hWnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : new IntPtr(GetWindowLong32(hWnd, index)); }
  public static IntPtr SetLong(IntPtr hWnd, int index, IntPtr value) { return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, index, value) : new IntPtr(SetWindowLong32(hWnd, index, value.ToInt32())); }
  // T192: read-only menu inspection for -ReloadProject. GetMenu answers IntPtr.Zero for
  // windows whose menu bar is drawn by the application itself (which is the case for the
  // CODESYS V3.5 shell), and that is exactly what the caller must be told.
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr hMenu, int position);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr hMenu);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr hMenu, int position);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="GetMenuStringW")] public static extern int GetMenuString(IntPtr hMenu, uint item, StringBuilder text, int maxCount, uint flags);
  [DllImport("user32.dll", EntryPoint="PostMessageW")] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  // MF_BYPOSITION = 0x400: the caller addresses items by index, never by command id.
  public static string MenuText(IntPtr menu, int position) {
    StringBuilder buffer = new StringBuilder(256);
    int length = GetMenuString(menu, (uint)position, buffer, buffer.Capacity, 0x00000400);
    return length > 0 ? buffer.ToString() : string.Empty;
  }
  public static bool IsSeparatorOrSubmenu(IntPtr menu, int position) {
    uint id = GetMenuItemID(menu, position);
    return id == 0 || id == 0xFFFFFFFF;
  }
  // T187: DPI awareness. This file is launched through powershell.exe (5.1), which carries no
  // DPI manifest and therefore starts DPI-UNAWARE: every window rectangle it reads or writes
  // lives in a virtualised 96-DPI space that Windows rescales by the display scale factor.
  // The caller (main.js) sends PHYSICAL pixels (screen.dipToScreenRect), so the unaware host
  // scaled every coordinate a SECOND time. Measured on this machine 2026-10-04, scale 1.5,
  // request 432,116,1476x1402: the window landed physically at 648,174,2214x1631 -- 1.5x too
  // large, shifted right/down, running off the bottom of the screen -- which is exactly the
  // reported "window opens in the wrong place, not inside the plugin panel". The audit looked
  // almost clean because the host's own read-back divided by 1.5 again and reported
  // "actual = requested" for x/y/width; only the height differed (1087), because 1087 is
  // SM_CYMAXTRACK in that virtualised space. That lone number is the leaked maxDelta=315.
  // Becoming per-monitor-v2 aware puts this process in the same unit as its caller, so the
  // rectangles are used verbatim and no conversion is performed here.
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
  public static int Awareness() { return GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); }
}
'@

# T187: must run before the first rectangle is read or written. -4 is
# DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2; GetAwarenessFromDpiAwarenessContext then reports
# 2 for it. The call is refused only when process awareness is already fixed by a manifest,
# which is not the case here (measured: powershell.exe 5.1 reports awareness 0 = unaware by
# default and accepts this call). The awareness actually obtained is reported on every mode so
# that a refusal can never masquerade as a successful dock -- see codesys-native-host.js
# dpiCoordinateSpace().
try { [void][TaskHiveNativeHost]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) } catch { }
$dpiAwareness = [TaskHiveNativeHost]::Awareness()
$coordinateSpace = if ($dpiAwareness -ge 2) { 'physical' } else { 'virtualized' }

function Convert-Handle([string]$value) {
  $text = $value.Trim()
  if ($text -match '^0x') { return [IntPtr]::new([Convert]::ToInt64($text.Substring(2), 16)) }
  return [IntPtr]::new([Convert]::ToInt64($text))
}

$GWL_STYLE = -16
$GWL_EXSTYLE = -20
$GWLP_HWNDPARENT = -8

# T188: liveness probe. It has to answer "does this HWND still exist and is it still the
# same process" WITHOUT changing anything and WITHOUT depending on visibility.
#
# Why not reuse the list mode: win-window-monitor.ps1 enumerates only windows for which
# IsWindowVisible is true. But an owned window is HIDDEN while its owner is minimized --
# measured on this machine: with the host minimized, IsWindowVisible(target) flips to
# False while the HWND is still perfectly alive and GetWindowRect still answers. Judging
# "hosted window is gone" from a visibility-filtered enumeration would therefore report a
# lost window every time the operator minimizes TaskHive, and the recovery path would then
# pull the CODESYS window back on screen over a minimized shell.
$probeHandle = Convert-Handle $WindowId
if ($Probe) {
  $probeExists = [TaskHiveNativeHost]::IsWindow($probeHandle)
  $probePid = [uint32]0
  $probeOwner = [IntPtr]::Zero
  $probeStyle = 0
  $probeRect = $null
  $probeTitle = ''
  $probeProcessName = ''
  if ($probeExists) {
    [void][TaskHiveNativeHost]::GetWindowThreadProcessId($probeHandle, [ref]$probePid)
    $probeTitleBuffer = New-Object System.Text.StringBuilder 512
    if ([TaskHiveNativeHost]::GetWindowText($probeHandle, $probeTitleBuffer, $probeTitleBuffer.Capacity) -gt 0) { $probeTitle = $probeTitleBuffer.ToString() }
    try { $probeProcessName = (Get-Process -Id $probePid -ErrorAction Stop).ProcessName } catch { $probeProcessName = '' }
    $probeOwner = [TaskHiveNativeHost]::GetLong($probeHandle, $GWLP_HWNDPARENT)
    $probeStyle = [TaskHiveNativeHost]::GetLong($probeHandle, $GWL_STYLE).ToInt64()
    $probeRectValue = New-Object TaskHiveNativeHost+RECT
    if ([TaskHiveNativeHost]::GetWindowRect($probeHandle, [ref]$probeRectValue)) {
      $probeRect = [pscustomobject]@{ x=$probeRectValue.Left; y=$probeRectValue.Top; width=($probeRectValue.Right-$probeRectValue.Left); height=($probeRectValue.Bottom-$probeRectValue.Top) }
    }
  }
  [pscustomobject]@{
    ok = $true; mode = 'probe'; dpiAwareness = $dpiAwareness; coordinateSpace = $coordinateSpace;
    windowId = ('0x{0:X}' -f $probeHandle.ToInt64()); exists = $probeExists; pid = [int]$probePid;
    owner = ('0x{0:X}' -f $probeOwner.ToInt64()); style = $probeStyle; title = $probeTitle; processName = $probeProcessName;
    visible = if ($probeExists) { [TaskHiveNativeHost]::IsWindowVisible($probeHandle) } else { $false };
    iconic = if ($probeExists) { [TaskHiveNativeHost]::IsIconic($probeHandle) } else { $false };
    rect = $probeRect
  } | ConvertTo-Json -Compress
  exit 0
}

$handle = $probeHandle
if (-not [TaskHiveNativeHost]::IsWindow($handle)) { throw 'Target HWND no longer exists' }
$actualPid = [uint32]0
[void][TaskHiveNativeHost]::GetWindowThreadProcessId($handle, [ref]$actualPid)
if ([int]$actualPid -ne $ExpectedPid) { throw 'Target HWND PID changed' }
$process = Get-Process -Id $actualPid -ErrorAction Stop
$fixtureAllowed = $AllowFixture -and $env:TASKHIVE_CODESYS_TEST_FIXTURE -eq '1'
if ($process.ProcessName -notmatch '(?i)^codesys' -and -not $fixtureAllowed) { throw 'Target window process is not CODESYS' }

# T192: -ReloadProject. Deliberately placed BEFORE the bounds gate: reading a menu bar
# needs no geometry, and a small window must not be reported as "no reload entry".
# Nothing below this point runs for this switch -- no style write, no owner change,
# no SetWindowPos, no ShowWindow, no focus call. The only mutation possible is one
# PostMessage(WM_COMMAND) carrying the command id of a caption that matched exactly.
if ($ReloadProject) {
  $WM_COMMAND = 0x0111
  # Every non-English caption is assembled from code points on purpose: this file has no
  # BOM and is launched through powershell.exe (5.1), which reads BOM-less UTF-8 as ANSI,
  # so a literal non-ASCII byte would be mis-decoded here exactly as documented above for
  # comments. ASCII-only source, real Unicode captions at run time.
  #   0x91CD 0x65B0 0x52A0 0x8F7D          = reload
  #   0x5DE5 0x7A0B                        = project/engineering
  #   0x9879 0x76EE                        = project/item
  #   0x6587 0x4EF6                        = file
  #   0x5E93                               = library
  $zhReload = [string][char]0x91CD + [char]0x65B0 + [char]0x52A0 + [char]0x8F7D
  $zhProject = [string][char]0x9879 + [char]0x76EE
  $zhLibrary = [string][char]0x5E93
  $reloadCaptions = @('reload', 'reload project', 'reload project from disk', $zhReload, ($zhReload + [char]0x5DE5 + [char]0x7A0B), ($zhReload + $zhProject))
  $topLevelCaptions = @('file', 'project', ([string][char]0x6587 + [char]0x4EF6), $zhProject)
  $menuBar = [TaskHiveNativeHost]::GetMenu($handle)
  $menuBarCount = if ($menuBar -eq [IntPtr]::Zero) { 0 } else { [TaskHiveNativeHost]::GetMenuItemCount($menuBar) }
  if ($menuBarCount -le 0) {
    [pscustomobject]@{
      ok = $false; mode = 'reload-project'; reason = 'no-native-menubar'; invoked = $false;
      windowId = ('0x{0:X}' -f $handle.ToInt64()); pid = [int]$actualPid; scanned = 0; topLevelMenus = ''; commandId = 0; caption = ''
    } | ConvertTo-Json -Compress
    exit 0
  }
  # Normalization is local and total: strip the Win32 accelerator marker (both "&X" and a
  # trailing "(Ctrl+X)" / "(&R)" hint), collapse whitespace, lowercase. A caption only ever
  # matches the SHORT allowlist above, and any caption mentioning a library is refused
  # outright -- the one real "reload" command in the CODESYS menus is "Try To Reload
  # Library" and invoking it here would be a different, unintended operation. Measured on
  # the fixture: without the accelerator strip, "reload(&R)" never matched anything.
  function Get-NormalizedCaption([string]$text) {
    if ($null -eq $text) { return '' }
    $value = $text -replace '&', ''
    $value = $value -replace '\((?:ctrl|shift|alt)?[^()]*\)\s*$', ''
    $value = $value -replace '\s+', ' '
    return $value.Trim().ToLowerInvariant()
  }
  $topNames = New-Object System.Collections.Generic.List[string]
  $scanned = 0
  for ($top = 0; $top -lt $menuBarCount; $top += 1) {
    $topCaption = [TaskHiveNativeHost]::MenuText($menuBar, $top)
    if ($topCaption) { $topNames.Add((Get-NormalizedCaption $topCaption)) }
    if ($topLevelCaptions -notcontains (Get-NormalizedCaption $topCaption)) { continue }
    $subMenu = [TaskHiveNativeHost]::GetSubMenu($menuBar, $top)
    if ($subMenu -eq [IntPtr]::Zero) { continue }
    $subCount = [TaskHiveNativeHost]::GetMenuItemCount($subMenu)
    for ($item = 0; $item -lt $subCount; $item += 1) {
      $scanned += 1
      $caption = Get-NormalizedCaption ([TaskHiveNativeHost]::MenuText($subMenu, $item))
      if (-not $caption) { continue }
      if ($caption -match 'library') { continue }
      if ($caption.Contains($zhLibrary)) { continue }
      if ($reloadCaptions -notcontains $caption) { continue }
      if ([TaskHiveNativeHost]::IsSeparatorOrSubmenu($subMenu, $item)) { continue }
      $commandId = [TaskHiveNativeHost]::GetMenuItemID($subMenu, $item)
      [void][TaskHiveNativeHost]::PostMessage($handle, $WM_COMMAND, [IntPtr]::new([int64]$commandId), [IntPtr]::Zero)
      [pscustomobject]@{
        ok = $true; mode = 'reload-project'; reason = ''; invoked = $true;
        windowId = ('0x{0:X}' -f $handle.ToInt64()); pid = [int]$actualPid; scanned = $scanned;
        topLevelMenus = ($topNames -join '|'); commandId = [int]$commandId; caption = $caption
      } | ConvertTo-Json -Compress
      exit 0
    }
  }
  [pscustomobject]@{
    ok = $false; mode = 'reload-project'; reason = 'no-reload-command'; invoked = $false;
    windowId = ('0x{0:X}' -f $handle.ToInt64()); pid = [int]$actualPid; scanned = $scanned;
    topLevelMenus = ($topNames -join '|'); commandId = 0; caption = ''
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Width -lt 320 -or $Height -lt 200) { throw 'Native host bounds are too small' }

$WS_CAPTION = 0x00C00000L
$WS_THICKFRAME = 0x00040000L
$WS_MINIMIZEBOX = 0x00020000L
$WS_MAXIMIZEBOX = 0x00010000L
$WS_SYSMENU = 0x00080000L
$WS_EX_TOOLWINDOW = 0x00000080L
$WS_EX_APPWINDOW = 0x00040000L
$SW_HIDE = 0
$SW_SHOWNA = 8
$SW_RESTORE = 9
$SWP_NOACTIVATE = 0x0010
$SWP_FRAMECHANGED = 0x0020
$SWP_SHOWWINDOW = 0x0040

# T194: -Revive. Restore only the VISIBILITY of a window this plugin hid with
# SW_HIDE (see the switch comment in the param block for why that state needs a
# dedicated entry point). Identity has already been proven above: the HWND exists,
# it still belongs to -ExpectedPid, and that process is CODESYS. Nothing here is
# allowed to steal focus: SW_SHOWNA shows without activating and SetWindowPos runs
# with SWP_NOACTIVATE. The geometry is READ, never invented -- a revived window
# keeps the position it had, so this can never move a window the operator placed.
if ($Revive) {
  $WS_VISIBLE = 0x10000000L
  $styleBefore = [TaskHiveNativeHost]::GetLong($handle, $GWL_STYLE).ToInt64()
  $visibleBefore = [TaskHiveNativeHost]::IsWindowVisible($handle)
  $iconicBefore = [TaskHiveNativeHost]::IsIconic($handle)
  # The decision is made on the style BIT only. IsWindowVisible is the effective
  # answer and also flips to False when an owner is minimized (measured, T188), so
  # "hidden by us" and "hidden because its owner is minimized" are only separable
  # here. Both are reported so a reader can see which one it was.
  $styleVisibleBefore = (($styleBefore -band $WS_VISIBLE) -ne 0)
  $rectBefore = New-Object TaskHiveNativeHost+RECT
  $haveRect = [TaskHiveNativeHost]::GetWindowRect($handle, [ref]$rectBefore)
  $boundsBefore = if ($haveRect) { [pscustomobject]@{ x=$rectBefore.Left; y=$rectBefore.Top; width=($rectBefore.Right-$rectBefore.Left); height=($rectBefore.Bottom-$rectBefore.Top) } } else { $null }
  $styleVisibleAfter = $styleVisibleBefore
  $visibleAfter = $visibleBefore
  $revived = $false
  $reason = ''
  if ($iconicBefore) {
    $reason = 'window-minimized'
  } elseif ($styleVisibleBefore) {
    $reason = 'style-visible'
  } elseif (-not $haveRect) {
    $reason = 'cannot-read-bounds'
  } else {
    [void][TaskHiveNativeHost]::ShowWindowAsync($handle, $SW_SHOWNA)
    $placed = [TaskHiveNativeHost]::SetWindowPos($handle, [IntPtr]::Zero, $boundsBefore.x, $boundsBefore.y, $boundsBefore.width, $boundsBefore.height, ($SWP_NOACTIVATE -bor $SWP_SHOWWINDOW))
    $styleAfter = [TaskHiveNativeHost]::GetLong($handle, $GWL_STYLE).ToInt64()
    $styleVisibleAfter = (($styleAfter -band $WS_VISIBLE) -ne 0)
    $visibleAfter = [TaskHiveNativeHost]::IsWindowVisible($handle)
    # SWP_SHOWWINDOW sets WS_VISIBLE synchronously, so this read-back is a real
    # verification and not a hope: if the bit is still clear the show did not apply
    # and the caller must report a failure instead of claiming a repair.
    $revived = $styleVisibleAfter -or $visibleAfter
    if (-not $revived) { $reason = 'show-not-applied' }
    elseif (-not $placed) { $reason = 'shown-without-placement' }
  }
  [pscustomobject]@{
    ok = $revived; mode = 'revive'; revived = $revived; reason = $reason;
    identityVerified = $true; dpiAwareness = $dpiAwareness; coordinateSpace = $coordinateSpace;
    windowId = ('0x{0:X}' -f $handle.ToInt64()); pid = [int]$actualPid;
    styleBefore = $styleBefore; styleVisibleBefore = $styleVisibleBefore; visibleBefore = $visibleBefore;
    iconicBefore = $iconicBefore; styleVisibleAfter = $styleVisibleAfter; visibleAfter = $visibleAfter;
    bounds = $boundsBefore; activated = $false; inputSent = $false
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Mode -eq 'attach') {
  $hostHandle = Convert-Handle $HostWindowId
  if (-not [TaskHiveNativeHost]::IsWindow($hostHandle)) { throw 'TaskHive host HWND is invalid' }
  $rect = New-Object TaskHiveNativeHost+RECT
  if (-not [TaskHiveNativeHost]::GetWindowRect($handle, [ref]$rect)) { throw 'Cannot read target window bounds' }
  $style = [TaskHiveNativeHost]::GetLong($handle, $GWL_STYLE).ToInt64()
  $exStyle = [TaskHiveNativeHost]::GetLong($handle, $GWL_EXSTYLE).ToInt64()
  $owner = [TaskHiveNativeHost]::GetLong($handle, $GWLP_HWNDPARENT)
  # T161: IsIconic only covers MINIMIZED. A MAXIMIZED window needs SW_RESTORE too --
  # otherwise SetWindowPos only rewrites the restore rectangle, the window stays full
  # screen, and this script still reports success (panel looks blank while CODESYS
  # covers the screen). win-window-monitor.ps1 already does this with ShowWindowAsync.
  # NOTE: keep comments ASCII-only. This file has no BOM and is launched through
  # powershell.exe (5.1), which reads BOM-less UTF-8 as ANSI; non-ASCII comment bytes
  # get mis-decoded and can swallow the following braces (verified the hard way).
  if ([TaskHiveNativeHost]::IsIconic($handle) -or [TaskHiveNativeHost]::IsZoomed($handle)) {
    [void][TaskHiveNativeHost]::ShowWindow($handle, $SW_RESTORE)
    [void][TaskHiveNativeHost]::GetWindowRect($handle, [ref]$rect)
  }
  $dockedStyle = $style -band (-bnot ($WS_CAPTION -bor $WS_THICKFRAME -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX -bor $WS_SYSMENU))
  $hostedExStyle = ($exStyle -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW)
  [void][TaskHiveNativeHost]::SetLong($handle, $GWL_STYLE, [IntPtr]::new($dockedStyle))
  [void][TaskHiveNativeHost]::SetLong($handle, $GWL_EXSTYLE, [IntPtr]::new($hostedExStyle))
  [void][TaskHiveNativeHost]::SetLong($handle, $GWLP_HWNDPARENT, $hostHandle)
  if (-not [TaskHiveNativeHost]::SetWindowPos($handle, [IntPtr]::Zero, $Left, $Top, $Width, $Height, $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW)) { throw 'Cannot dock target window' }
  $actualExStyle = [TaskHiveNativeHost]::GetLong($handle, $GWL_EXSTYLE).ToInt64()
  $actualOwner = [TaskHiveNativeHost]::GetLong($handle, $GWLP_HWNDPARENT)
  $taskbarHidden = (($actualExStyle -band $WS_EX_TOOLWINDOW) -ne 0) -and (($actualExStyle -band $WS_EX_APPWINDOW) -eq 0)
  # T162: placement read-back, same reasoning as the move branch below.
  $placed = New-Object TaskHiveNativeHost+RECT
  $placedOk = [TaskHiveNativeHost]::GetWindowRect($handle, [ref]$placed)
  $actualBounds = if ($placedOk) { [pscustomobject]@{ x=$placed.Left; y=$placed.Top; width=($placed.Right-$placed.Left); height=($placed.Bottom-$placed.Top) } } else { $null }
  [pscustomobject]@{
    ok = $true; mode = 'owned-native-dock'; identityVerified = $true; styleCaptured = $true;
    dpiAwareness = $dpiAwareness; coordinateSpace = $coordinateSpace;
    hostWindowId = ('0x{0:X}' -f $hostHandle.ToInt64());
    actualOwner = ('0x{0:X}' -f $actualOwner.ToInt64()); actualExStyle = $actualExStyle; taskbarHidden = $taskbarHidden;
    actualBounds = $actualBounds;
    restore = [pscustomobject]@{ style=$style; exStyle=$hostedExStyle; originalExStyle=$exStyle; owner=('0x{0:X}' -f $owner.ToInt64()); left=$rect.Left; top=$rect.Top; width=($rect.Right-$rect.Left); height=($rect.Bottom-$rect.Top) }
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Mode -eq 'move') {
  if (-not [TaskHiveNativeHost]::SetWindowPos($handle, [IntPtr]::Zero, $Left, $Top, $Width, $Height, $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW)) { throw 'Cannot update docked target bounds' }
  # T162: read the placement back. SetWindowPos on a MAXIMIZED window only rewrites its
  # restore rectangle (the window stays full screen) and a DIP/physical pixel mixup lands
  # at the wrong size -- both used to be reported as success. The caller now compares
  # actualBounds with the request and audits a mismatch.
  $actual = New-Object TaskHiveNativeHost+RECT
  $readBack = [TaskHiveNativeHost]::GetWindowRect($handle, [ref]$actual)
  $actualBounds = if ($readBack) { [pscustomobject]@{ x=$actual.Left; y=$actual.Top; width=($actual.Right-$actual.Left); height=($actual.Bottom-$actual.Top) } } else { $null }
  [pscustomobject]@{ ok=$true; mode='owned-native-dock'; identityVerified=$true; dpiAwareness=$dpiAwareness; coordinateSpace=$coordinateSpace; bounds=[pscustomobject]@{x=$Left;y=$Top;width=$Width;height=$Height}; actualBounds=$actualBounds } | ConvertTo-Json -Compress
  exit 0
}

if ($Mode -eq 'suspend') {
  # T162: ShowWindowAsync instead of ShowWindow. The synchronous variant blocks until the
  # target thread processes the request; CODESYS is busy while loading/building, and every
  # native-host operation is serialised, so one blocked suspend used to stall the whole
  # transition chain (resume/update/detach) for up to the 15s execFile timeout.
  [void][TaskHiveNativeHost]::ShowWindowAsync($handle, $SW_HIDE)
  [pscustomobject]@{ ok=$true; mode='owned-native-dock'; identityVerified=$true; dpiAwareness=$dpiAwareness; coordinateSpace=$coordinateSpace; suspended=$true } | ConvertTo-Json -Compress
  exit 0
}

if ($Mode -eq 'resume') {
  [void][TaskHiveNativeHost]::ShowWindowAsync($handle, $SW_SHOWNA)
  if (-not [TaskHiveNativeHost]::SetWindowPos($handle, [IntPtr]::Zero, $Left, $Top, $Width, $Height, $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW)) { throw 'Cannot resume docked target window' }
  [pscustomobject]@{ ok=$true; mode='owned-native-dock'; identityVerified=$true; dpiAwareness=$dpiAwareness; coordinateSpace=$coordinateSpace; suspended=$false; bounds=[pscustomobject]@{x=$Left;y=$Top;width=$Width;height=$Height} } | ConvertTo-Json -Compress
  exit 0
}

# T188: teardown order is part of the contract, not a style choice. This window is held
# by an OWNER relationship (GWLP_HWNDPARENT), so while that owner is still set the panel
# can hide the window or destroy it together with itself (Windows destroys owned windows
# with their owner) at any moment -- geometry and styles would then be written back onto
# a window the operator can no longer see. Break the owner FIRST, then styles, then
# geometry, and verify the release really happened instead of trusting the call: a
# detach that silently fails to release the owner is exactly the "window stuck in the
# panel / never comes back" failure this file exists to prevent.
$restoreOwnerHandle = Convert-Handle $RestoreOwner
[void][TaskHiveNativeHost]::SetLong($handle, $GWLP_HWNDPARENT, $restoreOwnerHandle)
$releasedOwner = [TaskHiveNativeHost]::GetLong($handle, $GWLP_HWNDPARENT).ToInt64()
if ($releasedOwner -ne $restoreOwnerHandle.ToInt64()) { throw 'Cannot release target window owner' }
[void][TaskHiveNativeHost]::SetLong($handle, $GWL_STYLE, [IntPtr]::new($RestoreStyle))
[void][TaskHiveNativeHost]::SetLong($handle, $GWL_EXSTYLE, [IntPtr]::new($RestoreExStyle))
if (-not [TaskHiveNativeHost]::SetWindowPos($handle, [IntPtr]::Zero, $Left, $Top, $Width, $Height, $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW)) { throw 'Cannot restore target window' }
[pscustomobject]@{ ok=$true; mode='detached'; identityVerified=$true; dpiAwareness=$dpiAwareness; coordinateSpace=$coordinateSpace; restored=$true; releasedOwner=('0x{0:X}' -f $releasedOwner) } | ConvertTo-Json -Compress
