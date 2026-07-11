import {existsSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {EditJobRecord, RunContext} from "./types.ts";

const STATE_FILE = "run-context.json";

/** Serializable subset of RunContext that survives Grok subprocess tool calls. */
export type PersistedRunContext = {
  schemaVersion: "mooncut.run-context.v1";
  job: EditJobRecord;
  jobDir: string;
  publicMediaPath: string;
  publicMediaSrc: string;
  probe?: RunContext["probe"];
  visionAnalysis?: string;
  visionModel?: string;
  subtitles?: RunContext["subtitles"];
  speechCleanup?: RunContext["speechCleanup"];
  speechCleanupPath?: string;
  cleanedSpeechPath?: string;
  faceTrack?: RunContext["faceTrack"];
  spec?: RunContext["spec"];
  renderPath?: string;
  verificationPath?: string;
  contactSheetPath?: string;
  evidenceAssets: RunContext["evidenceAssets"];
  generatedVisuals: RunContext["generatedVisuals"];
  imageSchedule?: RunContext["imageSchedule"];
  qualityReviews: RunContext["qualityReviews"];
  capabilityInvocations: RunContext["capabilityInvocations"];
};

export const contextStatePath = (jobDir: string) => join(jobDir, STATE_FILE);

export const toPersisted = (context: RunContext): PersistedRunContext => ({
  schemaVersion: "mooncut.run-context.v1",
  job: context.job,
  jobDir: context.jobDir,
  publicMediaPath: context.publicMediaPath,
  publicMediaSrc: context.publicMediaSrc,
  probe: context.probe,
  visionAnalysis: context.visionAnalysis,
  visionModel: context.visionModel,
  subtitles: context.subtitles,
  speechCleanup: context.speechCleanup,
  speechCleanupPath: context.speechCleanupPath,
  cleanedSpeechPath: context.cleanedSpeechPath,
  faceTrack: context.faceTrack,
  spec: context.spec,
  renderPath: context.renderPath,
  verificationPath: context.verificationPath,
  contactSheetPath: context.contactSheetPath,
  evidenceAssets: context.evidenceAssets ?? [],
  generatedVisuals: context.generatedVisuals ?? [],
  imageSchedule: context.imageSchedule,
  qualityReviews: context.qualityReviews ?? [],
  capabilityInvocations: context.capabilityInvocations ?? [],
});

export const fromPersisted = (value: PersistedRunContext): RunContext => ({
  job: value.job,
  jobDir: value.jobDir,
  publicMediaPath: value.publicMediaPath,
  publicMediaSrc: value.publicMediaSrc,
  probe: value.probe,
  visionAnalysis: value.visionAnalysis,
  visionModel: value.visionModel,
  subtitles: value.subtitles,
  speechCleanup: value.speechCleanup,
  speechCleanupPath: value.speechCleanupPath,
  cleanedSpeechPath: value.cleanedSpeechPath,
  faceTrack: value.faceTrack,
  spec: value.spec,
  renderPath: value.renderPath,
  verificationPath: value.verificationPath,
  contactSheetPath: value.contactSheetPath,
  evidenceAssets: value.evidenceAssets ?? [],
  generatedVisuals: value.generatedVisuals ?? [],
  imageSchedule: value.imageSchedule,
  qualityReviews: value.qualityReviews ?? [],
  capabilityInvocations: value.capabilityInvocations ?? [],
});

export const saveRunContext = async (context: RunContext) => {
  await mkdir(context.jobDir, {recursive: true});
  const path = contextStatePath(context.jobDir);
  await writeFile(path, `${JSON.stringify(toPersisted(context), null, 2)}\n`);
};

export const loadRunContext = async (jobDir: string): Promise<RunContext> => {
  const path = contextStatePath(jobDir);
  if (!existsSync(path)) throw new Error(`Missing run context state: ${path}`);
  const raw = JSON.parse(await readFile(path, "utf8")) as PersistedRunContext;
  if (raw.schemaVersion !== "mooncut.run-context.v1") {
    throw new Error(`Unsupported run context schema: ${String(raw.schemaVersion)}`);
  }
  return fromPersisted(raw);
};

/** Merge disk state back into the live JobManager context object. */
export const hydrateRunContext = (target: RunContext, source: RunContext) => {
  target.publicMediaPath = source.publicMediaPath;
  target.publicMediaSrc = source.publicMediaSrc;
  target.probe = source.probe;
  target.visionAnalysis = source.visionAnalysis;
  target.visionModel = source.visionModel;
  target.subtitles = source.subtitles;
  target.speechCleanup = source.speechCleanup;
  target.speechCleanupPath = source.speechCleanupPath;
  target.cleanedSpeechPath = source.cleanedSpeechPath;
  target.faceTrack = source.faceTrack;
  target.spec = source.spec;
  target.renderPath = source.renderPath;
  target.verificationPath = source.verificationPath;
  target.contactSheetPath = source.contactSheetPath;
  target.evidenceAssets = source.evidenceAssets ?? [];
  target.generatedVisuals = source.generatedVisuals ?? [];
  target.imageSchedule = source.imageSchedule;
  target.qualityReviews = source.qualityReviews ?? [];
  target.capabilityInvocations = source.capabilityInvocations ?? [];
};

export const hydrateFromArtifacts = async (context: RunContext) => {
  const {join} = await import("node:path");
  const {existsSync} = await import("node:fs");
  const {readFile} = await import("node:fs/promises");
  const readJson = async <T,>(name: string): Promise<T | undefined> => {
    const path = join(context.jobDir, name);
    if (!existsSync(path)) return undefined;
    return JSON.parse(await readFile(path, "utf8")) as T;
  };

  const inspection = await readJson<{probe?: RunContext["probe"]; analysis?: string; visionModel?: string}>("source-inspection.json");
  if (inspection?.probe) context.probe = inspection.probe;
  if (inspection?.analysis) context.visionAnalysis = inspection.analysis;
  if (inspection?.visionModel) context.visionModel = inspection.visionModel;

  const subtitles = await readJson<RunContext["subtitles"]>("subtitles.json");
  if (subtitles) context.subtitles = subtitles;

  const speechCleanup = await readJson<RunContext["speechCleanup"]>("speech-cleanup.json");
  if (speechCleanup) {
    context.speechCleanup = speechCleanup;
    context.speechCleanupPath = join(context.jobDir, "speech-cleanup.json");
  }

  const faceTrack = await readJson<NonNullable<RunContext["faceTrack"]>>("face-track.json");
  if (faceTrack) context.faceTrack = faceTrack;

  const imageSchedule = await readJson<RunContext["imageSchedule"]>("image-generation.json");
  if (imageSchedule) context.imageSchedule = imageSchedule;

  const spec = await readJson<RunContext["spec"]>("edit-spec.json");
  if (spec) context.spec = spec;

  const finalPath = join(context.jobDir, "final.mp4");
  if (existsSync(finalPath)) context.renderPath = finalPath;

  const verificationPath = join(context.jobDir, "verification.json");
  if (existsSync(verificationPath)) {
    context.verificationPath = verificationPath;
    const verification = await readJson<{qualityReview?: RunContext["qualityReviews"][number]}>("verification.json");
    if (verification?.qualityReview) context.qualityReviews = [verification.qualityReview];
  }

  const contactSheet = join(context.jobDir, "final-contact-sheet.jpg");
  if (existsSync(contactSheet)) context.contactSheetPath = contactSheet;

  // Prefer explicit state file when present (has evidenceAssets + public media).
  if (existsSync(contextStatePath(context.jobDir))) {
    const persisted = await loadRunContext(context.jobDir);
    hydrateRunContext(context, {
      ...persisted,
      // Prefer freshest artifact-backed fields when both exist.
      probe: context.probe ?? persisted.probe,
      subtitles: context.subtitles ?? persisted.subtitles,
      speechCleanup: context.speechCleanup ?? persisted.speechCleanup,
      faceTrack: context.faceTrack ?? persisted.faceTrack,
      imageSchedule: context.imageSchedule ?? persisted.imageSchedule,
      spec: context.spec ?? persisted.spec,
      renderPath: context.renderPath ?? persisted.renderPath,
      verificationPath: context.verificationPath ?? persisted.verificationPath,
      contactSheetPath: context.contactSheetPath ?? persisted.contactSheetPath,
      qualityReviews: context.qualityReviews.length ? context.qualityReviews : persisted.qualityReviews,
    });
  }
};
