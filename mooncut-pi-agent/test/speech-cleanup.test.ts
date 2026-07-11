import assert from "node:assert/strict";
import test from "node:test";
import {planSpeechCleanup, retimeSubtitlesAfterCleanup} from "../src/speech-cleanup.ts";
import type {SubtitleData} from "../src/types.ts";

const subtitles: SubtitleData = {
  duration_ms: 3_000,
  transcript: "你好，嗯，大家好。",
  segments: [{index: 1, text: "你好，嗯，大家好。", start_ms: 0, end_ms: 2_200}],
  words: [
    {text: "你好", start_ms: 0, end_ms: 300},
    {text: "嗯", start_ms: 900, end_ms: 1_100},
    {text: "大家好", start_ms: 1_900, end_ms: 2_200},
  ],
  provider: "fixture",
};

test("speech cleanup removes an isolated filler and excess timed dead air", () => {
  const plan = planSpeechCleanup({subtitles, durationMs: subtitles.duration_ms});

  assert.equal(plan.status, "applied");
  assert.ok(plan.removedDurationMs > 900);
  assert.ok(plan.cuts.some((cut) => cut.reasons.some((reason) => reason.startsWith("filler:"))));
  assert.ok(plan.keptRanges.length >= 2);

  const retimed = retimeSubtitlesAfterCleanup(subtitles, plan);
  assert.equal(retimed.duration_ms, plan.outputDurationMs);
  assert.ok(retimed.words?.every((word) => word.text !== "嗯"));
  assert.ok(retimed.transcript.includes("你好"));
  assert.ok(retimed.transcript.includes("大家好"));
  assert.ok(!retimed.transcript.includes("嗯"));
  assert.ok((retimed.words?.at(-1)?.end_ms ?? 0) <= plan.outputDurationMs);
});

test("speech cleanup skips safely without word-level timing", () => {
  const withoutWords: SubtitleData = {...subtitles, words: undefined};
  const plan = planSpeechCleanup({subtitles: withoutWords, durationMs: withoutWords.duration_ms});

  assert.equal(plan.status, "skipped");
  assert.equal(plan.reason, "word timestamps are required for safe speech cleanup");
  assert.equal(plan.removedDurationMs, 0);
});
