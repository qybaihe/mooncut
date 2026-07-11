# MoonCut Studio — Release Handbook

## Automated releases (GitHub Actions)

Workflow: [`.github/workflows/studio-release.yml`](../../.github/workflows/studio-release.yml)

### Tag release (recommended)

```bash
# after merging Studio changes to main
git tag studio-v0.1.0
git push origin studio-v0.1.0
```

Actions builds:

| Runner | Artifact |
|--------|----------|
| `macos-14` | macOS **arm64** `.dmg` + `.zip` |
| `windows-latest` | Windows **x64** NSIS `.exe` |
| `ubuntu-latest` | Linux **x64** `.AppImage` |

Then creates a GitHub Release and uploads all packages.

### Manual dispatch

GitHub → Actions → **Studio Release** → Run workflow  
- Optional tag name  
- Runtime profile: `minimal` (CI default) or `full`

### Runtime profiles

| Profile | Contents | When |
|---------|----------|------|
| `minimal` / `ci` | `mooncut-pi-agent` (+ `dist/cli.mjs`) + pinned ffmpeg/ffprobe | CI / nightly |
| `full` (default local) | + remotion-studio, face-tracker, hybrid-subtitle | Local full pack |

```bash
# local full package (large)
cd mooncut-studio && npm run pack:mac

# local CI-like package
MOONCUT_RUNTIME_PROFILE=minimal npm run pack:ci
```

## Continuous integration

Workflow: [`.github/workflows/studio-ci.yml`](../../.github/workflows/studio-ci.yml)

Runs package unit tests + desktop `node:test` on every PR/push touching `mooncut-studio/**` or `mooncut-pi-agent/**`.

## Pre-flight (local)

1. `cd mooncut-studio && npm test` green  
2. Manual GUI: onboarding → library → **创作口播** → 剪辑台  
3. Optional: Agent mode `real` with configured provider  
4. Dependency/license review (`docs/LICENSES.md`)

## Signing

### macOS

- Set electron-builder `mac.identity` to Developer ID Application  
- Notarize with `notarytool`  
- Staple ticket  

CI currently ships **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `identity=null`).

### Windows

- Authenticode cert + timestamp  
- Until configured, SmartScreen may warn  

## Publish checklist

- [ ] Version bump (`mooncut-studio/package.json` + desktop)  
- [ ] Changelog / release notes  
- [ ] `studio-v*` tag pushed (or workflow_dispatch)  
- [ ] GitHub Release assets verified downloadable  
- [ ] Privacy + license attachments  
- [ ] Auto-update feed (future)  
