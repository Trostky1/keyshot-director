# package.ps1 - builds dist\KeyShot-Director-<date>.zip containing ONLY what another computer needs.
# Left out on purpose: your reference images, config.local.json (API key), bridge runtime files, screenshots, test/probe scripts.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $env:TEMP ("kd_pkg_" + [guid]::NewGuid().ToString('N').Substring(0, 8)); $app = Join-Path $stage 'KeyShotDirector'
New-Item -ItemType Directory -Force $app | Out-Null
function Copy-Rel($rel) { $src = Join-Path $root $rel; $dst = Join-Path $app $rel; New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null; Copy-Item $src $dst -Recurse -Force }
foreach ($f in 'README.md', 'LICENSE', 'install.ps1') { Copy-Rel $f }
foreach ($f in 'server\server.js','server\agent.js','server\bridge.js','server\png.js','server\rigs.js','server\shots.js','server\style.js','server\cli.js','server\janitor.js','server\video.js','server\anim.js','server\gltf.js','server\glbanim.js','server\public\index.html') { Copy-Rel $f }
foreach ($f in 'bridge\cc_bridge.py','bridge\cc_ops.py','bridge\cc_lights.py','bridge\cc_anim.py','bridge\assets\cc_light_panel.obj') { Copy-Rel $f }
foreach ($f in 'tools\normalize.ps1','tools\resize.ps1','tools\stop.ps1') { Copy-Rel $f }
New-Item -ItemType Directory -Force (Join-Path $app 'references') | Out-Null
Set-Content (Join-Path $app 'references\README.txt') "Each folder in here is a style. Make a folder, put reference images in it (jpg/png/webp/avif), then Analyze it in the app." -Encoding ASCII
Set-Content (Join-Path $app '.gitignore') "config.local.json`nbridge/cmd/`nbridge/resp/`nbridge/shots/`nbridge/anim/`nbridge/heartbeat.json`nreferences/*/`nrenders/`ndist/`n" -Encoding ASCII
# safety net: refuse to package anything that still mentions this machine or a key
$bad = Get-ChildItem $app -Recurse -File | Select-String -Pattern 'bentr', 'sk-ant-[A-Za-z0-9_-]{20,}', 'Keyhot Plugin' -List
if ($bad) { Write-Host "Refusing to package: personal data found in:" -ForegroundColor Red; $bad | ForEach-Object { Write-Host "  $($_.Path)  (line $($_.LineNumber): $($_.Line.Trim()))" }; exit 1 }
$dist = Join-Path $root 'dist'; New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist ("KeyShot-Director-" + (Get-Date -Format 'yyyy-MM-dd') + ".zip"); if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $app -DestinationPath $zip
Remove-Item $stage -Recurse -Force
$kb = [int]((Get-Item $zip).Length / 1KB); Write-Host "Built $zip ($kb KB)"
