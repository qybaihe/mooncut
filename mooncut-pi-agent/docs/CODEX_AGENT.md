# Codex Production Agent

Codex mode preserves the existing MoonCut API and Cloudflare Tunnel:

```text
Browser → Cloudflare Pages → Tunnel → MoonCut API → JobManager
                                             └→ Codex exec (gpt-5.6-terra, xhigh)
                                                  └→ MoonCut tool CLI → verified artifacts
```

Only the creative planner/executor changes. Clients continue to submit `POST /v1/edits` or `POST /v1/edit-jobs` and poll the same job endpoints. The trusted host performs network-capable source preparation and final render/verification; Codex owns the semantic editing spec and optional ImageGen decisions.

## Enable

```bash
export MOONCUT_AGENT_EXECUTION_MODE=codex
export MOONCUT_CODEX_MODEL=gpt-5.6-terra
export MOONCUT_CODEX_REASONING_EFFORT=xhigh
# macOS only when the PATH `codex` is stale:
export MOONCUT_CODEX_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex

npm run serve
```

The runner launches:

```bash
codex exec --ephemeral --json --sandbox workspace-write \
  -m gpt-5.6-terra -c 'model_reasoning_effort="xhigh"' ...
```

It intentionally does **not** use `--dangerously-bypass-approvals-and-sandbox`.

## Isolation

Codex runs with its workspace set to MoonCut's writable data root and only receives one additional writable path for Remotion job media. It may read the tool implementation but is instructed to make all task mutations through the MoonCut tool CLI. Browser-provided prompts are treated as editorial input, not as authority to alter server configuration or inspect other jobs.

## ImageGen

When the request allows image generation and an illustration is genuinely needed, Codex uses its built-in ImageGen capability. The image must first be copied into the current job directory, then registered through:

```bash
node --experimental-strip-types src/cli.ts tool <jobDir> import_codex_generated_visual '{...}'
```

The import verifies the image signature and size, copies it to the durable job and public Remotion locations, records metadata, and returns a `generatedVisualId`. Generated imagery remains illustrative and cannot serve as factual evidence.

## Artifacts

In addition to normal video, edit spec, subtitles, render, contact sheet, and verification artifacts, Codex jobs expose:

| Artifact | Purpose |
|---|---|
| `CODEX_PROMPT.md` | Exact production prompt |
| `codex-launch.json` | Binary, model, effort, and sandbox snapshot |
| `codex-headless.log` | JSONL/stdout-stderr execution transcript |
| `codex-events.jsonl` | Copy of agent event stream |
| `codex-final-message.txt` | Final Codex response |

Host recovery can finish only deterministic stages. It never invents the creative `save_edit_spec`; a Codex run must produce that artifact before render can proceed.
