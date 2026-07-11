import assert from "node:assert/strict";
import test from "node:test";
import {missingRequiredStages, MOONCUT_TOOL_NAMES, REQUIRED_TOOL_SEQUENCE} from "../src/tool-runner.ts";
import {fromPersisted, toPersisted} from "../src/context-store.ts";
import type {EditJobRecord, RunContext} from "../src/types.ts";

const sampleJob = (): EditJobRecord => ({
  id: "test-job",
  status: "running",
  stage: "preparing-source",
  progress: 0.1,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  inputPath: "/tmp/source.mp4",
  originalName: "source.mp4",
  request: {prompt: "test"},
});

test("tool catalog includes the full production sequence", () => {
  for (const name of REQUIRED_TOOL_SEQUENCE) {
    assert.equal(MOONCUT_TOOL_NAMES.includes(name), true, name);
  }
});

test("missingRequiredStages reports creative and render tails", () => {
  const context: RunContext = {
    job: sampleJob(),
    jobDir: "/tmp/job",
    publicMediaPath: "/tmp/public.mp4",
    publicMediaSrc: "public/agent-jobs/test/source.mp4",
    evidenceAssets: [],
    generatedVisuals: [],
    qualityReviews: [],
    capabilityInvocations: [],
  };
  assert.deepEqual(missingRequiredStages(context), [
    "inspect_source",
    "transcribe_source",
    "clean_speech_delivery",
    "schedule_generated_visuals",
    "track_speaker",
    "save_edit_spec",
    "render_edit",
    "verify_render",
  ]);
  context.probe = {durationMs: 1000, fps: 30, width: 720, height: 1280, hasAudio: true, formatName: "mp4"};
  context.subtitles = {duration_ms: 1000, transcript: "hi", segments: [], provider: "test"};
  context.speechCleanup = {
    schemaVersion: "mooncut.speech-cleanup.v1",
    status: "skipped",
    reason: "test",
    policy: {enabled: true, minSilenceMs: 750, retainedSilenceMs: 190, fillerPaddingMs: 80, wordGuardMs: 55},
    sourceDurationMs: 1000,
    outputDurationMs: 1000,
    removedDurationMs: 0,
    cuts: [],
    keptRanges: [],
  };
  context.imageSchedule = {
    mode: "none",
    reason: "test",
    maxImages: 2,
    requestedCount: 0,
    providerConfigured: false,
    plan: [],
    assets: [],
    errors: [],
  };
  context.faceTrack = null;
  assert.deepEqual(missingRequiredStages(context), ["save_edit_spec", "render_edit", "verify_render"]);
});

test("run context round-trips through persistence shape", () => {
  const context: RunContext = {
    job: sampleJob(),
    jobDir: "/tmp/job",
    publicMediaPath: "/tmp/public.mp4",
    publicMediaSrc: "public/agent-jobs/test/source.mp4",
    evidenceAssets: [],
    generatedVisuals: [],
    qualityReviews: [],
    capabilityInvocations: [],
    probe: {durationMs: 12, fps: 30, width: 1, height: 1, hasAudio: false, formatName: "mp4"},
  };
  const restored = fromPersisted(toPersisted(context));
  assert.equal(restored.job.id, "test-job");
  assert.equal(restored.probe?.durationMs, 12);
  assert.equal(restored.publicMediaSrc, context.publicMediaSrc);
});
