@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" %*
set "KIT_RESULT=%ERRORLEVEL%"
echo.
if not "%KIT_RESULT%"=="0" echo Installation failed. Keep this window and read the error above.
pause
exit /b %KIT_RESULT%
