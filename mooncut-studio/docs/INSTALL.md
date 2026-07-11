# MoonCut Studio — Install & Run

## Requirements

- Node.js ≥ 22.19  
- macOS 12+ (Apple Silicon or Intel) or Windows 10/11 x64  
- Optional: FFmpeg on PATH for media probe and real edits  

## Development (monorepo)

```bash
cd mooncut-studio
npm install
npm run build
npm test
npm run verify
npm run dev
```

`npm run dev` starts Vite (renderer on `127.0.0.1:5178`) and Electron with `MOONCUT_STUDIO_DEV=1`.

## Headless verification (no GUI)

```bash
cd mooncut-studio
npm run verify
```

Writes `docs/VERIFICATION_REPORT.md`.

## Packaging (self-contained runtime)

The installer embeds a full local toolchain so end users do **not** need monorepo checkout, system FFmpeg, or manual Agent setup:

```bash
# Builds apps/desktop/resources/mooncut-runtime/ then packages the app
# Includes: mooncut-pi-agent, remotion-studio, face-tracker (+venv), hybrid-subtitle (+venv), ffmpeg/ffprobe
npm run pack:mac   # macOS
npm run pack:win   # Windows (on Windows)
```

Only prepare the runtime tree (without packaging):

```bash
npm run prepare:runtime
```

Outputs under `apps/desktop/release/`. First launch materializes a writable workspace under Electron `userData` (symlinks to the read-only app bundle + real `remotion-studio/public/agent-jobs`).

**Signing:** configs set `identity: null` / `signAndEditExecutable: false`. Do **not** claim signed/notarized builds without certificates.

**Install size:** full runtime is multi‑GB (Remotion + Python venvs). Ship “完整版” installers; a future slim SKU can omit optional venvs.

## First launch

1. Choose workspace directory  
2. Review dependency probe  
3. Prefer local-only (default) or allow remote providers later  
4. Create sample project or empty project  
5. Import video → create mock job → observe real stages/artifacts  

## Uninstall & data retention

- **App uninstall** does not delete user projects under your workspace.  
- App preferences live in Electron `userData` (macOS `~/Library/Application Support/MoonCut Studio`, Windows `%APPDATA%/MoonCut Studio`).  
- Delete projects from Project Library (optional disk delete) or remove folders manually.  

## Privacy (summary)

- No MoonCut login  
- No cloud sync  
- Keys only in OS secure storage  
- Remote calls only after user enables network providers and configures endpoints  
