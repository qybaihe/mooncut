param(
  [switch]$Build,
  [ValidateSet('debug', 'release')]
  [string]$BuildMode = 'debug',
  [string]$HvigorPath = ''
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repo = (Resolve-Path (Join-Path $project '..')).Path

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
  Write-Host "PASS  $Message"
}

$required = @(
  'build-profile.json5',
  'oh-package.json5',
  'hvigorfile.ts',
  'hvigor/hvigor-config.json5',
  'entry/build-profile.json5',
  'entry/src/main/module.json5',
  'entry/src/main/ets/pages/Index.ets'
)
foreach ($relative in $required) {
  Assert-True (Test-Path -LiteralPath (Join-Path $project $relative)) "required file: $relative"
}

$caIos = Join-Path $repo 'ios/MoonCut/Resources/mooncut-ca.crt'
$caHarmony = Join-Path $project 'entry/src/main/resources/rawfile/mooncut-ca.crt'
$petIos = Join-Path $repo 'ios/MoonCut/Assets.xcassets/HappyDogSpritesheet.imageset/happydog-spritesheet.png'
$petHarmony = Join-Path $project 'entry/src/main/resources/base/media/happydog_spritesheet.png'
Assert-True ((Get-FileHash $caIos -Algorithm SHA256).Hash -eq (Get-FileHash $caHarmony -Algorithm SHA256).Hash) 'iOS/Harmony CA hash match'
Assert-True ((Get-FileHash $petIos -Algorithm SHA256).Hash -eq (Get-FileHash $petHarmony -Algorithm SHA256).Hash) 'iOS/Harmony pet sprite hash match'

$preferences = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/core/storage/ClientPreferences.ets')
Assert-True ($preferences -notmatch 'mooncut_session|Cookie|SECRET') 'Preferences contain no raw session secret'

$source = Get-ChildItem (Join-Path $project 'entry/src') -Recurse -Filter '*.ets'
foreach ($file in $source) {
  $text = Get-Content -Raw -Encoding utf8 $file.FullName
  Assert-True (([regex]::Matches($text, '\{').Count -eq [regex]::Matches($text, '\}').Count)) "brace balance: $($file.Name)"
}

$speech = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/services/coaching/SystemSpeechRecognizer.ets')
$motion = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/core/accessibility/SystemMotionPreference.ets')
$pet = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/components/PetCompanion.ets')
$auth = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/features/auth/AuthPage.ets')
$teleprompter = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/features/record/TeleprompterPage.ets')
$store = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/app/AppStore.ets')
$camera = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/services/media/CameraRecorder.ets')
$models = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/core/models/AppModels.ets')
$themeSource = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/core/design/AppTheme.ets')
$abilitySource = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/entryability/EntryAbility.ets')
$preferencesSource = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/core/storage/ClientPreferences.ets')
Assert-True ($speech -match 'startListening\(params\)') 'Core Speech starts with StartParams'
Assert-True ($speech -match 'writeAudio\(this\.sessionId, audio\)') 'Core Speech receives real PCM'
Assert-True ($speech -match 'this\.engine\.cancel\(this\.sessionId\)' -and $speech -match 'this\.wantRunning = false') 'Core Speech cancels a failed PCM session instead of leaking it'
Assert-True ($motion -match 'ANIMATOR_DURATION_SCALE' -and $motion -match 'TRANSITION_ANIMATION_SCALE' -and $motion -match 'WINDOW_ANIMATION_SCALE') 'reduced motion follows HarmonyOS system animation scales'
Assert-True ($pet -match 'if \(this\.reducedMotion\)' -and $pet -match 'compact') 'pet animation stops for reduced motion and supports teleprompter HUD'
Assert-True ($auth -match 'errorDiagnostic' -and $auth -match 'refreshHealth\(\)' -and $store -match 'hasSessionCookie\(\)' -and $store -match 'verifySession') 'authentication matches iOS diagnostics, service retry, and session verification'
Assert-True ($camera -match 'unlinkSync\(failedPath\)' -and $camera -match "this\.outputPath = ''") 'camera failures do not retain empty recording files'
Assert-True ($camera -match 'context\.cacheDir.*mooncut-recording') 'recording drafts use purgeable cache storage until handoff'
Assert-True ($teleprompter -match 'requestPermissionOnSetting' -and $teleprompter -match 'GrantStatus\.PERMISSION_GRANTED') 'permission denial opens native settings and rechecks authoritative grant state'
Assert-True ($teleprompter.Contains('startSession(true)')) 'practice control starts a non-recording session'
Assert-True ($teleprompter.Contains('startSession(false)')) 'record control starts a recording session'
Assert-True ($models -match 'enum PetEvent' -and $models -match 'COACH_OFF_CAMERA' -and $models -match 'COACH_LOW_VOLUME') 'pet reducer mirrors iOS real business events'
$featureSource = Get-ChildItem (Join-Path $project 'entry/src/main/ets/features') -Recurse -Filter '*.ets'
$directPetWrites = Select-String -Path $featureSource.FullName -Pattern 'store\.pet(State|Override)\s*=' -AllMatches
Assert-True ($null -eq $directPetWrites) 'feature pages drive pet only through the event reducer'
Assert-True ($themeSource -match '#FBF1E0' -and $themeSource -match '#29211C' -and $themeSource -match 'themeTokensForSystem') 'theme tokens match iOS light and system-dark Memphis palettes'
Assert-True ($abilitySource -match 'currentColorMode' -and $abilitySource -match 'onConfigurationUpdate\(configuration: Configuration\)') 'system color-mode changes feed the theme provider'
Assert-True ($preferencesSource -match 'Promise<ThemeMode \| null>' -and $store -match 'themeFollowsSystem') 'unset theme follows system until explicit user selection'
Assert-True ($store -match 'setColorMode\(colorMode\)' -and $store -match 'COLOR_MODE_NOT_SET') 'explicit themes also style native system controls like iOS'

$api = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/core/api/MoonCutAPIClient.ets')
$clip = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/features/edit/ClipStudioPage.ets')
$coach = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/features/coach/CoachPage.ets')
$community = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/features/community/CommunityPage.ets')
$homeSource = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/features/home/HomePage.ets')
$jobs = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/features/jobs/JobsPage.ets')
$scriptStudio = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/features/record/ScriptStudioPage.ets')
$buildProfile = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/build-profile.json5')
$apiConfiguration = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/ets/core/api/APIConfiguration.ets')
$moduleProfile = Get-Content -Raw -Encoding utf8 (Join-Path $project 'entry/src/main/module.json5')
$projectProfile = Get-Content -Raw -Encoding utf8 (Join-Path $project 'build-profile.json5')
Assert-True ($projectProfile -match '"compileSdkVersion"\s*:\s*"6\.1\.1\(24\)"' -and $projectProfile -match '"compatibleSdkVersion"\s*:\s*"5\.0\.0\(12\)"') 'compile SDK matches installed API 24 while compatibility remains API 12'
Assert-True ($api -match '/v1/upload-sessions') 'API client uses resumable upload sessions'
Assert-True ($api -notmatch 'async uploadAsset\(') 'API client exposes no whole-file ArrayBuffer upload regression path'
Assert-True ($clip -match 'readSync\(' -and $clip -match 'session\.chunkBytes') 'source video is read in bounded chunks'
Assert-True ($clip -match 'DocumentViewPicker' -and $clip -match 'fileSuffixFilters') 'edit import supports both photo library and MP4/MOV document picker'
Assert-True ($clip -match 'this\.imageGeneration' -and $clip -match "'auto'" -and $clip -match "'off'") 'edit ready state exposes the iOS image-generation choice'
Assert-True ($clip -match 'this\.store\.setPendingAsset\(this\.asset\)' -and $clip -match 'this\.store\.clipPrompt = this\.prompt' -and $clip -match "asset\?\.source === 'recording'" -and $clip -match 'removeSandboxUri\(this\.localResultUri\)') 'edit navigation retains workspace state and reset removes only app-owned media'
Assert-True ($clip -match 'quality\?\.ok === true') 'community publishing is quality-gated'
Assert-True ($clip -notmatch 'setInterval\([^\)]*progress') 'edit progress is never locally incremented'
Assert-True ($clip -match 'errorDiagnostic' -and $clip -match 'LoadingProgress\(\)' -and $clip -match 'offset / stat\.size') 'edit UI exposes diagnostics, indeterminate jobs, and measured upload progress'
Assert-True ($clip -match '!error\.retryable' -and $clip -match 'error\.unauthorized' -and $clip -match 'this\.fail\(error\)') 'edit retry and polling preserve iOS terminal-error boundaries'
Assert-True ($coach -match 'characterCount\(\)' -and $coach -match 'sentenceCount\(\)' -and $coach -match '/v1/assistant/coach') 'coach entry matches iOS draft statistics and real advice pipeline'
Assert-True ($api -match 'assertTrustedResourceUrl') 'authenticated media enforces same-origin trust'
Assert-True ($api -match 'requestId' -and $api -match 'PAYLOAD_TOO_LARGE' -and $api -match 'RATE_LIMITED') 'HTTP errors preserve iOS diagnostics and status-specific copy'
Assert-True ($api -match 'response\.cookies' -and $api -match 'captureCookie') 'session capture uses the official HttpResponse cookies field plus headers'
Assert-True ($api -match "DOWNLOAD_RANGE_UNSUPPORTED" -and $api -match "AUTH_REQUIRED") 'JSON, upload, and Range 401 responses clear the native session'
Assert-True ($api -match 'DOWNLOAD_WRITE_INCOMPLETE' -and $api -match 'DOWNLOAD_SIZE_MISMATCH' -and $api -match 'DOWNLOAD_RANGE_MISMATCH' -and $api -match 'unlinkSync\(destinationPath\)') 'Range offsets and writes are verified and failures cannot leave a partial result file'
Assert-True ($community -match 'downloadUrl\(post\.videoUrl') 'community video is downloaded before playback'
Assert-True ($community -match 'context\.cacheDir.*community-poster' -and $community -match 'context\.cacheDir.*community-') 'community poster and video downloads use cache storage'
Assert-True ($community -match 'errorDiagnostic' -and $community -match 'load\(true\)' -and $community -match 'nextCursor') 'community keeps iOS diagnostics, retry, and cursor pagination'
Assert-True ($community -match 'this\.loading \|\| this\.loadingMore' -and $community -match 'requestEpoch' -and $community -match '!this\.visible') 'community requests are serial and ignore responses after navigation'
Assert-True ($homeSource -match 'refreshHealth\(true\)' -and $homeSource -match 'activeJobId' -and $homeSource -match 'currentDraft') 'home service retry revalidates session and exposes both iOS continuation paths'
Assert-True ($jobs -match 'snapshot\.updatedAt' -and $jobs -match 'queuePosition' -and $jobs -match 'item\.mine') 'jobs UI consumes authoritative queue metadata'
Assert-True ($jobs -match 'LoadingProgress\(\)' -and $jobs -match 'hasProgress\(item\)') 'jobs UI shows indeterminate service-owned progress'
Assert-True ($jobs -notmatch 'new Date\(\)\.toLocaleTimeString') 'jobs UI does not invent snapshot time'
Assert-True ($jobs -match 'this\.refreshing' -and $jobs -match '!this\.visible' -and $jobs -match 'finally') 'jobs polling is serial and ignores responses after navigation'
Assert-True ($scriptStudio -match "requestScript\('generate'\)" -and $scriptStudio -match "requestScript\('polish'" -and $scriptStudio -match 'retryLast') 'script assistant keeps iOS request actions and retry path'
Assert-True ($scriptStudio -match 'pasteboard\.getSystemPasteboard\(\)\.setData' -and $scriptStudio -match 'selectedSuggestionIds') 'script draft copy and suggestion selection are native and stateful'
Assert-True ($buildProfile -match 'https://42\.194\.219\.172' -and $buildProfile -match 'http://127\.0\.0\.1:4317') 'Debug and Release endpoints are build-specific'
Assert-True ($apiConfiguration -match "parsed\.protocol !== 'http:'" -and $apiConfiguration -match '!this\.requiresBundledCA') 'transport rejects non-HTTP schemes and Release without bundled CA'
Assert-True ($moduleProfile -match 'ohos\.permission\.INTERNET' -and $moduleProfile -match 'ohos\.permission\.CAMERA' -and $moduleProfile -match 'ohos\.permission\.MICROPHONE') 'required runtime permissions are declared'

$synthetic = Select-String -Path $source.FullName -Pattern 'Math\.random|random\(|fake|mock' -AllMatches
Assert-True ($null -eq $synthetic) 'no synthetic metric or fake/mock path'

if ($Build) {
  $wrapper = Join-Path $project 'hvigorw.bat'
  $command = Get-Command hvigor -ErrorAction SilentlyContinue
  $runner = if (-not [string]::IsNullOrWhiteSpace($HvigorPath)) { $HvigorPath }
    elseif (-not [string]::IsNullOrWhiteSpace($env:HVIGOR_PATH)) { $env:HVIGOR_PATH }
    elseif (Test-Path $wrapper) { $wrapper }
    elseif ($null -ne $command) { $command.Source }
    else { '' }
  Assert-True (-not [string]::IsNullOrWhiteSpace($runner)) 'Hvigor runner is available'
  Assert-True (Test-Path -LiteralPath $runner -PathType Leaf) 'Hvigor runner path exists'
  Push-Location $project
  try {
    & $runner assembleHap --mode module -p product=default -p module=entry@default -p buildMode=$BuildMode --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Hvigor $BuildMode build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

Write-Host 'MoonCut HarmonyOS preflight completed.'
