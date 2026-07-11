# MoonCut engineering completion audit

Date: 2026-07-11 (Asia/Shanghai)

## Requirement evidence

| Original requirement | Current implementation | Evidence |
|---|---|---|
| Install and configure Agent Mail CLI | `agently-cli 1.0.9`, `agently-mail` skill, OAuth mailbox `xbuild@agent.qq.com` | `agently-cli +me`; `GET /v1/mail/status` |
| Select a notification email after uploading | Optional email card with validation and authorized sender status | `mooncut-web/src/components/ClipStudio.vue` |
| Background editing without waiting on the page | Persistent job records, Web polling, `active-job` / `last-job` recovery after reload | Completed-job recovery checked in a new browser session |
| Send the finished result by email | Completion email with concise summary and stable artifact URL; Agent Mail prepare/confirm endpoints | `mooncut-pi-agent/src/mail.ts`; OpenAPI mail routes |
| Fill rare visual-material gaps with image generation | Conservative zero-to-two scheduler, OpenAI-compatible image endpoint adapter, separate illustration assets, permanent AI disclosure, and QA gate | `mooncut-pi-agent/src/visuals.ts`; `schedule_generated_visuals`; Remotion illustration beat |
| Smooth real-time coaching | Attack/release volume envelope, rolling-window pace median, monotonic ASR sentence alignment, adaptive low-latency advice cadence | `mooncut-web/src/composables/useSpeakingCoach.ts`; `RecordStudio.vue` |
| Community backed by SQLite | Explicit publish only, quality-gated/idempotent records, paginated list, poster and HTTP Range video routes | `mooncut-pi-agent/src/community.ts`; `/v1/community/posts`; `CommunityStudio.vue` |
| Reuse the remote speaking-coach branch without its UI | Only audio/ASR/MediaPipe/gaze/cooldown logic and pinned local assets were integrated into the Vue product | `origin/speech-coach` at `8b04ddd`; `useSpeakingCoach.ts`; `public/mediapipe`; `public/models` |
| Smooth volume and accurate live metrics | Web Audio attack/release envelope, 12-second pace window, median smoothing, acoustic fallback, pause count | `mooncut-web/src/composables/useSpeakingCoach.ts` |
| Current spoken line at the top | ASR-driven script progress with previous/current/next line ribbon | `RecordStudio.vue` live script ribbon |
| Real-time ASR, pace and word count | Browser `SpeechRecognition` with acoustic fallback and explicit unsupported state | Desktop and 390×844 mobile browser checks |
| Guided script generation through the supplied endpoint | Server-side OpenAI-compatible proxy and structured role prompt | `assistant.ts`, `prompts.ts`, `POST /v1/assistant/script` |
| GLM-5.2 for script work | Active routing `script: glm-5.2` | `GET /v1/models`; live structured response check |
| DeepSeek v4 Flash for fast coaching | Active routing `coach: deepseek-v4-flash`, adaptive 14-second minimum cadence, local rules remain available | `POST /v1/assistant/coach`; live structured response check |
| Pet speaks and reacts during writing/coaching | Model-returned pet messages, local advice messages, running/jumping/waiting sprite states | `PetCompanion.vue`, `RecordStudio.vue`, `ClipStudio.vue` |
| Complete Web-to-Pi editing flow | Binary upload, persistent async job, Pi pipeline, Remotion render, artifact download | Real job `16573f532c2046d9accd667c7171acaa` completed with `quality.ok=true` |

## Verified gates

- Backend TypeScript check: passed.
- Backend tests: 27/27 passed.
- Web production build: passed.
- OpenAPI YAML: parsed with 16 paths.
- CORS: configured MoonCut origin accepted; untrusted origin returned 403.
- Secret scan: supplied gateway key is absent from tracked source files.
- Real output: H.264 1920×1080 video, AAC audio, 25.856 seconds.
- Browser: desktop and 390×844 mobile flows checked with zero fresh console errors or warnings.
- Automatic webhook transport: verified against a local mock provider, including sender, recipient, concise summary, stable artifact URL, bearer authorization boundary, and task metadata.

## Agent Mail safety boundary

Agent Mail CLI mandates a two-stage confirmation for every send. MoonCut automatically prepares the exact completion email when a job finishes and persists the pending confirmation in a mode-`0600` task-private file. The Web UI then displays the recipient and an explicit **Confirm send** action. The application does not auto-consume the confirmation token.

Consequently, the current Agent Mail transport supports "leave the editing page and return to a ready-to-send completion email", but not unattended delivery with no final confirmation. Fully unattended delivery requires a separately authorized transactional transport (for example an SMTP or mail-webhook provider) whose contract explicitly permits pre-authorized automated sends.

## Generated-visual safety boundary

Image generation is off unless an explicit OpenAI-compatible provider is configured. In `auto` mode the planner defaults to zero images, normally schedules one, and is hard-capped at two. Generated visuals are stored separately from evidence assets, can only be referenced by `illustration` beats, and are rendered with a permanent AI-example disclosure. The quality gate rejects missing IDs, unused images, budget overflow, evidence mixing, and disclosure failures.

MoonCut includes that automatic boundary as `MOONCUT_MAIL_TRANSPORT=webhook`. It stays disabled until a server URL, bearer token, sender address, and public Agent URL are supplied.
