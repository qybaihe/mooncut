import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {reviewEvidenceSequence, reviewImpactSequence} from "./gateway.ts";
import {runProcess} from "./process.ts";
import {DEFAULT_CAMERA_POLICY, expectedSpeakerLayout, shortSpeakerLayoutRuns} from "./camera-policy.ts";
import type {AgentEditSpec, EditBeat, QualityFinding, QualityReview} from "./types.ts";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

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
    if (beat.evidenceId) {
      usedEvidenceIds.add(beat.evidenceId);
      if (!evidenceById.has(beat.evidenceId)) {
        findings.push({id: "evidence-missing", severity: "error", beatIndex: index, message: `Unknown evidenceId: ${beat.evidenceId}`});
      }
      if (beat.kind !== "evidence") {
        findings.push({id: "evidence-wrong-beat", severity: "warning", beatIndex: index, message: "evidenceId is attached to a non-evidence beat."});
      }
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
  if (/真实|官网|网页|X\s*原帖|官方原帖|证据/iu.test(requestPrompt) && evidenceAssets.length === 0) {
    findings.push({id: "requested-evidence-absent", severity: "error", message: "The request asked for real web/X evidence, but the edit spec has no evidence assets."});
  }
  if (/官网|网页|browser-evidence/iu.test(requestPrompt) && !evidenceAssets.some((asset) => asset.kind === "webpage")) {
    findings.push({id: "requested-web-evidence-absent", severity: "error", message: "The request explicitly requires real webpage evidence, but no webpage asset is present."});
  }
  if (/X\s*原帖|官方原帖|x-post-evidence/iu.test(requestPrompt) && !evidenceAssets.some((asset) => asset.kind === "x-post")) {
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

  const visualResults = await Promise.all(spec.beats.map(async (beat, index) => {
    if (beat.kind !== "impact" && !(beat.kind === "evidence" && beat.evidenceId)) return null;
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
      const asset = beat.evidenceId ? evidenceById.get(beat.evidenceId) : undefined;
      if (!asset) return {label, stripPath};
      const review = await reviewEvidenceSequence(stripPath, asset.label, asset.kind);
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
