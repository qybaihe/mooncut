# Audio-visual cues

Use `src/audioVisualCues.ts` as the only catalog for short sound effects. A
generation spec should create an `audioVisualCues` list and render it with
`<AudioVisualCueTrack beats={spec.beats} cues={spec.audioVisualCues} />`.

```ts
{
  id: 'product-ui-click',
  preset: 'cursor-click',
  anchor: {type: 'beat', beatId: 'product-ui', offsetMs: 3333},
}
```

The anchor identifies the visual event. The preset supplies the asset, gain,
and any intentional lead time. For example, `scene-transition-tech` starts
its sound three frames before the next scene's visual anchor.

Rules:

- Use one semantic preset per visual event; never point a generated spec at a
  raw `public/sfx` filename.
- Keep narration in front. Do not layer short effects unless an edit is
  deliberately designed for it.
- Leave 1.5 seconds between micro-SFX. Use `validateAudioVisualCueSpacing()`
  when generating or reviewing a plan.
- Only set `durationMs` when the visual itself has a shorter lifetime, such as
  typing or a glitch. This prevents unused audio tails.

The source URLs and playback defaults live in `sfxLibrary`. The source files
are available under the Pixabay Content License for incorporation in finished
videos; do not redistribute them as a standalone SFX pack.
