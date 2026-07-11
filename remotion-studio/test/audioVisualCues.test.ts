import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  resolveAudioVisualCues,
  sfxLibrary,
  validateAudioVisualCueSpacing,
  type AudioVisualCue,
  type TimedBeat,
} from '../src/audioVisualCues.ts';

const beats: TimedBeat[] = [
  {id: 'intro', startMs: 0, endMs: 4000},
  {id: 'dashboard', startMs: 4000, endMs: 8000},
];

test('every catalog entry resolves to a project-owned SFX asset', () => {
  assert.equal(Object.keys(sfxLibrary).length, 13);
  for (const asset of Object.values(sfxLibrary)) {
    assert.ok(
      existsSync(path.join(process.cwd(), 'public', asset.src)),
      `Missing SFX asset: ${asset.src}`,
    );
  }
});

test('a tech transition starts three frames before its named visual anchor', () => {
  const cues: AudioVisualCue[] = [{
    id: 'dashboard-enter',
    preset: 'scene-transition-tech',
    anchor: {type: 'beat', beatId: 'dashboard'},
  }];
  const [cue] = resolveAudioVisualCues({beats, cues, fps: 30});
  assert.equal(cue.anchorMs, 4000);
  assert.equal(cue.playbackStartMs, 3900);
  assert.equal(cue.asset.src, 'sfx/transition-whoosh-tech.mp3');
  assert.equal(cue.gainDb, -8);
});

test('a caller can shorten typing to the visible text animation', () => {
  const cues: AudioVisualCue[] = [{
    id: 'terminal-type',
    preset: 'text-typing',
    anchor: {type: 'absolute', atMs: 1200},
    durationMs: 1800,
  }];
  const [cue] = resolveAudioVisualCues({beats, cues, fps: 30});
  assert.equal(cue.playbackStartMs, 1200);
  assert.equal(cue.durationMs, 1800);
});

test('the library reports overly dense SFX instead of silently layering them', () => {
  const cues: AudioVisualCue[] = [
    {id: 'first', preset: 'card-land', anchor: {type: 'absolute', atMs: 1000}},
    {id: 'second', preset: 'cursor-click', anchor: {type: 'absolute', atMs: 1800}},
  ];
  const resolved = resolveAudioVisualCues({beats, cues, fps: 30});
  assert.deepEqual(validateAudioVisualCueSpacing({cues: resolved}), [
    'first and second are only 800ms apart (minimum 1500ms).',
  ]);
});
