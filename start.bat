@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
set "PEKO_ROOT=%~dp0"
set "PEKO_NODE=node.exe"
if exist "PekoPet.exe" (
  call PekoPet.cmd
) else (
  call npm.cmd start
)
if errorlevel 1 goto failed
popd
exit /b 0
:failed
set "result=%errorlevel%"
echo PekoPet could not start. See the error above.
pause
popd
exit /b %result%
