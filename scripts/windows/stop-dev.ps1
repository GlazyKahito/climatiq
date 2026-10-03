# Stops the CLIMATIQ dev server started in the background (Next.js on :3100 and the embedded Postgres on :54330).
# Only processes listening on those two ports are touched. Usage:  powershell -File scripts\windows\stop-dev.ps1
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
foreach ($port in 3100, 54330) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; "stopped PID $_ (port $port)" }
}
# Embedded Postgres worker processes of this project (never touches other PostgreSQL installations).
Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" |
  Where-Object { $_.CommandLine -like "*$root*" -or $_.ExecutablePath -like "*$root*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item -ErrorAction SilentlyContinue (Join-Path $root '.data\pg\postmaster.pid')
