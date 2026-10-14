@echo off
title Install KeyShot Director
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Setup could not finish. Follow the recovery steps shown above, then run this installer again.
)
echo.
pause
