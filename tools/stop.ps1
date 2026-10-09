# stop.ps1 - stops a running KeyShot Director server: whatever node.exe is listening on its port (default 8787).
# It never touches other programs; if something else owns the port it says so and leaves it alone.
param([int]$Port = 8787)
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) { Write-Host "KeyShot Director is not running (nothing on port $Port)."; exit 0 }
$stopped = 0
foreach ($c in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
  $p = Get-Process -Id $c -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $c -Force -ErrorAction SilentlyContinue; Write-Host "Stopped KeyShot Director (node process $c)."; $stopped++ }
  elseif ($p) { Write-Host "Port $Port is used by '$($p.ProcessName)' (not KeyShot Director) - left alone." }
}
Start-Sleep -Milliseconds 400
exit 0
