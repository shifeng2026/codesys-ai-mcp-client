param(
  [Parameter(Mandatory=$true)][string]$WindowId,
  [Parameter(Mandatory=$true)][ValidateSet('mouse.click','mouse.wheel','keyboard.key','keyboard.text')][string]$Action,
  [double]$X = 0,
  [double]$Y = 0,
  [ValidateRange(1,2)][int]$Clicks = 1,
  [ValidateRange(-1200,1200)][int]$Delta = 0,
  [string]$Key,
  [string]$TextBase64
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TaskHiveInput {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void Wheel(int delta) { mouse_event(0x0800, 0, 0, unchecked((uint)delta), UIntPtr.Zero); }
}
'@

$value = $WindowId.Trim()
if ($value -match '^0x') { $handle = [IntPtr]::new([Convert]::ToInt64($value.Substring(2), 16)) }
else { $handle = [IntPtr]::new([Convert]::ToInt64($value)) }
$processId = 0
[void][TaskHiveInput]::GetWindowThreadProcessId($handle, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction Stop
if ($process.ProcessName -notmatch '(?i)^codesys') { throw 'Target window process is not CODESYS' }
if (-not [TaskHiveInput]::IsWindowVisible($handle) -or [TaskHiveInput]::IsIconic($handle)) { throw 'CODESYS window is hidden or minimized' }
$rect = New-Object TaskHiveInput+RECT
if (-not [TaskHiveInput]::GetWindowRect($handle, [ref]$rect)) { throw 'Unable to read CODESYS window bounds' }
if (-not [TaskHiveInput]::SetForegroundWindow($handle)) { throw 'Windows refused to foreground CODESYS; no input was sent' }
Start-Sleep -Milliseconds 15

if ($Action -eq 'mouse.click') {
  if ($X -lt 0 -or $X -gt 1 -or $Y -lt 0 -or $Y -gt 1) { throw 'Relative coordinates are out of range' }
  $screenX = [int][Math]::Round($rect.Left + (($rect.Right - $rect.Left - 1) * $X))
  $screenY = [int][Math]::Round($rect.Top + (($rect.Bottom - $rect.Top - 1) * $Y))
  if (-not [TaskHiveInput]::SetCursorPos($screenX, $screenY)) { throw 'Unable to move the cursor to the approved coordinates' }
  for ($index = 0; $index -lt $Clicks; $index += 1) {
    [TaskHiveInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [TaskHiveInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    if ($Clicks -gt 1) { Start-Sleep -Milliseconds 90 }
  }
  [pscustomobject]@{ ok=$true; action=$Action; x=$screenX; y=$screenY; clicks=$Clicks } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'mouse.wheel') {
  if ($X -lt 0 -or $X -gt 1 -or $Y -lt 0 -or $Y -gt 1) { throw 'Relative coordinates are out of range' }
  if ($Delta -eq 0 -or [Math]::Abs($Delta) -gt 1200 -or ($Delta % 120) -ne 0) { throw 'Wheel delta is outside the approved range' }
  $screenX = [int][Math]::Round($rect.Left + (($rect.Right - $rect.Left - 1) * $X))
  $screenY = [int][Math]::Round($rect.Top + (($rect.Bottom - $rect.Top - 1) * $Y))
  if (-not [TaskHiveInput]::SetCursorPos($screenX, $screenY)) { throw 'Unable to move the cursor to the approved coordinates' }
  [TaskHiveInput]::Wheel($Delta)
  [pscustomobject]@{ ok=$true; action=$Action; x=$screenX; y=$screenY; delta=$Delta } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'keyboard.text') {
  Add-Type -AssemblyName System.Windows.Forms
  if ([string]::IsNullOrWhiteSpace($TextBase64)) { throw 'Text payload is missing' }
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextBase64))
  if ($text.Length -lt 1 -or $text.Length -gt 2000) { throw 'Text payload length is invalid' }
  $builder = New-Object Text.StringBuilder
  foreach ($char in $text.ToCharArray()) {
    if ($char -eq [char]10) { [void]$builder.Append('{ENTER}'); continue }
    if ($char -eq [char]9) { [void]$builder.Append('{TAB}'); continue }
    if ('+^%~()[]{}'.Contains([string]$char)) { [void]$builder.Append('{'); [void]$builder.Append($char); [void]$builder.Append('}'); continue }
    [void]$builder.Append($char)
  }
  [Windows.Forms.SendKeys]::SendWait($builder.ToString())
  [pscustomobject]@{ ok=$true; action=$Action; characters=$text.Length } | ConvertTo-Json -Compress
  exit 0
}

$map = @{ Tab=0x09; Enter=0x0D; Escape=0x1B; Backspace=0x08; Delete=0x2E; ArrowLeft=0x25; ArrowUp=0x26; ArrowRight=0x27; ArrowDown=0x28; Home=0x24; End=0x23; PageUp=0x21; PageDown=0x22 }
if (-not $map.ContainsKey($Key)) { throw 'Key is not in the safe allowlist' }
$vk = [byte]$map[$Key]
[TaskHiveInput]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
[TaskHiveInput]::keybd_event($vk, 0, 0x0002, [UIntPtr]::Zero)
[pscustomobject]@{ ok=$true; action=$Action; key=$Key } | ConvertTo-Json -Compress
