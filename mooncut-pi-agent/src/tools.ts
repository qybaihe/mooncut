import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {Type} from "typebox";
import {defineTool} from "@earendil-works/pi-coding-agent";
import {config, remotionRoot} from "./config.ts";
import {copyDerivedVideoIntoRemotion, inspectVideo, makeContactSheet, probeVideo, trackFace, transcribeVideo} from "./media.ts";
import {runProcess} from "./process.ts";
import {buildRemotionRenderArgs, describeRenderGpuConfig, remotionCliPath} from "./render.ts";
import {captureWebPage, captureXPost} from "./research.ts";
import {detectAudioSilences, planSpeechCleanup, renderSpeechCleanup, retimeSubtitlesAfterCleanup} from "./speech-cleanup.ts";
import {importCodexGeneratedVisual, importHanddrawnDiagram, scheduleGeneratedVisuals} from "./visuals.ts";
import {isVisionGateProtocolOnlyFailure, reviewRenderedVideo} from "./quality.ts";
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

const speechCleanupPolicy = () => ({
  enabled: config.speechCleanupEnabled,
  minSilenceMs: config.speechCleanupMinSilenceMs,
  retainedSilenceMs: config.speechCleanupRetainedSilenceMs,
  fillerPaddingMs: config.speechCleanupFillerPaddingMs,
  wordGuardMs: config.speechCleanupWordGuardMs,
});

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
    evidencePanels?: EditBeat["evidencePanels"];
    evidenceMode?: EditBeat["evidenceMode"];
    generatedVisualId?: string;
    diagramId?: string;
    desktopTemplate?: EditBeat["desktopTemplate"];
    visualItems?: EditBeat["visualItems"];
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
      ...(beat.evidencePanels?.length ? {evidencePanels: beat.evidencePanels.slice(0, 3).map((panel) => ({
        evidenceId: panel.evidenceId.trim().slice(0, 100),
        role: panel.role,
        purpose: panel.purpose.trim().slice(0, 80),
        ...(Number.isFinite(panel.scrollStartPct) ? {scrollStartPct: clampNumber(panel.scrollStartPct!, 0, 70)} : {}),
        ...(Number.isFinite(panel.scrollEndPct) ? {scrollEndPct: clampNumber(panel.scrollEndPct!, 0, 70)} : {}),
      }))} : {}),
      ...(beat.evidenceMode ? {evidenceMode: beat.evidenceMode} : {}),
      ...(beat.generatedVisualId ? {generatedVisualId: beat.generatedVisualId} : {}),
      ...(beat.diagramId ? {diagramId: beat.diagramId} : {}),
      ...(beat.desktopTemplate ? {desktopTemplate: beat.desktopTemplate} : {}),
      ...(beat.visualItems?.length ? {visualItems: beat.visualItems.slice(0, 4).map((item) => ({
        title: item.title.trim().slice(0, 30),
        detail: item.detail.trim().slice(0, 80),
        ...(item.value?.trim() ? {value: item.value.trim().slice(0, 24)} : {}),
      }))} : {}),
      speakerLayout: expectedSpeakerLayout({
        kind,
        evidenceId: beat.evidenceId,
        evidencePanels: beat.evidencePanels,
        generatedVisualId: beat.generatedVisualId,
        diagramId: beat.diagramId,
      }),
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

  const cleanSpeechDelivery = defineTool({
    name: "clean_speech_delivery",
    label: "Tighten pauses and filler words",
    description: "Build a local non-destructive EDL from word timings and acoustic silence, remove only isolated fillers and excess dead air, then retime subtitles to the derived media.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!context.probe || !context.subtitles) throw new Error("inspect_source and transcribe_source must run before clean_speech_delivery");
      await update("cleaning-speech", 0.35);
      const policy = speechCleanupPolicy();
      const audioSilences = context.probe.hasAudio
        ? await detectAudioSilences(context.publicMediaPath, policy.minSilenceMs).catch(() => [])
        : [];
      let manifest = planSpeechCleanup({
        subtitles: context.subtitles,
        durationMs: context.probe.durationMs,
        policy,
        audioSilences,
      });
      const manifestPath = join(context.jobDir, "speech-cleanup.json");
      if (manifest.status === "applied") {
        const sourceSubtitles = context.subtitles;
        const cleanedPath = join(context.jobDir, "speech-clean.mp4");
        await renderSpeechCleanup({
          inputPath: context.publicMediaPath,
          outputPath: cleanedPath,
          manifest,
          hasAudio: context.probe.hasAudio,
        });
        const cleanedProbe = await probeVideo(cleanedPath);
        manifest = {
          ...manifest,
          outputDurationMs: cleanedProbe.durationMs,
          removedDurationMs: Math.max(0, manifest.sourceDurationMs - cleanedProbe.durationMs),
        };
        context.subtitles = retimeSubtitlesAfterCleanup(sourceSubtitles, manifest);
        const copied = await copyDerivedVideoIntoRemotion(cleanedPath, context.job.id, "speech-clean");
        context.publicMediaPath = copied.path;
        context.publicMediaSrc = copied.src;
        context.probe = cleanedProbe;
        context.cleanedSpeechPath = cleanedPath;
        await writeJson(join(context.jobDir, "subtitles-source.json"), sourceSubtitles);
        await writeJson(join(context.jobDir, "subtitles.json"), context.subtitles);
      }
      context.speechCleanup = manifest;
      context.speechCleanupPath = manifestPath;
      await writeJson(manifestPath, manifest);
      await update(manifest.status === "applied" ? "speech-cleaned" : "speech-cleanup-skipped", 0.44);
      return textResult({
        manifestPath,
        status: manifest.status,
        reason: manifest.reason,
        sourceDurationMs: manifest.sourceDurationMs,
        outputDurationMs: manifest.outputDurationMs,
        removedDurationMs: manifest.removedDurationMs,
        cuts: manifest.cuts,
      });
    },
  });

  const scheduleVisuals = defineTool({
    name: "schedule_generated_visuals",
    label: "Schedule optional AI example visuals",
    description: "Run the conservative zero-to-two image scheduler. It defaults to no generated images and never substitutes generated art for factual evidence.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!context.probe || !context.subtitles) {
        throw new Error("inspect_source and transcribe_source must run before schedule_generated_visuals");
      }
      if (!context.speechCleanup) {
        throw new Error("clean_speech_delivery must run before schedule_generated_visuals so all visual beats use the cleaned timeline");
      }
      await update("scheduling-visuals", 0.45);
      const schedule = await scheduleGeneratedVisuals(context);
      await update(schedule.mode === "generated" ? "visuals-generated" : "visuals-scheduled", 0.50);
      return textResult({
        ...schedule,
        instruction: schedule.assets.length > 0
          ? "Use generatedVisualId only on matching illustration beats. Always present these as AI-generated examples, never as evidence."
          : "Do not invent generatedVisualId values. Continue without generated imagery.",
      });
    },
  });

  const importCodexVisual = defineTool({
    name: "import_codex_generated_visual",
    label: "Import Codex ImageGen visual",
    description: "Import one ImageGen result that Codex created inside this job directory. The file is signature-checked, copied into job/public media, and registered for an illustration beat.",
    parameters: Type.Object({
      sourcePath: Type.String({minLength: 1, maxLength: 600}),
      label: Type.String({minLength: 1, maxLength: 80}),
      purpose: Type.String({minLength: 1, maxLength: 240}),
      prompt: Type.String({minLength: 1, maxLength: 1200}),
      avoid: Type.Optional(Type.String({maxLength: 400})),
      relatedQuote: Type.Optional(Type.String({maxLength: 240})),
    }),
    execute: async (_toolCallId, params) => {
      if (!context.probe || !context.subtitles || !context.speechCleanup) {
        throw new Error("inspect_source, transcribe_source and clean_speech_delivery must run before importing a Codex ImageGen visual");
      }
      await update("importing-codex-imagegen", 0.48);
      const asset = await importCodexGeneratedVisual(context, {
        sourcePath: params.sourcePath,
        label: params.label,
        purpose: params.purpose,
        prompt: params.prompt,
        avoid: params.avoid ?? "文字、Logo、水印、二维码、真实人物和品牌标识",
        relatedQuote: params.relatedQuote ?? "",
      });
      await update("codex-imagegen-imported", 0.50);
      return textResult({
        generatedVisual: asset,
        instruction: `Use generatedVisualId=${asset.id} only on the matching illustration beat. Present it as an AI-generated example, never as factual evidence.`,
      });
    },
  });

  const importDiagram = defineTool({
    name: "import_handdrawn_diagram",
    label: "Import hand-drawn diagram",
    description: "Import a PNG rendered from Excalidraw JSON inside this job. It becomes a diagram asset, never factual evidence.",
    parameters: Type.Object({
      sourcePath: Type.String({minLength: 1, maxLength: 600}),
      sourceExcalidrawPath: Type.String({minLength: 1, maxLength: 600}),
      label: Type.String({minLength: 1, maxLength: 80}),
      purpose: Type.String({minLength: 1, maxLength: 240}),
    }),
    execute: async (_toolCallId, params) => {
      if (!context.probe || !context.subtitles || !context.speechCleanup) {
        throw new Error("inspect_source, transcribe_source and clean_speech_delivery must run before importing a diagram");
      }
      await update("importing-handdrawn-diagram", 0.49);
      const asset = await importHanddrawnDiagram(context, params);
      await update("handdrawn-diagram-imported", 0.51);
      return textResult({
        diagram: asset,
        instruction: `Use diagramId=${asset.id} only on a diagram beat. It explains structure; it is not factual evidence.`,
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
      if (!context.speechCleanup) throw new Error("clean_speech_delivery must run before track_speaker");
      await update("tracking-speaker", 0.52);
      const outputPath = join(context.jobDir, "face-track.json");
      context.faceTrack = await trackFace(context.publicMediaPath, outputPath);
      await update("speaker-tracked", 0.60);
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
          Type.Literal("illustration"),
          Type.Literal("diagram"),
        ]),
        headline: Type.String({minLength: 1, maxLength: 30}),
        body: Type.String({maxLength: 100}),
        keywords: Type.Array(Type.String({maxLength: 24}), {maxItems: 4}),
        impactText: Type.Optional(Type.String({maxLength: 20})),
        impactAtMs: Type.Optional(Type.Number({minimum: 0, description: "Absolute word timestamp where the visual pulse should land"})),
        evidenceId: Type.Optional(Type.String({maxLength: 100})),
        evidencePanels: Type.Optional(Type.Array(Type.Object({
          evidenceId: Type.String({minLength: 1, maxLength: 100}),
          role: Type.Union([
            Type.Literal("primary"),
            Type.Literal("supporting"),
            Type.Literal("contrast"),
            Type.Literal("step"),
          ]),
          purpose: Type.String({minLength: 1, maxLength: 80}),
          scrollStartPct: Type.Optional(Type.Number({minimum: 0, maximum: 70})),
          scrollEndPct: Type.Optional(Type.Number({minimum: 0, maximum: 70})),
        }), {minItems: 1, maxItems: 3})),
        evidenceMode: Type.Optional(Type.Union([
          Type.Literal("single"),
          Type.Literal("parallel"),
          Type.Literal("comparison"),
          Type.Literal("sequence"),
        ])),
        generatedVisualId: Type.Optional(Type.String({maxLength: 100})),
        diagramId: Type.Optional(Type.String({maxLength: 100})),
        desktopTemplate: Type.Optional(Type.Union([
          Type.Literal("editorial"),
          Type.Literal("workflow"),
          Type.Literal("comparison"),
          Type.Literal("dashboard"),
        ])),
        visualItems: Type.Optional(Type.Array(Type.Object({
          title: Type.String({minLength: 1, maxLength: 30}),
          detail: Type.String({maxLength: 80}),
          value: Type.Optional(Type.String({maxLength: 24})),
        }), {maxItems: 4})),
      }), {minItems: 1, maxItems: 12}),
    }),
    execute: async (_toolCallId, params) => {
      if (!context.probe || !context.subtitles) {
        throw new Error("inspect_source and transcribe_source must run before save_edit_spec");
      }
      if (!context.speechCleanup) throw new Error("clean_speech_delivery must run before save_edit_spec");
      await update("planning-edit", 0.62);
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
      const fps = config.renderFps;
      const outputHeight = context.job.request.maxOutputHeight ?? config.renderHeight;
      // Agent desktop/browser compositions are authored on a 1920x1080 design
      // canvas. Keep every export at 16:9 so HTML-like windows never stretch or
      // clip when a plan selects 720p, 1080p, or 4K.
      const outputWidth = Math.max(320, Math.round((16 / 9 * outputHeight) / 2) * 2);
      const spec: AgentEditSpec = {
        schemaVersion: "mooncut.edit.v1",
        title: params.title.trim(),
        summary: params.summary.trim(),
        accent: normalizeAccent(params.accent),
        fps,
        durationInFrames: Math.max(1, Math.ceil(context.probe.durationMs / 1000 * fps)),
        width: outputWidth,
        height: outputHeight,
        source: {
          src: context.publicMediaSrc,
          aspectRatio: context.probe.width / context.probe.height,
        },
        transcript: context.subtitles.transcript,
        subtitles: context.subtitles.segments,
        beats,
        evidenceAssets: context.evidenceAssets,
        generatedVisuals: context.generatedVisuals,
        ...(context.speechCleanup ? {speechCleanup: context.speechCleanup} : {}),
        generationPreset: "macos-sonoma-native",
        cameraPolicy: DEFAULT_CAMERA_POLICY,
      };
      context.spec = spec;
      const specPath = join(context.jobDir, "edit-spec.json");
      await writeJson(specPath, spec);
      await update("edit-planned", 0.66);
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
      const renderArgs = buildRemotionRenderArgs({
        composition: "AgentTalkingHeadVideo",
        outputPath,
        propsPath,
      });
      const gpu = describeRenderGpuConfig();
      const result = await runProcess(remotionCliPath(), renderArgs, {
        cwd: remotionRoot,
        timeoutMs: config.renderTimeoutMs,
      });
      context.renderPath = outputPath;
      await writeFile(
        join(context.jobDir, "render.log"),
        [
          `# MoonCut render`,
          `# gpu=${JSON.stringify(gpu)}`,
          `# args=${JSON.stringify(renderArgs)}`,
          result.stdout,
          result.stderr,
        ].join("\n"),
      );
      await update("rendered", 0.92);
      return textResult({
        outputPath,
        composition: "AgentTalkingHeadVideo",
        gpu,
        renderArgs,
      });
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
      let qualityReview;
      for (let qaAttempt = 0; qaAttempt < 2; qaAttempt += 1) {
        qualityReview = await reviewRenderedVideo({
          jobDir: context.jobDir,
          requestPrompt: context.job.request.prompt ?? "",
          spec: context.spec,
          videoPath: context.renderPath,
        });
        context.qualityReviews.push(qualityReview);
        await writeJson(join(context.jobDir, `quality-review-${context.qualityReviews.length}.json`), qualityReview);
        const protocolOnlyFailure = isVisionGateProtocolOnlyFailure(qualityReview.findings);
        if (qualityReview.ok || !protocolOnlyFailure) break;
        await update("visual-quality-retry", 0.97);
      }
      if (!qualityReview) throw new Error("Visual quality review did not run");
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
        const hardFindings = qualityReview.findings.filter((finding) => finding.severity === "error");
        const protocolOnlyFailure = isVisionGateProtocolOnlyFailure(qualityReview.findings);
        const errors = hardFindings
          .map((finding) => `${finding.id}: ${finding.message}`)
          .join("; ");
        throw new Error(protocolOnlyFailure
          ? `Visual quality service was unavailable after retry. Keep the current render and retry verify_render: ${errors}`
          : `Visual quality gate failed. Revise the edit spec and rerender: ${errors}`);
      }
      context.verificationPath = verificationPath;
      await update("verified", 0.99);
      return textResult(verification);
    },
  });

  return [
    inspectSource,
    transcribeSource,
    cleanSpeechDelivery,
    scheduleVisuals,
    importCodexVisual,
    importDiagram,
    captureXPostEvidence,
    captureWebEvidence,
    trackSpeaker,
    saveEditSpec,
    renderEdit,
    verifyRender,
  ];
};
