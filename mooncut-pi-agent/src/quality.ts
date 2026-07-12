import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {reviewDiagramSequence, reviewEvidenceSequence, reviewGeneratedVisualSequence, reviewImpactSequence} from "./gateway.ts";
import {runProcess} from "./process.ts";
import {DEFAULT_CAMERA_POLICY, expectedSpeakerLayout, shortSpeakerLayoutRuns} from "./camera-policy.ts";
import type {AgentEditSpec, EditBeat, QualityFinding, QualityReview} from "./types.ts";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const isVisionGateProtocolOnlyFailure = (findings: QualityFinding[]) => {
  const hardFindings = findings.filter((finding) => finding.severity === "error");
  return hardFindings.length > 0 && hardFindings.every((finding) => finding.id === "vision-gate-unavailable");
};

export const buildQaSampleTimes = (beat: EditBeat) => {
  const duration = Math.max(1, beat.endMs - beat.startMs);
  if (beat.kind === "impact" && Number.isFinite(beat.impactAtMs)) {
    return [-420, 0, 360].map((offset) => Math.round(clamp(
      beat.impactAtMs! + offset,
      beat.startMs,
      beat.endMs - 1,
    )));
  }
  const fractions = beat.kind === "impact" ? [0.52, 0.64, 0.78] : [0.12, 0.5, 0.88];
  return fractions.map((fraction) => Math.round(clamp(beat.startMs + duration * fraction, beat.startMs, beat.endMs - 1)));
};

const safeName = (value: string) => value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80);

const extractFrame = async (videoPath: string, timeMs: number, outputPath: string) => {
  await runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-ss", (timeMs / 1000).toFixed(3),
    "-i", videoPath,
    "-frames:v", "1",
    "-vf", "scale=640:-2",
    "-q:v", "2",
    "-y", outputPath,
  ], {timeoutMs: 90_000});
};

const makeStrip = async (
  videoPath: string,
  timesMs: number[],
  directory: string,
  label: string,
) => {
  const framePaths: string[] = [];
  for (const [index, timeMs] of timesMs.entries()) {
    const framePath = join(directory, `${safeName(label)}-${index + 1}-${timeMs}ms.jpg`);
    await extractFrame(videoPath, timeMs, framePath);
    framePaths.push(framePath);
  }
  const outputPath = join(directory, `${safeName(label)}-sequence.jpg`);
  await runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    ...framePaths.flatMap((path) => ["-i", path]),
    "-filter_complex", `hstack=inputs=${framePaths.length}`,
    "-q:v", "2",
    "-y", outputPath,
  ], {timeoutMs: 90_000});
  return outputPath;
};

export const validateSpecQuality = (spec: AgentEditSpec, requestPrompt = ""): QualityFinding[] => {
  const findings: QualityFinding[] = [];
  const evidenceAssets = spec.evidenceAssets ?? [];
  const evidenceById = new Map(evidenceAssets.map((asset) => [asset.id, asset]));
  const usedEvidenceIds = new Set<string>();
  const generatedVisuals = (spec.generatedVisuals ?? []).filter((asset) => asset.kind === "generated-illustration");
  const diagrams = (spec.generatedVisuals ?? []).filter((asset) => asset.kind === "handdrawn-diagram");
  const visualById = new Map((spec.generatedVisuals ?? []).map((asset) => [asset.id, asset]));
  const usedGeneratedIds = new Set<string>();
  const usedDiagramIds = new Set<string>();
  if (generatedVisuals.length > 2) {
    findings.push({id: "generated-visual-budget-exceeded", severity: "error", message: `Edit spec contains ${generatedVisuals.length} generated images; maximum is 2.`});
  }
  if (diagrams.length > 2) {
    findings.push({id: "diagram-budget-exceeded", severity: "error", message: `Edit spec contains ${diagrams.length} hand-drawn diagrams; maximum is 2.`});
  }
  for (const [index, beat] of spec.beats.entries()) {
    const expectedLayout = expectedSpeakerLayout(beat);
    if (beat.speakerLayout && beat.speakerLayout !== expectedLayout) {
      findings.push({
        id: "speaker-layout-policy-violation",
        severity: "error",
        beatIndex: index,
        message: `${beat.kind} must use ${expectedLayout}; face tracking is allowed only in a small circle over supporting content.`,
      });
    }
    if (beat.kind === "impact") {
      if (!(beat.impactText ?? beat.headline).trim()) {
        findings.push({id: "impact-text-empty", severity: "error", beatIndex: index, message: "Impact beat has no visible phrase."});
      }
      if (beat.endMs - beat.startMs < 1200) {
        findings.push({id: "impact-too-short", severity: "warning", beatIndex: index, message: "Impact beat is shorter than 1.2 seconds."});
      }
      if (Number.isFinite(beat.impactAtMs) && (beat.impactAtMs! < beat.startMs || beat.impactAtMs! >= beat.endMs)) {
        findings.push({id: "impact-anchor-outside-beat", severity: "error", beatIndex: index, message: "Impact pulse anchor is outside its beat."});
      }
    }
    const evidencePanels = beat.evidencePanels?.length
      ? beat.evidencePanels
      : beat.evidenceId
        ? [{evidenceId: beat.evidenceId, role: "primary" as const, purpose: beat.body || beat.headline}]
        : [];
    if (beat.evidenceId && beat.evidencePanels?.length) {
      findings.push({id: "evidence-reference-ambiguous", severity: "error", beatIndex: index, message: "Use either legacy evidenceId or evidencePanels, never both on the same beat."});
    }
    if (evidencePanels.length > 3) {
      findings.push({id: "evidence-panel-budget-exceeded", severity: "error", beatIndex: index, message: "An evidence beat may show at most three simultaneous sources."});
    }
    const panelIds = evidencePanels.map((panel) => panel.evidenceId);
    if (new Set(panelIds).size !== panelIds.length) {
      findings.push({id: "evidence-panel-duplicate", severity: "error", beatIndex: index, message: "Parallel evidence panels repeat the same evidence asset."});
    }
    const purposes = evidencePanels.map((panel) => panel.purpose.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")).filter(Boolean);
    if (new Set(purposes).size !== purposes.length) {
      findings.push({id: "evidence-purpose-duplicate", severity: "error", beatIndex: index, message: "Parallel evidence panels must explain distinct, non-repeating purposes."});
    }
    const urls = evidencePanels
      .map((panel) => evidenceById.get(panel.evidenceId)?.url.replace(/#.*$/u, "").replace(/\/$/u, ""))
      .filter((url): url is string => Boolean(url));
    if (new Set(urls).size !== urls.length) {
      findings.push({id: "evidence-source-duplicate", severity: "error", beatIndex: index, message: "Parallel evidence panels repeat the same source URL instead of adding new information."});
    }
    if ((beat.evidenceMode === "parallel" || beat.evidenceMode === "comparison" || beat.evidenceMode === "sequence") && evidencePanels.length < 2) {
      findings.push({id: "evidence-mode-underfilled", severity: "error", beatIndex: index, message: `${beat.evidenceMode} evidence mode requires at least two complementary panels.`});
    }
    if ((beat.evidenceMode ?? (evidencePanels.length > 1 ? "parallel" : "single")) === "single" && evidencePanels.length > 1) {
      findings.push({id: "evidence-mode-conflict", severity: "error", beatIndex: index, message: "Multiple panels cannot use single evidence mode."});
    }
    if (beat.evidenceMode === "comparison" && !evidencePanels.some((panel) => panel.role === "contrast")) {
      findings.push({id: "evidence-comparison-missing-contrast", severity: "error", beatIndex: index, message: "Comparison evidence needs one panel marked as contrast."});
    }
    if (beat.evidenceMode === "sequence" && evidencePanels.some((panel) => panel.role !== "step")) {
      findings.push({id: "evidence-sequence-role-invalid", severity: "error", beatIndex: index, message: "Every panel in sequence mode must use the step role."});
    }
    for (const panel of evidencePanels) {
      usedEvidenceIds.add(panel.evidenceId);
      if (!evidenceById.has(panel.evidenceId)) {
        findings.push({id: "evidence-missing", severity: "error", beatIndex: index, message: `Unknown evidenceId: ${panel.evidenceId}`});
      }
    }
    if (evidencePanels.length && beat.kind !== "evidence") {
      findings.push({id: "evidence-wrong-beat", severity: "warning", beatIndex: index, message: "Evidence panels are attached to a non-evidence beat."});
    }
    if (beat.generatedVisualId) {
      usedGeneratedIds.add(beat.generatedVisualId);
      if (visualById.get(beat.generatedVisualId)?.kind !== "generated-illustration") {
        findings.push({id: "generated-visual-missing", severity: "error", beatIndex: index, message: `Unknown generatedVisualId: ${beat.generatedVisualId}`});
      }
      if (beat.kind !== "illustration") {
        findings.push({id: "generated-visual-wrong-beat", severity: "error", beatIndex: index, message: "generatedVisualId is allowed only on an illustration beat."});
      }
    }
    if (beat.kind === "illustration" && !beat.generatedVisualId) {
      findings.push({id: "illustration-asset-missing", severity: "error", beatIndex: index, message: "Illustration beat must reference a generatedVisualId returned by the scheduler."});
    }
    if (beat.diagramId) {
      usedDiagramIds.add(beat.diagramId);
      if (visualById.get(beat.diagramId)?.kind !== "handdrawn-diagram") {
        findings.push({id: "diagram-missing", severity: "error", beatIndex: index, message: `Unknown hand-drawn diagramId: ${beat.diagramId}`});
      }
      if (beat.kind !== "diagram") {
        findings.push({id: "diagram-wrong-beat", severity: "error", beatIndex: index, message: "diagramId is allowed only on a diagram beat."});
      }
    }
    if (beat.kind === "diagram" && !beat.diagramId) {
      findings.push({id: "diagram-asset-missing", severity: "error", beatIndex: index, message: "Diagram beat must reference an imported hand-drawn diagramId."});
    }
    if (beat.evidenceId && beat.generatedVisualId) {
      findings.push({id: "generated-evidence-confusion", severity: "error", beatIndex: index, message: "A generated illustration can never be attached as factual evidence."});
    }
  }
  const minimumHoldMs = spec.cameraPolicy?.minimumLayoutHoldMs ?? DEFAULT_CAMERA_POLICY.minimumLayoutHoldMs;
  for (const run of shortSpeakerLayoutRuns(spec.beats, minimumHoldMs)) {
    findings.push({
      id: "speaker-layout-run-too-short",
      severity: "error",
      beatIndex: run.beatIndexes[0],
      message: `${run.layout} speaker layout lasts only ${run.endMs - run.startMs}ms; minimum is ${minimumHoldMs}ms to prevent visible camera jumping.`,
    });
  }
  for (const asset of evidenceAssets) {
    if (!usedEvidenceIds.has(asset.id)) {
      findings.push({id: "captured-evidence-unused", severity: "error", message: `Captured evidence is not used by any beat: ${asset.label}`});
    }
  }
  for (const asset of generatedVisuals) {
    if (!usedGeneratedIds.has(asset.id)) {
      findings.push({id: "generated-visual-unused", severity: "error", message: `Generated image is not used by any illustration beat: ${asset.label}`});
    }
  }
  for (const asset of diagrams) {
    if (!usedDiagramIds.has(asset.id)) {
      findings.push({id: "diagram-unused", severity: "error", message: `Imported hand-drawn diagram is not used by any diagram beat: ${asset.label}`});
    }
  }
  // A request such as "不要使用外部证据" is a prohibition, not a request
  // to collect evidence. Keep this gate semantic enough that a user can opt
  // out of research without making every render fail QA.
  const evidenceForbidden = /(?:不要|不需要|无需|无须|禁止|避免|别|不使用|不用)[^，、。；\n]{0,16}(?:真实|官网|网页|X\s*原帖|官方原帖|证据)/iu.test(requestPrompt);
  const evidenceRequested = /真实|官网|网页|X\s*原帖|官方原帖|证据/iu.test(requestPrompt) && !evidenceForbidden;
  const webEvidenceRequested = /官网|网页|browser-evidence/iu.test(requestPrompt) && !evidenceForbidden;
  const xEvidenceRequested = /X\s*原帖|官方原帖|x-post-evidence/iu.test(requestPrompt) && !evidenceForbidden;
  if (evidenceRequested && evidenceAssets.length === 0) {
    findings.push({id: "requested-evidence-absent", severity: "error", message: "The request asked for real web/X evidence, but the edit spec has no evidence assets."});
  }
  if (webEvidenceRequested && !evidenceAssets.some((asset) => asset.kind === "webpage")) {
    findings.push({id: "requested-web-evidence-absent", severity: "error", message: "The request explicitly requires real webpage evidence, but no webpage asset is present."});
  }
  if (xEvidenceRequested && !evidenceAssets.some((asset) => asset.kind === "x-post")) {
    findings.push({id: "requested-x-evidence-absent", severity: "error", message: "The request explicitly requires a trusted original X post, but no X-post asset is present."});
  }
  return findings;
};

export const reviewRenderedVideo = async ({
  jobDir,
  requestPrompt,
  spec,
  videoPath,
}: {
  jobDir: string;
  requestPrompt: string;
  spec: AgentEditSpec;
  videoPath: string;
}): Promise<QualityReview> => {
  const qaDirectory = join(jobDir, "quality");
  await mkdir(qaDirectory, {recursive: true});
  const findings = validateSpecQuality(spec, requestPrompt);
  const qaAssets: Record<string, string> = {};
  const evidenceById = new Map((spec.evidenceAssets ?? []).map((asset) => [asset.id, asset]));
  const generatedById = new Map((spec.generatedVisuals ?? []).map((asset) => [asset.id, asset]));

  const visualResults = await Promise.all(spec.beats.map(async (beat, index) => {
    const evidenceIds = beat.evidencePanels?.length
      ? beat.evidencePanels.map((panel) => panel.evidenceId)
      : beat.evidenceId ? [beat.evidenceId] : [];
    if (beat.kind !== "impact" && !(beat.kind === "evidence" && evidenceIds.length) && !(beat.kind === "illustration" && beat.generatedVisualId) && !(beat.kind === "diagram" && beat.diagramId)) return null;
    const label = `${String(index + 1).padStart(2, "0")}-${beat.kind}`;
    const stripPath = await makeStrip(videoPath, buildQaSampleTimes(beat), qaDirectory, label);
    try {
      if (beat.kind === "impact") {
        const review = await reviewImpactSequence(stripPath, beat.impactText ?? beat.headline);
        return {
          label,
          stripPath,
          finding: review.result.pass ? undefined : {
            id: "impact-visual-failed",
            severity: review.result.confidence >= 0.5 ? "error" as const : "warning" as const,
            beatIndex: index,
            message: review.result.summary || review.result.issues.join("; ") || "Impact text was not visually confirmed.",
            evidencePath: stripPath,
            model: review.model,
            confidence: review.result.confidence,
          },
        };
      }
      if (beat.kind === "illustration") {
        const asset = beat.generatedVisualId ? generatedById.get(beat.generatedVisualId) : undefined;
        if (!asset) return {label, stripPath};
        const review = await reviewGeneratedVisualSequence(stripPath, asset.label);
        return {
          label,
          stripPath,
          finding: review.result.pass ? undefined : {
            id: "generated-visual-display-failed",
            severity: review.result.confidence >= 0.5 ? "error" as const : "warning" as const,
            beatIndex: index,
            message: review.result.summary || review.result.issues.join("; ") || "AI example image or its disclosure was not visually confirmed.",
            evidencePath: stripPath,
            model: review.model,
            confidence: review.result.confidence,
          },
        };
      }
      if (beat.kind === "diagram") {
        const asset = beat.diagramId ? generatedById.get(beat.diagramId) : undefined;
        if (!asset) return {label, stripPath};
        const review = await reviewDiagramSequence(stripPath, asset.label);
        return {
          label,
          stripPath,
          finding: review.result.pass ? undefined : {
            id: "diagram-display-failed",
            severity: review.result.confidence >= 0.5 ? "error" as const : "warning" as const,
            beatIndex: index,
            message: review.result.summary || review.result.issues.join("; ") || "Hand-drawn diagram was not visually confirmed.",
            evidencePath: stripPath,
            model: review.model,
            confidence: review.result.confidence,
          },
        };
      }
      const assets = evidenceIds.map((id) => evidenceById.get(id)).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
      if (!assets.length) return {label, stripPath};
      const kinds = new Set(assets.map((asset) => asset.kind));
      const review = await reviewEvidenceSequence(
        stripPath,
        assets.map((asset) => asset.label).join(" + "),
        kinds.size === 1 ? assets[0].kind : "mixed",
        assets.length,
      );
      return {
        label,
        stripPath,
        finding: review.result.pass ? undefined : {
          id: "evidence-visual-failed",
          severity: review.result.confidence >= 0.5 ? "error" as const : "warning" as const,
          beatIndex: index,
          message: review.result.summary || review.result.issues.join("; ") || "Real evidence was not visually confirmed.",
          evidencePath: stripPath,
          model: review.model,
          confidence: review.result.confidence,
        },
      };
    } catch (error) {
      return {
        label,
        stripPath,
        finding: {
          id: "vision-gate-unavailable",
          severity: "error" as const,
          beatIndex: index,
          message: error instanceof Error ? error.message : String(error),
          evidencePath: stripPath,
        },
      };
    }
  }));
  for (const result of visualResults) {
    if (!result) continue;
    qaAssets[result.label] = result.stripPath;
    if (result.finding) findings.push(result.finding);
  }

  const review: QualityReview = {
    schemaVersion: "mooncut.quality.v1",
    ok: !findings.some((finding) => finding.severity === "error"),
    reviewedAt: new Date().toISOString(),
    findings,
    qaAssets,
  };
  await writeFile(join(jobDir, "quality-review.json"), `${JSON.stringify(review, null, 2)}\n`);
  if (!review.ok) {
    await writeFile(join(jobDir, "learning-proposal.json"), `${JSON.stringify({
      schemaVersion: "mooncut.learning-proposal.v1",
      createdAt: review.reviewedAt,
      sourceFindings: findings.filter((finding) => finding.severity === "error"),
      instruction: "Promote a finding into memory/lessons.json only after a human or regression test confirms the root cause.",
    }, null, 2)}\n`);
  }
  return review;
};
