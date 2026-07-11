import assert from 'node:assert/strict';
import test from 'node:test';
import {narrationDuckAmount} from '../src/audioDucking.ts';

const ranges = [{start_ms: 1_000, end_ms: 2_000}];

test('ducks fully during a timed narration segment', () => {
  assert.equal(narrationDuckAmount({timeMs: 1_500, ranges}), 1);
});

test('uses a smooth attack and release around a narration segment', () => {
  assert.equal(narrationDuckAmount({timeMs: 950, ranges, attackMs: 100}), 0.5);
  assert.equal(narrationDuckAmount({timeMs: 2_175, ranges, releaseMs: 350}), 0.5);
});

test('does not duck outside the narration envelope', () => {
  assert.equal(narrationDuckAmount({timeMs: 500, ranges}), 0);
  assert.equal(narrationDuckAmount({timeMs: 2_500, ranges}), 0);
});
