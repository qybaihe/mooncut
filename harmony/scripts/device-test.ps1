param(
  [string]$HvigorPath = '',
  [string]$HdcPath = ''
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'prepare-emulator-signing.ps1')
$wrapper = Join-Path $project 'hvigorw.bat'
$devecoRoot = Join-Path $env:ProgramFiles 'Huawei\DevEco Studio'
$devecoRunner = Join-Path $devecoRoot 'tools\hvigor\bin\hvigorw.bat'
$devecoSdk = Join-Path $devecoRoot 'sdk'
$devecoHdc = Join-Path $devecoSdk 'default\openharmony\toolchains\hdc.exe'
$hvigorCommand = Get-Command hvigor -ErrorAction SilentlyContinue
$runner = if (-not [string]::IsNullOrWhiteSpace($HvigorPath)) { $HvigorPath }
  elseif (-not [string]::IsNullOrWhiteSpace($env:HVIGOR_PATH)) { $env:HVIGOR_PATH }
  elseif (Test-Path -LiteralPath $wrapper -PathType Leaf) { $wrapper }
  elseif ($null -ne $hvigorCommand) { $hvigorCommand.Source }
  elseif (Test-Path -LiteralPath $devecoRunner -PathType Leaf) { $devecoRunner }
  else { '' }

$hdcCommand = Get-Command hdc -ErrorAction SilentlyContinue
$hdc = if (-not [string]::IsNullOrWhiteSpace($HdcPath)) { $HdcPath }
  elseif (-not [string]::IsNullOrWhiteSpace($env:HDC_PATH)) { $env:HDC_PATH }
  elseif ($null -ne $hdcCommand) { $hdcCommand.Source }
  elseif (Test-Path -LiteralPath $devecoHdc -PathType Leaf) { $devecoHdc }
  else { '' }

if ([string]::IsNullOrWhiteSpace($env:DEVECO_SDK_HOME) -or -not (Test-Path -LiteralPath $env:DEVECO_SDK_HOME)) {
  if (Test-Path -LiteralPath $devecoSdk -PathType Container) { $env:DEVECO_SDK_HOME = $devecoSdk }
}

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
