param(
  [string]$SdkRoot = '',
  [string]$JavaPath = ''
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$signingDir = Join-Path $project 'signing'
$sdkCandidates = @()
if (-not [string]::IsNullOrWhiteSpace($SdkRoot)) { $sdkCandidates += $SdkRoot }
if (-not [string]::IsNullOrWhiteSpace($env:DEVECO_SDK_HOME)) { $sdkCandidates += $env:DEVECO_SDK_HOME }
$sdkCandidates += 'C:\Program Files\Huawei\DevEco Studio\sdk'

$lib = ''
foreach ($candidate in $sdkCandidates) {
  foreach ($relative in @('default\openharmony\toolchains\lib', 'openharmony\toolchains\lib')) {
    $possible = Join-Path $candidate $relative
    if (Test-Path -LiteralPath (Join-Path $possible 'OpenHarmony.p12') -PathType Leaf) {
      $lib = $possible
      break
    }
  }
  if ($lib) { break }
}
if (-not $lib) { throw 'The OpenHarmony SDK signing materials were not found.' }

$java = if (-not [string]::IsNullOrWhiteSpace($JavaPath)) { $JavaPath }
  elseif (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) { Join-Path $env:JAVA_HOME 'bin\java.exe' }
  else { 'C:\Program Files\Huawei\DevEco Studio\jbr\bin\java.exe' }
if (-not (Test-Path -LiteralPath $java -PathType Leaf)) { throw 'DevEco JBR java.exe was not found.' }

$keystore = Join-Path $signingDir 'OpenHarmony.p12'
$profile = Join-Path $signingDir 'mooncut-emulator-profile.p7b'
Copy-Item -LiteralPath (Join-Path $lib 'OpenHarmony.p12') -Destination $keystore -Force

$profileCertificateChain = [System.IO.File]::ReadAllText((Join-Path $lib 'OpenHarmonyProfileDebug.pem'))
$certificateMatches = [regex]::Matches($profileCertificateChain, '(?s)-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----')
if ($certificateMatches.Count -lt 2) { throw 'The SDK OpenHarmony certificate chain is incomplete.' }
$applicationLeaf = [System.IO.File]::ReadAllText((Join-Path $signingDir 'OpenHarmonyApplicationRelease.pem')).Trim()
$applicationChain = $certificateMatches[0].Value + "`n" + $certificateMatches[1].Value + "`n" + $applicationLeaf + "`n"
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $signingDir 'OpenHarmonyApplicationReleaseChain.pem'), $applicationChain, $utf8WithoutBom)

$node = if (-not [string]::IsNullOrWhiteSpace($env:NODE_HOME)) { Join-Path $env:NODE_HOME 'node.exe' }
  else { 'C:\Program Files\Huawei\DevEco Studio\tools\node\node.exe' }
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'DevEco node.exe was not found.' }
$encryptedPassword = & $node (Join-Path $PSScriptRoot 'prepare-signing-material.js') $signingDir
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($encryptedPassword)) {
  throw "Hvigor signing material preparation failed with exit code $LASTEXITCODE"
}

& $java -jar (Join-Path $lib 'hap-sign-tool.jar') sign-profile `
  -mode localSign `
  -keyAlias 'openharmony application profile debug' `
  -keyPwd 123456 `
  -profileCertFile (Join-Path $lib 'OpenHarmonyProfileDebug.pem') `
  -inFile (Join-Path $signingDir 'mooncut-emulator-profile.json') `
  -signAlg SHA256withECDSA `
  -keystoreFile $keystore `
  -keystorePwd 123456 `
  -outFile $profile
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $profile -PathType Leaf)) {
  throw "OpenHarmony emulator profile signing failed with exit code $LASTEXITCODE"
}

Write-Host "OpenHarmony emulator signing profile prepared: $profile"
Write-Host "Hvigor encrypted emulator password: $encryptedPassword"
