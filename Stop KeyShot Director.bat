@echo off
title Stop KeyShot Director
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop.ps1"
ping -n 3 127.0.0.1 >nul
