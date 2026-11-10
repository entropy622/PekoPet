@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
set "PEKO_ROOT=%~dp0"
set "PEKO_NODE=node.exe"

if exist "pekopet.exe" goto portable

node.exe "scripts/fetch-models.mjs"
if errorlevel 1 goto failed
call npm.cmd run dev
if errorlevel 1 goto failed
goto done

:portable
set "PEKO_NODE=%~dp0node.exe"
call PekoPet.cmd
if errorlevel 1 goto failed

:done
popd
exit /b 0

:failed
set "result=%errorlevel%"
echo.
echo PekoPet could not start. Check the error above.
pause
popd
exit /b %result%
