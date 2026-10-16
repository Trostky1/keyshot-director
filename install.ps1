# KeyShot Director - installer. Run once on each computer:   powershell -ExecutionPolicy Bypass -File install.ps1
# It (1) checks Node.js, (2) finds KeyShot's Scripts folder, (3) writes a launcher script there that knows where this folder
# lives, (4) creates "Start KeyShot Director.bat". It never touches your KeyShot scenes. Re-running it is safe.
param([string]$ScriptsFolder = "", [switch]$NoDesktopShortcut)
$ErrorActionPreference = 'Stop'
$home_ = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host ""; Write-Host "KeyShot Director - install" -ForegroundColor White; Write-Host "folder: $home_"

# Fail early when someone runs the installer from a partial or incorrectly extracted download.
foreach ($required in 'server\server.js', 'server\listen-with-fallback.js', 'server\material-core.js', 'bridge\cc_bridge.py', 'bridge\cc_materials.py', 'bridge\cc_lights.py', 'tools\stop.ps1') {
  if (-not (Test-Path (Join-Path $home_ $required) -PathType Leaf)) {
    Write-Host "`nThis download is incomplete: $required is missing. Extract the full release ZIP into a permanent folder, then run Install KeyShot Director.bat again." -ForegroundColor Red
    exit 1
  }
}

# 1) Node.js 20+
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host "`nNode.js 20 or newer is required to run KeyShot Director." -ForegroundColor Yellow; Write-Host "1. Install the LTS version from https://nodejs.org"; Write-Host "2. Close and reopen this installer so Windows refreshes PATH."; Write-Host "3. Run Install KeyShot Director.bat again."; Start-Process 'https://nodejs.org/'; exit 1 }
$ver = (& node --version).TrimStart('v'); $major = [int]($ver.Split('.')[0])
if ($major -lt 20) { Write-Host "`nNode $ver is too old; version 20 or newer is needed." -ForegroundColor Yellow; Write-Host "Install the LTS version from https://nodejs.org, reopen this installer, and run it again."; Start-Process 'https://nodejs.org/'; exit 1 }
Write-Host "Node.js $ver ... ok"

# 2) KeyShot's Scripts folder (KeyShot keeps it under Documents\KeyShot*\Scripts)
if (-not $ScriptsFolder) {
  $cands = @(Get-ChildItem ([Environment]::GetFolderPath('MyDocuments')) -Directory -Filter 'KeyShot*' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'Scripts' } | Where-Object { Test-Path $_ })
  if ($cands.Count -eq 0) { Write-Host "`nCould not find KeyShot's Scripts folder under Documents. Open KeyShot once (it creates it), or run:`n  install.ps1 -ScriptsFolder `"C:\path\to\KeyShot\Scripts`"" -ForegroundColor Yellow; exit 1 }
  if ($cands.Count -gt 1) {
    Write-Host "Several KeyShot folders found:"; $i = 0; $cands | ForEach-Object { Write-Host "  [$i] $_"; $i++ }
    while ($true) {
      $pick = Read-Host "Enter the number for the KeyShot version you use, or paste its Scripts folder path"
      $index = 0
      if ([int]::TryParse($pick, [ref]$index) -and $index -ge 0 -and $index -lt $cands.Count) { $ScriptsFolder = $cands[$index]; break }
      if ($pick -and (Test-Path $pick -PathType Container)) { $ScriptsFolder = $pick; break }
      Write-Host "That choice is not valid. Enter one of the listed numbers or an existing Scripts folder path." -ForegroundColor Yellow
    }
  } else { $ScriptsFolder = $cands[0] }
}
if (-not (Test-Path $ScriptsFolder)) { New-Item -ItemType Directory -Force $ScriptsFolder | Out-Null }
Write-Host "KeyShot Scripts folder: $ScriptsFolder"

# 3) launcher script (appears in KeyShot's Scripts tab)
$launcher = Join-Path $ScriptsFolder 'KeyShot Director.py'
$kdHomeLiteral = ConvertTo-Json -InputObject $home_ -Compress
if ((Test-Path $launcher -PathType Leaf) -and -not (Select-String -LiteralPath $launcher -Pattern '# AUTHOR KeyShot Director' -Quiet -ErrorAction SilentlyContinue)) {
  Write-Host "`nAn existing KeyShot script is already named KeyShot Director.py and is not managed by this installer, so it was left untouched:`n$launcher" -ForegroundColor Yellow
  Write-Host "Rename that script in KeyShot's Scripts folder, then run this installer again."
  exit 1
}
$py = @"
# -*- coding: utf-8 -*-
# AUTHOR KeyShot Director
# VERSION 1.0
# Connects KeyShot to the KeyShot Director app. Start the app first (Start KeyShot Director.bat), save your scene, then run this.
# (Written by install.ps1. You can also paste the one-line connect command shown in the app into the scripting console.)
# SAVE YOUR SCENE FIRST. While it runs, plain viewport interaction is fine; do not run other scripts, open dialogs or close panels.
import os
KD_HOME = $kdHomeLiteral
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
  'for /f "tokens=1 delims=v." %%A in (''node --version'') do set NODE_MAJOR=%%A',
  'if %NODE_MAJOR% LSS 20 goto oldnode',
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop.ps1"',
  'echo Starting KeyShot Director ...',
  'set KD_OPEN=1',
  ':run',
  'node server\server.js',
  'rem exit code 3 = "Restart" was pressed in the page',
  'if %errorlevel%==3 goto run',
  'echo.',
  'echo The server stopped. If that was not on purpose, the message above says why.',
  'pause',
  'exit /b',
  ':oldnode',
  'echo Node.js %NODE_MAJOR% is too old. KeyShot Director needs version 20 or newer.',
  'echo Install the LTS version from https://nodejs.org , then reopen this shortcut.',
  'start "" https://nodejs.org/',
  'pause',
  'exit /b',
  ':nonode',
  'echo Node.js 20 or newer is not installed or not on PATH.',
  'echo Install the LTS version from https://nodejs.org , then reopen this shortcut.',
  'start "" https://nodejs.org/',
  'pause'
)
[IO.File]::WriteAllText((Join-Path $home_ 'Start KeyShot Director.bat'), (($batLines -join "`r`n") + "`r`n"), (New-Object System.Text.ASCIIEncoding))

$stopBat = "@echo off`r`ntitle Stop KeyShot Director`r`ncd /d `"%~dp0`"`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0tools\stop.ps1`"`r`nping -n 3 127.0.0.1 >nul`r`n"
[IO.File]::WriteAllText((Join-Path $home_ 'Stop KeyShot Director.bat'), $stopBat, (New-Object System.Text.ASCIIEncoding))

# 5) desktop shortcut. Preserve any unrelated shortcut with the same display name.
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$startBat = Join-Path $home_ 'Start KeyShot Director.bat'
if (-not $NoDesktopShortcut) {
  $shortcutShell = New-Object -ComObject WScript.Shell
  $shortcutPath = Join-Path $desktop 'KeyShot Director.lnk'
  $suffix = Split-Path -Leaf $home_
  $index = 1
  while (Test-Path $shortcutPath) {
    $existing = $shortcutShell.CreateShortcut($shortcutPath)
    $alreadyOurs = $false
    try { $alreadyOurs = $existing.TargetPath -and [IO.Path]::GetFullPath($existing.TargetPath).Equals([IO.Path]::GetFullPath($startBat), [StringComparison]::OrdinalIgnoreCase) } catch { }
    if ($alreadyOurs) { break }
    $label = if ($index -eq 1) { "KeyShot Director - $suffix" } else { "KeyShot Director - $suffix ($index)" }
    $shortcutPath = Join-Path $desktop ($label + '.lnk')
    $index++
  }
  $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $startBat
  $shortcut.WorkingDirectory = $home_
  $shortcut.Description = 'Start KeyShot Director'
  $shortcut.Save()
  Write-Host "Desktop shortcut created: $shortcutPath"
}

Write-Host "`nDone. To use it:" -ForegroundColor White
if ($NoDesktopShortcut) { Write-Host "  1. Start the app with Start KeyShot Director.bat (leave its window open; the page opens in your browser)" }
else { Write-Host "  1. Double-click the KeyShot Director desktop shortcut (leave its window open; the page opens in your browser)" }
Write-Host "  2. In KeyShot: open your scene, SAVE IT, then Scripts tab -> 'KeyShot Director' -> Run"
Write-Host "  3. The page header turns to 'KeyShot connected'. Drag the preview to orbit; pick a lighting rig; or type a prompt."
Write-Host "  Prompts with an AI model: open Settings in the page and paste your own Anthropic API key (optional)."
Write-Host "  Full guide: README.md`n"
