@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" -Rollback
set "KIT_RESULT=%ERRORLEVEL%"
pause
exit /b %KIT_RESULT%
