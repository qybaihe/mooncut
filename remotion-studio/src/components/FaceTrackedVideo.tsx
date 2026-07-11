import React, {useMemo} from 'react';
import {OffthreadVideo} from 'remotion';
import {
  interpolateFaceTrack as interpolateFaceTrackStable,
  resolveFaceCrop as resolveFaceCropStable,
  resolveFaceCropMotion,
  type FaceCropMotionConfig,
  type FaceFramingProfile,
  type FaceTrackSample,
} from './faceCropMotion';
export type {
  FaceCropMotionConfig,
  FaceFramingProfile,
  FaceTrackSample,
  InterpolatedFaceSample,
  NormalizedCrop,
  NormalizedPoint,
  NormalizedSize,
} from './faceCropMotion';

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

export type FaceTrackedVideoProps = {
  src: string;
  faceTrack: FaceTrackManifest | null;
  sourceTimeMs: number;
  framing: FaceFramingProfile;
  /** Used only when the manifest does not contain source dimensions. */
  sourceAspectRatio?: number;
  /** Milliseconds since this tracked shot became visible. Enables the built-in camera move. */
  trackingElapsedMs?: number;
  /** Optional engineering override; production callers should normally use the safe defaults. */
  motion?: Partial<FaceCropMotionConfig>;
  /**
   * Source-media frame offset for a trimmed clip. Keep this aligned with sourceTimeMs;
   * arbitrary jump cuts should render one FaceTrackedVideo per source segment.
   */
  trimBefore?: number;
  className?: string;
  style?: React.CSSProperties;
  volume?: number;
};

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

/** Public compatibility exports now use the same stable motion primitives as the renderer. */
export const interpolateFaceTrack = interpolateFaceTrackStable;

/**
 * Convert a normalized face box into a normalized source crop. Source pixels are accounted for,
 * so the same tracking file works for landscape, portrait, rectangular, and circular targets.
 */
export const resolveFaceCrop = resolveFaceCropStable;

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
  motion,
  sourceAspectRatio,
  sourceTimeMs,
  src,
  style,
  trackingElapsedMs,
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
  const resolvedSourceAspect =
    sourceAspectFromManifest(validatedTrack) ??
    (sourceAspectRatio && sourceAspectRatio > 0 ? sourceAspectRatio : framing.aspectRatio);
  const crop = resolveFaceCropMotion({
    framing,
    motion,
    samples,
    sourceAspectRatio: resolvedSourceAspect,
    sourceTimeMs,
    trackingElapsedMs: trackingElapsedMs ?? (
      framing.shape === 'circle'
        ? Math.max(0, sourceTimeMs - (samples[0]?.t_ms ?? 0))
        : undefined
    ),
  });
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
