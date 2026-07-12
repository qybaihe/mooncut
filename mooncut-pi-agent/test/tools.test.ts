import assert from "node:assert/strict";
import test from "node:test";
import {alignImpactBeatsToWords, normalizeBeats} from "../src/tools.ts";

test("normalizes beats into one contiguous full-duration timeline", () => {
  const beats = normalizeBeats([
    {startMs: 100, endMs: 1200, kind: "speaker", headline: "开场", body: "", keywords: []},
    {startMs: 1500, endMs: 3200, kind: "desktop", headline: "重点", body: "", keywords: []},
    {startMs: 3800, endMs: 4800, kind: "quote", headline: "收尾", body: "", keywords: []},
  ], 5000);

  assert.equal(beats[0].startMs, 0);
  assert.equal(beats.at(-1)?.endMs, 5000);
  for (let index = 1; index < beats.length; index += 1) {
    assert.equal(beats[index].startMs, beats[index - 1].endMs);
    assert.ok(beats[index].endMs > beats[index].startMs);
  }
  assert.deepEqual(beats.map((beat) => beat.speakerLayout), ["native", "circle", "circle"]);
});

test("limits impact beats according to the production cadence", () => {
  const beats = normalizeBeats(Array.from({length: 6}, (_, index) => ({
    startMs: index * 4000,
    endMs: (index + 1) * 4000,
    kind: "impact" as const,
    headline: `重点 ${index}`,
    body: "",
    keywords: [],
    impactText: `重点 ${index}`,
  })), 24_000);

  assert.equal(beats.filter((beat) => beat.kind === "impact").length, 3);
  assert.equal(beats.filter((beat) => beat.kind === "desktop").length, 3);
});

test("anchors an impact pulse to the matching spoken keyword", () => {
  const beats = alignImpactBeatsToWords([{
    startMs: 19_000,
    endMs: 20_665,
    kind: "impact",
    headline: "前端页面太震撼",
    body: "",
    keywords: ["震撼", "前端"],
    impactText: "前端页面太震撼",
    speakerLayout: "native",
  }], [
    {text: "真是太", start_ms: 18_585, end_ms: 19_145},
    {text: "震撼", start_ms: 19_145, end_ms: 19_545},
    {text: "了", start_ms: 19_545, end_ms: 19_705},
  ]);
  assert.equal(beats[0].impactAtMs, 19_145);
});

test("preserves rich desktop and multi-evidence orchestration fields", () => {
  const beats = normalizeBeats([
    {
      startMs: 0,
      endMs: 5000,
      kind: "desktop",
      headline: "丰富页面",
      body: "使用流程模板",
      keywords: ["理解", "编排"],
      desktopTemplate: "workflow",
      visualItems: [{title: "理解", detail: "读取上下文"}, {title: "编排", detail: "选择视觉"}],
    },
    {
      startMs: 5000,
      endMs: 10_000,
      kind: "evidence",
      headline: "并行证据",
      body: "互补来源",
      keywords: [],
      evidenceMode: "parallel",
      evidencePanels: [
        {evidenceId: "one", role: "primary", purpose: "确认能力", scrollStartPct: 0, scrollEndPct: 28},
        {evidenceId: "two", role: "supporting", purpose: "补充价格", scrollStartPct: 8, scrollEndPct: 44},
      ],
    },
  ], 10_000);
  assert.equal(beats[0].desktopTemplate, "workflow");
  assert.equal(beats[0].visualItems?.length, 2);
  assert.equal(beats[1].evidenceMode, "parallel");
  assert.equal(beats[1].evidencePanels?.length, 2);
  assert.equal(beats[1].speakerLayout, "circle");
});
