import assert from "node:assert/strict";
import test from "node:test";
import {hasDisqualifyingVisualContradiction, hasPositiveImpactConfirmation} from "../src/gateway.ts";
import {buildQaSampleTimes, isVisionGateProtocolOnlyFailure, validateSpecQuality} from "../src/quality.ts";
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

test("does not treat an evidence prohibition as an evidence request", () => {
  const findings = validateSpecQuality(spec(), "不要使用生成图片或外部证据，完成自然口播剪辑");
  assert.equal(findings.some((finding) => finding.id.startsWith("requested-")), false);
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

test("accepts distinct parallel evidence panels with independent scroll ranges", () => {
  const assets = [
    {id: "product", kind: "webpage" as const, label: "Product", url: "https://example.com/product", src: "product.png", localPath: "/tmp/product.png", evidencePath: "/tmp/product.json"},
    {id: "pricing", kind: "webpage" as const, label: "Pricing", url: "https://example.com/pricing", src: "pricing.png", localPath: "/tmp/pricing.png", evidencePath: "/tmp/pricing.json"},
  ];
  const findings = validateSpecQuality(spec({
    evidenceAssets: assets,
    beats: [{
      startMs: 0,
      endMs: 10_000,
      kind: "evidence",
      headline: "能力与价格",
      body: "两份来源各自补充信息",
      keywords: [],
      evidenceMode: "parallel",
      evidencePanels: [
        {evidenceId: "product", role: "primary", purpose: "确认产品能力", scrollStartPct: 0, scrollEndPct: 24},
        {evidenceId: "pricing", role: "supporting", purpose: "补充价格范围", scrollStartPct: 8, scrollEndPct: 38},
      ],
    }],
  }));
  assert.equal(findings.some((finding) => finding.severity === "error"), false);
});

test("rejects duplicate or structurally conflicting multi-evidence panels", () => {
  const asset = {id: "same", kind: "webpage" as const, label: "Same", url: "https://example.com/same", src: "same.png", localPath: "/tmp/same.png", evidencePath: "/tmp/same.json"};
  const findings = validateSpecQuality(spec({
    evidenceAssets: [asset],
    beats: [{
      startMs: 0,
      endMs: 10_000,
      kind: "evidence",
      headline: "重复面板",
      body: "不应通过",
      keywords: [],
      evidenceId: "same",
      evidenceMode: "comparison",
      evidencePanels: [
        {evidenceId: "same", role: "primary", purpose: "相同用途"},
        {evidenceId: "same", role: "supporting", purpose: "相同用途"},
      ],
    }],
  }));
  assert.ok(findings.some((finding) => finding.id === "evidence-panel-duplicate"));
  assert.ok(findings.some((finding) => finding.id === "evidence-reference-ambiguous"));
  assert.ok(findings.some((finding) => finding.id === "evidence-purpose-duplicate"));
  assert.ok(findings.some((finding) => finding.id === "evidence-comparison-missing-contrast"));
});

test("keeps hand-drawn diagrams separate from evidence and generated illustrations", () => {
  const diagram = {
    id: "diagram-01",
    kind: "handdrawn-diagram" as const,
    label: "流程图",
    purpose: "解释流程",
    prompt: "Local Excalidraw skill render",
    src: "diagram.png",
    localPath: "/tmp/diagram.png",
    metadataPath: "/tmp/diagram.json",
    sourceJsonPath: "/tmp/diagram.excalidraw",
    model: "excalidraw-skill",
    generatedAt: new Date(0).toISOString(),
  };
  const valid = validateSpecQuality(spec({
    generatedVisuals: [diagram],
    beats: [{startMs: 0, endMs: 10_000, kind: "diagram", headline: "证据编排流程", body: "解释选择关系", keywords: [], diagramId: diagram.id}],
  }));
  assert.equal(valid.some((finding) => finding.severity === "error"), false);

  const wrong = validateSpecQuality(spec({
    generatedVisuals: [diagram],
    beats: [{startMs: 0, endMs: 10_000, kind: "evidence", headline: "错误", body: "", keywords: [], diagramId: diagram.id}],
  }));
  assert.ok(wrong.some((finding) => finding.id === "diagram-wrong-beat"));
});

test("keeps generated illustrations separate from factual evidence and within budget", () => {
  const generated = {
    id: "generated-01",
    kind: "generated-illustration" as const,
    label: "抽象示例",
    purpose: "解释抽象流程",
    prompt: "editorial illustration",
    src: "media/generated.png",
    localPath: "/tmp/generated.png",
    metadataPath: "/tmp/generated.json",
    model: "image-model",
    generatedAt: new Date(0).toISOString(),
  };
  const valid = validateSpecQuality(spec({
    generatedVisuals: [generated],
    beats: [{
      startMs: 0,
      endMs: 10_000,
      kind: "illustration",
      headline: "示例",
      body: "只用于帮助理解",
      keywords: [],
      generatedVisualId: generated.id,
      speakerLayout: "circle",
    }],
  }));
  assert.equal(valid.some((finding) => finding.severity === "error"), false);

  const confused = validateSpecQuality(spec({
    generatedVisuals: [generated],
    beats: [{
      startMs: 0,
      endMs: 10_000,
      kind: "evidence",
      headline: "错误证据",
      body: "",
      keywords: [],
      evidenceId: "official-source",
      generatedVisualId: generated.id,
      speakerLayout: "circle",
    }],
  }));
  assert.ok(confused.some((finding) => finding.id === "generated-evidence-confusion"));
  assert.ok(confused.some((finding) => finding.id === "generated-visual-wrong-beat"));
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

test("distinguishes a QA protocol outage from a real visual edit failure", () => {
  assert.equal(isVisionGateProtocolOnlyFailure([{
    id: "vision-gate-unavailable",
    severity: "error",
    message: "gateway timeout",
  }]), true);
  assert.equal(isVisionGateProtocolOnlyFailure([
    {id: "vision-gate-unavailable", severity: "error", message: "gateway timeout"},
    {id: "impact-visual-failed", severity: "error", message: "missing text"},
  ]), false);
});

test("does not reject a valid impact merely because normal subtitles remain visible", () => {
  const summary = "重点短语在中间和右侧帧以大号白色加粗字体全屏清晰呈现，符合通过条件。底部字幕在所有三帧均一致可见。";
  assert.equal(hasDisqualifyingVisualContradiction(summary, []), false);
  assert.equal(hasDisqualifyingVisualContradiction("只有人物全屏，预期大字缺失。", []), true);
});

test("recognizes an explicit visual-impact pass even when a compatible model missets its boolean", () => {
  const passing = "三帧连续显示重点短语全屏大字：左帧淡入，中间和右侧为稳定冲击呈现，文字完整、未被裁切，满足所有通过条件。";
  assert.equal(hasPositiveImpactConfirmation(passing, []), true);
  assert.equal(hasDisqualifyingVisualContradiction(passing, []), false);
  assert.equal(hasDisqualifyingVisualContradiction("重点大字被裁切，无法看清。", []), true);
  assert.equal(hasPositiveImpactConfirmation("重点文字缺失，三帧完全相同。", []), false);
});
