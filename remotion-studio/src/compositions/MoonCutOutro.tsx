import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type MoonCutOutroFormat = 'landscape' | 'portrait' | 'square';

export const MOONCUT_OUTRO_DURATION_IN_FRAMES = 145;

const LOGO_SIZE = 1254;
const MARK_REGION = {x: 354, y: 210, size: 560};

const OfficialMoonCutMark: React.FC<{opacity: number; size: number; scale: number}> = ({
  opacity,
  size,
  scale,
}) => {
  const sourceScale = size / MARK_REGION.size;
  const sourceSize = LOGO_SIZE * sourceScale;

  return (
    <div
      style={{
        width: size,
        height: size,
        overflow: 'hidden',
        opacity,
        position: 'relative',
        transform: `scale(${scale})`,
        transformOrigin: 'center',
      }}
    >
      <Img
        src={staticFile('assets/mooncut-logo-transparent.png')}
        style={{
          height: sourceSize,
          left: -MARK_REGION.x * sourceScale,
          position: 'absolute',
          top: -MARK_REGION.y * sourceScale,
          width: sourceSize,
        }}
      />
    </div>
  );
};

/**
 * A format-adaptive MoonCut outro.
 *
 * The generated 1:1 animation remains the sharp, faithful centre layer. A dim,
 * blurred copy extends outward only when a horizontal or vertical delivery needs
 * more canvas. The real MoonCut mark then takes over in the final second.
 */
export const MoonCutOutro: React.FC<{format?: MoonCutOutroFormat}> = ({
  format = 'landscape',
}) => {
  const frame = useCurrentFrame();
  const {height, width, fps} = useVideoConfig();
  const isLandscape = format === 'landscape';
  const isPortrait = format === 'portrait';
  const coreSize = isLandscape ? height : isPortrait ? width : Math.min(width, height);
  const outroMarkSize = Math.round(coreSize * 0.47);
  const markOpacity = interpolate(frame, [108, 119], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const markScale = spring({
    frame: frame - 108,
    fps,
    config: {damping: 15, stiffness: 115, mass: 0.82},
  });
  const sourceDim = interpolate(frame, [106, 128], [1, 0.58], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const haloOpacity = interpolate(frame, [104, 120, 144], [0, 0.72, 0.4], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const orbitTurn = interpolate(frame, [0, MOONCUT_OUTRO_DURATION_IN_FRAMES], [-12, 22], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: '#06101c', overflow: 'hidden'}}>
      <OffthreadVideo
        muted
        src={staticFile('assets/mooncut-outro-square.mp4')}
        style={{
          filter: 'blur(42px) brightness(0.38) saturate(1.18)',
          height: '118%',
          left: '-9%',
          objectFit: 'cover',
          opacity: 0.86,
          position: 'absolute',
          top: '-9%',
          transform: `scale(${isPortrait ? 1.16 : 1.07})`,
          width: '118%',
        }}
        volume={0}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(43, 169, 216, 0.12), transparent 42%), linear-gradient(90deg, rgba(4, 11, 20, 0.92), rgba(4, 11, 20, 0.12) 26%, rgba(4, 11, 20, 0.12) 74%, rgba(4, 11, 20, 0.92))',
        }}
      />

      <div
        style={{
          boxShadow: '0 0 110px rgba(32, 194, 241, 0.13)',
          height: coreSize,
          left: '50%',
          overflow: 'hidden',
          position: 'absolute',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: coreSize,
        }}
      >
        <OffthreadVideo
          muted
          src={staticFile('assets/mooncut-outro-square.mp4')}
          style={{height: '100%', objectFit: 'cover', opacity: sourceDim, width: '100%'}}
          volume={0}
        />
        <AbsoluteFill
          style={{
            background:
              'radial-gradient(circle at 50% 50%, transparent 28%, rgba(3, 10, 18, 0.1) 67%, rgba(3, 10, 18, 0.54) 100%)',
          }}
        />
      </div>

      <div
        style={{
          border: '1px solid rgba(98, 231, 255, 0.35)',
          borderRadius: '50%',
          height: outroMarkSize * 1.46,
          left: '50%',
          opacity: haloOpacity,
          position: 'absolute',
          top: '50%',
          transform: `translate(-50%, -50%) rotate(${orbitTurn}deg)`,
          width: outroMarkSize * 1.46,
        }}
      />
      <div
        style={{
          background: 'radial-gradient(circle, rgba(228, 250, 255, 0.2), rgba(62, 215, 255, 0.05) 46%, transparent 70%)',
          borderRadius: '50%',
          height: outroMarkSize * 1.4,
          left: '50%',
          opacity: haloOpacity,
          position: 'absolute',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: outroMarkSize * 1.4,
        }}
      />
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          height: outroMarkSize,
          justifyContent: 'center',
          left: '50%',
          position: 'absolute',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: outroMarkSize,
        }}
      >
        <OfficialMoonCutMark opacity={markOpacity} scale={0.94 + markScale * 0.06} size={outroMarkSize} />
      </div>

      {format !== 'square' ? (
        <>
          <div
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(95, 231, 255, 0.24), transparent)',
              bottom: isLandscape ? 48 : 80,
              height: 1,
              left: isLandscape ? 72 : 34,
              opacity: 0.58,
              position: 'absolute',
              right: isLandscape ? 72 : 34,
            }}
          />
          <div
            style={{
              color: 'rgba(224, 246, 255, 0.58)',
              fontFamily: 'Arial, PingFang SC, sans-serif',
              fontSize: isLandscape ? 20 : 18,
              fontWeight: 650,
              left: '50%',
              letterSpacing: 3,
              opacity: interpolate(frame, [116, 133], [0, 0.7], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
              position: 'absolute',
              textTransform: 'uppercase',
              top: isLandscape ? height - 36 : height - 62,
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
            }}
          >
            Speak naturally. Ship confidently.
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};
