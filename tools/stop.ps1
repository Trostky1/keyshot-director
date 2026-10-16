# stop.ps1 - safely stops the KeyShot Director process recorded by its own runtime marker.
param([int]$Port = 8787)
$home_ = Split-Path -Parent $PSScriptRoot
$marker = Join-Path $home_ 'bridge\director-server.json'
if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
  Write-Host "No KeyShot Director process marker was found. Any other process using port $Port was left alone."
  exit 0
}
try { $record = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json }
catch { Write-Host 'The KeyShot Director process marker is invalid; no process was stopped.' -ForegroundColor Yellow; exit 1 }
$processId = 0
if (-not [int]::TryParse([string]$record.pid, [ref]$processId) -or $processId -le 0 -or $record.port -ne $Port) {
  Write-Host 'The KeyShot Director process marker does not match this port; no process was stopped.' -ForegroundColor Yellow
  exit 1
}
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  Write-Host 'KeyShot Director is not running; removed its stale process marker.'
  exit 0
}
$expected = [IO.Path]::GetFullPath((Join-Path $home_ 'server\server.js'))
if ($process.Name -notmatch '^node(?:\.exe)?$' -or $process.CommandLine.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
  Write-Host 'The recorded process no longer matches this KeyShot Director installation; no process was stopped.' -ForegroundColor Yellow
  exit 1
}
# PID reuse can leave a stale marker pointing at an unrelated later process.
if ($record.started) {
  try {
    $markerStart = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$record.started).UtcDateTime
    $processStart = [Management.ManagementDateTimeConverter]::ToDateTime($process.CreationDate).ToUniversalTime()
    if ([Math]::Abs(($processStart - $markerStart).TotalSeconds) -gt 5) {
      Write-Host 'The recorded process start time no longer matches; no process was stopped.' -ForegroundColor Yellow
      exit 1
    }
  } catch {
    Write-Host 'Could not verify the recorded process start time; no process was stopped.' -ForegroundColor Yellow
    exit 1
  }
}
Stop-Process -Id $processId -Force -ErrorAction Stop
Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
Write-Host "Stopped KeyShot Director (process $processId)."
exit 0
