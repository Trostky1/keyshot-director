param([string]$Version, [switch]$Force)
# package.ps1 - builds a clean release ZIP containing ONLY what another computer needs.
# Left out on purpose: your reference images, config.local.json (API key), bridge runtime files, screenshots, test/probe scripts.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist'; New-Item -ItemType Directory -Force $dist | Out-Null
if ($Version -and $Version -match '[\\/:*?"<>|]') { throw 'Version must be a plain version label, such as 2.3.0.' }
$zipName = if ($Version) { "KeyShot-Director-v$Version.zip" } else { "KeyShot-Director-" + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + ".zip" }
$zip = Join-Path $dist $zipName
if ((Test-Path $zip) -and -not $Force) { throw "Release archive already exists: $zip. Choose a new version or pass -Force to replace an archive you created." }
$stage = Join-Path $env:TEMP ("kd_pkg_" + [guid]::NewGuid().ToString('N').Substring(0, 8)); $app = Join-Path $stage 'KeyShotDirector'
New-Item -ItemType Directory -Force $app | Out-Null
function Copy-Rel($rel) { $src = Join-Path $root $rel; $dst = Join-Path $app $rel; New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null; Copy-Item $src $dst -Recurse -Force }
foreach ($f in 'README.md', 'LICENSE', 'install.ps1', 'Install KeyShot Director.bat', 'install-mac.sh', 'start-mac.sh', 'Start KeyShot Director.command', 'PRODUCT.md', 'DESIGN.md') { Copy-Rel $f }
foreach ($f in '.github\workflows\checks.yml', '.gitignore', '.impeccable\design.json') { Copy-Rel $f }
foreach ($f in 'docs\PHOTO_WORKFLOW.md','docs\SCENE_STAGING.md','docs\MATERIAL_CORE.md','docs\POLIIGON_TEXTURE_WORKFLOW.md','docs\LIGHTING_AND_MOOD_DEEP_DIVE.md','docs\MATERIALS_AND_DISPLACEMENT_DEEP_DIVE.md','docs\FEATURE_AUDIT_AND_KEYSHOT_CONTEXT.md','docs\RELEASE_NOTES_2.0.md','docs\RELEASE_NOTES_2.2.md','docs\RELEASE_NOTES_2.3.md') { Copy-Rel $f }
foreach ($f in 'server\server.js','server\listen-with-fallback.js','server\agent.js','server\bridge.js','server\lighting-lab.js','server\lighting-evidence.js','server\exr.js','server\lighting-playbooks.js','server\png.js','server\rigs.js','server\shots.js','server\style.js','server\cli.js','server\janitor.js','server\video.js','server\anim.js','server\gltf.js','server\glbanim.js','server\photo.js','server\image-tools.js','server\material-textures.js','server\material-core.js','server\texture-edit.js','server\public\index.html','server\public\director.css','server\public\photo-ui.js','server\public\lighting-lab-ui.js') { Copy-Rel $f }
foreach ($f in 'bridge\cc_bridge.py','bridge\cc_ops.py','bridge\cc_materials.py','bridge\cc_lights.py','bridge\cc_anim.py','bridge\cc_stage.py','bridge\cc_scene_context.py','bridge\assets\cc_light_panel.obj','bridge\assets\cc_stage_cube.obj') { Copy-Rel $f }
foreach ($f in 'server\photo-refinement.js','server\style-search.js','docs\MEASURED_REFINEMENT.md','docs\MATERIAL_EDIT_RECEIPTS.md','docs\MATERIAL_CALIBRATION_PLAN.md','docs\MATERIAL_CALIBRATION_RESULTS.md') { Copy-Rel $f }
foreach ($f in 'server\light-spec.js','server\job-receipt.js','server\image-mask.js','server\colour-contract.js','docs\LIGHTING_CAPABILITY_RECORD.md','docs\RELEASE_NOTES_REFERENCE_LIGHTING.md') { Copy-Rel $f }
foreach ($f in 'server\reconstruction.js','server\derivative-free.js','server\camera-alignment.js','server\lighting-objectives.js','bridge\cc_deliver.py','docs\RECONSTRUCTION_BACKLOG.md','docs\RECONSTRUCTION_MILESTONE_1.md') { Copy-Rel $f }
foreach ($f in 'skills\material-lab\SKILL.md','skills\reference-video\SKILL.md') { Copy-Rel $f }
$required = @('Install KeyShot Director.bat','install.ps1','docs\RELEASE_NOTES_2.0.md','docs\RELEASE_NOTES_2.2.md','docs\RELEASE_NOTES_2.3.md','bridge\cc_bridge.py','bridge\cc_materials.py','server\server.js','server\listen-with-fallback.js','server\public\index.html','server\material-textures.js','server\material-core.js','server\exr.js','skills\material-lab\SKILL.md','skills\reference-video\SKILL.md')
$required += @('server\reconstruction.js','server\derivative-free.js','server\camera-alignment.js','server\lighting-objectives.js','bridge\cc_deliver.py','docs\RECONSTRUCTION_MILESTONE_1.md')
$required += @('server\light-spec.js','server\job-receipt.js','server\image-mask.js','server\colour-contract.js','docs\LIGHTING_CAPABILITY_RECORD.md','docs\RELEASE_NOTES_REFERENCE_LIGHTING.md')
$required += @('server\photo-refinement.js','server\style-search.js','docs\MEASURED_REFINEMENT.md','docs\MATERIAL_EDIT_RECEIPTS.md','docs\MATERIAL_CALIBRATION_PLAN.md','docs\MATERIAL_CALIBRATION_RESULTS.md')
foreach ($rel in $required) { if (-not (Test-Path (Join-Path $app $rel))) { throw "Release package is missing required file: $rel" } }
foreach ($f in 'tools\normalize.ps1','tools\resize.ps1','tools\stop.ps1') { Copy-Rel $f }
New-Item -ItemType Directory -Force (Join-Path $app 'references'), (Join-Path $app 'renders') | Out-Null
Set-Content (Join-Path $app 'references\README.txt') "Each folder in here is a style. Make a folder, put reference images in it (jpg/png/webp/avif), then Analyze it in the app." -Encoding ASCII
Set-Content (Join-Path $app '.gitignore') "config.local.json`nbridge/cmd/`nbridge/resp/`nbridge/shots/`nbridge/anim/`nbridge/heartbeat.json`nreferences/*/`nrenders/`ndist/`n" -Encoding ASCII
# safety net: refuse to package anything that still mentions this machine or a key
$bad = Get-ChildItem $app -Recurse -File | Select-String -Pattern 'bentr', 'sk-ant-[A-Za-z0-9_-]{20,}', 'Keyhot Plugin' -List
if ($bad) { Write-Host "Refusing to package: personal data found in:" -ForegroundColor Red; $bad | ForEach-Object { Write-Host "  $($_.Path)  (line $($_.LineNumber): $($_.Line.Trim()))" }; Remove-Item $stage -Recurse -Force; throw 'Release package safety check failed.' }
try { Compress-Archive -Path $app -DestinationPath $zip -Force:$Force }
finally { if (Test-Path $stage) { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue } }
$kb = [int]((Get-Item $zip).Length / 1KB); Write-Host "Built $zip ($kb KB)"
