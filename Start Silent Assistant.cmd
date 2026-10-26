@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "APP_EXE=%~dp0silent-assistant\dist\win-unpacked\Silent Assistant.exe"
if not exist "%APP_EXE%" (
  echo Silent Assistant has not been built in this folder.
  echo Open PowerShell in silent-assistant and run: npm.cmd run pack
  pause
  exit /b 1
)
start "" /D "%~dp0silent-assistant\dist\win-unpacked" "%APP_EXE%"
if errorlevel 1 (
  echo Windows could not start Silent Assistant.
  pause
  exit /b 1
)
endlocal
