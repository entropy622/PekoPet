@echo off
setlocal
cd /d "%~dp0"
"%~dp0node.exe" "%~dp0scripts\fetch-models.mjs"
if errorlevel 1 (
  echo Model setup failed. Check the connection and try again.
  pause
  exit /b 1
)
start "" "%~dp0pekopet.exe"
