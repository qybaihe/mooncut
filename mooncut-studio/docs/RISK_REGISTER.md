# MoonCut Studio — Risk Register

| ID | Risk | Impact | Likelihood | Mitigation | Status |
|----|------|--------|------------|------------|--------|
| R1 | Real render needs Remotion + Chromium + FFmpeg; large footprint | High | High | Bootstrapper honesty; mock path for UI/e2e; optional download with SHA-256 | Open |
| R2 | Native Node modules / Electron ABI mismatch | High | Medium | Prefer pure JS + subprocess tools; electron-rebuild when native deps added | Mitigated in baseline |
| R3 | Code signing / notarization certs missing | High (distribution) | High | Document as external blocker; unsigned builds for internal QA only | Blocked externally |
| R4 | Windows path / Python face-tracker packaging | Medium | Medium | Path helpers; face-tracker optional/degraded | Open |
| R5 | Remote provider cost confusion | Medium | Medium | Explicit UI copy: app free, provider bills user | Mitigated |
| R6 | Secret leakage via logs / diagnostics / crash | High | Medium | `redactSecrets`; diagnostics exclude media & keys; safeStorage | Mitigated |
| R7 | Agent process leak / zombie renders | Medium | Medium | Supervisor stop/SIGTERM/SIGKILL; cancel API; job ownerPid recovery | Partial |
| R8 | Port conflicts / multi-instance | Low | Medium | Random port 0; per-user runtime root | Mitigated |
| R9 | Breaking web agent auth while adding studio mode | High | Medium | Additive `MOONCUT_STUDIO_MODE`; web tests retained | Mitigated |
| R10 | Fake progress / fake local AI claims | High (trust) | Low if disciplined | Mock labeled as mock; real path fails visibly | Mitigated |
| R11 | License non-compliance (Remotion, YOLO, FFmpeg) | High | Medium | DEPENDENCY_MATRIX + LICENSES.md | Open review |
| R12 | Auto-update supply chain | Medium | Low | Update check stub only until signed feed exists | Deferred |
| R13 | Camera/mic permission UX on macOS/Windows | Medium | Medium | User-gesture + system settings recovery copy | Partial |
| R14 | Subtitle service requires remote MiMo keys | Medium | High | Optional; local Whisper degraded path documented | Open |
| R15 | Cooperative cancel may not kill deep grandchild immediately | Medium | Medium | Process tree kill on future hard-cancel; retain intermediates | Open |

## External blockers (release)

1. Apple Developer ID + notarization credentials  
2. Windows code-signing certificate  
3. Legal review of Remotion commercial license for distribution  
4. Optional: hosted, version-locked dependency CDN with SHA-256 manifests  

## Residual acceptance gaps

- Full real-agent job on fixture video requires provider credentials + complete local toolchain (tracked in VERIFICATION_REPORT).  
- GUI onboarding is implemented; automated Electron UI tests not yet in CI.
