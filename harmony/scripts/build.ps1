param(
  [ValidateSet('debug', 'release')]
  [string]$BuildMode = 'debug',
  [string]$HvigorPath = ''
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'preflight.ps1') -Build -BuildMode $BuildMode -HvigorPath $HvigorPath
