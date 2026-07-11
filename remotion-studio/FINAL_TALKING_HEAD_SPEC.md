# Final talking-head spec v2

`mooncut.final-talking-head.v2` is the only schema for newly generated final
talking-head videos. It replaces the older split between a timeline, an agent
edit spec, and the Perfect demo spec.

The v2 file owns seven things together:

1. source-media duration, aspect ratio, MIME type, and measured input audio;
2. transcript metadata and timed subtitles;
3. contiguous semantic beats and approved scene visuals;
4. source provenance for every non-source visual asset;
5. native-plus-circle camera policy;
6. narration, catalog or imported AI-generated BGM, audio-visual cues, and mastering targets;
7. delivery codec/bitrate plus preflight QA thresholds.

## Required authoring rules

- Beats start at 0, are contiguous, meet the minimum duration, and cover the
  source duration within one frame.
- Subtitle ranges cannot overlap, cannot run beyond the render, and must stay
  below the configured character and reading-speed limits.
- Catalog BGM must point to the local catalog. Set `allowDemoOnly: false` for
  a normal production render so demo tracks cannot be selected accidentally.
- Generated BGM is never read from a remote URL at render time. Import a
  completed service job into `public/audio/bgm/generated/` first, then use
  `kind: "generated"` plus its local SHA-256 and plan provenance in the spec.
  Do not put `YUNWU_API_KEY`, `SERVICE_API_KEY`, download tokens, or provider
  URLs in a final-video JSON file.
- The renderer applies the spec's `duckDb` against timed subtitle ranges with
  a short attack/release envelope, so narration has priority over either kind
  of BGM.
- Add SFX only as semantic `audio.cues`; raw filenames and raw millisecond SFX
  lists are not valid v2 authoring.
- `source.durationMs` is checked against the real media with `ffprobe` before
  rendering. Assets, BGM, and cue audio must all exist below `public/`.

## Preflight

```bash
npm run verify:final-spec
node scripts/validate-final-talking-head-spec.ts path/to/spec.json
```

`assertFinalTalkingHeadSpec()` is the runtime guard for a Composition. The CLI
adds filesystem and real source-duration checks before Remotion begins an
expensive render.

After a render, verify the actual programme loudness and true peak against the
same spec:

```bash
node scripts/verify-rendered-final-audio.mjs out/final.mp4 path/to/spec.json
```

The v2 reference is [src/data/763e8d-perfect-edit-spec.json](src/data/763e8d-perfect-edit-spec.json).

## Generated BGM import

The music service stays server-side in `services/ai-voiceover-bgm/`. Its
`YUNWU_API_KEY` and `SERVICE_API_KEY` belong only in that service's ignored
`.env`. The local importer needs the service URL and its separate service key,
also from an ignored `remotion-studio/.env`:

```bash
cp .env.example .env
# Set BGM_SERVICE_URL and BGM_SERVICE_API_KEY in the ignored .env.
npm run bgm:import-generated -- SUCCEEDED_JOB_ID
```

The command downloads the protected job artifact with the bearer token, saves
only the MP3 under `public/audio/bgm/generated/`, and prints the exact
`audio.bgm` object to paste into a final spec. That output deliberately omits
the service key, provider URL, and one-time download token. Generated MP3s are
ignored by Git; persist them through the render/deployment asset store instead.
