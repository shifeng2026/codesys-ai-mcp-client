@echo off
setlocal
cd /d "%~dp0"
iexpress /N /Q packager\CodexLocalClient.sed
