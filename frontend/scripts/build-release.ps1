param(
  [string]$UpdateFolder = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$cargoTargetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repoRoot "target" }
$packageJsonPath = Join-Path $repoRoot "package.json"
$installerSourceDirs = @(
  (Join-Path $cargoTargetDir "release\bundle\nsis"),
  (Join-Path $repoRoot "target\release\bundle\nsis"),
  (Join-Path $repoRoot "src-tauri\target\release\bundle\nsis")
)
$companyUpdateFolder = "C:\Users\maste\OneDrive\Company - Files - 2.0\JBT USA - Files\Dash Board - Info\Inventoy System app\Maintenance Inventory Tracker\App Updates"
$personalUpdateFolder = "C:\Users\maste\OneDrive\My personal - Files\Maintenance Inventory Tracker\App Updates"
$updateFolderConfigFile = Join-Path $repoRoot "scripts\release-update-folder.txt"

function Normalize-UpdateFolder([string]$folderPath) {
  if ([string]::IsNullOrWhiteSpace($folderPath)) {
    return ""
  }

  return $folderPath.Trim().Trim('"')
}

function Add-UpdateDestination($destinations, [string]$folderPath) {
  $normalizedFolder = Normalize-UpdateFolder $folderPath

  if (-not $normalizedFolder) {
    return
  }

  foreach ($destination in $destinations) {
    if ([string]::Equals($destination, $normalizedFolder, [System.StringComparison]::OrdinalIgnoreCase)) {
      return
    }
  }

  [void]$destinations.Add($normalizedFolder)
}

function Get-ConfiguredUpdateFolder {
  $configuredFolder = Normalize-UpdateFolder $UpdateFolder

  if ($configuredFolder) {
    return $configuredFolder
  }

  $configuredFolder = Normalize-UpdateFolder $env:MAINTENANCE_INVENTORY_UPDATE_FOLDER

  if ($configuredFolder) {
    return $configuredFolder
  }

  if (Test-Path -LiteralPath $updateFolderConfigFile -PathType Leaf) {
    $configuredFolder = Normalize-UpdateFolder (Get-Content -LiteralPath $updateFolderConfigFile -Raw)

    if ($configuredFolder) {
      return $configuredFolder
    }
  }

  return ""
}

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$releaseVersion = [string]$packageJson.version
$expectedInstallerName = "Maintenance Inventory Tracker_${releaseVersion}_x64-setup.exe"

Write-Host "Starting Maintenance Inventory Tracker desktop release build..."
Write-Host "Release version: $releaseVersion"
Write-Host "Expected installer filename: $expectedInstallerName"
Write-Host "Cargo target folder: $cargoTargetDir"

Push-Location $repoRoot
try {
  npm.cmd run tauri:build

  if ($LASTEXITCODE -ne 0) {
    throw "npm.cmd run tauri:build failed with exit code $LASTEXITCODE."
  }
} catch {
  Write-Error "Release build failed. $($_.Exception.Message)"
  exit 1
} finally {
  Pop-Location
}

$existingInstallerSourceDirs = @($installerSourceDirs | Where-Object { Test-Path -LiteralPath $_ -PathType Container })

if ($existingInstallerSourceDirs.Count -eq 0) {
  Write-Error "Release build passed, but no NSIS installer folder was found. Checked: $($installerSourceDirs -join '; ')"
  exit 1
}

$installer = Get-ChildItem -LiteralPath $existingInstallerSourceDirs -Filter $expectedInstallerName -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  Write-Error "Release build passed, but expected installer $expectedInstallerName was not found in: $($existingInstallerSourceDirs -join '; ')"
  exit 1
}

$updateDestinations = New-Object System.Collections.Generic.List[string]
$configuredUpdateFolder = Get-ConfiguredUpdateFolder

if ($configuredUpdateFolder) {
  Add-UpdateDestination $updateDestinations $configuredUpdateFolder
} else {
  Add-UpdateDestination $updateDestinations $companyUpdateFolder
}

if ((Test-Path -LiteralPath $personalUpdateFolder -PathType Container) -or
    [string]::Equals($configuredUpdateFolder, $personalUpdateFolder, [System.StringComparison]::OrdinalIgnoreCase)) {
  Add-UpdateDestination $updateDestinations $personalUpdateFolder
}

if ($updateDestinations.Count -eq 0) {
  Write-Error "No update destination folder could be resolved."
  exit 1
}

$copiedInstallers = @()

foreach ($updateFolder in $updateDestinations) {
  New-Item -ItemType Directory -Path $updateFolder -Force | Out-Null

  $destinationPath = Join-Path $updateFolder $installer.Name
  Copy-Item -LiteralPath $installer.FullName -Destination $destinationPath -Force
  $copiedInstallers += $destinationPath
}

Write-Host ""
Write-Host "Release build complete."
Write-Host "Build passed: npm.cmd run tauri:build"
Write-Host "Release version: $releaseVersion"
Write-Host "Installer filename: $($installer.Name)"
Write-Host "Copied installer to:"
foreach ($copiedInstaller in $copiedInstallers) {
  Write-Host "  $copiedInstaller"
}
