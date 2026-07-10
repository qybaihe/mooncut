import type {EditBeat, EditBeatKind, SpeakerLayout} from './types.ts';

export const DEFAULT_CAMERA_POLICY = {
  mode: 'track-small-overlays-only' as const,
  trackedLayout: 'circle' as const,
  nativeReframe: 'preserve-source' as const,
  minimumLayoutHoldMs: 2500,
  transitionMs: 220,
};

export const expectedSpeakerLayout = (
  beat: Pick<EditBeat, 'kind' | 'evidenceId'> | {kind: EditBeatKind; evidenceId?: string},
): SpeakerLayout => {
  if (beat.kind === 'desktop' || beat.kind === 'quote') return 'circle';
  if (beat.kind === 'evidence' && beat.evidenceId) return 'circle';
  return 'native';
};

export type SpeakerLayoutRun = {
  layout: SpeakerLayout;
  startMs: number;
  endMs: number;
  beatIndexes: number[];
};

export const buildSpeakerLayoutRuns = (beats: readonly EditBeat[]): SpeakerLayoutRun[] => {
  const runs: SpeakerLayoutRun[] = [];
  for (const [index, beat] of beats.entries()) {
    const layout = expectedSpeakerLayout(beat);
    const previous = runs.at(-1);
    if (previous && previous.layout === layout) {
      previous.endMs = beat.endMs;
      previous.beatIndexes.push(index);
    } else {
      runs.push({layout, startMs: beat.startMs, endMs: beat.endMs, beatIndexes: [index]});
    }
  }
  return runs;
};

export const shortSpeakerLayoutRuns = (
  beats: readonly EditBeat[],
  minimumHoldMs = DEFAULT_CAMERA_POLICY.minimumLayoutHoldMs,
) => buildSpeakerLayoutRuns(beats).filter((run) =>
  run.endMs - run.startMs < Math.min(minimumHoldMs, beats.at(-1)?.endMs ?? minimumHoldMs),
);
