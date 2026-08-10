@echo off
setlocal
set "APP_DIR=C:\Users\29925\codex-local-client"
set "LOG=%APP_DIR%\launcher.log"
set "PS1=%APP_DIR%\launch-local.ps1"
>>"%LOG%" echo [%date% %time%] cmd
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
>>"%LOG%" echo [%date% %time%] cmd_done
