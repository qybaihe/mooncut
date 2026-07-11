import React from 'react';
import {Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {
  dbToVolume,
  resolveAudioVisualCues,
  type AudioVisualCue,
  type TimedBeat,
} from '../audioVisualCues';

/**
 * Render a cue plan created by a video generator. The plan is tied to visual
 * anchors (usually named beats), so moving a scene moves its sound with it.
 */
export const AudioVisualCueTrack: React.FC<{
  beats: TimedBeat[];
  cues: AudioVisualCue[];
}> = ({beats, cues}) => {
  const {fps} = useVideoConfig();
  const resolved = resolveAudioVisualCues({beats, cues, fps});

  return (
    <>
      {resolved.map((cue) => (
        <Sequence
          durationInFrames={Math.max(1, Math.ceil(cue.durationMs / 1000 * fps))}
          from={Math.max(0, Math.round(cue.playbackStartMs / 1000 * fps))}
          key={cue.id}
          name={`Cue · ${cue.presetDefinition.labelZh}`}
        >
          <Audio src={staticFile(cue.asset.src)} volume={dbToVolume(cue.gainDb)} />
        </Sequence>
      ))}
    </>
  );
};
