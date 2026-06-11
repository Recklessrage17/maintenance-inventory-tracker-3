$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDist = Join-Path $RepoRoot "frontend\dist"
$DbPath = Join-Path $BackendDir "data\maintenance_inventory_3_web.db"
$Port = 4173

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Maintenance Inventory Tracker 3 Website " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Repo:     $RepoRoot"
Write-Host "Backend:  $BackendDir"
Write-Host "Database: $DbPath"
Write-Host ""

if (-not (Test-Path $BackendDir)) {
  Write-Host "ERROR: Backend folder not found. This Start button is not inside the MIT3 project folder." -ForegroundColor Red
  pause
  exit 1
}

$nodeVersion = node -v 2>$null
if (-not $nodeVersion) {
  Write-Host "Node.js was not found. Install Node.js 22 LTS first." -ForegroundColor Red
  pause
  exit 1
}

if ($nodeVersion -notmatch "^v22\.") {
  Write-Host "WARNING: This project is designed for Node.js 22 LTS." -ForegroundColor Yellow
  Write-Host "Current Node: $nodeVersion" -ForegroundColor Yellow
  Write-Host ""
}

if (-not (Test-Path (Join-Path $FrontendDist "index.html"))) {
  Write-Host "Frontend build not found." -ForegroundColor Yellow
  Write-Host "Run Update MIT3 Website.cmd first to build it." -ForegroundColor Yellow
  pause
  exit 1
}

$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "MIT3 website is already running on port $Port." -ForegroundColor Yellow
  Write-Host "Opening website..." -ForegroundColor Green
  Start-Process "http://localhost:$Port"
  pause
  exit 0
}

Set-Location $BackendDir

Write-Host "Starting MIT3 website..." -ForegroundColor Green
Write-Host ""
Write-Host "Local website: http://localhost:$Port"
Write-Host "Health check:  http://localhost:$Port/api/health"
Write-Host "Phone/tablet:  http://YOUR-PC-IP:$Port"
Write-Host ""
Write-Host "To stop the website, press Ctrl + C in this window." -ForegroundColor Yellow
Write-Host ""

Start-Job -ScriptBlock {
  Start-Sleep -Seconds 4
  Start-Process "http://localhost:4173"
} | Out-Null

npm start
