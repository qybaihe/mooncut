export type JobStatus = "queued" | "running" | "completed" | "failed";

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

export type EditBeatKind = "speaker" | "desktop" | "quote" | "impact" | "evidence";
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
  generationPreset: "macos-sonoma-native";
  cameraPolicy?: {
    mode: "track-small-overlays-only";
    trackedLayout: "circle";
    nativeReframe: "preserve-source";
    minimumLayoutHoldMs: number;
    transitionMs: number;
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
};

export type EditJobRecord = {
  id: string;
  status: JobStatus;
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  inputPath: string;
  originalName: string;
  request: EditJobRequest;
  error?: string;
  result?: {
    summary: string;
    artifacts: ArtifactMap;
    probe: VideoProbe;
    models: {
      planner: string;
      vision: string;
    };
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
  faceTrack?: FaceTrackManifest | null;
  spec?: AgentEditSpec;
  renderPath?: string;
  verificationPath?: string;
  contactSheetPath?: string;
  evidenceAssets: EvidenceAsset[];
  qualityReviews: QualityReview[];
};
