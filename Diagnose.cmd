@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Diagnose.ps1"
set "KIT_RESULT=%ERRORLEVEL%"
pause
exit /b %KIT_RESULT%
