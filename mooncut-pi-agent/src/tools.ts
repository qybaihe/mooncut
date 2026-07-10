import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {Type} from "typebox";
import {defineTool} from "@earendil-works/pi-coding-agent";
import {remotionRoot} from "./config.ts";
import {inspectVideo, makeContactSheet, probeVideo, trackFace, transcribeVideo} from "./media.ts";
import {runProcess} from "./process.ts";
import {captureWebPage, captureXPost} from "./research.ts";
import {reviewRenderedVideo} from "./quality.ts";
import {DEFAULT_CAMERA_POLICY, expectedSpeakerLayout, shortSpeakerLayoutRuns} from "./camera-policy.ts";
import type {AgentEditSpec, EditBeat, EditBeatKind, RunContext, SubtitleWord} from "./types.ts";

export type StageUpdate = (stage: string, progress: number) => Promise<void>;

const textResult = (value: unknown) => ({
  content: [{type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2)}],
  details: {},
});

const writeJson = async (path: string, value: unknown) => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const colors = new Set(["#65d9b6", "#ffd166", "#ff7951", "#8fb7ff", "#d9ff63"]);

const normalizeAccent = (accent: string) => colors.has(accent.toLowerCase()) ? accent.toLowerCase() : "#65d9b6";

export const normalizeBeats = (
  beats: Array<{
    startMs: number;
    endMs: number;
    kind: EditBeatKind;
    headline: string;
    body: string;
    keywords: string[];
    impactText?: string;
    impactAtMs?: number;
    evidenceId?: string;
  }>,
  durationMs: number,
): EditBeat[] => {
  const maximumBeatCount = Math.max(1, Math.floor(durationMs / 750));
  const selected = beats
    .filter((beat) => Number.isFinite(beat.startMs) && Number.isFinite(beat.endMs))
    .sort((left, right) => left.startMs - right.startMs)
    .slice(0, Math.min(12, maximumBeatCount));
  if (selected.length === 0) {
    return [{
      startMs: 0,
      endMs: durationMs,
      kind: "speaker",
      headline: "口播现场",
      body: "保留人物表达与原始语境",
      keywords: [],
    }];
  }

  let impactCount = 0;
  const normalized: EditBeat[] = [];
  for (const [index, beat] of selected.entries()) {
    const startMs = index === 0 ? 0 : normalized[index - 1].endMs;
    const remainingBeatCount = selected.length - index - 1;
    const maximumEnd = Math.max(startMs + 1, durationMs - remainingBeatCount * 500);
    const endMs = index === selected.length - 1
      ? durationMs
      : clampNumber(Math.round(beat.endMs), startMs + 500, maximumEnd);
    let kind = beat.kind;
    if (kind === "impact") {
      impactCount += 1;
      if (impactCount > Math.max(1, Math.floor(durationMs / 8000))) kind = "desktop";
    }
    normalized.push({
      startMs,
      endMs,
      kind,
      headline: beat.headline.trim().slice(0, 30) || "内容重点",
      body: beat.body.trim().slice(0, 100),
      keywords: beat.keywords.map((keyword) => keyword.trim()).filter(Boolean).slice(0, 4),
      ...(kind === "impact" ? {impactText: (beat.impactText ?? beat.headline).trim().slice(0, 20)} : {}),
      ...(kind === "impact" && Number.isFinite(beat.impactAtMs)
        ? {impactAtMs: clampNumber(Math.round(beat.impactAtMs!), startMs, endMs - 1)}
        : {}),
      ...(beat.evidenceId ? {evidenceId: beat.evidenceId} : {}),
      speakerLayout: expectedSpeakerLayout({kind, evidenceId: beat.evidenceId}),
    });
  }
  return normalized;
};

const normalizedText = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Add a deterministic word-level pulse anchor when the planner omitted one.
 * This keeps the visual effect tied to what was actually spoken instead of a
 * fixed percentage of an arbitrarily sized beat.
 */
export const alignImpactBeatsToWords = (beats: EditBeat[], words: SubtitleWord[] = []): EditBeat[] =>
  beats.map((beat) => {
    if (beat.kind !== "impact" || Number.isFinite(beat.impactAtMs)) return beat;
    const phrase = normalizedText(beat.impactText ?? beat.headline);
    const keywords = beat.keywords.map(normalizedText).filter(Boolean);
    const candidates = words
      .filter((word) => word.start_ms >= beat.startMs && word.start_ms < beat.endMs)
      .map((word) => {
        const token = normalizedText(word.text);
        const keywordScore = Math.max(0, ...keywords.map((keyword) =>
          keyword.includes(token) || token.includes(keyword) ? 100 + Math.min(token.length, keyword.length) : 0));
        const phraseScore = token && (phrase.includes(token) || token.includes(phrase)) ? 20 + token.length : 0;
        return {word, score: keywordScore + phraseScore};
      })
      .filter(({score}) => score > 0)
      .sort((left, right) => right.score - left.score || right.word.start_ms - left.word.start_ms);
    const anchor = candidates[0]?.word.start_ms;
    return Number.isFinite(anchor)
      ? {...beat, impactAtMs: clampNumber(Math.round(anchor!), beat.startMs, beat.endMs - 1)}
      : beat;
  });

const clampNumber = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const createMooncutTools = (context: RunContext, update: StageUpdate) => {
  const inspectSource = defineTool({
    name: "inspect_source",
    label: "Inspect source video",
    description: "Probe the source video, generate a 3x2 contact sheet, and analyze it with the configured vision model.",
    parameters: Type.Object({}),
    execute: async () => {
      await update("inspecting-source", 0.08);
      const contactSheetPath = join(context.jobDir, "source-contact-sheet.jpg");
      const result = await inspectVideo(context.job.inputPath, contactSheetPath);
      context.probe = result.probe;
      context.visionAnalysis = result.analysis;
      context.visionModel = result.visionModel;
      context.contactSheetPath = contactSheetPath;
      await writeJson(join(context.jobDir, "source-inspection.json"), result);
      await update("source-inspected", 0.18);
      return textResult({
        probe: result.probe,
        visionModel: result.visionModel,
        visualAnalysis: result.analysis,
        contactSheetPath,
      });
    },
  });

  const transcribeSource = defineTool({
    name: "transcribe_source",
    label: "Transcribe source video",
    description: "Load a hash-matched timed transcript or request one from the local hybrid subtitle service.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!context.probe) throw new Error("inspect_source must run first");
      await update("transcribing", 0.22);
      context.subtitles = await transcribeVideo(context.job.inputPath, context.probe.durationMs);
      await writeJson(join(context.jobDir, "subtitles.json"), context.subtitles);
      await update("transcribed", 0.34);
      return textResult({
        provider: context.subtitles.provider,
        durationMs: context.subtitles.duration_ms,
        transcript: context.subtitles.transcript,
        segments: context.subtitles.segments,
        words: context.subtitles.words ?? [],
        note: context.subtitles.segments.length === 0
          ? "Timed subtitles unavailable. Continue with visual analysis and do not invent quotations."
          : "Use these segment times as the source of truth for beats.",
      });
    },
  });

  const trackSpeaker = defineTool({
    name: "track_speaker",
    label: "Track primary speaker",
    description: "Generate the MoonCut stable face-track manifest used only by small circular speaker overlays; large/native shots preserve source framing.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!context.probe) throw new Error("inspect_source must run first");
      await update("tracking-speaker", 0.38);
      const outputPath = join(context.jobDir, "face-track.json");
      context.faceTrack = await trackFace(context.job.inputPath, outputPath);
      await update("speaker-tracked", 0.52);
      return textResult(context.faceTrack
        ? {
            faceTrackPath: outputPath,
            primaryTrackId: context.faceTrack.primary_track_id,
            samples: context.faceTrack.samples.length,
          }
        : {
            faceTrackPath: null,
            fallback: "Face tracker was unavailable or failed; circular overlays use stable center cropping and native shots remain unchanged.",
          });
    },
  });

  const captureXPostEvidence = defineTool({
    name: "capture_x_post",
    label: "Capture trusted X post",
    description: "Search or open an allowlisted public X post, validate its source, and save the untouched native post screenshot plus evidence JSON.",
    parameters: Type.Object({
      topic: Type.Optional(Type.String({description: "Compact source-language search terms"})),
      url: Type.Optional(Type.String({description: "Exact canonical x.com post URL"})),
      trustedAccounts: Type.Array(Type.String({minLength: 1}), {minItems: 1, maxItems: 6}),
      officialDomains: Type.Array(Type.String({minLength: 1}), {maxItems: 6}),
    }),
    execute: async (_toolCallId, params) => {
      await update("researching-x", 0.36);
      const result = await captureXPost(context, params);
      await update("x-evidence-captured", 0.39);
      return textResult({
        evidenceAsset: result.asset,
        trust: result.evidence.trust,
        sourceUrl: result.evidence.source_url,
        instruction: `Use evidenceId=${result.asset.id} on the matching evidence beat.`,
      });
    },
  });

  const captureWebEvidence = defineTool({
    name: "capture_web_page",
    label: "Browse and capture real webpage",
    description: "Open a public HTTP(S) page in a real Playwright browser, wait for the rendered page, and save its screenshot, accessibility snapshot, URL, and evidence JSON.",
    parameters: Type.Object({
      url: Type.String({minLength: 8}),
      label: Type.String({minLength: 1, maxLength: 80}),
      fullPage: Type.Optional(Type.Boolean({default: true})),
    }),
    execute: async (_toolCallId, params) => {
      await update("browsing-web", 0.36);
      const result = await captureWebPage(context, {
        url: params.url,
        label: params.label,
        fullPage: params.fullPage ?? true,
      });
      await update("web-evidence-captured", 0.39);
      return textResult({
        evidenceAsset: result.asset,
        sourceUrl: result.asset.url,
        instruction: `Use evidenceId=${result.asset.id} on the matching evidence beat.`,
      });
    },
  });

  const saveEditSpec = defineTool({
    name: "save_edit_spec",
    label: "Save semantic edit spec",
    description: "Save the complete, timed semantic editing plan that drives the Remotion composition.",
    parameters: Type.Object({
      title: Type.String({minLength: 1, maxLength: 60}),
      summary: Type.String({minLength: 1, maxLength: 240}),
      accent: Type.Union([
        Type.Literal("#65d9b6"),
        Type.Literal("#ffd166"),
        Type.Literal("#ff7951"),
        Type.Literal("#8fb7ff"),
        Type.Literal("#d9ff63"),
      ]),
      beats: Type.Array(Type.Object({
        startMs: Type.Number({minimum: 0}),
        endMs: Type.Number({minimum: 1}),
        kind: Type.Union([
          Type.Literal("speaker"),
          Type.Literal("desktop"),
          Type.Literal("quote"),
          Type.Literal("impact"),
          Type.Literal("evidence"),
        ]),
        headline: Type.String({minLength: 1, maxLength: 30}),
        body: Type.String({maxLength: 100}),
        keywords: Type.Array(Type.String({maxLength: 24}), {maxItems: 4}),
        impactText: Type.Optional(Type.String({maxLength: 20})),
        impactAtMs: Type.Optional(Type.Number({minimum: 0, description: "Absolute word timestamp where the visual pulse should land"})),
        evidenceId: Type.Optional(Type.String({maxLength: 100})),
      }), {minItems: 1, maxItems: 12}),
    }),
    execute: async (_toolCallId, params) => {
      if (!context.probe || !context.subtitles) {
        throw new Error("inspect_source and transcribe_source must run before save_edit_spec");
      }
      await update("planning-edit", 0.56);
      const beats = alignImpactBeatsToWords(
        normalizeBeats(params.beats, context.probe.durationMs),
        context.subtitles.words,
      );
      const shortCameraRuns = shortSpeakerLayoutRuns(beats);
      if (shortCameraRuns.length > 0) {
        throw new Error(
          `Speaker layout changes too quickly. Keep each native/circle run for at least ${DEFAULT_CAMERA_POLICY.minimumLayoutHoldMs}ms: ${shortCameraRuns.map((run) => `${run.layout} ${run.startMs}-${run.endMs}ms`).join(', ')}`,
        );
      }
      const fps = 30;
      const spec: AgentEditSpec = {
        schemaVersion: "mooncut.edit.v1",
        title: params.title.trim(),
        summary: params.summary.trim(),
        accent: normalizeAccent(params.accent),
        fps,
        durationInFrames: Math.max(1, Math.ceil(context.probe.durationMs / 1000 * fps)),
        width: 1920,
        height: 1080,
        source: {
          src: context.publicMediaSrc,
          aspectRatio: context.probe.width / context.probe.height,
        },
        transcript: context.subtitles.transcript,
        subtitles: context.subtitles.segments,
        beats,
        evidenceAssets: context.evidenceAssets,
        generationPreset: "macos-sonoma-native",
        cameraPolicy: DEFAULT_CAMERA_POLICY,
      };
      context.spec = spec;
      const specPath = join(context.jobDir, "edit-spec.json");
      await writeJson(specPath, spec);
      await update("edit-planned", 0.64);
      return textResult({specPath, durationInFrames: spec.durationInFrames, beats: spec.beats});
    },
  });

  const renderEdit = defineTool({
    name: "render_edit",
    label: "Render final edit",
    description: "Render the saved edit spec through MoonCut's data-driven Remotion composition.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!context.spec) throw new Error("save_edit_spec must run before render_edit");
      await update("rendering", 0.68);
      await mkdir(context.jobDir, {recursive: true});
      const propsPath = join(context.jobDir, "render-props.json");
      await writeJson(propsPath, {spec: context.spec, faceTrack: context.faceTrack ?? null});
      const outputPath = join(context.jobDir, "final.mp4");
      const remotionBinary = join(remotionRoot, "node_modules/.bin/remotion");
      const result = await runProcess(remotionBinary, [
        "render",
        "src/index.ts",
        "AgentTalkingHeadVideo",
        outputPath,
        `--props=${propsPath}`,
        "--codec=h264",
        "--overwrite",
      ], {cwd: remotionRoot, timeoutMs: 45 * 60_000});
      context.renderPath = outputPath;
      await writeFile(join(context.jobDir, "render.log"), `${result.stdout}\n${result.stderr}`);
      await update("rendered", 0.92);
      return textResult({outputPath, composition: "AgentTalkingHeadVideo"});
    },
  });

  const verifyRender = defineTool({
    name: "verify_render",
    label: "Verify rendered video",
    description: "Probe the encoded MP4, validate duration and dimensions, and generate a contact sheet for visual QA.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!context.renderPath || !context.spec) throw new Error("render_edit must run before verify_render");
      await update("verifying", 0.94);
      const probe = await probeVideo(context.renderPath);
      const expectedMs = context.spec.durationInFrames / context.spec.fps * 1000;
      if (Math.abs(probe.durationMs - expectedMs) > 1200) {
        throw new Error(`Rendered duration ${probe.durationMs}ms differs from expected ${expectedMs}ms`);
      }
      if (probe.width !== context.spec.width || probe.height !== context.spec.height) {
        throw new Error(`Rendered dimensions ${probe.width}x${probe.height} do not match spec`);
      }
      const contactSheetPath = join(context.jobDir, "final-contact-sheet.jpg");
      await makeContactSheet(context.renderPath, probe, contactSheetPath);
      await update("visual-quality-review", 0.97);
      const qualityReview = await reviewRenderedVideo({
        jobDir: context.jobDir,
        requestPrompt: context.job.request.prompt ?? "",
        spec: context.spec,
        videoPath: context.renderPath,
      });
      context.qualityReviews.push(qualityReview);
      await writeJson(join(context.jobDir, `quality-review-${context.qualityReviews.length}.json`), qualityReview);
      const verification = {
        ok: qualityReview.ok,
        video: context.renderPath,
        contactSheet: contactSheetPath,
        probe,
        expectedDurationMs: Math.round(expectedMs),
        qualityReview,
      };
      const verificationPath = join(context.jobDir, "verification.json");
      await writeJson(verificationPath, verification);
      context.contactSheetPath = contactSheetPath;
      if (!qualityReview.ok) {
        const errors = qualityReview.findings
          .filter((finding) => finding.severity === "error")
          .map((finding) => `${finding.id}: ${finding.message}`)
          .join("; ");
        throw new Error(`Visual quality gate failed. Revise the edit spec and rerender: ${errors}`);
      }
      context.verificationPath = verificationPath;
      await update("verified", 0.99);
      return textResult(verification);
    },
  });

  return [
    inspectSource,
    transcribeSource,
    captureXPostEvidence,
    captureWebEvidence,
    trackSpeaker,
    saveEditSpec,
    renderEdit,
    verifyRender,
  ];
};
