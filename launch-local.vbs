Option Explicit

Dim shell
Dim fso
Dim appDir
Dim ps1File
Dim url
Dim loadingUrl
Dim logFile
Dim powershellPath
Dim command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = "C:\Users\29925\codex-local-client"
ps1File = appDir & "\launch-local.ps1"
logFile = appDir & "\launcher.log"
url = "http://127.0.0.1:" & GetPort()
loadingUrl = FileUrl(appDir & "\public\loading.html") & "?target=" & UrlEncode(url & "/")
powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"

LogLine "launch"
LogLine "loading=" & loadingUrl

shell.Run loadingUrl, 1, False
command = """" & powershellPath & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1File & """ -NoBrowser"
shell.Run command, 0, False
LogLine "hidden_powershell"

Function GetPort()
  Dim value
  value = shell.ExpandEnvironmentStrings("%PORT%")
  If value = "" Or value = "%PORT%" Then
    GetPort = "5177"
  Else
    GetPort = value
  End If
End Function

Function FileUrl(filePath)
  FileUrl = "file:///" & Replace(Replace(filePath, "\", "/"), " ", "%20")
End Function

Function UrlEncode(value)
  UrlEncode = Replace(Replace(value, ":", "%3A"), "/", "%2F")
End Function

Sub LogLine(message)
  On Error Resume Next
  Dim stream
  Set stream = fso.OpenTextFile(logFile, 8, True)
  stream.WriteLine Now & " " & message
  stream.Close
End Sub
