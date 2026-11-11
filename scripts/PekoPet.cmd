@echo off
setlocal
cd /d "%~dp0"
set "PEKO_ROOT=%~dp0resources\runtime"
set "PEKO_NODE=%PEKO_ROOT%\node.exe"
start "" "%~dp0PekoPet.exe"
