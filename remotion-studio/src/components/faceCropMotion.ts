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

export type FaceCropMotionConfig = {
  /** Time used to move from the neutral source crop into the tracked crop. */
  recenterDurationMs: number;
  /** Symmetric offline smoothing window. It removes jumps without adding one-sided lag. */
  smoothingWindowMs: number;
  /** Number of target crops sampled inside the smoothing window. */
  smoothingSamples: number;
};

export const DEFAULT_FACE_CROP_MOTION: FaceCropMotionConfig = {
  recenterDurationMs: 650,
  smoothingWindowMs: 720,
  smoothingSamples: 13,
};

const EPSILON = 1e-6;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

const lerp = (from: number, to: number, progress: number) =>
  from + (to - from) * progress;

/** Smooth at both ends so crop velocity never starts or stops abruptly. */
export const smootherstep = (value: number) => {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const interpolateBox = (
  before: FaceTrackSample['raw_bbox_norm'],
  after: FaceTrackSample['raw_bbox_norm'],
  progress: number,
) => {
  if (!before) return after;
  if (!after) return before;
  return before.map((value, index) => lerp(value, after[index], progress)) as
    [number, number, number, number];
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
    raw_bbox_norm: interpolateBox(before.raw_bbox_norm, after.raw_bbox_norm, progress),
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

export const centeredCoverCrop = (
  sourceAspectRatio: number,
  targetAspectRatio: number,
): NormalizedCrop => {
  const cropHeight = Math.min(1, sourceAspectRatio / targetAspectRatio);
  const cropWidth = (targetAspectRatio * cropHeight) / sourceAspectRatio;
  return {
    left: (1 - cropWidth) / 2,
    top: (1 - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
};

const edgePaddingWeight = ({
  clearance,
  clipped,
  cropSize,
  faceSize,
}: {
  clearance: number;
  clipped: boolean | undefined;
  cropSize: number;
  faceSize: number;
}) => {
  if (clipped) return 0;
  const seamGuard = Math.max(cropSize * 0.03, faceSize * 0.15);
  const releaseBand = Math.max(cropSize * 0.025, faceSize * 0.1, 0.006);
  return smootherstep((clearance - seamGuard) / releaseBand);
};

/**
 * Convert a face observation into an aspect-correct crop. Edge padding uses a
 * continuous safety weight, so approaching the clamp boundary cannot snap the
 * crop between two distant positions.
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
  const clampedLeft = clamp(rawLeft, 0, 1 - cropWidth);
  const clampedTop = clamp(rawTop, 0, 1 - cropHeight);

  if (framing.edgeMode !== 'pad') {
    return {left: clampedLeft, top: clampedTop, width: cropWidth, height: cropHeight};
  }

  const rawBox = face.raw_bbox_norm;
  const safetyLeft = rawBox ? finiteOr(rawBox[0], centerX - faceWidth / 2) : centerX - faceWidth / 2;
  const safetyTop = rawBox ? finiteOr(rawBox[1], centerY - faceHeight / 2) : centerY - faceHeight / 2;
  const safetyRight = rawBox ? finiteOr(rawBox[2], centerX + faceWidth / 2) : centerX + faceWidth / 2;
  const safetyBottom = rawBox ? finiteOr(rawBox[3], centerY + faceHeight / 2) : centerY + faceHeight / 2;
  const safetyWidth = Math.max(EPSILON, safetyRight - safetyLeft);
  const safetyHeight = Math.max(EPSILON, safetyBottom - safetyTop);

  let horizontalPaddingWeight = 1;
  if (rawLeft < 0) {
    horizontalPaddingWeight = edgePaddingWeight({
      clearance: safetyLeft,
      clipped: face.source_clipped?.left,
      cropSize: cropWidth,
      faceSize: safetyWidth,
    });
  } else if (rawLeft + cropWidth > 1) {
    horizontalPaddingWeight = edgePaddingWeight({
      clearance: 1 - safetyRight,
      clipped: face.source_clipped?.right,
      cropSize: cropWidth,
      faceSize: safetyWidth,
    });
  }

  let verticalPaddingWeight = 1;
  if (rawTop < 0) {
    verticalPaddingWeight = edgePaddingWeight({
      clearance: safetyTop,
      clipped: face.source_clipped?.top,
      cropSize: cropHeight,
      faceSize: safetyHeight,
    });
  } else if (rawTop + cropHeight > 1) {
    verticalPaddingWeight = edgePaddingWeight({
      clearance: 1 - safetyBottom,
      clipped: face.source_clipped?.bottom,
      cropSize: cropHeight,
      faceSize: safetyHeight,
    });
  }

  return {
    left: lerp(clampedLeft, rawLeft, horizontalPaddingWeight),
    top: lerp(clampedTop, rawTop, verticalPaddingWeight),
    width: cropWidth,
    height: cropHeight,
  };
};

const averageCrops = (items: Array<{crop: NormalizedCrop; weight: number}>): NormalizedCrop => {
  const total = items.reduce((sum, item) => sum + item.weight, 0) || 1;
  const centerX = items.reduce((sum, item) => sum + (item.crop.left + item.crop.width / 2) * item.weight, 0) / total;
  const centerY = items.reduce((sum, item) => sum + (item.crop.top + item.crop.height / 2) * item.weight, 0) / total;
  const width = Math.exp(items.reduce((sum, item) => sum + Math.log(Math.max(EPSILON, item.crop.width)) * item.weight, 0) / total);
  const height = Math.exp(items.reduce((sum, item) => sum + Math.log(Math.max(EPSILON, item.crop.height)) * item.weight, 0) / total);
  return {left: centerX - width / 2, top: centerY - height / 2, width, height};
};

export const interpolateCrop = (
  from: NormalizedCrop,
  to: NormalizedCrop,
  progress: number,
): NormalizedCrop => {
  const eased = smootherstep(progress);
  const fromCenterX = from.left + from.width / 2;
  const fromCenterY = from.top + from.height / 2;
  const toCenterX = to.left + to.width / 2;
  const toCenterY = to.top + to.height / 2;
  const width = Math.exp(lerp(Math.log(Math.max(EPSILON, from.width)), Math.log(Math.max(EPSILON, to.width)), eased));
  const height = Math.exp(lerp(Math.log(Math.max(EPSILON, from.height)), Math.log(Math.max(EPSILON, to.height)), eased));
  const centerX = lerp(fromCenterX, toCenterX, eased);
  const centerY = lerp(fromCenterY, toCenterY, eased);
  return {left: centerX - width / 2, top: centerY - height / 2, width, height};
};

/**
 * Resolve the final deterministic camera crop. This is the single entry point
 * renderers should use: it smooths tracker discontinuities and performs the
 * neutral-to-face camera move when a tracked circle becomes active.
 */
export const resolveFaceCropMotion = ({
  framing,
  motion = {},
  samples,
  sourceAspectRatio,
  sourceTimeMs,
  trackingElapsedMs,
}: {
  framing: FaceFramingProfile;
  motion?: Partial<FaceCropMotionConfig>;
  samples: readonly FaceTrackSample[];
  sourceAspectRatio: number;
  sourceTimeMs: number;
  trackingElapsedMs?: number;
}): NormalizedCrop => {
  const config = {...DEFAULT_FACE_CROP_MOTION, ...motion};
  const count = Math.max(1, Math.round(config.smoothingSamples));
  const halfWindow = Math.max(0, config.smoothingWindowMs) / 2;
  const resolved: Array<{crop: NormalizedCrop; weight: number}> = [];

  for (let index = 0; index < count; index += 1) {
    const fraction = count === 1 ? 0.5 : index / (count - 1);
    const offset = lerp(-halfWindow, halfWindow, fraction);
    const distance = Math.abs(fraction - 0.5) * 2;
    const weight = 1 + (1 - distance) * 3;
    const face = interpolateFaceTrack(samples, sourceTimeMs + offset);
    resolved.push({crop: resolveFaceCrop({face, framing, sourceAspectRatio}), weight});
  }

  const trackedCrop = averageCrops(resolved);
  if (trackingElapsedMs === undefined) return trackedCrop;
  const neutralCrop = centeredCoverCrop(sourceAspectRatio, framing.aspectRatio);
  return interpolateCrop(
    neutralCrop,
    trackedCrop,
    Math.max(0, trackingElapsedMs) / Math.max(1, config.recenterDurationMs),
  );
};
