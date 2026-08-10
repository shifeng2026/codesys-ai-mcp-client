$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:AUTOCAD_MCP_PAYLOAD_B64)) {
  throw 'AUTOCAD_MCP_PAYLOAD_B64 is not set.'
}

$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:AUTOCAD_MCP_PAYLOAD_B64))
$payload = $payloadJson | ConvertFrom-Json
if ($null -eq $payload.args) {
  $payload | Add-Member -NotePropertyName args -NotePropertyValue ([pscustomobject]@{})
}

function Write-BridgeResult {
  param([object]$Value)
  $json = $Value | ConvertTo-Json -Depth 20 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Write-Output ('@@AUTOCAD_MCP_RESULT@@' + [System.Convert]::ToBase64String($bytes))
}

function Has-Arg {
  param([string]$Name)
  return $payload.args.PSObject.Properties.Name -contains $Name
}

function Arg {
  param([string]$Name, [object]$Default = $null)
  if (Has-Arg $Name) {
    return $payload.args.$Name
  }
  return $Default
}

function Bool-Arg {
  param([string]$Name, [bool]$Default = $false)
  if (-not (Has-Arg $Name)) {
    return $Default
  }
  $value = $payload.args.$Name
  if ($value -is [bool]) {
    return $value
  }
  return [System.Convert]::ToBoolean($value)
}

function String-Arg {
  param([string]$Name, [bool]$Required = $true, [string]$Default = '')
  if (-not (Has-Arg $Name)) {
    if ($Required) {
      throw "Missing required argument '$Name'."
    }
    return $Default
  }
  $value = [string]$payload.args.$Name
  if ($Required -and [string]::IsNullOrWhiteSpace($value)) {
    throw "Argument '$Name' must not be empty."
  }
  return $value
}

function Number-Arg {
  param([string]$Name, [bool]$Required = $true, [double]$Default = 0)
  if (-not (Has-Arg $Name)) {
    if ($Required) {
      throw "Missing required argument '$Name'."
    }
    return $Default
  }
  return [double]$payload.args.$Name
}

function Array-From {
  param([object]$Value)
  if ($null -eq $Value) {
    return @()
  }
  if ($Value -is [System.Array]) {
    return @($Value)
  }
  return @($Value)
}

function Point3 {
  param([object]$Value, [string]$Name)
  if ($null -eq $Value) {
    throw "Argument '$Name' is required."
  }
  if ($Value.PSObject.Properties.Name -contains 'x') {
    $x = [double]$Value.x
    $y = [double]$Value.y
    $z = 0
    if ($Value.PSObject.Properties.Name -contains 'z') {
      $z = [double]$Value.z
    }
    return [double[]]@($x, $y, $z)
  }

  $items = Array-From $Value
  if ($items.Count -ne 2 -and $items.Count -ne 3) {
    throw "Argument '$Name' must be [x, y] or [x, y, z]."
  }
  $zValue = 0
  if ($items.Count -eq 3) {
    $zValue = [double]$items[2]
  }
  return [double[]]@([double]$items[0], [double]$items[1], [double]$zValue)
}

function Point2 {
  param([object]$Value, [string]$Name)
  $p = Point3 -Value $Value -Name $Name
  return [double[]]@($p[0], $p[1])
}

function Get-PreferredProgIds {
  $items = New-Object System.Collections.Generic.List[string]

  if (Has-Arg 'progId') {
    $items.Add([string]$payload.args.progId)
  }
  if (-not [string]::IsNullOrWhiteSpace($env:AUTOCAD_MCP_PROGID)) {
    $items.Add([string]$env:AUTOCAD_MCP_PROGID)
  }
  if (-not [string]::IsNullOrWhiteSpace($payload.env.defaultProgId)) {
    $items.Add([string]$payload.env.defaultProgId)
  }
  if (Has-Arg 'progIds') {
    foreach ($item in (Array-From $payload.args.progIds)) {
      $items.Add([string]$item)
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($env:AUTOCAD_MCP_PROGIDS)) {
    foreach ($item in $env:AUTOCAD_MCP_PROGIDS.Split(';')) {
      $items.Add([string]$item)
    }
  }

  $items.Add('AutoCAD.Application.26')
  $items.Add('AutoCAD.Application')

  $seen = @{}
  $result = New-Object System.Collections.Generic.List[string]
  foreach ($item in $items) {
    $trimmed = ([string]$item).Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
      continue
    }
    if (-not $seen.ContainsKey($trimmed)) {
      $seen[$trimmed] = $true
      $result.Add($trimmed)
    }
  }
  return @($result)
}

function Connect-AutoCAD {
  param([bool]$StartIfMissing = $false)

  $errors = New-Object System.Collections.Generic.List[string]
  foreach ($prog in (Get-PreferredProgIds)) {
    try {
      $app = [Runtime.InteropServices.Marshal]::GetActiveObject($prog)
      return [pscustomobject]@{ App = $app; ProgId = $prog; Started = $false }
    } catch {
      $errors.Add("${prog}: $($_.Exception.Message)")
    }
  }

  if ($StartIfMissing) {
    foreach ($prog in (Get-PreferredProgIds)) {
      try {
        $app = New-Object -ComObject $prog
        $app.Visible = $true
        Start-Sleep -Milliseconds 700
        return [pscustomobject]@{ App = $app; ProgId = $prog; Started = $true }
      } catch {
        $errors.Add("${prog} start: $($_.Exception.Message)")
      }
    }
  }

  throw "No running AutoCAD COM server found. Start AutoCAD first, or pass startIfMissing=true. Tried: $($errors -join ' | ')"
}

function Try-Get {
  param([object]$Object, [string]$PropertyName, [object]$Default = $null)
  try {
    return $Object.$PropertyName
  } catch {
    return $Default
  }
}

function Get-Document {
  param([object]$App, [bool]$CreateIfMissing = $true)
  try {
    return $App.ActiveDocument
  } catch {
    if ($CreateIfMissing) {
      return $App.Documents.Add()
    }
    throw 'AutoCAD has no active document.'
  }
}

function Document-Summary {
  param([object]$Doc)
  if ($null -eq $Doc) {
    return $null
  }
  return [pscustomobject]@{
    name = (Try-Get -Object $Doc -PropertyName 'Name' -Default $null)
    fullName = (Try-Get -Object $Doc -PropertyName 'FullName' -Default $null)
    path = (Try-Get -Object $Doc -PropertyName 'Path' -Default $null)
  }
}

function Ensure-Layer {
  param([object]$Doc, [string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) {
    return $null
  }
  try {
    return $Doc.Layers.Item($Name)
  } catch {
    return $Doc.Layers.Add($Name)
  }
}

function Apply-Layer {
  param([object]$Entity, [object]$Doc, [string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) {
    return
  }
  Ensure-Layer -Doc $Doc -Name $Name | Out-Null
  $Entity.Layer = $Name
}

function Entity-Summary {
  param([object]$Entity, [string]$Type)
  return [pscustomobject]@{
    type = $Type
    handle = (Try-Get -Object $Entity -PropertyName 'Handle' -Default $null)
    objectName = (Try-Get -Object $Entity -PropertyName 'ObjectName' -Default $null)
    layer = (Try-Get -Object $Entity -PropertyName 'Layer' -Default $null)
  }
}

function Regen-Doc {
  param([object]$Doc)
  try {
    $Doc.Regen(1) | Out-Null
  } catch {
  }
}

function Invoke-Status {
  $start = Bool-Arg -Name 'startIfMissing' -Default $false
  try {
    $conn = Connect-AutoCAD -StartIfMissing $start
    $app = $conn.App
    $doc = $null
    try {
      $doc = $app.ActiveDocument
    } catch {
    }
    return [pscustomobject]@{
      available = $true
      running = $true
      started = $conn.Started
      progId = $conn.ProgId
      version = (Try-Get -Object $app -PropertyName 'Version' -Default $null)
      visible = (Try-Get -Object $app -PropertyName 'Visible' -Default $null)
      documentsCount = (Try-Get -Object $app.Documents -PropertyName 'Count' -Default $null)
      activeDocument = (Document-Summary -Doc $doc)
    }
  } catch {
    return [pscustomobject]@{
      available = $false
      running = $false
      started = $false
      progIds = (Get-PreferredProgIds)
      error = $_.Exception.Message
    }
  }
}

function Invoke-NewDrawing {
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $app = $conn.App
  $templatePath = String-Arg -Name 'templatePath' -Required $false -Default ''
  if ([string]::IsNullOrWhiteSpace($templatePath)) {
    $doc = $app.Documents.Add()
  } else {
    $fullTemplatePath = [System.IO.Path]::GetFullPath($templatePath)
    if (-not (Test-Path -LiteralPath $fullTemplatePath)) {
      throw "Template file does not exist: $fullTemplatePath"
    }
    $doc = $app.Documents.Add($fullTemplatePath)
  }
  return [pscustomobject]@{
    started = $conn.Started
    progId = $conn.ProgId
    document = (Document-Summary -Doc $doc)
  }
}

function Invoke-OpenDrawing {
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $path = [System.IO.Path]::GetFullPath((String-Arg -Name 'filePath'))
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Drawing file does not exist: $path"
  }
  $readOnly = Bool-Arg -Name 'readOnly' -Default $false
  $doc = $conn.App.Documents.Open($path, $readOnly)
  return [pscustomobject]@{
    started = $conn.Started
    progId = $conn.ProgId
    document = (Document-Summary -Doc $doc)
  }
}

function Invoke-SaveAs {
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $doc = Get-Document -App $conn.App -CreateIfMissing $false
  $path = [System.IO.Path]::GetFullPath((String-Arg -Name 'filePath'))
  $dir = [System.IO.Path]::GetDirectoryName($path)
  if (-not (Test-Path -LiteralPath $dir)) {
    throw "Output directory does not exist: $dir"
  }
  if ((Test-Path -LiteralPath $path) -and -not (Bool-Arg -Name 'overwrite' -Default $false)) {
    throw "Output file already exists. Pass overwrite=true to replace it: $path"
  }
  $doc.SaveAs($path) | Out-Null
  return [pscustomobject]@{
    progId = $conn.ProgId
    filePath = $path
    document = (Document-Summary -Doc $doc)
  }
}

function Invoke-DrawLine {
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $doc = Get-Document -App $conn.App
  $start = Point3 -Value (Arg -Name 'start') -Name 'start'
  $end = Point3 -Value (Arg -Name 'end') -Name 'end'
  $entity = $doc.ModelSpace.AddLine($start, $end)
  Apply-Layer -Entity $entity -Doc $doc -Name (String-Arg -Name 'layer' -Required $false -Default '')
  Regen-Doc -Doc $doc
  return [pscustomobject]@{
    entity = (Entity-Summary -Entity $entity -Type 'line')
    document = (Document-Summary -Doc $doc)
  }
}

function Invoke-DrawPolyline {
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $doc = Get-Document -App $conn.App
  $points = Array-From (Arg -Name 'points')
  if ($points.Count -lt 2) {
    throw "Argument 'points' must contain at least two points."
  }
  $flat = New-Object System.Collections.Generic.List[double]
  foreach ($point in $points) {
    $p = Point2 -Value $point -Name 'points[]'
    $flat.Add($p[0])
    $flat.Add($p[1])
  }
  $entity = $doc.ModelSpace.AddLightWeightPolyline([double[]]$flat.ToArray())
  $entity.Closed = (Bool-Arg -Name 'closed' -Default $false)
  Apply-Layer -Entity $entity -Doc $doc -Name (String-Arg -Name 'layer' -Required $false -Default '')
  Regen-Doc -Doc $doc
  return [pscustomobject]@{
    entity = (Entity-Summary -Entity $entity -Type 'polyline')
    document = (Document-Summary -Doc $doc)
  }
}

function Invoke-DrawRectangle {
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $doc = Get-Document -App $conn.App
  $origin = Point2 -Value (Arg -Name 'origin') -Name 'origin'
  $width = Number-Arg -Name 'width'
  $height = Number-Arg -Name 'height'
  if ($width -eq 0 -or $height -eq 0) {
    throw "Arguments 'width' and 'height' must be non-zero."
  }
  $x = $origin[0]
  $y = $origin[1]
  $flat = [double[]]@($x, $y, $x + $width, $y, $x + $width, $y + $height, $x, $y + $height)
  $entity = $doc.ModelSpace.AddLightWeightPolyline($flat)
  $entity.Closed = $true
  Apply-Layer -Entity $entity -Doc $doc -Name (String-Arg -Name 'layer' -Required $false -Default '')
  Regen-Doc -Doc $doc
  return [pscustomobject]@{
    entity = (Entity-Summary -Entity $entity -Type 'rectangle')
    document = (Document-Summary -Doc $doc)
  }
}

function Invoke-DrawCircle {
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $doc = Get-Document -App $conn.App
  $center = Point3 -Value (Arg -Name 'center') -Name 'center'
  $radius = Number-Arg -Name 'radius'
  if ($radius -le 0) {
    throw "Argument 'radius' must be greater than zero."
  }
  $entity = $doc.ModelSpace.AddCircle($center, $radius)
  Apply-Layer -Entity $entity -Doc $doc -Name (String-Arg -Name 'layer' -Required $false -Default '')
  Regen-Doc -Doc $doc
  return [pscustomobject]@{
    entity = (Entity-Summary -Entity $entity -Type 'circle')
    document = (Document-Summary -Doc $doc)
  }
}

function Invoke-AddText {
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $doc = Get-Document -App $conn.App
  $text = String-Arg -Name 'text'
  $point = Point3 -Value (Arg -Name 'point') -Name 'point'
  $height = Number-Arg -Name 'height'
  if ($height -le 0) {
    throw "Argument 'height' must be greater than zero."
  }
  $entity = $doc.ModelSpace.AddText($text, $point, $height)
  if (Has-Arg 'rotationDeg') {
    $entity.Rotation = ([double]$payload.args.rotationDeg) * [Math]::PI / 180
  }
  Apply-Layer -Entity $entity -Doc $doc -Name (String-Arg -Name 'layer' -Required $false -Default '')
  Regen-Doc -Doc $doc
  return [pscustomobject]@{
    entity = (Entity-Summary -Entity $entity -Type 'text')
    document = (Document-Summary -Doc $doc)
  }
}

function Invoke-SetLayer {
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $doc = Get-Document -App $conn.App
  $name = String-Arg -Name 'name'
  try {
    $layer = $doc.Layers.Item($name)
  } catch {
    if (-not (Bool-Arg -Name 'createIfMissing' -Default $true)) {
      throw "Layer does not exist: $name"
    }
    $layer = $doc.Layers.Add($name)
  }
  if (Has-Arg 'color') {
    $layer.Color = [int]$payload.args.color
  }
  if (Bool-Arg -Name 'makeActive' -Default $false) {
    $doc.ActiveLayer = $layer
  }
  return [pscustomobject]@{
    name = (Try-Get -Object $layer -PropertyName 'Name' -Default $name)
    color = (Try-Get -Object $layer -PropertyName 'Color' -Default $null)
    active = (Bool-Arg -Name 'makeActive' -Default $false)
    document = (Document-Summary -Doc $doc)
  }
}

function Assert-RawCommandsAllowed {
  $allowed = $false
  if ($payload.env.allowRawCommands -eq $true) {
    $allowed = $true
  }
  if (Bool-Arg -Name 'unsafeAcknowledged' -Default $false) {
    $allowed = $true
  }
  if (-not $allowed) {
    throw 'Raw AutoCAD commands are blocked. Set AUTOCAD_MCP_ALLOW_COMMANDS=1 for this MCP server, or pass unsafeAcknowledged=true for a single call.'
  }
}

function Invoke-RunCommand {
  Assert-RawCommandsAllowed
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $doc = Get-Document -App $conn.App
  $command = String-Arg -Name 'command'
  $newline = [string][char]10
  if (-not $command.EndsWith($newline)) {
    $command = $command + $newline
  }
  $doc.SendCommand($command) | Out-Null
  $waitMs = [int](Number-Arg -Name 'waitMs' -Required $false -Default 0)
  if ($waitMs -gt 0) {
    Start-Sleep -Milliseconds $waitMs
  }
  return [pscustomobject]@{
    sent = $true
    async = $true
    document = (Document-Summary -Doc $doc)
  }
}

function Invoke-RunScript {
  Assert-RawCommandsAllowed
  $conn = Connect-AutoCAD -StartIfMissing (Bool-Arg -Name 'startIfMissing' -Default $true)
  $doc = Get-Document -App $conn.App
  $commands = Array-From (Arg -Name 'commands')
  if ($commands.Count -eq 0) {
    throw "Argument 'commands' must contain at least one AutoCAD command line."
  }
  $newline = [string][char]10
  $scriptText = (($commands | ForEach-Object { [string]$_ }) -join $newline) + $newline
  $doc.SendCommand($scriptText) | Out-Null
  $waitMs = [int](Number-Arg -Name 'waitMs' -Required $false -Default 0)
  if ($waitMs -gt 0) {
    Start-Sleep -Milliseconds $waitMs
  }
  return [pscustomobject]@{
    sent = $true
    async = $true
    commandCount = $commands.Count
    document = (Document-Summary -Doc $doc)
  }
}

try {
  $data = switch ([string]$payload.operation) {
    'status' { Invoke-Status; break }
    'new_drawing' { Invoke-NewDrawing; break }
    'open_drawing' { Invoke-OpenDrawing; break }
    'save_as' { Invoke-SaveAs; break }
    'draw_line' { Invoke-DrawLine; break }
    'draw_polyline' { Invoke-DrawPolyline; break }
    'draw_rectangle' { Invoke-DrawRectangle; break }
    'draw_circle' { Invoke-DrawCircle; break }
    'add_text' { Invoke-AddText; break }
    'set_layer' { Invoke-SetLayer; break }
    'run_command' { Invoke-RunCommand; break }
    'run_script' { Invoke-RunScript; break }
    default { throw "Unknown AutoCAD bridge operation: $($payload.operation)" }
  }
  Write-BridgeResult ([pscustomobject]@{ ok = $true; data = $data })
} catch {
  Write-BridgeResult ([pscustomobject]@{
    ok = $false
    error = [pscustomobject]@{
      message = $_.Exception.Message
      operation = [string]$payload.operation
      category = [string]$_.CategoryInfo.Category
    }
  })
}
