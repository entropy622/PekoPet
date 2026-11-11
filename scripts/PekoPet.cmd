@echo off
setlocal
cd /d "%~dp0"
set "PEKO_ROOT=%~dp0resources\runtime"
set "PEKO_NODE=%PEKO_ROOT%\node.exe"
"%PEKO_NODE%" "%PEKO_ROOT%\scripts\fetch-models.mjs"
if errorlevel 1 (
  echo Model setup failed. Check the connection and try again.
  pause
  exit /b 1
)
start "" "%~dp0PekoPet.exe"
