# KeyShot Director - installer. Run once on each computer:   powershell -ExecutionPolicy Bypass -File install.ps1
# It (1) checks Node.js, (2) finds KeyShot's Scripts folder, (3) writes a launcher script there that knows where this folder
# lives, (4) creates "Start KeyShot Director.bat". It never touches your KeyShot scenes. Re-running it is safe.
param([string]$ScriptsFolder = "")
$ErrorActionPreference = 'Stop'
$home_ = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host ""; Write-Host "KeyShot Director - install" -ForegroundColor White; Write-Host "folder: $home_"

# 1) Node.js 20+
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host "`nNode.js is not installed. Get the LTS version from https://nodejs.org , install it, then run this installer again." -ForegroundColor Yellow; exit 1 }
$ver = (& node --version).TrimStart('v'); $major = [int]($ver.Split('.')[0])
if ($major -lt 20) { Write-Host "`nNode $ver is too old; version 20 or newer is needed (https://nodejs.org)." -ForegroundColor Yellow; exit 1 }
Write-Host "Node.js $ver ... ok"

# 2) KeyShot's Scripts folder (KeyShot keeps it under Documents\KeyShot*\Scripts)
if (-not $ScriptsFolder) {
  $cands = @(Get-ChildItem ([Environment]::GetFolderPath('MyDocuments')) -Directory -Filter 'KeyShot*' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'Scripts' } | Where-Object { Test-Path $_ })
  if ($cands.Count -eq 0) { Write-Host "`nCould not find KeyShot's Scripts folder under Documents. Open KeyShot once (it creates it), or run:`n  install.ps1 -ScriptsFolder `"C:\path\to\KeyShot\Scripts`"" -ForegroundColor Yellow; exit 1 }
  if ($cands.Count -gt 1) { Write-Host "Several KeyShot folders found:"; $i = 0; $cands | ForEach-Object { Write-Host "  [$i] $_"; $i++ }; $pick = Read-Host "Install the launcher into which one? (number)"; $ScriptsFolder = $cands[[int]$pick] } else { $ScriptsFolder = $cands[0] }
}
if (-not (Test-Path $ScriptsFolder)) { New-Item -ItemType Directory -Force $ScriptsFolder | Out-Null }
Write-Host "KeyShot Scripts folder: $ScriptsFolder"

# 3) launcher script (appears in KeyShot's Scripts tab)
$launcher = Join-Path $ScriptsFolder 'KeyShot Director.py'
$py = @"
# -*- coding: utf-8 -*-
# AUTHOR KeyShot Director
# VERSION 1.0
# Connects KeyShot to the KeyShot Director app. Start the app first (Start KeyShot Director.bat), save your scene, then run this.
# (Written by install.ps1. You can also paste the one-line connect command shown in the app into the scripting console.)
# SAVE YOUR SCENE FIRST. While it runs, plain viewport interaction is fine; do not run other scripts, open dialogs or close panels.
import os
KD_HOME = r"$home_"
if not os.path.isfile(os.path.join(KD_HOME, "bridge", "cc_bridge.py")):
    raise Exception("KeyShot Director was moved or deleted. Run install.ps1 again from its folder. Looked in: " + KD_HOME)
exec(open(os.path.join(KD_HOME, "bridge", "cc_bridge.py"), encoding="utf-8-sig").read())
"@
[IO.File]::WriteAllText($launcher, $py, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "launcher written: $launcher"

# 4) folders + start script
foreach ($d in 'bridge\cmd','bridge\resp','bridge\shots','references') { New-Item -ItemType Directory -Force (Join-Path $home_ $d) | Out-Null }
$batLines = @(
  '@echo off',
  'title KeyShot Director (leave this window open)',
  'cd /d "%~dp0"',
  'where node >nul 2>nul',
  'if errorlevel 1 goto nonode',
  'netstat -ano | find ":8787" | find "LISTENING" >nul',
  'if not errorlevel 1 goto running',
  'echo Starting KeyShot Director ...',
  'set KD_OPEN=1',
  'node server\server.js',
  'echo.',
  'echo The server stopped. If that was not on purpose, the message above says why.',
  'pause',
  'exit /b',
  ':running',
  'echo KeyShot Director is already running - opening the page.',
  'start "" http://localhost:8787',
  'ping -n 4 127.0.0.1 >nul',
  'exit /b',
  ':nonode',
  'echo Node.js is not installed or not on PATH.',
  'echo Install the LTS version from https://nodejs.org , then double-click this file again.',
  'pause'
)
[IO.File]::WriteAllText((Join-Path $home_ 'Start KeyShot Director.bat'), (($batLines -join "`r`n") + "`r`n"), (New-Object System.Text.ASCIIEncoding))

Write-Host "`nDone. To use it:" -ForegroundColor White
Write-Host "  1. Double-click  'Start KeyShot Director.bat'   (leave its window open; the page opens in your browser)"
Write-Host "  2. In KeyShot: open your scene, SAVE IT, then Scripts tab -> 'KeyShot Director' -> Run"
Write-Host "  3. The page header turns to 'KeyShot connected'. Drag the preview to orbit; pick a lighting rig; or type a prompt."
Write-Host "  Prompts with an AI model: open Settings in the page and paste your own Anthropic API key (optional)."
Write-Host "  Full guide: README.md`n"
