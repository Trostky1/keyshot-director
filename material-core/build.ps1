$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargo) {
  $profile = [Environment]::GetFolderPath('UserProfile')
  $candidate = Join-Path $profile '.cargo\bin\cargo.exe'
  if (Test-Path $candidate) { $cargo = Get-Item $candidate }
}
if (-not $cargo) { throw 'Rust stable is required. Install it from https://www.rust-lang.org/tools/install.' }
$cargoPath = if ($cargo.Source) { $cargo.Source } else { $cargo.FullName }
& $cargoPath build --manifest-path (Join-Path $PSScriptRoot 'Cargo.toml') --release --target wasm32-unknown-unknown
if ($LASTEXITCODE -ne 0) { throw 'Rust material compiler build failed.' }
$wasm = Join-Path $PSScriptRoot 'target\wasm32-unknown-unknown\release\keyshot_material_core.wasm'
Copy-Item -LiteralPath $wasm -Destination (Join-Path $root 'server\material-core.wasm') -Force
Write-Host 'Built server\material-core.wasm'
