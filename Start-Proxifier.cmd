@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Proxifier.ps1" %*
set "KIT_RESULT=%ERRORLEVEL%"
if not "%KIT_RESULT%"=="0" pause
exit /b %KIT_RESULT%
