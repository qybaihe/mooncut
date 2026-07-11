import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  assertFinalTalkingHeadSpec,
  validateFinalTalkingHeadSpec,
  type FinalTalkingHeadSpec,
} from '../src/finalTalkingHeadSpec.ts';

const sample = JSON.parse(readFileSync('src/data/763e8d-perfect-edit-spec.json', 'utf8')) as FinalTalkingHeadSpec;

test('the v2 reference spec passes complete preflight validation', () => {
  assert.deepEqual(validateFinalTalkingHeadSpec(sample), []);
  assert.equal(assertFinalTalkingHeadSpec(sample).schemaVersion, 'mooncut.final-talking-head.v2');
});

test('preflight rejects a gap in a required contiguous beat timeline', () => {
  const invalid = structuredClone(sample);
  invalid.beats[1].startMs += 100;
  assert.ok(validateFinalTalkingHeadSpec(invalid).some((issue) => issue.path === 'beats[1]'));
});

test('preflight rejects demo-only music when the output forbids it', () => {
  const invalid = structuredClone(sample);
  invalid.audio.bgm = {
    ...invalid.audio.bgm!,
    trackId: 'demo-tech-house-vibes',
    src: 'audio/bgm/demo-tracks/tech-house-vibes.mp3',
    allowDemoOnly: false,
  };
  assert.ok(validateFinalTalkingHeadSpec(invalid).some((issue) => issue.path === 'audio.bgm'));
});

test('preflight accepts a locally imported generated BGM with provenance', () => {
  const generated = structuredClone(sample);
  generated.audio.bgm = {
    kind: 'generated',
    src: 'audio/bgm/generated/28c55360-5c85-4b3e-a8d4-f04d1691ee23.mp3',
    title: 'AI 产品讲解配乐',
    gainDb: -22,
    duckDb: -6,
    fadeInMs: 900,
    fadeOutMs: 1400,
    crossfadeLoopMs: 900,
    generated: {
      provider: 'yunwu-suno',
      jobId: '28c55360-5c85-4b3e-a8d4-f04d1691ee23',
      plan: {mood: 'confident, forward-looking', tags: 'modern technology, instrumental', bpm: 108, source: 'ai'},
      assetSha256: 'a'.repeat(64),
      importedAt: '2026-07-11T10:00:00.000Z',
      usageRights: 'provider-terms-pending',
    },
  };
  assert.deepEqual(validateFinalTalkingHeadSpec(generated), []);
});

test('preflight rejects generated BGM that bypasses the local asset import', () => {
  const invalid = structuredClone(sample);
  invalid.audio.bgm = {
    kind: 'generated',
    src: 'https://cdn.example.com/generated.mp3',
    title: 'Remote music must not render directly',
    gainDb: -22,
    duckDb: -6,
    fadeInMs: 900,
    fadeOutMs: 1400,
    crossfadeLoopMs: 900,
    generated: {
      provider: 'yunwu-suno',
      jobId: '28c55360-5c85-4b3e-a8d4-f04d1691ee23',
      plan: {mood: 'confident', tags: 'instrumental', bpm: 108, source: 'rules'},
      assetSha256: 'a'.repeat(64),
      importedAt: '2026-07-11T10:00:00.000Z',
      usageRights: 'provider-terms-pending',
    },
  };
  assert.ok(validateFinalTalkingHeadSpec(invalid).some((issue) => issue.path === 'audio.bgm.src'));
});

test('preflight rejects an audio cue that points to an unknown beat', () => {
  const invalid = structuredClone(sample);
  invalid.audio.cues[0] = {
    ...invalid.audio.cues[0],
    anchor: {type: 'beat', beatId: 'missing-beat'},
  };
  assert.ok(validateFinalTalkingHeadSpec(invalid).some((issue) => issue.path === 'audio.cues'));
});
