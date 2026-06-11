$ErrorActionPreference = "Stop"

$Port = 4173

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Stop MIT3 Website                       " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Looking for MIT3 website on port $Port..." -ForegroundColor Yellow

$connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue

if (-not $connections) {
  Write-Host ""
  Write-Host "MIT3 website is not running on port $Port." -ForegroundColor Yellow
  Write-Host "Nothing to stop." -ForegroundColor Gray
  Write-Host ""
  pause
  exit 0
}

$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique

foreach ($pidToStop in $processIds) {
  $proc = Get-Process -Id $pidToStop -ErrorAction SilentlyContinue

  if ($proc) {
    Write-Host ""
    Write-Host "Stopping process:" -ForegroundColor Yellow
    Write-Host "Name: $($proc.ProcessName)"
    Write-Host "PID:  $pidToStop"
    Stop-Process -Id $pidToStop -Force
  }
}

Start-Sleep -Seconds 1

$stillRunning = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue

Write-Host ""
if ($stillRunning) {
  Write-Host "MIT3 website may still be running on port $Port." -ForegroundColor Red
  Write-Host "Try running this Stop button again." -ForegroundColor Yellow
} else {
  Write-Host "MIT3 website stopped successfully." -ForegroundColor Green
}

Write-Host ""
pause
