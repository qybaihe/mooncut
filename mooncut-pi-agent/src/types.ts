export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type FaceTrackManifest = {
  schema_version: "mooncut.face-track.v1";
  source?: {
    width: number;
    height: number;
    display_width?: number;
    display_height?: number;
    duration_ms?: number;
    fps?: number;
  };
  primary_track_id?: number | null;
  samples: Array<{
    t_ms: number;
    center_norm: readonly [number, number];
    face_size_norm: readonly [number, number];
    track_id?: number;
    confidence?: number;
    state?: "detected" | "interpolated" | "held" | "fallback";
  }>;
};

export type VideoProbe = {
  durationMs: number;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
  formatName: string;
};

export type SubtitleSegment = {
  index: number;
  text: string;
  start_ms: number;
  end_ms: number;
};

export type SubtitleWord = {
  text: string;
  start_ms: number;
  end_ms: number;
  confidence?: number;
};

export type SubtitleData = {
  duration_ms: number;
  transcript: string;
  segments: SubtitleSegment[];
  words?: SubtitleWord[];
  provider: string;
};

/** Conservative local delivery-cleanup settings applied before semantic editing. */
export type SpeechCleanupPolicy = {
  enabled: boolean;
  minSilenceMs: number;
  retainedSilenceMs: number;
  fillerPaddingMs: number;
  wordGuardMs: number;
};

export type SpeechCleanupCut = {
  startMs: number;
  endMs: number;
  kind: "silence" | "filler" | "combined";
  reasons: string[];
};

export type SpeechCleanupKeepRange = {
  sourceStartMs: number;
  sourceEndMs: number;
  outputStartMs: number;
  outputEndMs: number;
};

/**
 * Auditable edit-decision list for removing dead air and isolated fillers.
 * All timestamps in `cuts` and `keptRanges` refer to the pre-cleanup source.
 */
export type SpeechCleanupManifest = {
  schemaVersion: "mooncut.speech-cleanup.v1";
  status: "applied" | "skipped";
  reason: string;
  policy: SpeechCleanupPolicy;
  sourceDurationMs: number;
  outputDurationMs: number;
  removedDurationMs: number;
  cuts: SpeechCleanupCut[];
  keptRanges: SpeechCleanupKeepRange[];
};

/** A deliberately narrow human instruction for a completed video's subtitles. */
export type SubtitleRepairFeedback = {
  instruction: string;
  /** Optional cue point from the preview player, in source-timeline milliseconds. */
  atMs?: number;
  /** Optional exact wording supplied by the editor. */
  replacementText?: string;
};

export type SubtitleRepairChange = {
  segmentIndex: number;
  before: string;
  after: string;
  startMs: number;
  endMs: number;
  reason: string;
};

export type SubtitleRepairAnalysis = {
  summary: string;
  changes: SubtitleRepairChange[];
  model: string;
};

export type SubtitleRepairRecord = {
  /** Immediate version this repair was made from. */
  parentJobId: string;
  /** Stable initial version used to retrieve a complete repair history. */
  rootJobId: string;
  feedback: SubtitleRepairFeedback;
  analysis?: SubtitleRepairAnalysis;
};

export type EditBeatKind = "speaker" | "desktop" | "quote" | "impact" | "evidence" | "illustration";
export type SpeakerLayout = "native" | "circle";

export type EditBeat = {
  startMs: number;
  endMs: number;
  kind: EditBeatKind;
  headline: string;
  body: string;
  keywords: string[];
  impactText?: string;
  /** Absolute source-timeline time where the impact pulse must land. */
  impactAtMs?: number;
  evidenceId?: string;
  generatedVisualId?: string;
  speakerLayout?: SpeakerLayout;
};

export type EvidenceAsset = {
  id: string;
  kind: "webpage" | "x-post";
  label: string;
  url: string;
  src: string;
  localPath: string;
  evidencePath: string;
};

export type GeneratedVisualAsset = {
  id: string;
  kind: "generated-illustration";
  label: string;
  purpose: string;
  prompt: string;
  src: string;
  localPath: string;
  metadataPath: string;
  model: string;
  generatedAt: string;
};

export type ImageGenerationPlanItem = {
  label: string;
  purpose: string;
  prompt: string;
  avoid: string;
  relatedQuote: string;
};

export type ImageGenerationSchedule = {
  mode: "off" | "none" | "generated" | "unavailable";
  reason: string;
  maxImages: number;
  requestedCount: number;
  providerConfigured: boolean;
  plan: ImageGenerationPlanItem[];
  assets: GeneratedVisualAsset[];
  errors: string[];
};

export type AgentEditSpec = {
  schemaVersion: "mooncut.edit.v1";
  title: string;
  summary: string;
  accent: string;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  source: {
    src: string;
    aspectRatio: number;
  };
  transcript: string;
  subtitles: SubtitleSegment[];
  beats: EditBeat[];
  evidenceAssets: EvidenceAsset[];
  generatedVisuals?: GeneratedVisualAsset[];
  speechCleanup?: SpeechCleanupManifest;
  generationPreset: "macos-sonoma-native";
  cameraPolicy?: {
    mode: "track-small-overlays-only";
    trackedLayout: "circle";
    nativeReframe: "preserve-source";
    minimumLayoutHoldMs: number;
    transitionMs: number;
    recenterDurationMs: number;
  };
};

export type AgentRenderProps = {
  spec: AgentEditSpec;
  faceTrack: FaceTrackManifest | null;
};

export type QualityFinding = {
  id: string;
  severity: "error" | "warning";
  message: string;
  beatIndex?: number;
  evidencePath?: string;
  model?: string;
  confidence?: number;
};

export type QualityReview = {
  schemaVersion: "mooncut.quality.v1";
  ok: boolean;
  reviewedAt: string;
  findings: QualityFinding[];
  qaAssets: Record<string, string>;
};

export type ArtifactMap = Record<string, string>;

export type EditJobRequest = {
  assetId?: string;
  inputPath?: string;
  prompt?: string;
  title?: string;
  notificationEmail?: string;
  imageGeneration?: "auto" | "off";
  /** Installed capabilities explicitly selected for this task. */
  capabilityInstallIds?: string[];
  /** User-authorized calls that should produce research before editing begins. */
  capabilityRequests?: Array<CapabilityInvocationRequest & {installationId: string}>;
};

export type MailDeliveryStatus = "scheduled" | "ready" | "awaiting-confirmation" | "sent" | "failed";

export type MailDelivery = {
  recipient: string;
  status: MailDeliveryStatus;
  updatedAt: string;
  sentAt?: string;
  error?: string;
};

export type EditJobRecord = {
  id: string;
  /** Privacy-safe, human-friendly name used by the shared render queue. */
  displayName?: string;
  /** User account that owns this job. Missing only for trusted service jobs created before authentication. */
  ownerUserId?: string;
  status: JobStatus;
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  /** Local worker process that owns queued/running state. */
  ownerPid?: number;
  /** Set when a user/API cancel is requested while queued/running. */
  cancelRequested?: boolean;
  inputPath: string;
  originalName: string;
  request: EditJobRequest;
  /** Immutable release identities captured at creation; runtime still checks enabled state. */
  capabilitySnapshot?: CapabilitySnapshot[];
  /** Present only on a non-destructive human subtitle-repair version. */
  subtitleRepair?: SubtitleRepairRecord;
  mail?: MailDelivery;
  error?: string;
  result?: {
    summary: string;
    artifacts: ArtifactMap;
    probe: VideoProbe;
    models: {
      planner: string;
      vision: string;
      image?: string;
    };
    visuals?: ImageGenerationSchedule;
    quality?: QualityReview;
  };
};

export type RunContext = {
  job: EditJobRecord;
  jobDir: string;
  publicMediaPath: string;
  publicMediaSrc: string;
  probe?: VideoProbe;
  visionAnalysis?: string;
  visionModel?: string;
  subtitles?: SubtitleData;
  speechCleanup?: SpeechCleanupManifest;
  speechCleanupPath?: string;
  cleanedSpeechPath?: string;
  faceTrack?: FaceTrackManifest | null;
  spec?: AgentEditSpec;
  renderPath?: string;
  verificationPath?: string;
  contactSheetPath?: string;
  evidenceAssets: EvidenceAsset[];
  generatedVisuals: GeneratedVisualAsset[];
  imageSchedule?: ImageGenerationSchedule;
  qualityReviews: QualityReview[];
  capabilityInvocations: CapabilityInvocation[];
};
import type {CapabilityInvocation, CapabilityInvocationRequest, CapabilitySnapshot} from "./capabilities.ts";
