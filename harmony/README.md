# MoonCut HarmonyOS

ArkTS + ArkUI implementation of the native MoonCut client. Product behavior,
service contracts, state labels and theme tokens mirror the iOS client under
`../ios/MoonCut`.

## Implemented

- Stage-model HarmonyOS project scaffold for phone and tablet.
- Email registration/login and user Cookie session client.
- Exact light, dark and Memphis semantic design tokens matching iOS values;
  the default follows system color mode, while explicit choices style native controls too.
- Four primary tabs: Create, Coach, Jobs and Community.
- Home, auth, settings, script assistant, edit workflow, render queue and
  community page states.
- Real API DTOs and stage localization shared conceptually with iOS.
- Photo-library and MP4/MOV document pickers, resumable bounded-memory upload,
  image-generation choice, edit-job creation and server-owned polling.
- Authenticated HTTP Range download into the app sandbox with per-range offset,
  write-length and final-size validation, partial-file cleanup and local playback.
- Network Kit cookie capture plus Asset Store-backed session restoration, with
  logout/401 deletion and no raw Cookie in Preferences.
- Build-profile-specific network policy: loopback-only HTTP in Debug and the fixed HTTPS production host plus bundled MoonCut CA in Release.
- Share Kit system sharing for a locally downloaded result video.
- Practice-only or recording-plus-coaching from the same teleprompter, Camera Kit
  front-camera preview, AVRecorder pause/resume, recording review and
  handoff into the edit workflow, including abandoned-file cleanup.
- Native second-request permission settings after Camera/Microphone denial.
- Cache-backed recording drafts and community media; completed edits remain in persistent app storage.
- Real speaking-coach core: one AudioCapturer 16 kHz PCM stream feeds Core Speech
  Kit `writeAudio` and RMS, with cumulative session continuation, twelve-second pace,
  pauses, Camera metadata face geometry, local advice and
  `/v1/assistant/coach` responses.
- Preferences persistence for global theme and user-namespaced draft/active job.
- User-namespaced pet happiness/touch feedback plus persisted teleprompter font size and pace.
- The same iOS 8×9 pet sprite sheet with matching animation rows, frame counts and durations.
- Matching iOS compact pet geometry and page-specific Home/Coach pet cards.
- System reduced-motion support driven by HarmonyOS animator, transition and window animation scales.
- Community cursor pagination with authenticated poster/video downloads and iOS-equivalent metadata cards.
- No local fake progress or fake AI response paths.

## Required target-SDK verification

Open `harmony/` in DevEco Studio and select the installed HarmonyOS SDK.
The project compiles with HarmonyOS 6.1.1 API 24 while retaining API 12 as its
compatibility and target baseline. Before a
release build, verify the following adapters on a physical target device:

1. Network Kit Set-Cookie behavior and Asset Store-backed session restoration after process restart.
2. Resumable upload chunk reads and retries against a real server under mobile
   network interruption.
3. Authenticated artifact Range download and local video playback.
4. Camera Kit preview plus AVRecorder pause/resume.
5. Core Speech Kit `writeAudio`, AudioCapturer RMS and Camera metadata face-direction metrics
   sharing the same AVRecorder session. If a device rejects microphone sharing,
   the UI must retain the explicit unavailable state already implemented.
6. Release HTTPS certificate trust for the production MoonCut host and rejection of other hosts.
7. Share Kit preview and transfer of an app-sandbox MP4 to at least one target app.
8. Both PhotoViewPicker and DocumentViewPicker return readable non-empty MP4/MOV
   assets on every supported target device.

The Debug and Release server values are injected through `entry/build-profile.json5`
and validated by `entry/src/main/ets/core/api/APIConfiguration.ets`; no service
API key belongs in the client. The production CA is public certificate material,
not a client credential.

## Build and verification

Run the read-only contract preflight on Windows before opening DevEco Studio:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\preflight.ps1
```

After DevEco Studio/command-line tools provide `hvigor` and a signing profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1 debug
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1 release
```

With a signed Debug configuration and an HDC-visible emulator or physical device,
run the Hypium suite with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\device-test.ps1
```

Both scripts accept the full DevEco runner/tool paths through `-HvigorPath` and
`-HdcPath` when those executables are not on `PATH`.

If DevEco's Hvigor runner is not on `PATH`, pass its full path with
`-HvigorPath` or set `HVIGOR_PATH` for the current shell. The script validates
that the selected runner exists before invoking it.

Physical-device evidence must follow `DEVICE-TEST.md`. The scripts intentionally
do not store SDK paths, signing files, passwords or service credentials.
