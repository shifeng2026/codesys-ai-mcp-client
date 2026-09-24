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
  [switch]$AllowFixture
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TaskHiveNativeHost {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong32(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] public static extern int SetWindowLong32(IntPtr hWnd, int index, int value);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  public static IntPtr GetLong(IntPtr hWnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : new IntPtr(GetWindowLong32(hWnd, index)); }
  public static IntPtr SetLong(IntPtr hWnd, int index, IntPtr value) { return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, index, value) : new IntPtr(SetWindowLong32(hWnd, index, value.ToInt32())); }
}
'@

function Convert-Handle([string]$value) {
  $text = $value.Trim()
  if ($text -match '^0x') { return [IntPtr]::new([Convert]::ToInt64($text.Substring(2), 16)) }
  return [IntPtr]::new([Convert]::ToInt64($text))
}

$handle = Convert-Handle $WindowId
if (-not [TaskHiveNativeHost]::IsWindow($handle)) { throw 'Target HWND no longer exists' }
$actualPid = [uint32]0
[void][TaskHiveNativeHost]::GetWindowThreadProcessId($handle, [ref]$actualPid)
if ([int]$actualPid -ne $ExpectedPid) { throw 'Target HWND PID changed' }
$process = Get-Process -Id $actualPid -ErrorAction Stop
$fixtureAllowed = $AllowFixture -and $env:TASKHIVE_CODESYS_TEST_FIXTURE -eq '1'
if ($process.ProcessName -notmatch '(?i)^codesys' -and -not $fixtureAllowed) { throw 'Target window process is not CODESYS' }
if ($Width -lt 320 -or $Height -lt 200) { throw 'Native host bounds are too small' }

$GWL_STYLE = -16
$GWL_EXSTYLE = -20
$GWLP_HWNDPARENT = -8
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

if ($Mode -eq 'attach') {
  $hostHandle = Convert-Handle $HostWindowId
  if (-not [TaskHiveNativeHost]::IsWindow($hostHandle)) { throw 'TaskHive host HWND is invalid' }
  $rect = New-Object TaskHiveNativeHost+RECT
  if (-not [TaskHiveNativeHost]::GetWindowRect($handle, [ref]$rect)) { throw 'Cannot read target window bounds' }
  $style = [TaskHiveNativeHost]::GetLong($handle, $GWL_STYLE).ToInt64()
  $exStyle = [TaskHiveNativeHost]::GetLong($handle, $GWL_EXSTYLE).ToInt64()
  $owner = [TaskHiveNativeHost]::GetLong($handle, $GWLP_HWNDPARENT)
  if ([TaskHiveNativeHost]::IsIconic($handle)) { [void][TaskHiveNativeHost]::ShowWindow($handle, $SW_RESTORE) }
  $dockedStyle = $style -band (-bnot ($WS_CAPTION -bor $WS_THICKFRAME -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX -bor $WS_SYSMENU))
  $hostedExStyle = ($exStyle -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW)
  [void][TaskHiveNativeHost]::SetLong($handle, $GWL_STYLE, [IntPtr]::new($dockedStyle))
  [void][TaskHiveNativeHost]::SetLong($handle, $GWL_EXSTYLE, [IntPtr]::new($hostedExStyle))
  [void][TaskHiveNativeHost]::SetLong($handle, $GWLP_HWNDPARENT, $hostHandle)
  if (-not [TaskHiveNativeHost]::SetWindowPos($handle, [IntPtr]::Zero, $Left, $Top, $Width, $Height, $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW)) { throw 'Cannot dock target window' }
  $actualExStyle = [TaskHiveNativeHost]::GetLong($handle, $GWL_EXSTYLE).ToInt64()
  $actualOwner = [TaskHiveNativeHost]::GetLong($handle, $GWLP_HWNDPARENT)
  $taskbarHidden = (($actualExStyle -band $WS_EX_TOOLWINDOW) -ne 0) -and (($actualExStyle -band $WS_EX_APPWINDOW) -eq 0)
  [pscustomobject]@{
    ok = $true; mode = 'owned-native-dock'; identityVerified = $true; styleCaptured = $true;
    hostWindowId = ('0x{0:X}' -f $hostHandle.ToInt64());
    actualOwner = ('0x{0:X}' -f $actualOwner.ToInt64()); actualExStyle = $actualExStyle; taskbarHidden = $taskbarHidden;
    restore = [pscustomobject]@{ style=$style; exStyle=$hostedExStyle; originalExStyle=$exStyle; owner=('0x{0:X}' -f $owner.ToInt64()); left=$rect.Left; top=$rect.Top; width=($rect.Right-$rect.Left); height=($rect.Bottom-$rect.Top) }
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Mode -eq 'move') {
  if (-not [TaskHiveNativeHost]::SetWindowPos($handle, [IntPtr]::Zero, $Left, $Top, $Width, $Height, $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW)) { throw 'Cannot update docked target bounds' }
  [pscustomobject]@{ ok=$true; mode='owned-native-dock'; identityVerified=$true; bounds=[pscustomobject]@{x=$Left;y=$Top;width=$Width;height=$Height} } | ConvertTo-Json -Compress
  exit 0
}

if ($Mode -eq 'suspend') {
  [void][TaskHiveNativeHost]::ShowWindow($handle, $SW_HIDE)
  [pscustomobject]@{ ok=$true; mode='owned-native-dock'; identityVerified=$true; suspended=$true } | ConvertTo-Json -Compress
  exit 0
}

if ($Mode -eq 'resume') {
  [void][TaskHiveNativeHost]::ShowWindow($handle, $SW_SHOWNA)
  if (-not [TaskHiveNativeHost]::SetWindowPos($handle, [IntPtr]::Zero, $Left, $Top, $Width, $Height, $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW)) { throw 'Cannot resume docked target window' }
  [pscustomobject]@{ ok=$true; mode='owned-native-dock'; identityVerified=$true; suspended=$false; bounds=[pscustomobject]@{x=$Left;y=$Top;width=$Width;height=$Height} } | ConvertTo-Json -Compress
  exit 0
}

$restoreOwnerHandle = Convert-Handle $RestoreOwner
[void][TaskHiveNativeHost]::SetLong($handle, $GWLP_HWNDPARENT, $restoreOwnerHandle)
[void][TaskHiveNativeHost]::SetLong($handle, $GWL_STYLE, [IntPtr]::new($RestoreStyle))
[void][TaskHiveNativeHost]::SetLong($handle, $GWL_EXSTYLE, [IntPtr]::new($RestoreExStyle))
if (-not [TaskHiveNativeHost]::SetWindowPos($handle, [IntPtr]::Zero, $Left, $Top, $Width, $Height, $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW)) { throw 'Cannot restore target window' }
[pscustomobject]@{ ok=$true; mode='detached'; identityVerified=$true; restored=$true } | ConvertTo-Json -Compress
