param([string]$Version)
# package.ps1 - builds a clean release ZIP containing ONLY what another computer needs.
# Left out on purpose: your reference images, config.local.json (API key), bridge runtime files, screenshots, test/probe scripts.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$userProfile = [Environment]::GetFolderPath('UserProfile')
$rustup = Join-Path $userProfile '.cargo\bin\cargo.exe'
if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -and (Test-Path $rustup)) { $env:PATH = (Split-Path $rustup) + ';' + $env:PATH }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Rust stable is required to package the material compiler. Install it from https://www.rust-lang.org/tools/install.' }
& (Get-Command cargo).Source build --manifest-path (Join-Path $root 'material-core\Cargo.toml') --release --target wasm32-unknown-unknown
if ($LASTEXITCODE -ne 0) { throw 'Rust material compiler build failed.' }
$wasm = Join-Path $root 'material-core\target\wasm32-unknown-unknown\release\keyshot_material_core.wasm'
Copy-Item -LiteralPath $wasm -Destination (Join-Path $root 'server\material-core.wasm') -Force
$stage = Join-Path $env:TEMP ("kd_pkg_" + [guid]::NewGuid().ToString('N').Substring(0, 8)); $app = Join-Path $stage 'KeyShotDirector'
New-Item -ItemType Directory -Force $app | Out-Null
function Copy-Rel($rel) { $src = Join-Path $root $rel; $dst = Join-Path $app $rel; New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null; Copy-Item $src $dst -Recurse -Force }
foreach ($f in 'README.md', 'LICENSE', 'install.ps1', 'install-mac.sh', 'start-mac.sh', 'Start KeyShot Director.command', 'PRODUCT.md', 'DESIGN.md') { Copy-Rel $f }
foreach ($f in '.github\workflows\checks.yml', '.gitignore', '.impeccable\design.json') { Copy-Rel $f }
foreach ($f in 'docs\PHOTO_WORKFLOW.md','docs\SCENE_STAGING.md','docs\MATERIAL_CORE.md') { Copy-Rel $f }
foreach ($f in 'server\server.js','server\agent.js','server\bridge.js','server\png.js','server\rigs.js','server\shots.js','server\style.js','server\cli.js','server\janitor.js','server\video.js','server\anim.js','server\gltf.js','server\glbanim.js','server\photo.js','server\image-tools.js','server\material-textures.js','server\material-core.js','server\material-core.wasm','server\texture-edit.js','server\public\index.html','server\public\director.css','server\public\photo-ui.js') { Copy-Rel $f }
foreach ($f in 'bridge\cc_bridge.py','bridge\cc_ops.py','bridge\cc_materials.py','bridge\cc_lights.py','bridge\cc_anim.py','bridge\cc_stage.py','bridge\assets\cc_light_panel.obj','bridge\assets\cc_stage_cube.obj') { Copy-Rel $f }
foreach ($f in 'skills\material-lab\SKILL.md','skills\reference-video\SKILL.md') { Copy-Rel $f }
$required = @('bridge\cc_materials.py','server\material-textures.js','server\material-core.js','server\material-core.wasm','skills\material-lab\SKILL.md','skills\reference-video\SKILL.md')
foreach ($rel in $required) { if (-not (Test-Path (Join-Path $app $rel))) { throw "Release package is missing required file: $rel" } }
foreach ($f in 'tools\normalize.ps1','tools\resize.ps1','tools\stop.ps1') { Copy-Rel $f }
New-Item -ItemType Directory -Force (Join-Path $app 'references'), (Join-Path $app 'renders') | Out-Null
Set-Content (Join-Path $app 'references\README.txt') "Each folder in here is a style. Make a folder, put reference images in it (jpg/png/webp/avif), then Analyze it in the app." -Encoding ASCII
Set-Content (Join-Path $app '.gitignore') "config.local.json`nbridge/cmd/`nbridge/resp/`nbridge/shots/`nbridge/anim/`nbridge/heartbeat.json`nreferences/*/`nrenders/`ndist/`n" -Encoding ASCII
# safety net: refuse to package anything that still mentions this machine or a key
$bad = Get-ChildItem $app -Recurse -File | Select-String -Pattern 'bentr', 'sk-ant-[A-Za-z0-9_-]{20,}', 'Keyhot Plugin' -List
if ($bad) { Write-Host "Refusing to package: personal data found in:" -ForegroundColor Red; $bad | ForEach-Object { Write-Host "  $($_.Path)  (line $($_.LineNumber): $($_.Line.Trim()))" }; exit 1 }
$dist = Join-Path $root 'dist'; New-Item -ItemType Directory -Force $dist | Out-Null
$zipName = if ($Version) { "KeyShot-Director-v$Version.zip" } else { "KeyShot-Director-" + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + ".zip" }
$zip = Join-Path $dist $zipName
Compress-Archive -Path $app -DestinationPath $zip
Remove-Item $stage -Recurse -Force
$kb = [int]((Get-Item $zip).Length / 1KB); Write-Host "Built $zip ($kb KB)"
