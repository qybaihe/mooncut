# MoonCut Studio — Architecture

## Product model

MoonCut Studio is a **local-first, single-user desktop workstation** for the talking-head pipeline:

**Idea / script → teleprompter record or import → AI edit → captions / pacing / picture → QA → export**

- No MoonCut account, login, cloud identity, or community publish.
- Projects, media, jobs, logs, and artifacts stay on the user machine by default.
- Local capabilities first; remote OpenAI-compatible providers are optional and user-configured.
- The app is free; third-party model/API costs are **never** presented as free.

## Repository layout

```
mooncut-studio/
  apps/desktop/           Electron main / preload / Vue renderer
  packages/shared/        Domain types + IPC channel contracts
  packages/project-format/ Portable project files + local project index
  packages/bootstrapper/  Dependency probe (FFmpeg, Pi Agent, Remotion, …)
  packages/agent-host/    Mock agent + real pi-agent supervisor + HTTP client
  docs/                   Architecture, risks, licenses, install, verification
  scripts/                dev / build / verify
```

Sibling monorepo modules (unchanged web/server modes):

| Module | Studio role |
|--------|-------------|
| `mooncut-web/` | Visual language, script/teleprompter/clip UX reference; **not** iframe-embedded |
| `mooncut-pi-agent/` | Real edit agent; Studio launches **studio mode** subprocess |
| `remotion-studio/` | Remotion compositions / render |
| `hybrid-subtitle-service/` | Optional hybrid ASR service |
| `face-tracker/` | Optional face track binary/Python |

## Data flow

```
┌────────────────────┐
│  Vue Renderer      │  No Node, no secrets, no raw agent token
│  (project library, │
│   workbench,       │
│   settings)        │
└─────────┬──────────┘
          │ window.mooncut.*  (preload whitelist)
          ▼
┌────────────────────┐
│  Preload           │  contextBridge + ipcRenderer.invoke only
└─────────┬──────────┘
          │ IPC (schema-validated handlers)
          ▼
┌────────────────────┐
│  Main Process      │  windows, dialogs, project FS, secure storage,
│                    │  bootstrapper, agent lifecycle, menus
└─────────┬──────────┘
          │ HTTP  http://127.0.0.1:<random>/  Bearer <random token>
          ▼
┌────────────────────┐
│  Agent Host        │  mock server OR mooncut-pi-agent (MOONCUT_STUDIO_MODE)
│  (child / in-proc) │  tools: inspect / transcribe / face / plan / render / QA
└─────────┬──────────┘
          │
          ├─► Project directory (media/, jobs/, exports/)
          └─► Optional user Provider (local or remote OpenAI-compatible)
```

## Security baseline

| Control | Implementation |
|---------|----------------|
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `sandbox` | `true` |
| CSP | Strict; dev allows Vite on 127.0.0.1:5178 only |
| Navigation | Blocked except app origin |
| External links | `shell.openExternal` after http(s) check |
| Agent bind | Always `127.0.0.1`, never `0.0.0.0` |
| Agent auth | Per-launch random bearer token |
| API keys | Electron `safeStorage` (Keychain / DPAPI); never project files / logs |
| Path safety | Project-root containment; reject `..` traversal |
| Prompt/model output | Cannot mutate provider endpoints or FS allow-list |

## Studio mode on pi-agent

Environment injected by Main (ephemeral, not committed `.env`):

- `MOONCUT_STUDIO_MODE=true` → force loopback host, default port `0`, allow local `inputPath`
- `MOONCUT_API_KEYS=<random>` → service principal (no cookie login)
- `MOONCUT_GATEWAY_*` / model names from selected Provider Profile
- `MOONCUT_PROBE_GATEWAY_ON_HEALTH=false` offline by default
- `POST /v1/edit-jobs/:id/cancel` → cooperative cancel; source media retained

Web multi-user auth, community, and mail remain available when **not** in studio mode.

## Project format

Portable folder:

```
MyProject/
  mooncut.project.json   # schema mooncut.studio.project.v1
  media/
  recordings/
  jobs/
  exports/
  logs/
  README.txt
```

App index (userData): `project-index.json`, `settings.json`, `providers.json`, `secrets.enc.json`.

## Reuse map (web → desktop)

| Web capability | Desktop approach |
|----------------|------------------|
| Dark design tokens / logo | Ported CSS tokens + brand asset |
| Project/edit mental model | Project library + workbench |
| ClipStudio task stages | Workbench polls real agent stages |
| RecordStudio teleprompter | Script panel + getUserMedia permissions (user-triggered) |
| Auth / Landing / Community | **Removed** from Studio shell |
| `services/api.ts` cookie auth | Replaced by IPC → Agent Host client |

## Packaging

- **electron-builder** configs for macOS (arm64/x64 dmg+zip) and Windows (x64 NSIS)
- Signing/notarization: **external blocker** without certificates (`identity: null`, `signAndEditExecutable: false`)
- Large optional deps: probe first; ship or first-run download with SHA-256 (no `curl | sh`)
