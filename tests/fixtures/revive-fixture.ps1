# T194 fixture: a real top-level window whose owning process is named CODESYS.
#
# The self-heal under test may only ever touch a window whose process looks like
# CODESYS, so an honest end-to-end test cannot use powershell.exe's own name. The
# test therefore copies powershell.exe to a temporary file called CODESYS.exe and
# runs this script with it: the window is REAL (real HWND, real process, real
# WS_VISIBLE style bit) and the process name the host checks is real too, while
# nothing on the machine -- no CODESYS installation, no user instance -- is
# involved or disturbed.
#
# ASCII only: this file has no BOM and is launched through powershell.exe (5.1),
# which reads BOM-less files as ANSI.
param(
  [string]$Title = 'CODESYS TaskHive Revive Fixture',
  [int]$Width = 900,
  [int]$Height = 700,
  [ValidateSet('hidden', 'visible', 'minimized')][string]$State = 'hidden',
  [string]$ReadyFile = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(60, 60)
$form.Size = New-Object System.Drawing.Size($Width, $Height)
# Keep the fixture out of the taskbar/Alt-Tab so it can never be confused with a
# real window of the operator's, and so the test leaves no visible trace.
$form.ShowInTaskbar = $false

# Touching .Handle creates the HWND. A WinForms window that was never shown is
# created WITHOUT the WS_VISIBLE style bit: that is exactly the "exists but is
# hidden (SW_VISIBLE=false), and is not minimized" state the self-heal targets.
$handle = $form.Handle

if ($State -eq 'visible') { $form.Show() }
if ($State -eq 'minimized') { $form.Show(); $form.WindowState = 'Minimized' }

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReviveFixtureWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong32(IntPtr hWnd, int index);
  public static IntPtr GetLong(IntPtr hWnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : new IntPtr(GetWindowLong32(hWnd, index)); }
}
'@

$rect = New-Object ReviveFixtureWin+RECT
[void][ReviveFixtureWin]::GetWindowRect($handle, [ref]$rect)
$snapshot = [pscustomobject]@{
  pid = $PID
  handle = ('0x{0:X}' -f $handle.ToInt64())
  title = $Title
  state = $State
  styleVisible = (([ReviveFixtureWin]::GetLong($handle, -16).ToInt64() -band 0x10000000L) -ne 0)
  visible = [ReviveFixtureWin]::IsWindowVisible($handle)
  iconic = [ReviveFixtureWin]::IsIconic($handle)
  rect = [pscustomobject]@{ left = $rect.Left; top = $rect.Top; width = ($rect.Right - $rect.Left); height = ($rect.Bottom - $rect.Top) }
}
if ($ReadyFile) { $snapshot | ConvertTo-Json -Compress | Set-Content -LiteralPath $ReadyFile -Encoding UTF8 }
$snapshot | ConvertTo-Json -Compress

# Stay alive so the window (and its state) can be observed and driven from outside.
# No message pump on purpose: the test only reads and rewrites window state, which
# the window manager answers whether or not the owning thread is pumping.
$deadline = (Get-Date).AddMinutes(10)
while ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 400 }
