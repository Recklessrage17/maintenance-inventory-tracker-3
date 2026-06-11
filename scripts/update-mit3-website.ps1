$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms

function Pick-Mit3Folder {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "Pick your Maintenance Inventory Tracker 3 folder"
  $dialog.SelectedPath = "F:\maintenance-inventory-tracker-3"
  $dialog.ShowNewFolderButton = $false

  $result = $dialog.ShowDialog()

  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "Update canceled. No folder selected." -ForegroundColor Yellow
    pause
    exit 0
  }

  return $dialog.SelectedPath
}

function Stop-Mit3Website {
  param([int]$Port = 4173)

  Write-Host ""
  Write-Host "Stopping website on port $Port if running..." -ForegroundColor Yellow

  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue

  if (-not $connections) {
    Write-Host "Nothing running on port $Port." -ForegroundColor Gray
    return
  }

  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($pidToStop in $processIds) {
    $proc = Get-Process -Id $pidToStop -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host "Stopping $($proc.ProcessName) PID $pidToStop..." -ForegroundColor Yellow
      Stop-Process -Id $pidToStop -Force
    }
  }
}

$RepoRoot = Pick-Mit3Folder
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"
$ScriptsDir = Join-Path $RepoRoot "scripts"
$DbDir = Join-Path $BackendDir "data"
$DbPath = Join-Path $DbDir "maintenance_inventory_3_web.db"
$BackupDir = Join-Path $RepoRoot "_mit3_database_backups"
$Port = 4173

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " MIT3 Website Update Puller              " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Selected folder: $RepoRoot"
Write-Host ""

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
  Write-Host "ERROR: This folder is not a Git repo. No .git folder was found." -ForegroundColor Red
  Write-Host "Pick the real maintenance-inventory-tracker-3 repo folder." -ForegroundColor Yellow
  pause
  exit 1
}

if (-not (Test-Path $BackendDir)) {
  Write-Host "ERROR: backend folder was not found." -ForegroundColor Red
  pause
  exit 1
}

if (-not (Test-Path $FrontendDir)) {
  Write-Host "ERROR: frontend folder was not found." -ForegroundColor Red
  pause
  exit 1
}

$nodeVersion = node -v 2>$null
if (-not $nodeVersion) {
  Write-Host "ERROR: Node.js was not found. Install Node.js 22 LTS first." -ForegroundColor Red
  pause
  exit 1
}

if ($nodeVersion -notmatch "^v22\.") {
  Write-Host "WARNING: MIT3 is built for Node.js 22 LTS." -ForegroundColor Yellow
  Write-Host "Current Node: $nodeVersion" -ForegroundColor Yellow
  Write-Host ""
}

Stop-Mit3Website -Port $Port

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

if (Test-Path $DbPath) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = Join-Path $BackupDir "maintenance_inventory_3_web-$timestamp.db"
  Write-Host ""
  Write-Host "Backing up SQLite database..." -ForegroundColor Green
  Copy-Item $DbPath $backupPath -Force
  Write-Host "Backup saved:" -ForegroundColor Green
  Write-Host $backupPath
} else {
  Write-Host ""
  Write-Host "No SQLite database found yet. Skipping DB backup." -ForegroundColor Yellow
}

Set-Location $RepoRoot

Write-Host ""
Write-Host "Checking Git status..." -ForegroundColor Cyan
git status --short

$dirty = git status --porcelain
if ($dirty) {
  Write-Host ""
  Write-Host "ERROR: This repo has local changes." -ForegroundColor Red
  Write-Host "Update stopped so it does not overwrite your work." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Review these changes first:"
  git status --short
  pause
  exit 1
}

Write-Host ""
Write-Host "Pulling latest update from GitHub..." -ForegroundColor Green
git fetch
git pull --ff-only

Write-Host ""
Write-Host "Installing/building frontend..." -ForegroundColor Green
Set-Location $FrontendDir

if (Test-Path ".env.production.website") {
  Copy-Item ".env.production.website" ".env.local" -Force
} elseif (Test-Path ".env.website.example") {
  Copy-Item ".env.website.example" ".env.local" -Force
}

npm install
npm run build

Write-Host ""
Write-Host "Installing/building backend..." -ForegroundColor Green
Set-Location $BackendDir
npm install
npm run build

Write-Host ""
Write-Host "Starting MIT3 website..." -ForegroundColor Green
Start-Job -ScriptBlock {
  Start-Sleep -Seconds 4
  Start-Process "http://localhost:4173"
} | Out-Null

npm start
