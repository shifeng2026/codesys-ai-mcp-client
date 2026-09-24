Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TaskHiveBackgroundInput {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize; public uint flags; public IntPtr hwndActive; public IntPtr hwndFocus;
    public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret;
  }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
}
'@

function Resolve-Handle([string]$value) {
  $trimmed = $value.Trim()
  if ($trimmed -match '^0x') { return [IntPtr]::new([Convert]::ToInt64($trimmed.Substring(2), 16)) }
  return [IntPtr]::new([Convert]::ToInt64($trimmed))
}

function Make-LParam([int]$x, [int]$y) {
  $packed = (($y -band 0xffff) -shl 16) -bor ($x -band 0xffff)
  return [IntPtr]::new([int64]$packed)
}

function Resolve-Target([IntPtr]$root, [int]$screenX, [int]$screenY, [uint32]$expectedPid) {
  $point = New-Object TaskHiveBackgroundInput+POINT
  $point.X = $screenX; $point.Y = $screenY
  $candidate = [TaskHiveBackgroundInput]::WindowFromPoint($point)
  $candidatePid = [uint32]0
  if ($candidate -ne [IntPtr]::Zero) { [void][TaskHiveBackgroundInput]::GetWindowThreadProcessId($candidate, [ref]$candidatePid) }
  if ($candidate -eq [IntPtr]::Zero -or $candidatePid -ne $expectedPid) { return $root }
  return $candidate
}

function Invoke-BackgroundInput($request) {
  $handle = Resolve-Handle ([string]$request.windowId)
  $pidValue = [uint32]0
  $threadId = [TaskHiveBackgroundInput]::GetWindowThreadProcessId($handle, [ref]$pidValue)
  if ($pidValue -ne [uint32]$request.expectedPid) { throw 'CODESYS window PID changed' }
  $process = Get-Process -Id $pidValue -ErrorAction Stop
  if ($process.ProcessName -notmatch '(?i)^codesys') { throw 'Target window process is not CODESYS' }
  if (-not [TaskHiveBackgroundInput]::IsWindowVisible($handle) -or [TaskHiveBackgroundInput]::IsIconic($handle)) { throw 'CODESYS window is hidden or minimized' }
  $rect = New-Object TaskHiveBackgroundInput+RECT
  if (-not [TaskHiveBackgroundInput]::GetWindowRect($handle, [ref]$rect)) { throw 'Unable to read CODESYS window bounds' }
  $action = $request.action

  if ($action.type -eq 'mouse.click' -or $action.type -eq 'mouse.wheel') {
    $screenX = [int][Math]::Round($rect.Left + (($rect.Right - $rect.Left - 1) * [double]$action.x))
    $screenY = [int][Math]::Round($rect.Top + (($rect.Bottom - $rect.Top - 1) * [double]$action.y))
    $target = Resolve-Target $handle $screenX $screenY $pidValue
    $client = New-Object TaskHiveBackgroundInput+POINT
    $client.X = $screenX; $client.Y = $screenY
    if (-not [TaskHiveBackgroundInput]::ScreenToClient($target, [ref]$client)) { throw 'Unable to map pointer coordinates' }
    if ($action.type -eq 'mouse.click') {
      for ($i=0; $i -lt [int]$action.clicks; $i++) {
        [void][TaskHiveBackgroundInput]::PostMessage($target, 0x0201, [IntPtr]::new(1), (Make-LParam $client.X $client.Y))
        [void][TaskHiveBackgroundInput]::PostMessage($target, 0x0202, [IntPtr]::Zero, (Make-LParam $client.X $client.Y))
      }
      return @{ ok=$true; action=$action.type; x=$client.X; y=$client.Y; background=$true }
    }
    $wheelParam = [IntPtr]::new(([int64]([int]$action.delta -band 0xffff)) -shl 16)
    [void][TaskHiveBackgroundInput]::PostMessage($target, 0x020A, $wheelParam, (Make-LParam $screenX $screenY))
    return @{ ok=$true; action=$action.type; delta=[int]$action.delta; background=$true }
  }

  $gui = New-Object TaskHiveBackgroundInput+GUITHREADINFO
  $gui.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][TaskHiveBackgroundInput+GUITHREADINFO])
  [void][TaskHiveBackgroundInput]::GetGUIThreadInfo($threadId, [ref]$gui)
  $target = if ($gui.hwndFocus -ne [IntPtr]::Zero) { $gui.hwndFocus } else { $handle }
  $map = @{ Tab=0x09; Enter=0x0D; Escape=0x1B; Backspace=0x08; Delete=0x2E; ArrowLeft=0x25; ArrowUp=0x26; ArrowRight=0x27; ArrowDown=0x28; Home=0x24; End=0x23; PageUp=0x21; PageDown=0x22 }
  if ($action.type -eq 'keyboard.key') {
    if (-not $map.ContainsKey([string]$action.key)) { throw 'Key is not in the safe allowlist' }
    $vk = [IntPtr]::new([int]$map[[string]$action.key])
    [void][TaskHiveBackgroundInput]::PostMessage($target, 0x0100, $vk, [IntPtr]::Zero)
    [void][TaskHiveBackgroundInput]::PostMessage($target, 0x0101, $vk, [IntPtr]::Zero)
    return @{ ok=$true; action=$action.type; key=$action.key; background=$true }
  }
  if ($action.type -eq 'keyboard.text') {
    foreach ($char in ([string]$action.text).ToCharArray()) {
      if ($char -eq [char]10) {
        $vk = [IntPtr]::new(0x0D); [void][TaskHiveBackgroundInput]::PostMessage($target, 0x0100, $vk, [IntPtr]::Zero); [void][TaskHiveBackgroundInput]::PostMessage($target, 0x0101, $vk, [IntPtr]::Zero)
      } elseif ($char -eq [char]9) {
        $vk = [IntPtr]::new(0x09); [void][TaskHiveBackgroundInput]::PostMessage($target, 0x0100, $vk, [IntPtr]::Zero); [void][TaskHiveBackgroundInput]::PostMessage($target, 0x0101, $vk, [IntPtr]::Zero)
      } else {
        [void][TaskHiveBackgroundInput]::PostMessage($target, 0x0102, [IntPtr]::new([int][char]$char), [IntPtr]::Zero)
      }
    }
    return @{ ok=$true; action=$action.type; characters=([string]$action.text).Length; background=$true }
  }
  throw 'Unsupported action'
}

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $requestId = $null
  try {
    $request = $line | ConvertFrom-Json
    $requestId = [string]$request.requestId
    $result = Invoke-BackgroundInput $request
    @{ requestId=$requestId; ok=$true; result=$result } | ConvertTo-Json -Compress -Depth 8 | Write-Output
  } catch {
    @{ requestId=$requestId; ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress -Depth 5 | Write-Output
  }
}
