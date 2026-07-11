# MoonCut Studio — Verification Report

Generated: 2026-07-11T07:16:37.195Z
Platform: darwin arm64
Node: v26.4.0

## Automated evidence

- workspace packages build
- workspace packages typecheck
- workspace unit tests
- offline create project + import video + index
- project files contain no API key material
- secret redaction helper
- dependency probe (canRunRealAgent=true)
- agent host loopback only host=127.0.0.1 port=50196
- mock agent e2e create → progress → artifacts
- mock agent cancel
- openai-compatible provider test contract (local) + redacted errors
- IPC contract exported
- electron-builder mac/win config present

## Acceptance mapping

| # | Criterion | Result |
|---|-----------|--------|
| 1 | typecheck / unit / build | PASS (packages) |
| 2 | offline open/create/import | PASS (headless) |
| 3 | onboarding without login | PASS (wizard code path; GUI manual) |
| 4 | API keys not in project/logs | PASS (project scan + redaction) |
| 5 | Agent loopback + random token | PASS |
| 6 | mock agent e2e | PASS |
| 7 | remote provider contract + recoverable fail | PASS (local OpenAI-compatible mock) |
| 8 | macOS/Windows pack config | PASS (config); build artifacts platform-dependent |
| 9 | real agent + real video | MANUAL / blocked without provider+deps |
| 10 | recoverable errors | PASS (ffprobe/import/cancel messaging in app) |

## Known limits

- Electron GUI launch not required for this headless report.
- Code signing / notarization not performed (no certificates in repo).
- Real Agent path requires FFmpeg, Remotion, and optional Python components.
