import React, {useMemo} from 'react';
import {OffthreadVideo} from 'remotion';

export type NormalizedPoint = readonly [x: number, y: number];
export type NormalizedSize = readonly [width: number, height: number];

export type FaceTrackSample = {
  t_ms: number;
  center_norm: NormalizedPoint;
  face_size_norm: NormalizedSize;
  track_id?: number;
  confidence?: number;
  state?: 'detected' | 'interpolated' | 'held' | 'fallback';
  raw_bbox_norm?: readonly [left: number, top: number, right: number, bottom: number] | null;
  source_clipped?: {left: boolean; top: boolean; right: boolean; bottom: boolean};
};

export type FaceTrackSource = {
  width: number;
  height: number;
  display_width?: number;
  display_height?: number;
  duration_ms?: number;
  fps?: number;
  file_size?: number;
  sha256?: string;
};

export type FaceTrackManifest = {
  schema_version: 'mooncut.face-track.v1';
  source?: FaceTrackSource;
  primary_track_id?: number | null;
  samples: FaceTrackSample[];
};

export type FaceFramingProfile = {
  /** Width / height of the visible crop. Keep this equal to the rendered container. */
  aspectRatio: number;
  /** Face diameter as a fraction of the crop's shortest edge. */
  faceFill: number;
  /** Desired face position inside the crop, in normalized output coordinates. */
  anchor: NormalizedPoint;
  shape: 'rect' | 'circle';
  /** Safety limit for noisy or unusually small detections. */
  maxZoom?: number;
  /** Keep an edge face centered and reveal the container background outside source bounds. */
  edgeMode?: 'clamp' | 'pad';
};

export type InterpolatedFaceSample = {
  center_norm: NormalizedPoint;
  face_size_norm: NormalizedSize;
  raw_bbox_norm?: readonly [left: number, top: number, right: number, bottom: number] | null;
  source_clipped?: {left: boolean; top: boolean; right: boolean; bottom: boolean};
};

export type NormalizedCrop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type FaceTrackedVideoProps = {
  src: string;
  faceTrack: FaceTrackManifest | null;
  sourceTimeMs: number;
  framing: FaceFramingProfile;
  /** Used only when the manifest does not contain source dimensions. */
  sourceAspectRatio?: number;
  /**
   * Source-media frame offset for a trimmed clip. Keep this aligned with sourceTimeMs;
   * arbitrary jump cuts should render one FaceTrackedVideo per source segment.
   */
  trimBefore?: number;
  className?: string;
  style?: React.CSSProperties;
  volume?: number;
};

const EPSILON = 1e-6;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

const lerp = (from: number, to: number, progress: number) =>
  from + (to - from) * progress;

const isUsableSample = (value: unknown): value is FaceTrackSample => {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Partial<FaceTrackSample>;
  return Number.isFinite(sample.t_ms) &&
    Array.isArray(sample.center_norm) &&
    Array.isArray(sample.face_size_norm) &&
    sample.center_norm.length === 2 &&
    sample.face_size_norm.length === 2 &&
    sample.center_norm.every(Number.isFinite) &&
    sample.face_size_norm.every(Number.isFinite) &&
    sample.face_size_norm[0] > 0 &&
    sample.face_size_norm[1] > 0;
};

const interpolateSamples = (
  before: FaceTrackSample,
  after: FaceTrackSample,
  sourceTimeMs: number,
): InterpolatedFaceSample => {
  const duration = after.t_ms - before.t_ms;
  const progress = duration <= 0 ? 0 : clamp((sourceTimeMs - before.t_ms) / duration, 0, 1);

  return {
    center_norm: [
      lerp(before.center_norm[0], after.center_norm[0], progress),
      lerp(before.center_norm[1], after.center_norm[1], progress),
    ],
    face_size_norm: [
      lerp(before.face_size_norm[0], after.face_size_norm[0], progress),
      lerp(before.face_size_norm[1], after.face_size_norm[1], progress),
    ],
    raw_bbox_norm: progress < 0.5 ? before.raw_bbox_norm : after.raw_bbox_norm,
    source_clipped: {
      left: Boolean(before.source_clipped?.left || after.source_clipped?.left),
      top: Boolean(before.source_clipped?.top || after.source_clipped?.top),
      right: Boolean(before.source_clipped?.right || after.source_clipped?.right),
      bottom: Boolean(before.source_clipped?.bottom || after.source_clipped?.bottom),
    },
  };
};

/** Resolve a face sample at a source-video timestamp. The ends are held outside the sampled range. */
export const interpolateFaceTrack = (
  samples: readonly FaceTrackSample[],
  sourceTimeMs: number,
): InterpolatedFaceSample | null => {
  if (samples.length === 0) return null;
  if (samples.length === 1 || sourceTimeMs <= samples[0].t_ms) {
    return {
      center_norm: samples[0].center_norm,
      face_size_norm: samples[0].face_size_norm,
      raw_bbox_norm: samples[0].raw_bbox_norm,
      source_clipped: samples[0].source_clipped,
    };
  }

  const last = samples[samples.length - 1];
  if (sourceTimeMs >= last.t_ms) {
    return {
      center_norm: last.center_norm,
      face_size_norm: last.face_size_norm,
      raw_bbox_norm: last.raw_bbox_norm,
      source_clipped: last.source_clipped,
    };
  }

  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t_ms <= sourceTimeMs) low = middle;
    else high = middle;
  }

  return interpolateSamples(samples[low], samples[high], sourceTimeMs);
};

const centeredCoverCrop = (sourceAspectRatio: number, targetAspectRatio: number): NormalizedCrop => {
  const cropHeight = Math.min(1, sourceAspectRatio / targetAspectRatio);
  const cropWidth = (targetAspectRatio * cropHeight) / sourceAspectRatio;
  return {
    left: (1 - cropWidth) / 2,
    top: (1 - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
};

/**
 * Convert a normalized face box into a normalized source crop. Source pixels are accounted for,
 * so the same tracking file works for landscape, portrait, rectangular, and circular targets.
 */
export const resolveFaceCrop = ({
  face,
  framing,
  sourceAspectRatio,
}: {
  face: InterpolatedFaceSample | null;
  framing: FaceFramingProfile;
  sourceAspectRatio: number;
}): NormalizedCrop => {
  const sourceAspect = Math.max(EPSILON, finiteOr(sourceAspectRatio, 1));
  const targetAspect = Math.max(EPSILON, finiteOr(framing.aspectRatio, 1));
  const maximumCropHeight = Math.min(1, sourceAspect / targetAspect);

  if (!face) return centeredCoverCrop(sourceAspect, targetAspect);

  const centerX = clamp(finiteOr(face.center_norm[0], 0.5), 0, 1);
  const centerY = clamp(finiteOr(face.center_norm[1], 0.5), 0, 1);
  const faceWidth = clamp(finiteOr(face.face_size_norm[0], 0), EPSILON, 1);
  const faceHeight = clamp(finiteOr(face.face_size_norm[1], 0), EPSILON, 1);
  const faceDiameterInSourceHeight = Math.max(faceWidth * sourceAspect, faceHeight);
  const faceFill = clamp(finiteOr(framing.faceFill, 0.55), 0.05, 1);
  const shortestTargetEdge = Math.min(targetAspect, 1);
  const maximumZoom = Math.max(1, finiteOr(framing.maxZoom ?? 6, 6));
  const minimumCropHeight = maximumCropHeight / maximumZoom;
  const cropHeight = clamp(
    faceDiameterInSourceHeight / (faceFill * shortestTargetEdge),
    minimumCropHeight,
    maximumCropHeight,
  );
  const cropWidth = (targetAspect * cropHeight) / sourceAspect;
  const anchorX = clamp(finiteOr(framing.anchor[0], 0.5), 0, 1);
  const anchorY = clamp(finiteOr(framing.anchor[1], 0.5), 0, 1);

  const rawLeft = centerX - anchorX * cropWidth;
  const rawTop = centerY - anchorY * cropHeight;
  const rawBox = face.raw_bbox_norm;
  const safetyLeft = rawBox ? finiteOr(rawBox[0], centerX - faceWidth / 2) : centerX - faceWidth / 2;
  const safetyTop = rawBox ? finiteOr(rawBox[1], centerY - faceHeight / 2) : centerY - faceHeight / 2;
  const safetyRight = rawBox ? finiteOr(rawBox[2], centerX + faceWidth / 2) : centerX + faceWidth / 2;
  const safetyBottom = rawBox ? finiteOr(rawBox[3], centerY + faceHeight / 2) : centerY + faceHeight / 2;
  const safetyWidth = Math.max(EPSILON, safetyRight - safetyLeft);
  const safetyHeight = Math.max(EPSILON, safetyBottom - safetyTop);
  const seamGuardX = Math.max(cropWidth * 0.03, safetyWidth * 0.15);
  const seamGuardY = Math.max(cropHeight * 0.03, safetyHeight * 0.15);
  const paddingWouldCrossFaceX =
    (rawLeft < 0 && (face.source_clipped?.left || safetyLeft <= seamGuardX)) ||
    (rawLeft + cropWidth > 1 && (face.source_clipped?.right || 1 - safetyRight <= seamGuardX));
  const paddingWouldCrossFaceY =
    (rawTop < 0 && (face.source_clipped?.top || safetyTop <= seamGuardY)) ||
    (rawTop + cropHeight > 1 && (face.source_clipped?.bottom || 1 - safetyBottom <= seamGuardY));

  return {
    left:
      framing.edgeMode === 'pad' && !paddingWouldCrossFaceX
        ? rawLeft
        : clamp(rawLeft, 0, 1 - cropWidth),
    top:
      framing.edgeMode === 'pad' && !paddingWouldCrossFaceY
        ? rawTop
        : clamp(rawTop, 0, 1 - cropHeight),
    width: cropWidth,
    height: cropHeight,
  };
};

export const assertFaceTrackManifest = (value: unknown): FaceTrackManifest => {
  if (!value || typeof value !== 'object') throw new Error('Face track must be an object');
  const candidate = value as Partial<FaceTrackManifest>;
  if (candidate.schema_version !== 'mooncut.face-track.v1') {
    throw new Error(`Unsupported face-track schema: ${String(candidate.schema_version)}`);
  }
  if (!Array.isArray(candidate.samples)) throw new Error('Face track samples must be an array');
  let previousTime = -Infinity;
  for (const sample of candidate.samples) {
    if (!isUsableSample(sample)) throw new Error('Face track contains an invalid sample');
    if (sample.t_ms < previousTime) throw new Error('Face track timestamps must be monotonic');
    previousTime = sample.t_ms;
  }
  if (candidate.source) {
    const width = candidate.source.display_width ?? candidate.source.width;
    const height = candidate.source.display_height ?? candidate.source.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('Face track source dimensions are invalid');
    }
  }
  return candidate as FaceTrackManifest;
};

const sourceAspectFromManifest = (manifest: FaceTrackManifest | null) => {
  const source = manifest?.source;
  if (!source) return null;
  const width = source.display_width ?? source.width;
  const height = source.display_height ?? source.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
};

export const FaceTrackedVideo: React.FC<FaceTrackedVideoProps> = ({
  className,
  faceTrack,
  framing,
  sourceAspectRatio,
  sourceTimeMs,
  src,
  style,
  trimBefore = 0,
  volume = 1,
}) => {
  const validatedTrack = useMemo(() => {
    return faceTrack ? assertFaceTrackManifest(faceTrack) : null;
  }, [faceTrack]);
  const samples = useMemo(
    () => validatedTrack?.samples.slice().sort((a, b) => a.t_ms - b.t_ms) ?? [],
    [validatedTrack],
  );
  const face = interpolateFaceTrack(samples, sourceTimeMs);
  const resolvedSourceAspect =
    sourceAspectFromManifest(validatedTrack) ??
    (sourceAspectRatio && sourceAspectRatio > 0 ? sourceAspectRatio : framing.aspectRatio);
  const crop = resolveFaceCrop({face, framing, sourceAspectRatio: resolvedSourceAspect});
  const padLeft = crop.left < 0;
  const padRight = crop.left + crop.width > 1;
  const padTop = crop.top < 0;
  const padBottom = crop.top + crop.height > 1;
  const horizontalMask = padLeft && padRight
    ? 'linear-gradient(to right, transparent 0%, #000 3%, #000 97%, transparent 100%)'
    : padLeft
      ? 'linear-gradient(to right, transparent 0%, #000 3%, #000 100%)'
      : padRight
        ? 'linear-gradient(to right, #000 0%, #000 97%, transparent 100%)'
        : 'linear-gradient(#000, #000)';
  const verticalMask = padTop && padBottom
    ? 'linear-gradient(to bottom, transparent 0%, #000 3%, #000 97%, transparent 100%)'
    : padTop
      ? 'linear-gradient(to bottom, transparent 0%, #000 3%, #000 100%)'
      : padBottom
        ? 'linear-gradient(to bottom, #000 0%, #000 97%, transparent 100%)'
        : 'linear-gradient(#000, #000)';
  const maskImage = `${horizontalMask}, ${verticalMask}`;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        aspectRatio: framing.aspectRatio,
        overflow: 'hidden',
        backgroundColor: '#050706',
        ...style,
        borderRadius: framing.shape === 'circle' ? '50%' : style?.borderRadius,
        clipPath: framing.shape === 'circle' ? 'circle(50% at 50% 50%)' : style?.clipPath,
      }}
    >
      {framing.edgeMode === 'pad' ? (
        <OffthreadVideo
          src={src}
          trimBefore={trimBefore}
          volume={0}
          style={{
            position: 'absolute',
            inset: '-8%',
            width: '116%',
            height: '116%',
            objectFit: 'cover',
            filter: 'blur(22px) brightness(.86)',
          }}
        />
      ) : null}
      <OffthreadVideo
        src={src}
        trimBefore={trimBefore}
        volume={volume}
        style={{
          position: 'absolute',
          width: `${100 / crop.width}%`,
          height: `${100 / crop.height}%`,
          left: `${(-crop.left / crop.width) * 100}%`,
          top: `${(-crop.top / crop.height) * 100}%`,
          maxWidth: 'none',
          maxHeight: 'none',
          WebkitMaskImage: maskImage,
          WebkitMaskComposite: 'source-in',
          maskImage,
          maskComposite: 'intersect',
        }}
      />
    </div>
  );
};
