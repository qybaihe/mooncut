import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

/** The selected macOS-style default for talking-head and UI-led compositions. */
export const DEFAULT_MACOS_WALLPAPER = 'assets/wallpapers/macos-sonoma-default.jpg';

type MacDefaultBackgroundProps = {
  /** Lets a composition keep evidence panels readable without replacing the shared artwork. */
  shade?: number;
};

/**
 * A quiet, frame-driven Sonoma wallpaper layer.
 *
 * It deliberately has no independent timer: every render is deterministic and
 * the movement always spans the exact duration of the composition.
 */
export const MacDefaultBackground: React.FC<MacDefaultBackgroundProps> = ({shade = 0.36}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const normalizedShade = Math.min(0.86, Math.max(0.12, shade));
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(progress, [0, 1], [1.035, 1.105]);
  const translateX = interpolate(progress, [0, 1], [-18, 22]);
  const translateY = interpolate(progress, [0, 1], [10, -18]);

  return (
    <AbsoluteFill
      aria-label="Sonoma default wallpaper"
      className="macos-wallpaper"
      style={{background: '#050908', overflow: 'hidden', zIndex: 0}}
    >
      <Img
        src={staticFile(DEFAULT_MACOS_WALLPAPER)}
        style={{
          height: '100%',
          objectFit: 'cover',
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          transformOrigin: 'center',
          width: '100%',
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(118deg, rgba(3, 10, 9, ${normalizedShade + 0.12}), rgba(4, 20, 16, ${normalizedShade - 0.12}) 50%, rgba(3, 8, 9, ${normalizedShade + 0.08}))`,
        }}
      />
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse at 54% 44%, transparent 22%, rgba(1, 4, 4, 0.34) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
