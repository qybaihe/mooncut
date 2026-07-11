# iOS / HarmonyOS parity contract

This file is the implementation gate for the HarmonyOS client. A feature is not
considered complete merely because a visually similar page exists: its real
service path, failure behavior and persisted state must match iOS.

| iOS source | HarmonyOS source | Current status |
| --- | --- | --- |
| `Views/RootView.swift` | `pages/Index.ets` | Implemented: auth gate, four tabs, create subroutes |
| `Core/DesignSystem/AppTheme.swift` | `core/design/AppTheme.ets` | Implemented: exact light/dark/Memphis semantic tokens; an unset preference follows system color mode and explicit choices also style native controls |
| `Services/API/APIModels.swift` | `core/api/APIModels.ets` | Implemented: auth/jobs/queue/assistant/coach/community DTOs and stage copy |
| `Services/API/MoonCutAPIClient.swift` + `CertificateTrust.swift` | `core/api/MoonCutAPIClient.ets` + `core/api/RawFileUploader.ets` + `core/security/*` | Updated to the production edge contract: `https://mooncut.me/api`, OTP endpoints, Cookie capture, Asset Store restoration, bounded raw upload, authenticated Range download, fixed-host policy and the system public TLS chain |
| `Features/Auth/AuthView.swift` | `features/auth/AuthPage.ets` | Updated to OTP-first login/registration with 60-second resend cooldown, compatible password login, diagnostics and post-login session verification |
| `Features/Home/HomeView.swift` | `features/home/HomePage.ets` | Implemented: service badge, health/session recheck, creation actions, active state and compact pet card |
| `Features/Edit/ClipStudioViewModel.swift` | `features/edit/ClipStudioPage.ets` | Implemented: PhotoViewPicker plus MP4/MOV DocumentViewPicker, navigation-stable and account-isolated source state, app-owned media cleanup, measured raw upload, image-generation choice, create/poll with eight transient retries, authenticated download/local before-after playback, Share Kit system sharing and iOS-equivalent quality-gated publish panel; physical-device verification pending |
| `Features/Record/RecordStudioViewModel.swift` | `features/record/ScriptStudioPage.ets` + `TeleprompterPage.ets` | Implemented in code: real script assistant, punctuation-preserving prompt split, camera-independent practice mode, cancellable countdown, native second-request permission settings, Camera Kit/AVRecorder with pausing state, cache-backed recording drafts, review and edit handoff; abandoned review files are removed and handed-off files are retained; device verification pending |
| `Features/Coach/CoachView.swift` | `features/coach/CoachPage.ets` + `services/coaching/*` | Implemented in code: one real 16 kHz PCM stream feeds Core Speech Kit `writeAudio` and RMS, ASR sessions auto-continue with cumulative text, plus 12-second pace, pauses, Camera metadata face geometry, local advice and remote coach; SDK/device verification pending |
| `Features/Jobs/JobsView.swift` | `features/jobs/JobsPage.ets` | Edge queue summary is explicitly treated as a possible placeholder; active task details remain authoritative |
| `Core/Pet/PetStateStore.swift` + `PetCompanionView.swift` | `app/AppStore.ets` + `components/PetCompanion.ets` | Implemented: bounded bootstrap, session epoch/account isolation, iOS-equivalent business-event reducer/messages, touch priority, identical sprite sheet/row/frame timing and compact 56×60 outer/52×56 viewport geometry, page-specific Home/Coach cards, happiness persistence and HarmonyOS system animation-scale reduction; device verification pending |
| `Features/Community/CommunityView.swift` | `features/community/CommunityPage.ets` | Implemented in code: serial cursor pagination with stale-response rejection, metadata cards, authenticated cache-backed poster/video Range download and local playback; player-sheet/device verification pending |
| `Features/Settings/SettingsView.swift` | `features/settings/SettingsPage.ets` + `core/storage/ClientPreferences.ets` | Implemented: iOS section order, account/theme, health plus session recheck, service diagnostics, security policy and user-namespaced draft/messages/job/pet persistence |

## Non-negotiable behavior

- No service API key in the client.
- No locally incremented edit progress.
- No fake AI response or fake output video when a service fails.
- Only `quality.ok === true` may expose community publishing.
- Authenticated video is downloaded through the API client before playback.
- Camera/ASR permission denial remains a visible degraded state, never synthetic metrics.
- Production trust applies only to `mooncut.me` through the system HTTPS trust chain.
- Only `AUTH_REQUIRED` clears an existing native session; OTP/password credential errors remain local form errors.
- Edge assistant availability and editing-Agent availability are separate states.
- The raw `mooncut_session` value is stored only in Asset Store, never Preferences or a regular file.
- Release builds reject cleartext HTTP; Debug cleartext is restricted to loopback.

## Completion gates

1. DevEco ArkTS compile succeeds with the selected target SDK.
2. Hypium contract tests pass.
3. All Camera Kit, microphone, ASR and Media Kit flows pass on a physical device.
4. Login survives process restart without storing the raw Cookie in Preferences.
5. A large source video uploads without being fully loaded into the ArkTS heap.
6. A real completed job downloads, plays, shares and conditionally publishes.
7. Community cursor pagination, poster fallback and local player pass device testing.
8. Pet sprite-sheet rendering is pixel-identical; reduce-motion behavior passes device accessibility testing.
9. Photo-library and MP4/MOV document imports both return readable, non-empty assets.
10. Leaving review deletes an abandoned recording, while edit handoff keeps the MP4 readable until Clip Studio finishes with it.
11. A failed or mismatched Range response leaves no partial result file that can be played or shared.
12. Practice-only and recording-plus-coaching are both available from the same teleprompter screen.
13. A denied Camera/Microphone request can open native permission settings and automatically re-check the returned grant state.
14. Recording drafts and community playback use cache storage; completed edits remain persistent until explicit reset.
