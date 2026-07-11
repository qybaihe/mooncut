# MoonCut Studio — Dependency Matrix

| Dependency | Role | macOS | Windows | Approx size | License | Bundle strategy |
|------------|------|-------|---------|-------------|---------|-----------------|
| Electron + Chromium | App shell | arm64 + x64 | x64 | ~150–250 MB | Electron (MIT) + Chromium | Ship with installer |
| Node runtime | Embedded in Electron | yes | yes | (included) | MIT | Embedded |
| mooncut-pi-agent | Edit agent | yes (Node ≥22) | yes | ~tens of MB + node_modules | UNLICENSED | Dev: monorepo path; Prod: extraResources + version lock |
| @earendil-works/pi-* | Agent runtime | yes | yes | moderate | per package | With agent |
| FFmpeg / ffprobe | Probe, extract, transcode | brew/path or static | static build | 50–100 MB | LGPL/GPL | Prefer system detect; optional managed static binary with SHA-256 |
| remotion-studio | Compose + render | yes | yes | large (node_modules + browser) | Remotion License | Dev monorepo; prod first-run or heavy bundle |
| @remotion/renderer Chromium | Headless render | yes | yes | ~150 MB+ | BSD-style / Chromium | Remotion browser download; show size |
| face-tracker (Python + YOLO) | Speaker track | mps/cpu | cpu | ~50–200 MB weights | Project + Ultralytics terms | Optional; first-run; degraded without venv |
| hybrid-subtitle-service | Hybrid ASR | Python 3.12 | Python 3.12 | moderate + models | Project | Optional service; Agent can use local whisper script |
| Faster Whisper models | Local ASR | yes | yes | small≈500MB+ | MIT (model-dependent) | User download; show size/path |
| MediaPipe (web teleprompter) | Optional coach | browser WASM | browser WASM | moderate | Apache-2.0 | Optional if porting web coach |
| SQLite (node:sqlite / JSON index) | Project index | yes | yes | small | Public domain / MIT | JSON index baseline; sqlite optional |

## Runtime requirements (minimum offline)

| Capability | Required deps | If missing |
|------------|---------------|------------|
| Open app, onboarding, project library | Electron | N/A |
| Create project / import file | FS permissions | Show dialog error |
| Media probe (duration/size) | ffprobe | Import still succeeds; probe error shown |
| Mock edit job e2e | Agent Host mock | Always available offline |
| Real edit job | pi-agent + FFmpeg + Remotion (+ models/providers as configured) | Honest failure / degraded badges |
| Face track | face-tracker venv + weights | Stage error; job may fail visibly |
| Hybrid subtitles | service + keys or whisper | Fail or fallback per agent config |

## Integrity policy

- No `curl | sh`  
- Optional downloads: HTTPS + SHA-256 manifest + user cancel/retry  
- Never silently install system-wide packages or edit shell profiles  

## Platform notes

- **macOS**: hardened runtime entitlements prepared; signing/notarization external  
- **Windows**: NSIS target; SmartScreen reputation requires signing  
- **Apple Silicon vs Intel**: electron-builder arch list `arm64` + `x64`  
