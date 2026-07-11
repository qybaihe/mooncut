import {
  audioVisualPresets,
  resolveAudioVisualCues,
  validateAudioVisualCueSpacing,
  type AudioVisualCue,
} from './audioVisualCues.ts';
import {getBgmTrack} from './bgm.ts';

export const FINAL_TALKING_HEAD_SCHEMA = 'mooncut.final-talking-head.v2' as const;

export const FINAL_TALKING_HEAD_VISUALS = [
  'speaker-focus',
  'metrics',
  'pipeline',
  'source-full',
  'impact',
  'model-compare',
  'product-ui',
  'distribution',
  'closing',
] as const;

export type FinalTalkingHeadVisual = (typeof FINAL_TALKING_HEAD_VISUALS)[number];

export type FinalTalkingHeadToolBadge = {
  label: string;
  caption: string;
  iconSrc: string;
  accent?: string;
};

export type FinalTalkingHeadBeat = {
  id: string;
  startMs: number;
  endMs: number;
  visual: FinalTalkingHeadVisual;
  headline: string;
  body: string;
  keywords: string[];
  assetId?: string;
  /** Optional alternate timestamp for an in-source B-roll cutaway. */
  sourceStartMs?: number;
  metrics?: Array<{label: string; value: string; unit?: string}>;
  tools?: FinalTalkingHeadToolBadge[];
  speakerLayout?: 'native' | 'circle';
};

export type FinalTalkingHeadAsset = {
  id: string;
  src: string;
  label: string;
  kind: 'evidence' | 'generated-illustration' | 'product-ui' | 'source-broll';
  provenance: {
    kind: 'generated' | 'project-owned' | 'verified-source';
    sourceUrl?: string;
    evidencePath?: string;
  };
};

export type FinalTalkingHeadBgmMix = {
  src: string;
  title: string;
  gainDb: number;
  duckDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  crossfadeLoopMs: number;
};

export type FinalTalkingHeadCatalogBgm = FinalTalkingHeadBgmMix & {
  /** Omitted only for specs authored before the generated-BGM contract. */
  kind?: 'catalog';
  trackId: string;
  allowDemoOnly: boolean;
};

export type FinalTalkingHeadGeneratedBgm = FinalTalkingHeadBgmMix & {
  kind: 'generated';
  generated: {
    provider: 'yunwu-suno';
    jobId: string;
    plan: {
      mood: string;
      tags: string;
      bpm: number;
      source: 'ai' | 'rules';
    };
    assetSha256: string;
    importedAt: string;
    usageRights: 'provider-terms-pending' | 'commercial-use-confirmed';
  };
};

export type FinalTalkingHeadBgm = FinalTalkingHeadCatalogBgm | FinalTalkingHeadGeneratedBgm;

export type FinalTalkingHeadSpec = {
  schemaVersion: typeof FINAL_TALKING_HEAD_SCHEMA;
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
    durationMs: number;
    mimeType: string;
    audio: {
      integratedLufs: number;
      truePeakDbtp: number;
      lra: number;
    };
  };
  transcript: string;
  transcriptMetadata: {
    language: 'zh-CN';
    glossary: string[];
  };
  subtitles: Array<{index: number; text: string; start_ms: number; end_ms: number}>;
  beats: FinalTalkingHeadBeat[];
  assets: FinalTalkingHeadAsset[];
  cameraPolicy: {
    mode: 'track-small-overlays-only';
    trackedLayout: 'circle';
    nativeReframe: 'preserve-source';
    minimumLayoutHoldMs: number;
    transitionMs: number;
    recenterDurationMs: number;
  };
  audio: {
    narration: {
      targetIntegratedLufs: number;
      maxTruePeakDbtp: number;
      normalizeBeforeRender: boolean;
      renderGainDb: number;
    };
    bgm?: FinalTalkingHeadBgm;
    cues: AudioVisualCue[];
    mastering: {
      programmeTargetLufs: number;
      programmeToleranceLufs: number;
      maxTruePeakDbtp: number;
      requireRenderedAudioMetering: boolean;
    };
  };
  output: {
    format: 'landscape-16:9' | 'portrait-9:16' | 'square-1:1';
    videoCodec: 'h264' | 'h265';
    audioCodec: 'aac';
    imageFormat: 'jpeg';
    videoBitrateKbps: number;
    audioBitrateKbps: number;
  };
  qa: {
    requireContiguousBeats: boolean;
    minimumBeatDurationMs: number;
    maxCaptionCharacters: number;
    maxCaptionCharsPerSecond: number;
    requireCueSpacing: boolean;
    requireAssetProvenance: boolean;
  };
};

export type FinalTalkingHeadSpecIssue = {
  path: string;
  message: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const cleanLength = (text: string) => Array.from(text.replace(/\s/gu, '')).length;

const addIssue = (issues: FinalTalkingHeadSpecIssue[], path: string, message: string) => {
  issues.push({path, message});
};

/**
 * Full preflight for final-video data. It intentionally validates the places
 * TypeScript cannot protect once an LLM or JSON file becomes the input.
 */
export const validateFinalTalkingHeadSpec = (value: unknown): FinalTalkingHeadSpecIssue[] => {
  const issues: FinalTalkingHeadSpecIssue[] = [];
  if (!isObject(value)) return [{path: '$', message: 'spec must be an object'}];
  const spec = value as Partial<FinalTalkingHeadSpec>;

  if (spec.schemaVersion !== FINAL_TALKING_HEAD_SCHEMA) {
    addIssue(issues, 'schemaVersion', `must equal ${FINAL_TALKING_HEAD_SCHEMA}`);
  }
  for (const field of ['title', 'summary', 'accent'] as const) {
    if (typeof spec[field] !== 'string' || !spec[field].trim()) addIssue(issues, field, 'must be a non-empty string');
  }
  if (!isFiniteNumber(spec.fps) || spec.fps < 24 || spec.fps > 60) addIssue(issues, 'fps', 'must be between 24 and 60');
  if (!isFiniteNumber(spec.durationInFrames) || spec.durationInFrames < 1) addIssue(issues, 'durationInFrames', 'must be positive');
  if (!isFiniteNumber(spec.width) || !isFiniteNumber(spec.height) || spec.width < 320 || spec.height < 320) {
    addIssue(issues, 'width/height', 'must be at least 320 pixels');
  }

  if (!isObject(spec.source)) {
    addIssue(issues, 'source', 'must be an object');
  } else {
    const source = spec.source as FinalTalkingHeadSpec['source'];
    if (!source.src) addIssue(issues, 'source.src', 'is required');
    if (!isFiniteNumber(source.aspectRatio) || source.aspectRatio <= 0) addIssue(issues, 'source.aspectRatio', 'must be positive');
    if (!isFiniteNumber(source.durationMs) || source.durationMs <= 0) addIssue(issues, 'source.durationMs', 'must be positive');
    if (!source.mimeType?.startsWith('video/')) addIssue(issues, 'source.mimeType', 'must be a video MIME type');
    if (!isObject(source.audio) || !isFiniteNumber(source.audio.integratedLufs) || !isFiniteNumber(source.audio.truePeakDbtp)) {
      addIssue(issues, 'source.audio', 'must include measured loudness and true peak');
    }
    if (isFiniteNumber(spec.fps) && isFiniteNumber(spec.durationInFrames) && isFiniteNumber(source.durationMs)) {
      const outputDurationMs = spec.durationInFrames / spec.fps * 1000;
      if (Math.abs(outputDurationMs - source.durationMs) > 1000 / spec.fps + 1) {
        addIssue(issues, 'source.durationMs', 'must match the render duration within one frame');
      }
    }
  }

  if (typeof spec.transcript !== 'string' || !spec.transcript.trim()) {
    addIssue(issues, 'transcript', 'must be non-empty text');
  }
  if (!isObject(spec.transcriptMetadata) || spec.transcriptMetadata.language !== 'zh-CN' || !Array.isArray(spec.transcriptMetadata.glossary)) {
    addIssue(issues, 'transcriptMetadata', 'must include zh-CN language and a glossary array');
  }

  if (!isObject(spec.qa)) {
    addIssue(issues, 'qa', 'must be an object');
  }
  const qa = spec.qa as FinalTalkingHeadSpec['qa'] | undefined;
  if (!qa || !isFiniteNumber(qa.minimumBeatDurationMs) || qa.minimumBeatDurationMs < 500) {
    addIssue(issues, 'qa.minimumBeatDurationMs', 'must be at least 500ms');
  }
  if (!qa || !isFiniteNumber(qa.maxCaptionCharacters) || qa.maxCaptionCharacters < 8) {
    addIssue(issues, 'qa.maxCaptionCharacters', 'must be at least 8');
  }
  if (!qa || !isFiniteNumber(qa.maxCaptionCharsPerSecond) || qa.maxCaptionCharsPerSecond <= 0) {
    addIssue(issues, 'qa.maxCaptionCharsPerSecond', 'must be positive');
  }

  const durationMs = isFiniteNumber(spec.fps) && isFiniteNumber(spec.durationInFrames)
    ? spec.durationInFrames / spec.fps * 1000
    : 0;
  if (!Array.isArray(spec.subtitles) || spec.subtitles.length === 0) {
    addIssue(issues, 'subtitles', 'must be a non-empty array');
  } else {
    let previousEnd = -Infinity;
    const subtitleIds = new Set<number>();
    spec.subtitles.forEach((subtitle, index) => {
      const path = `subtitles[${index}]`;
      if (!isObject(subtitle) || !isFiniteNumber(subtitle.index) || typeof subtitle.text !== 'string') {
        addIssue(issues, path, 'must include index and text');
        return;
      }
      if (subtitleIds.has(subtitle.index)) addIssue(issues, `${path}.index`, 'must be unique');
      subtitleIds.add(subtitle.index);
      if (!isFiniteNumber(subtitle.start_ms) || !isFiniteNumber(subtitle.end_ms) || subtitle.end_ms <= subtitle.start_ms) {
        addIssue(issues, path, 'must have an increasing time range');
        return;
      }
      if (subtitle.start_ms < previousEnd) addIssue(issues, path, 'must not overlap the preceding subtitle');
      previousEnd = subtitle.end_ms;
      if (subtitle.end_ms > durationMs + 1) addIssue(issues, path, 'must end inside the render duration');
      const characters = cleanLength(subtitle.text);
      if (qa && characters > qa.maxCaptionCharacters) addIssue(issues, path, `exceeds ${qa.maxCaptionCharacters} caption characters`);
      const charsPerSecond = characters / ((subtitle.end_ms - subtitle.start_ms) / 1000);
      if (qa && charsPerSecond > qa.maxCaptionCharsPerSecond) addIssue(issues, path, `reading rate ${charsPerSecond.toFixed(1)} exceeds the limit`);
    });
  }

  if (!Array.isArray(spec.beats) || spec.beats.length === 0) {
    addIssue(issues, 'beats', 'must be a non-empty array');
  } else {
    const beatIds = new Set<string>();
    let previousEnd = 0;
    spec.beats.forEach((beat, index) => {
      const path = `beats[${index}]`;
      if (!isObject(beat) || !beat.id || !isFiniteNumber(beat.startMs) || !isFiniteNumber(beat.endMs)) {
        addIssue(issues, path, 'must include id, startMs and endMs');
        return;
      }
      if (beatIds.has(beat.id)) addIssue(issues, `${path}.id`, 'must be unique');
      beatIds.add(beat.id);
      if (beat.endMs <= beat.startMs) addIssue(issues, path, 'must have a positive duration');
      if (beat.sourceStartMs != null && (!isFiniteNumber(beat.sourceStartMs) || beat.sourceStartMs < 0)) {
        addIssue(issues, `${path}.sourceStartMs`, 'must be a non-negative source timestamp');
      }
      if (beat.tools != null) {
        if (!Array.isArray(beat.tools) || beat.tools.length === 0) {
          addIssue(issues, `${path}.tools`, 'must be a non-empty array when present');
        } else {
          beat.tools.forEach((tool, toolIndex) => {
            const toolPath = `${path}.tools[${toolIndex}]`;
            if (!isObject(tool) || typeof tool.label !== 'string' || !tool.label.trim() || typeof tool.caption !== 'string' || !tool.caption.trim() || typeof tool.iconSrc !== 'string' || !tool.iconSrc.trim()) {
              addIssue(issues, toolPath, 'must include label, caption and iconSrc');
            } else if (/^(?:https?:)?\/\//iu.test(tool.iconSrc)) {
              addIssue(issues, `${toolPath}.iconSrc`, 'must be a local asset path, never a remote URL');
            }
          });
        }
      }
      if (qa && beat.endMs - beat.startMs < qa.minimumBeatDurationMs) addIssue(issues, path, 'is shorter than qa.minimumBeatDurationMs');
      if (!FINAL_TALKING_HEAD_VISUALS.includes(beat.visual as FinalTalkingHeadVisual)) addIssue(issues, `${path}.visual`, 'is not a supported final-video visual');
      if (qa?.requireContiguousBeats && Math.abs(beat.startMs - previousEnd) > 1) addIssue(issues, path, 'must begin where the preceding beat ended');
      previousEnd = beat.endMs;
    });
    if (spec.beats[0]?.startMs !== 0) addIssue(issues, 'beats[0].startMs', 'must begin at 0');
    if (Math.abs(previousEnd - durationMs) > (isFiniteNumber(spec.fps) ? 1000 / spec.fps + 1 : 1)) {
      addIssue(issues, 'beats', 'must cover the render duration within one frame');
    }
  }

  if (!Array.isArray(spec.assets)) {
    addIssue(issues, 'assets', 'must be an array');
  } else {
    const assetIds = new Set<string>();
    spec.assets.forEach((asset, index) => {
      const path = `assets[${index}]`;
      if (!isObject(asset) || !asset.id || !asset.src || !asset.label || !asset.kind) addIssue(issues, path, 'must include id, src, label and kind');
      if (isObject(asset) && assetIds.has(String(asset.id))) addIssue(issues, `${path}.id`, 'must be unique');
      if (isObject(asset)) assetIds.add(String(asset.id));
      if (qa?.requireAssetProvenance && (!isObject(asset) || !isObject(asset.provenance) || !asset.provenance.kind)) {
        addIssue(issues, `${path}.provenance`, 'is required');
      }
    });
    if (Array.isArray(spec.beats)) {
      for (const beat of spec.beats) {
        if (beat.assetId && !assetIds.has(beat.assetId)) addIssue(issues, `beats.${beat.id}.assetId`, 'must reference an asset');
      }
    }
  }

  if (!isObject(spec.cameraPolicy)) {
    addIssue(issues, 'cameraPolicy', 'must be an object');
  } else {
    const camera = spec.cameraPolicy as FinalTalkingHeadSpec['cameraPolicy'];
    if (camera.mode !== 'track-small-overlays-only' || camera.trackedLayout !== 'circle' || camera.nativeReframe !== 'preserve-source') {
      addIssue(issues, 'cameraPolicy', 'must preserve the approved native-plus-circle camera policy');
    }
    for (const field of ['minimumLayoutHoldMs', 'transitionMs', 'recenterDurationMs'] as const) {
      if (!isFiniteNumber(camera[field]) || camera[field] <= 0) addIssue(issues, `cameraPolicy.${field}`, 'must be positive');
    }
  }

  if (!isObject(spec.audio)) {
    addIssue(issues, 'audio', 'must be an object');
  } else {
    const audio = spec.audio as FinalTalkingHeadSpec['audio'];
    if (!isObject(audio.narration) || !isFiniteNumber(audio.narration.targetIntegratedLufs) || !isFiniteNumber(audio.narration.maxTruePeakDbtp) || !isFiniteNumber(audio.narration.renderGainDb)) {
      addIssue(issues, 'audio.narration', 'must include target loudness, true peak and render gain');
    }
    if (!isObject(audio.mastering) || !isFiniteNumber(audio.mastering.programmeTargetLufs) || !isFiniteNumber(audio.mastering.maxTruePeakDbtp)) {
      addIssue(issues, 'audio.mastering', 'must include programme loudness and true peak targets');
    }
    if (!Array.isArray(audio.cues)) {
      addIssue(issues, 'audio.cues', 'must be an array');
    } else {
      const validCuePresets = audio.cues.every((cue) => isObject(cue) && typeof cue.preset === 'string' && cue.preset in audioVisualPresets);
      if (!validCuePresets) {
        addIssue(issues, 'audio.cues', 'contains an unknown cue preset');
      } else if (Array.isArray(spec.beats) && isFiniteNumber(spec.fps)) {
        try {
          const resolved = resolveAudioVisualCues({beats: spec.beats, cues: audio.cues, fps: spec.fps});
          if (qa?.requireCueSpacing) {
            for (const warning of validateAudioVisualCueSpacing({cues: resolved})) addIssue(issues, 'audio.cues', warning);
          }
        } catch (error) {
          addIssue(issues, 'audio.cues', error instanceof Error ? error.message : 'could not resolve cues');
        }
      }
    }
    if (audio.bgm) {
      if (!isObject(audio.bgm)) {
        addIssue(issues, 'audio.bgm', 'must be an object');
      } else {
        const bgm = audio.bgm as FinalTalkingHeadBgm & Record<string, unknown>;
        if (typeof bgm.src !== 'string' || !bgm.src.trim() || /^(?:https?:)?\/\//iu.test(bgm.src)) {
          addIssue(issues, 'audio.bgm.src', 'must be a local asset path, never a remote URL');
        }
        if (typeof bgm.title !== 'string' || !bgm.title.trim()) addIssue(issues, 'audio.bgm.title', 'must be non-empty text');
        if (!isFiniteNumber(bgm.gainDb) || bgm.gainDb < -40 || bgm.gainDb > 0) {
          addIssue(issues, 'audio.bgm.gainDb', 'must be between -40dB and 0dB');
        }
        if (!isFiniteNumber(bgm.fadeInMs) || bgm.fadeInMs < 0 || !isFiniteNumber(bgm.fadeOutMs) || bgm.fadeOutMs < 0) {
          addIssue(issues, 'audio.bgm', 'must include non-negative fade durations');
        }
        if (!isFiniteNumber(bgm.crossfadeLoopMs) || bgm.crossfadeLoopMs < 0) {
          addIssue(issues, 'audio.bgm.crossfadeLoopMs', 'must be non-negative');
        }
        if (!isFiniteNumber(bgm.duckDb) || bgm.duckDb > -2 || bgm.duckDb < -12) {
          addIssue(issues, 'audio.bgm.duckDb', 'must be between -12dB and -2dB');
        }

        if (bgm.kind === 'generated') {
          if (!bgm.src.startsWith('audio/bgm/generated/')) {
            addIssue(issues, 'audio.bgm.src', 'generated music must be imported below public/audio/bgm/generated/');
          }
          const generated = bgm.generated;
          if (!isObject(generated)) {
            addIssue(issues, 'audio.bgm.generated', 'must include local import provenance');
          } else {
            if (generated.provider !== 'yunwu-suno') addIssue(issues, 'audio.bgm.generated.provider', 'must be yunwu-suno');
            if (typeof generated.jobId !== 'string' || !generated.jobId.trim()) addIssue(issues, 'audio.bgm.generated.jobId', 'must be non-empty');
            if (!/^[a-f0-9]{64}$/iu.test(String(generated.assetSha256 ?? ''))) addIssue(issues, 'audio.bgm.generated.assetSha256', 'must be a SHA-256 hash');
            if (typeof generated.importedAt !== 'string' || Number.isNaN(Date.parse(generated.importedAt))) addIssue(issues, 'audio.bgm.generated.importedAt', 'must be an ISO timestamp');
            if (!['provider-terms-pending', 'commercial-use-confirmed'].includes(String(generated.usageRights))) addIssue(issues, 'audio.bgm.generated.usageRights', 'must record provider-rights review state');
            if (!isObject(generated.plan) || typeof generated.plan.mood !== 'string' || typeof generated.plan.tags !== 'string' || !isFiniteNumber(generated.plan.bpm) || generated.plan.bpm < 50 || generated.plan.bpm > 180 || !['ai', 'rules'].includes(String(generated.plan.source))) {
              addIssue(issues, 'audio.bgm.generated.plan', 'must include mood, tags, 50-180 BPM and ai/rules source');
            }
          }
        } else {
          if (bgm.kind != null && bgm.kind !== 'catalog') addIssue(issues, 'audio.bgm.kind', 'must be catalog or generated');
          const track = getBgmTrack(String(bgm.trackId ?? ''));
          if (!track) addIssue(issues, 'audio.bgm.trackId', 'does not exist in the BGM catalog');
          if (track && track.file !== bgm.src) addIssue(issues, 'audio.bgm.src', 'must match the catalog track file');
          if (track?.demoOnly && !bgm.allowDemoOnly) addIssue(issues, 'audio.bgm', 'must not use a demo-only BGM track');
        }
      }
    }
  }

  if (!isObject(spec.output)) {
    addIssue(issues, 'output', 'must be an object');
  } else {
    const output = spec.output as FinalTalkingHeadSpec['output'];
    if (!['landscape-16:9', 'portrait-9:16', 'square-1:1'].includes(output.format)) addIssue(issues, 'output.format', 'is unsupported');
    if (!['h264', 'h265'].includes(output.videoCodec) || output.audioCodec !== 'aac' || output.imageFormat !== 'jpeg') {
      addIssue(issues, 'output', 'must use an approved video, audio and image format');
    }
    if (!isFiniteNumber(output.videoBitrateKbps) || !isFiniteNumber(output.audioBitrateKbps)) addIssue(issues, 'output', 'must include bitrates');
  }

  return issues;
};

export const assertFinalTalkingHeadSpec = (value: unknown): FinalTalkingHeadSpec => {
  const issues = validateFinalTalkingHeadSpec(value);
  if (issues.length > 0) {
    throw new Error(`Invalid ${FINAL_TALKING_HEAD_SCHEMA}:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`);
  }
  return value as FinalTalkingHeadSpec;
};
