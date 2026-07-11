# HarmonyOS physical-device acceptance

This checklist is evidence for the completion gates in `PARITY.md`. Record the
device model, HarmonyOS version, SDK/DevEco versions and build mode for every run.

## 1. Build and launch

- Start a DevEco emulator or connect and authorize a physical device, confirm
  `hdc list targets` is non-empty, then run `scripts/device-test.ps1` for the
  Hypium contract suite before manual acceptance.
- Run `scripts/build.ps1 debug` and install the signed HAP.
- Verify the app reaches the auth gate without ArkTS, resource or Kit-loading errors.
- Verify Settings shows `http://127.0.0.1:4317` in Debug.

## 2. Authentication and secure restoration

- Register or sign in with an email account.
- Force-stop the app and relaunch it; the authenticated session must restore.
- Sign out, force-stop and relaunch; the session must not restore.
- Trigger a 401 and verify the client returns to authentication and deletes the
  Asset Store session. Confirm diagnostics show the backend request ID when supplied.
- Inspect Preferences data: it may contain theme/draft/job/pet values but never
  `mooncut_session` or a raw Cookie. Asset Store owns the session secret.
- Expire the server session, then tap “重新连接” on Home or “重新检查” in
  Settings. Verify the client revalidates `/v1/auth/session` and returns to Auth.

## 3. Camera, recording and coaching

- Deny Camera once and Microphone once. Each denial must show an explicit
  unavailable state and no synthetic metrics.
- Tap “打开系统权限设置”, grant both permissions, return, and verify preview is
  prepared automatically. Leave either permission denied and verify the denial
  state remains visible without repeatedly showing the first-request dialog.
- Grant both permissions and verify front-camera preview, mirror toggle,
  countdown, record, pause, resume, stop and local review.
- From both Script and Coach entry paths, verify the same teleprompter exposes
  both “只陪练” and “开始录制”; practice-only must never create a video file.
- During practice, verify AudioCapturer supplies both a changing RMS value and
  partial ASR text. Speak for more than 60 seconds and verify word count/text
  continue instead of resetting when the ASR session rolls over.
- Move out of frame and speak softly; face/volume advice must follow real input.
- Verify the recorded MP4 can be handed to Clip Studio and has non-zero size.
- Record and enter review, then leave without handing off; verify the abandoned
  sandbox MP4 is deleted. Repeat with handoff and verify Clip Studio can still read it.
- Verify recording drafts are created under the app cache directory, while a
  downloaded completed edit remains in the persistent files directory.

## 4. Resumable upload and server-owned progress

- Select one video through the photo library and one MP4/MOV through the document
  picker; each selection must be readable and have non-zero size.
- Before uploading, return to Create and reopen Clip Studio; the selected source,
  title and preview must remain available. Reset must not delete the original
  photo-library/document file, but must delete an app-owned recording/result copy.
- Select a video larger than three configured upload chunks.
- Disable and re-enable networking during upload. The client must query the
  committed server offset and resume without loading the full file into memory.
- Verify edit progress changes only when `/v1/edit-jobs/{id}` changes.
- Force-stop during a queued/running job and relaunch; the active job must restore.

## 5. Result, quality gate and sharing

- Complete a real job and verify authenticated Range download plus local playback.
- Interrupt a Range download and verify no zero/partial MP4 remains playable or
  shareable. Retry and verify the final sandbox size matches Content-Range total.
- Open the Share Kit panel and transfer the local MP4 to at least one target app.
- For `quality.ok !== true`, verify no community publish action is exposed.
- For `quality.ok === true`, publish once and confirm the real post appears.

## 6. Community

- Verify protected posters load through the authenticated downloader; a failed
  poster must retain the themed placeholder without hiding the post.
- Load at least two cursor pages and verify no duplicate or missing posts.
- Open a post, play its downloaded local video, close the player and return to
  the same list position.

## 7. Themes, pet and accessibility

- With no saved preference, change system light/dark mode while the app is running
  and verify the app follows it. Then select Light, Dark and Memphis explicitly,
  compare against the iOS semantic tokens, and verify native controls follow.
- Touch the pet, relaunch and verify user-namespaced happiness persistence.
- Verify every pet state uses the same sprite row/frame timing as iOS. Compare the
  compact 56×60 outer frame and 52×56 sprite viewport on Home, Coach and teleprompter.
- With the system screen reader enabled, verify tab, theme, settings, refresh,
  mirror and pet controls have meaningful labels.
- Set the three system animation scales to zero through Accessibility/developer
  settings, return to the app, and verify the pet freezes on frame zero and the
  touch heart does not animate. Restore the scales and verify animation resumes.

## 8. Release transport

- Build Release and verify Settings shows `https://42.194.219.172`.
- Verify the bundled MoonCut CA succeeds only for the configured production host.
- Replace the endpoint with HTTP, another host or an invalid CA in a test branch;
  the client must fail closed without sending the session Cookie.
