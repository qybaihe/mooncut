import assert from "node:assert/strict";
import test from "node:test";
import {buildQaSampleTimes, validateSpecQuality} from "../src/quality.ts";
import type {AgentEditSpec, EditBeat} from "../src/types.ts";

const spec = (overrides: Partial<AgentEditSpec> = {}): AgentEditSpec => ({
  schemaVersion: "mooncut.edit.v1",
  title: "Test",
  summary: "Test",
  accent: "#65d9b6",
  fps: 30,
  durationInFrames: 300,
  width: 1920,
  height: 1080,
  source: {src: "source.mp4", aspectRatio: 16 / 9},
  transcript: "",
  subtitles: [],
  beats: [{startMs: 0, endMs: 10_000, kind: "speaker", headline: "Test", body: "", keywords: []}],
  evidenceAssets: [],
  generationPreset: "macos-sonoma-native",
  ...overrides,
});

test("samples impact QA in the latter half where the phrase must land", () => {
  const beat: EditBeat = {
    startMs: 1000,
    endMs: 5000,
    kind: "impact",
    headline: "太震撼了",
    body: "",
    keywords: [],
    impactText: "太震撼了",
  };
  assert.deepEqual(buildQaSampleTimes(beat), [3080, 3560, 4120]);
});

test("samples impact QA around the spoken-word pulse anchor", () => {
  const beat: EditBeat = {
    startMs: 19_000,
    endMs: 20_665,
    kind: "impact",
    headline: "前端页面太震撼",
    body: "",
    keywords: ["震撼"],
    impactText: "前端页面太震撼",
    impactAtMs: 19_145,
  };
  assert.deepEqual(buildQaSampleTimes(beat), [19_000, 19_145, 19_505]);
});

test("rejects a requested real-evidence edit with no evidence assets", () => {
  const findings = validateSpecQuality(spec(), "请使用真实官网和 X 原帖证据");
  assert.ok(findings.some((finding) => finding.id === "requested-evidence-absent" && finding.severity === "error"));
  assert.ok(findings.some((finding) => finding.id === "requested-web-evidence-absent" && finding.severity === "error"));
  assert.ok(findings.some((finding) => finding.id === "requested-x-evidence-absent" && finding.severity === "error"));
});

test("requires every captured evidence asset to be used by an evidence beat", () => {
  const asset = {
    id: "official-page",
    kind: "webpage" as const,
    label: "Official page",
    url: "https://example.com",
    src: "evidence.png",
    localPath: "/tmp/evidence.png",
    evidencePath: "/tmp/evidence.json",
  };
  const unused = validateSpecQuality(spec({evidenceAssets: [asset]}));
  assert.ok(unused.some((finding) => finding.id === "captured-evidence-unused"));

  const used = validateSpecQuality(spec({
    evidenceAssets: [asset],
    beats: [{
      startMs: 0,
      endMs: 10_000,
      kind: "evidence",
      headline: "Official page",
      body: "",
      keywords: [],
      evidenceId: asset.id,
    }],
  }), "使用真实官网证据");
  assert.equal(used.filter((finding) => finding.severity === "error").length, 0);
});

test("rejects face tracking on a main speaker shot", () => {
  const findings = validateSpecQuality(spec({
    beats: [{
      startMs: 0,
      endMs: 10_000,
      kind: "speaker",
      headline: "Main camera",
      body: "",
      keywords: [],
      speakerLayout: "circle",
    }],
  }));
  assert.ok(findings.some((finding) => finding.id === "speaker-layout-policy-violation"));
});

test("rejects a short circle island between native camera runs", () => {
  const findings = validateSpecQuality(spec({
    beats: [
      {startMs: 0, endMs: 4000, kind: "speaker", headline: "A", body: "", keywords: []},
      {startMs: 4000, endMs: 5000, kind: "desktop", headline: "B", body: "", keywords: []},
      {startMs: 5000, endMs: 10_000, kind: "speaker", headline: "C", body: "", keywords: []},
    ],
  }));
  assert.ok(findings.some((finding) => finding.id === "speaker-layout-run-too-short"));
});
