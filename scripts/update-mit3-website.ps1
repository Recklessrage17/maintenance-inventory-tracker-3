param(
  [string]$RepoRoot,
  [switch]$NoFolderPicker,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DefaultRepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$Status = $null
$StatusPath = $null
$LogFile = $null

if (-not $NoFolderPicker) {
  Add-Type -AssemblyName System.Windows.Forms
}

function Pause-IfInteractive {
  if (-not $NoFolderPicker) {
    pause
  }
}

function Pick-Mit3Folder {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "Pick your Maintenance Inventory Tracker 3 folder"
  $dialog.SelectedPath = $DefaultRepoRoot.Path
  $dialog.ShowNewFolderButton = $false

  $result = $dialog.ShowDialog()

  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "Update canceled. No folder selected." -ForegroundColor Yellow
    Pause-IfInteractive
    exit 0
  }

  return $dialog.SelectedPath
}

function Write-UpdateLog {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $Message

  if ($LogFile) {
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  }
}

function Write-Utf8NoBomFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $utf8NoBom)
}

function Save-UpdateStatus {
  param(
    [string]$Phase,
    [string]$Message,
    [bool]$Running = $true,
    [Nullable[bool]]$Ok = $null,
    [string]$ErrorMessage = $null
  )

  if (-not $StatusPath -or -not $Status) {
    return
  }

  $now = (Get-Date).ToUniversalTime().ToString("o")
  $Status.running = $Running
  $Status.phase = $Phase
  $Status.message = $Message
  $Status.updatedAt = $now
  $Status.ok = $Ok
  $Status.error = $ErrorMessage

  if (-not $Running) {
    $Status.completedAt = $now
  }

  if ($Phase -eq "complete") {
    try { $Status.afterSha = (& git -C $Status.repoRoot rev-parse HEAD 2>$null) } catch {}
  }

  $json = $Status | ConvertTo-Json -Depth 4
  Write-Utf8NoBomFile -Path $StatusPath -Value $json
}

function Invoke-LoggedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [string]$Description
  )

  Write-UpdateLog "COMMAND: $Description"
  Write-UpdateLog "WORKDIR: $WorkingDirectory"
  Write-UpdateLog ("RUN: {0} {1}" -f $FilePath, ($Arguments -join " "))

  Push-Location $WorkingDirectory
  try {
    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $textOutput = ($output | ForEach-Object { [string]$_ }) -join "`n"

    foreach ($line in $output) {
      Write-UpdateLog ([string]$line)
    }

    if ($exitCode -ne 0) {
      throw "Command failed with exit code $exitCode`: $Description`n$textOutput"
    }

    return $textOutput
  } finally {
    Pop-Location
  }
}

function Test-IgnoredRuntimeStatusLine {
  param([string]$Line)

  if (-not $Line -or $Line.Length -lt 4) { return $false }

  $normalizedPath = $Line.Substring(3).Replace("\", "/")

  return $normalizedPath -match "^backend/data/.+\.(db|db-shm|db-wal|sqlite|sqlite-shm|sqlite-wal)$" -or
    $normalizedPath -eq "backend/update-status.json" -or
    $normalizedPath.StartsWith("backend/update-logs/")
}

function Get-BlockingGitStatusLines {
  param([string]$WorkingDirectory)

  $lines = & git -C $WorkingDirectory status --porcelain

  return @($lines | Where-Object { $_ -and -not (Test-IgnoredRuntimeStatusLine $_) })
}

function Stop-Mit3Website {
  param([int]$Port = 4173)

  Write-UpdateLog "Stopping website on port $Port if running..."

  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -gt 0 }

  if (-not $connections) {
    Write-UpdateLog "Nothing running on port $Port."
    return
  }

  $processIds = $connections |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -gt 0 }

  foreach ($pidToStop in $processIds) {
    if ($pidToStop -eq 0) {
      Write-UpdateLog "Skipping Idle PID 0."
      continue
    }

    if ($pidToStop -eq $PID) {
      Write-UpdateLog "Skipping current updater PowerShell PID $pidToStop."
      continue
    }

    $proc = Get-Process -Id $pidToStop -ErrorAction SilentlyContinue
    if (-not $proc) {
      Write-UpdateLog "Process PID $pidToStop disappeared before it could be stopped. Continuing..."
      continue
    }

    Write-UpdateLog "Stopping $($proc.ProcessName) PID $pidToStop..."
    try {
      Stop-Process -Id $pidToStop -Force -ErrorAction Stop
    } catch {
      $stopMessage = $_.Exception.Message
      if (-not $stopMessage) { $stopMessage = [string]$_ }
      Write-UpdateLog "Could not stop PID $pidToStop ($($proc.ProcessName)): $stopMessage. Continuing..."
    }
  }
}

try {
  if ($NoFolderPicker) {
    if (-not $RepoRoot) {
      Write-Host "ERROR: RepoRoot is required when NoFolderPicker is used." -ForegroundColor Red
      exit 1
    }

    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
  } else {
    $RepoRoot = Pick-Mit3Folder
  }

  $BackendDir = Join-Path $RepoRoot "backend"
  $FrontendDir = Join-Path $RepoRoot "frontend"
  $DbDir = Join-Path $BackendDir "data"
  $DbPath = Join-Path $DbDir "maintenance_inventory_3_web.db"
  $BackupDir = Join-Path $RepoRoot "_mit3_database_backups"
  $StatusPath = Join-Path $BackendDir "update-status.json"
  $LogDir = Join-Path $BackendDir "update-logs"
  $Port = 4173
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $LogFile = Join-Path $LogDir "update-$timestamp.log"

  $beforeSha = $null
  try { $beforeSha = (& git -C $RepoRoot rev-parse HEAD 2>$null) } catch {}

  $Status = [ordered]@{
    running = $true
    phase = "starting"
    message = "Starting MIT3 website update..."
    repoRoot = $RepoRoot
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    completedAt = $null
    ok = $null
    error = $null
    beforeSha = $beforeSha
    afterSha = $null
    logFile = $LogFile
    branch = $null
    localSha = $beforeSha
    remoteSha = $null
    behindCount = $null
    gitPullResult = $null
  }
  Save-UpdateStatus -Phase "starting" -Message "Starting MIT3 website update..."

  Write-UpdateLog "========================================="
  Write-UpdateLog " MIT3 Website Update Puller"
  Write-UpdateLog "========================================="
  Write-UpdateLog "RepoRoot in use: $RepoRoot"
  Write-UpdateLog "NoFolderPicker: $NoFolderPicker"
  Write-UpdateLog "Restart: $Restart"
  Write-UpdateLog "Status file: $StatusPath"
  Write-UpdateLog "Log file: $LogFile"

  if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
    throw "This folder is not a Git repo. No .git folder was found: $RepoRoot"
  }

  if (-not (Test-Path $BackendDir)) {
    throw "backend folder was not found: $BackendDir"
  }

  if (-not (Test-Path $FrontendDir)) {
    throw "frontend folder was not found: $FrontendDir"
  }

  $nodeVersion = node -v 2>$null
  if (-not $nodeVersion) {
    throw "Node.js was not found. Install Node.js 22 LTS first."
  }

  if ($nodeVersion -notmatch "^v22\.") {
    Write-UpdateLog "WARNING: MIT3 is built for Node.js 22 LTS. Current Node: $nodeVersion"
  }

  Set-Location $RepoRoot

  Save-UpdateStatus -Phase "git-status" -Message "Checking local Git status..."
  Invoke-LoggedCommand -FilePath "git" -Arguments @("status", "--short") -WorkingDirectory $RepoRoot -Description "git status --short" | Out-Null

  $dirty = Get-BlockingGitStatusLines -WorkingDirectory $RepoRoot
  if ($dirty.Count -gt 0) {
    foreach ($line in $dirty) { Write-UpdateLog $line }
    throw "Update blocked because local changes exist. Commit, stash, or reset before updating."
  }

  $branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD).Trim()
  $Status.branch = $branch
  Write-UpdateLog "Current branch: $branch"
  if ($branch -ne "main") {
    throw "Update blocked because current branch is not main."
  }

  Save-UpdateStatus -Phase "backup" -Message "Backing up SQLite database..."
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

  if (Test-Path $DbPath) {
    $backupPath = Join-Path $BackupDir "maintenance_inventory_3_web-$timestamp.db"
    Write-UpdateLog "Backing up SQLite database to $backupPath"
    Copy-Item $DbPath $backupPath -Force
  } else {
    Write-UpdateLog "No SQLite database found yet. Skipping DB backup."
  }

  if ($NoFolderPicker) {
    Write-UpdateLog "In-app update requested. Waiting 5 seconds before stopping the website so the browser receives the start response..."
    Start-Sleep -Seconds 5
  }

  Save-UpdateStatus -Phase "restarting" -Message "Stopping the current MIT3 website process before pulling/building..."
  Stop-Mit3Website -Port $Port

  Save-UpdateStatus -Phase "pulling" -Message "Fetching origin and pulling latest main from GitHub..."
  Invoke-LoggedCommand -FilePath "git" -Arguments @("fetch", "origin") -WorkingDirectory $RepoRoot -Description "git fetch origin" | Out-Null

  $localSha = (& git -C $RepoRoot rev-parse HEAD).Trim()
  $remoteSha = (& git -C $RepoRoot rev-parse origin/main).Trim()
  $behindText = (& git -C $RepoRoot rev-list --count HEAD..origin/main).Trim()
  $behindCount = [int]$behindText
  $Status.localSha = $localSha
  $Status.remoteSha = $remoteSha
  $Status.behindCount = $behindCount
  Save-UpdateStatus -Phase "pulling" -Message "Repo path used: $RepoRoot; Current branch: $branch; Local commit: $localSha; Remote commit: $remoteSha; Behind count: $behindCount"
  Write-UpdateLog "Repo path used: $RepoRoot"
  Write-UpdateLog "Current branch: $branch"
  Write-UpdateLog "Local commit: $localSha"
  Write-UpdateLog "Remote commit: $remoteSha"
  Write-UpdateLog "Behind count: $behindCount"

  if ($behindCount -le 0) {
    $Status.gitPullResult = "Already up to date."
    Save-UpdateStatus -Phase "complete" -Message "Already up to date." -Running $false -Ok $true
    Write-UpdateLog "Git pull result: Already up to date."
    exit 0
  }

  try {
    $pullOutput = Invoke-LoggedCommand -FilePath "git" -Arguments @("pull", "--ff-only", "origin", "main") -WorkingDirectory $RepoRoot -Description "git pull --ff-only origin main"
    $Status.gitPullResult = if ($pullOutput) { $pullOutput } else { "git pull --ff-only origin main completed successfully." }
    Write-UpdateLog "Git pull result: $($Status.gitPullResult)"
  } catch {
    throw "Update blocked because fast-forward pull is not possible. $($_.Exception.Message)"
  }

  Save-UpdateStatus -Phase "frontend-install" -Message "Installing frontend dependencies..."
  if (Test-Path (Join-Path $FrontendDir ".env.production.website")) {
    Copy-Item (Join-Path $FrontendDir ".env.production.website") (Join-Path $FrontendDir ".env.local") -Force
    Write-UpdateLog "Copied frontend .env.production.website to .env.local"
  } elseif (Test-Path (Join-Path $FrontendDir ".env.website.example")) {
    Copy-Item (Join-Path $FrontendDir ".env.website.example") (Join-Path $FrontendDir ".env.local") -Force
    Write-UpdateLog "Copied frontend .env.website.example to .env.local"
  }
  Invoke-LoggedCommand -FilePath "npm" -Arguments @("install") -WorkingDirectory $FrontendDir -Description "frontend npm install"

  Save-UpdateStatus -Phase "frontend-build" -Message "Building frontend website files..."
  Invoke-LoggedCommand -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory $FrontendDir -Description "frontend npm run build"

  Save-UpdateStatus -Phase "backend-install" -Message "Installing backend dependencies..."
  Invoke-LoggedCommand -FilePath "npm" -Arguments @("install") -WorkingDirectory $BackendDir -Description "backend npm install"

  Save-UpdateStatus -Phase "backend-build" -Message "Building backend server..."
  Invoke-LoggedCommand -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory $BackendDir -Description "backend npm run build"

  Save-UpdateStatus -Phase "restarting" -Message "Starting MIT3 website on port $Port..."
  if (-not $NoFolderPicker -or $Restart) {
    if ($NoFolderPicker) {
      Start-Process -FilePath "powershell.exe" -WorkingDirectory $BackendDir -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "npm start")
      Write-UpdateLog "Started MIT3 website in a detached PowerShell process."
    } else {
      Start-Job -ScriptBlock {
        Start-Sleep -Seconds 4
        Start-Process "http://localhost:4173"
      } | Out-Null
      Save-UpdateStatus -Phase "complete" -Message "Update complete. Starting MIT3 website in this window..." -Running $false -Ok $true
      npm start
      exit 0
    }
  } else {
    Write-UpdateLog "Restart was not requested. Update complete."
  }

  Save-UpdateStatus -Phase "complete" -Message "Update completed successfully. Restart MIT3 to load the newest version." -Running $false -Ok $true
  Write-UpdateLog "Update complete."
} catch {
  $message = $_.Exception.Message
  if (-not $message) { $message = [string]$_ }
  Write-UpdateLog "ERROR: $message"
  Save-UpdateStatus -Phase "failed" -Message "Update failed." -Running $false -Ok $false -ErrorMessage $message
  Pause-IfInteractive
  exit 1
}
