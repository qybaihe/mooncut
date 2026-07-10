export const ARGENTINA_EGYPT_FPS = 30;
export const CROSSFADE_FRAMES = 3;

export type EditClip = {
  index: number;
  sourceStartMs: number;
  sourceEndMs: number;
  trimStartFrame: number;
  sourceStartFrame: number;
  sourceEndFrame: number;
  durationInFrames: number;
  outputStartFrame: number;
  outputContentStartFrame: number;
  outputEndFrame: number;
};

// Word-safe edit ranges. The removed spans contain the opening silence, long pauses,
// consecutive fillers/restarts, the "一一" stutter, and the unfinished final "然后".
const SOURCE_RANGES_FRAMES: ReadonlyArray<readonly [number, number]> = [
  [42, 85],
  [97, 361],
  [372, 408],
  [437, 538],
  [557, 649],
  [658, 701],
  [717, 832],
  [841, 1058],
  [1087, 1858],
  [1869, 1897],
  [1914, 1935],
  [1944, 2137],
  [2161, 2246],
  [2269, 2416],
  [2451, 3002],
  [3016, 3221],
];

const msToFrame = (ms: number) => Math.round((ms / 1000) * ARGENTINA_EGYPT_FPS);
const frameToMs = (frame: number) => (frame / ARGENTINA_EGYPT_FPS) * 1000;

export const argentinaEgyptEditClips: EditClip[] = SOURCE_RANGES_FRAMES.reduce<EditClip[]>(
  (clips, [sourceStartFrame, sourceEndFrame], index) => {
    const sourceStartMs = frameToMs(sourceStartFrame);
    const sourceEndMs = frameToMs(sourceEndFrame);
    const trimStartFrame = index === 0
      ? sourceStartFrame
      : sourceStartFrame - CROSSFADE_FRAMES;
    const durationInFrames = sourceEndFrame - trimStartFrame;
    const contentDurationInFrames = sourceEndFrame - sourceStartFrame;
    const previous = clips[clips.length - 1];
    const outputContentStartFrame = previous ? previous.outputEndFrame : 0;
    const outputStartFrame = index === 0
      ? outputContentStartFrame
      : outputContentStartFrame - CROSSFADE_FRAMES;

    clips.push({
      index,
      sourceStartMs,
      sourceEndMs,
      trimStartFrame,
      sourceStartFrame,
      sourceEndFrame,
      durationInFrames,
      outputStartFrame,
      outputContentStartFrame,
      outputEndFrame: outputContentStartFrame + contentDurationInFrames,
    });
    return clips;
  },
  [],
);

export const ARGENTINA_EGYPT_DURATION_IN_FRAMES =
  argentinaEgyptEditClips[argentinaEgyptEditClips.length - 1].outputEndFrame;

export const getEditClipAtOutputFrame = (frame: number): EditClip => {
  // Crossfades use pre-roll from a removed span; captions stay on the outgoing
  // clip until the incoming clip reaches its first kept frame.
  const clip = argentinaEgyptEditClips.find(
    (item) => frame >= item.outputContentStartFrame && frame < item.outputEndFrame,
  );
  return clip ?? argentinaEgyptEditClips[argentinaEgyptEditClips.length - 1];
};

export const outputFrameToSourceMs = (frame: number): number => {
  const clip = getEditClipAtOutputFrame(frame);
  const localFrame = Math.max(
    0,
    Math.min(clip.sourceEndFrame - clip.sourceStartFrame - 1, frame - clip.outputContentStartFrame),
  );
  return ((clip.sourceStartFrame + localFrame) / ARGENTINA_EGYPT_FPS) * 1000;
};

export const sourceMsToOutputFrame = (sourceMs: number): number => {
  const clip = argentinaEgyptEditClips.find(
    (item) => sourceMs >= item.sourceStartMs && sourceMs < item.sourceEndMs,
  );
  if (!clip) {
    throw new Error(`Source time ${sourceMs}ms is outside the edit decision list`);
  }
  return clip.outputContentStartFrame + msToFrame(sourceMs - clip.sourceStartMs);
};

export const isSourceMsKept = (sourceMs: number): boolean =>
  argentinaEgyptEditClips.some(
    (clip) => sourceMs >= clip.sourceStartMs && sourceMs < clip.sourceEndMs,
  );
