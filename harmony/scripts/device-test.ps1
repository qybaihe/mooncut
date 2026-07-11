param(
  [string]$HvigorPath = '',
  [string]$HdcPath = ''
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'prepare-emulator-signing.ps1')
$wrapper = Join-Path $project 'hvigorw.bat'
$hvigorCommand = Get-Command hvigor -ErrorAction SilentlyContinue
$runner = if (-not [string]::IsNullOrWhiteSpace($HvigorPath)) { $HvigorPath }
  elseif (-not [string]::IsNullOrWhiteSpace($env:HVIGOR_PATH)) { $env:HVIGOR_PATH }
  elseif (Test-Path -LiteralPath $wrapper -PathType Leaf) { $wrapper }
  elseif ($null -ne $hvigorCommand) { $hvigorCommand.Source }
  else { '' }

$hdcCommand = Get-Command hdc -ErrorAction SilentlyContinue
$hdc = if (-not [string]::IsNullOrWhiteSpace($HdcPath)) { $HdcPath }
  elseif (-not [string]::IsNullOrWhiteSpace($env:HDC_PATH)) { $env:HDC_PATH }
  elseif ($null -ne $hdcCommand) { $hdcCommand.Source }
  else { '' }

if ([string]::IsNullOrWhiteSpace($runner) -or -not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw 'Hvigor runner was not found. Pass -HvigorPath or set HVIGOR_PATH.'
}
if ([string]::IsNullOrWhiteSpace($hdc) -or -not (Test-Path -LiteralPath $hdc -PathType Leaf)) {
  throw 'HDC was not found. Pass -HdcPath or set HDC_PATH.'
}

$targets = @(& $hdc list targets) | Where-Object {
  -not [string]::IsNullOrWhiteSpace($_) -and $_.Trim() -ne '[Empty]'
}
if ($LASTEXITCODE -ne 0) { throw "HDC target query failed with exit code $LASTEXITCODE" }
if ($targets.Count -eq 0) {
  throw 'No HarmonyOS device is connected. Start a DevEco emulator or connect and authorize a physical device.'
}

Write-Host "Connected HarmonyOS target(s): $($targets -join ', ')"
Push-Location $project
try {
  & $runner onDeviceTest --mode module -p product=emulator -p module=entry@ohosTest -p buildMode=test --no-daemon
  if ($LASTEXITCODE -ne 0) { throw "Hypium device tests failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host 'MoonCut Hypium device tests completed.'
