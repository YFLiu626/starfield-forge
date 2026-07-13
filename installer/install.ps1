param(
  [string]$InstallParent = "",
  [switch]$NoPrompt
)

$ErrorActionPreference = "Stop"

$appName = "3D Starfield Generator"
$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultParent = [IO.Path]::Combine($env:LOCALAPPDATA, "Programs")
$sourceExe = Get-ChildItem -LiteralPath $sourceDir -Filter "*.exe" -File | Select-Object -First 1
if (-not $sourceExe) {
  throw "Application executable was not found."
}

function Get-FullPath($path) {
  return [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($path.Trim().Trim('"')))
}

function Resolve-InstallTarget($parentPath) {
  if ([string]::IsNullOrWhiteSpace($parentPath)) {
    $parentPath = $defaultParent
  }

  $fullParent = Get-FullPath $parentPath
  if ((Split-Path -Leaf $fullParent) -ieq $appName) {
    return $fullParent
  }

  return [IO.Path]::Combine($fullParent, $appName)
}

function Select-InstallParent() {
  if (-not [string]::IsNullOrWhiteSpace($InstallParent)) {
    return $InstallParent
  }

  if ($NoPrompt) {
    return $defaultParent
  }

  Write-Host "Choose an install location. The app folder will be created inside it."
  Write-Host "Default: $defaultParent"

  try {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Choose install location. The app will be installed into a 3D Starfield Generator folder inside the selected folder."
    $dialog.SelectedPath = $defaultParent
    $dialog.ShowNewFolderButton = $true
    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
      return $dialog.SelectedPath
    }

    Write-Host "Installation cancelled."
    exit 1
  } catch {
    Write-Host "Folder picker unavailable: $($_.Exception.Message)"
    $typedPath = Read-Host "Install location parent folder (press Enter for default)"
    if (-not [string]::IsNullOrWhiteSpace($typedPath)) {
      return $typedPath
    }
  }

  return $defaultParent
}

function ConvertTo-PowerShellLiteral($value) {
  return "'" + ($value -replace "'", "''") + "'"
}

$targetDir = Resolve-InstallTarget (Select-InstallParent)
$targetExe = [IO.Path]::Combine($targetDir, $sourceExe.Name)
$targetIcon = [IO.Path]::Combine($targetDir, "app-icon.ico")
$desktopShortcut = [IO.Path]::Combine([Environment]::GetFolderPath("Desktop"), "$appName.lnk")
$startMenuDir = [IO.Path]::Combine([Environment]::GetFolderPath("StartMenu"), "Programs", $appName)
$startShortcut = [IO.Path]::Combine($startMenuDir, "$appName.lnk")
$uninstallScript = [IO.Path]::Combine($targetDir, "uninstall.ps1")
$uninstallBat = [IO.Path]::Combine($targetDir, "uninstall.bat")
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\3D Starfield Generator"

Write-Host "Installing $appName ..."
Write-Host "Install location: $targetDir"

$sourceFullPath = Get-FullPath $sourceDir
if ($sourceFullPath.Equals((Get-FullPath $targetDir), [StringComparison]::OrdinalIgnoreCase)) {
  throw "Please choose a different install location than the extracted package folder."
}

$targetParent = Split-Path -Parent $targetDir
New-Item -ItemType Directory -Path $targetParent -Force | Out-Null

if (Test-Path -LiteralPath $targetDir) {
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

$items = Get-ChildItem -LiteralPath $sourceDir -Force | Where-Object {
  $_.Name -ine "install.ps1" -and $_.Extension -ine ".bat"
}
foreach ($item in $items) {
  Copy-Item -LiteralPath $item.FullName -Destination $targetDir -Recurse -Force
}

New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null

function New-AppShortcut($path) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $targetExe
  $shortcut.WorkingDirectory = $targetDir
  if (Test-Path -LiteralPath $targetIcon) {
    $shortcut.IconLocation = $targetIcon
  } else {
    $shortcut.IconLocation = "$targetExe,0"
  }
  $shortcut.Description = $appName
  $shortcut.Save()
}

New-AppShortcut $desktopShortcut
New-AppShortcut $startShortcut

@"
`$ErrorActionPreference = "Stop"
`$appName = $(ConvertTo-PowerShellLiteral $appName)
`$targetDir = $(ConvertTo-PowerShellLiteral $targetDir)
`$desktopShortcut = $(ConvertTo-PowerShellLiteral $desktopShortcut)
`$startMenuDir = $(ConvertTo-PowerShellLiteral $startMenuDir)
`$uninstallKey = $(ConvertTo-PowerShellLiteral $uninstallKey)
Write-Host "Uninstalling `$appName ..."
if (Test-Path -LiteralPath `$desktopShortcut) { Remove-Item -LiteralPath `$desktopShortcut -Force }
if (Test-Path -LiteralPath `$startMenuDir) { Remove-Item -LiteralPath `$startMenuDir -Recurse -Force }
if (Test-Path -LiteralPath `$uninstallKey) { Remove-Item -LiteralPath `$uninstallKey -Recurse -Force }
Start-Sleep -Milliseconds 300
if (Test-Path -LiteralPath `$targetDir) { Remove-Item -LiteralPath `$targetDir -Recurse -Force }
Write-Host "Uninstall complete."
"@ | Set-Content -LiteralPath $uninstallScript -Encoding UTF8

@"
@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
pause
"@ | Set-Content -LiteralPath $uninstallBat -Encoding ASCII

New-Item -Path $uninstallKey -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value $appName -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value "1.0.0" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "Local" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $targetDir -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value $targetIcon -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value "`"$uninstallBat`"" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null

Write-Host ""
Write-Host "Install complete."
Write-Host "Desktop and Start Menu shortcuts were created."
Write-Host "Install location: $targetDir"
