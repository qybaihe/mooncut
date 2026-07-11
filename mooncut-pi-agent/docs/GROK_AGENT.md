# Grok Editing Agent

Grok Build headless replaces the Pi coding-agent planner while keeping the same MoonCut tools, job queue, and HTTP API.

## Why this shape

The successful end-to-end experiment showed Grok can multimodal-inspect frames, capture real web evidence, write a semantic edit spec, and drive Remotion. Production packaging needs three more things:

1. **Stable tools** — same `createMooncutTools` as reliable/Pi (via CLI)
2. **Host completion gate** — missing deterministic tails can be recovered
3. **API switch** — one env var, no new endpoint required for v1

Later, the same runner can be exposed as a dedicated route or worker type; the API surface of “upload → job → artifacts” stays unchanged.

## Architecture

```
API / npm run edit
        │
        ▼
   JobManager.run
        │
        ▼
 runEditingAgent ── mode=grok ──► runGrokEditingAgent
        │                              │
        │                              ├─ write GROK_PROMPT.md
        │                              ├─ spawn: grok -m grok-4.5 --reasoning-effort max ...
        │                              │         (agent calls: cli.ts tool <jobDir> …)
        │                              ├─ hydrate run-context + artifacts
        │                              └─ recover render/verify if needed
        ▼
  artifacts (final.mp4, edit-spec, verification, …)
```

## Tool CLI

```bash
cd mooncut-pi-agent
node --experimental-strip-types src/cli.ts tool <jobDir> inspect_source
node --experimental-strip-types src/cli.ts tool <jobDir> save_edit_spec '{"title":"…","summary":"…","accent":"#65d9b6","beats":[…]}'
```

State is stored in `<jobDir>/run-context.json` so Grok’s subprocess tool calls share one RunContext with the host.

## Enable

```bash
export MOONCUT_AGENT_EXECUTION_MODE=grok
export MOONCUT_GROK_MODEL=grok-4.5
export MOONCUT_GROK_REASONING_EFFORT=max
# optional: MOONCUT_GROK_BINARY=/Users/…/.grok/bin/grok

npm run serve
# or one-shot:
npm run edit:grok -- /path/to/video.mp4 "严格遵循 SPEC 完整剪辑"
```

API clients do not change: still `POST /v1/edits` and poll `GET /v1/edit-jobs/:id`.

## Artifacts unique to Grok mode

| File | Purpose |
|---|---|
| `GROK_PROMPT.md` | Exact prompt given to headless Grok |
| `grok-headless.log` | streaming-json transcript |
| `grok-events.jsonl` | exit / error events |
| `grok-launch.json` | model/effort snapshot |
| `run-context.json` | persisted tool state |

## Quality bar vs Pi

| Concern | Approach |
|---|---|
| Same render engine | Shared `render_edit` / Remotion composition |
| Same speech/face/research | Shared tools |
| Planner freestyle risk | Prompt + tool CLI + host recovery |
| Visual QA | Prefer `verify_render` (gateway gates); Grok may also self-inspect frames |
| Vertical phone publish | Still product composition constraint (16:9 Sonoma canvas); not planner-specific |

## Suggested next upgrades

1. Independent second-pass QA (separate Grok session or existing vision gate only)
2. Force `clean_speech_delivery` even when Grok skips (host pre-flight)
3. Structured `save_edit_spec` JSON schema validation before render
4. Optional hybrid: host always runs prep tools, Grok only plans beats
