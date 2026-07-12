import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  FaceTrackedVideo,
  type FaceTrackManifest,
} from '../components/FaceTrackedVideo';

type SubtitleSegment = {
  text: string;
  start_ms: number;
  end_ms: number;
};

export const MOONCUT_EPIC_FPS = 30;
export const MOONCUT_EPIC_LECTURE_FRAMES = 88 * MOONCUT_EPIC_FPS;
export const MOONCUT_EPIC_APPEND_FRAMES = Math.round(83.1 * MOONCUT_EPIC_FPS);
export const MOONCUT_EPIC_DURATION_IN_FRAMES =
  MOONCUT_EPIC_LECTURE_FRAMES + MOONCUT_EPIC_APPEND_FRAMES;

const SCREEN_START_FRAME = 2 * MOONCUT_EPIC_FPS;
const XHS_PREVIEW_START_FRAME = Math.round(67.9 * MOONCUT_EPIC_FPS);
const XHS_PREVIEW_END_FRAME = Math.round(75.45 * MOONCUT_EPIC_FPS);

const TALKING_HEAD_SRC = 'mooncut-epic/talking-head-sdr.mp4';
const SCREEN_SRC = 'mooncut-epic/screen-demo.mp4';
const XHS_DEMO_SRC = 'mooncut-epic/xhs-football-demo.mp4';
const FINAL_DEMO_SRC = 'mooncut-epic/final-demo.mp4';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const normalizeSubtitle = (text: string) =>
  text
    .replace(/\n/g, '')
    .replace(/各位探月巨神智能社区/g, '各位探月具身智能社区')
    .replace(/MoenC\s*hat/g, 'MoonCut')
    .replace(/MoenCut/g, 'MoonCut')
    .replace(/moencut\.com/gi, 'mooncut.me')
    .replace(/GLM点二/g, 'GLM-5.2')
    .replace(/派agent/gi, 'Pi Agent')
    .replace(/FIFA的材\s*料/g, 'FIFA 的材料')
    .replace(/它会他会/g, '它会')
    .replace(/，然后。/g, '。');

const chapterAt = (screenTimeMs: number) => {
  if (screenTimeMs < 27_120) return '01 · 官网与案例';
  if (screenTimeMs < 47_754) return '02 · 创作工作台';
  if (screenTimeMs < 75_874) return '03 · 社区能力';
  return '04 · 邮件交付';
};

const Caption: React.FC<{
  segment: SubtitleSegment | null;
  previewMode: boolean;
}> = ({previewMode, segment}) => {
  if (!segment) return null;
  const text = normalizeSubtitle(segment.text);

  return (
    <div
      style={{
        alignItems: 'center',
        bottom: previewMode ? 116 : 42,
        display: 'flex',
        justifyContent: previewMode ? 'flex-start' : 'center',
        left: previewMode ? 94 : 260,
        position: 'absolute',
        right: previewMode ? 1050 : 260,
        zIndex: 60,
      }}
    >
      <div
        style={{
          background: 'rgba(3, 9, 17, 0.88)',
          border: '1px solid rgba(255,255,255,.14)',
          borderRadius: 18,
          boxShadow: '0 12px 32px rgba(0,0,0,.28)',
          color: '#fff',
          fontFamily: 'PingFang SC, Noto Sans CJK SC, sans-serif',
          fontSize: previewMode ? 37 : 42,
          fontWeight: 720,
          letterSpacing: -0.7,
          lineHeight: 1.34,
          maxWidth: previewMode ? 790 : 1240,
          padding: previewMode ? '15px 22px' : '14px 26px',
          textAlign: previewMode ? 'left' : 'center',
        }}
      >
        {text}
      </div>
    </div>
  );
};

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const titleOpacity = interpolate(frame, [4, 15, 48, 58], [0, 1, 1, 0], clamp);
  const titleY = interpolate(frame, [4, 18], [24, 0], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{backgroundColor: '#05080d'}}>
      <OffthreadVideo
        src={staticFile(TALKING_HEAD_SRC)}
        volume={1}
        style={{height: '100%', objectFit: 'cover', width: '100%'}}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(90deg, rgba(3,7,12,.82) 0%, rgba(3,7,12,.34) 42%, rgba(3,7,12,0) 72%)',
        }}
      />
      <div
        style={{
          left: 72,
          opacity: titleOpacity,
          position: 'absolute',
          top: 92,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <div
          style={{
            color: '#69e6ff',
            fontFamily: 'Inter, PingFang SC, sans-serif',
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 4.5,
            marginBottom: 18,
          }}
        >
          MOONCUT · PRODUCT DEMO
        </div>
        <div
          style={{
            color: '#fff',
            fontFamily: 'PingFang SC, Noto Sans CJK SC, sans-serif',
            fontSize: 64,
            fontWeight: 820,
            letterSpacing: -2.8,
            lineHeight: 1.08,
            maxWidth: 680,
          }}
        >
          把素口播，
          <br />
          变成能发布的成片。
        </div>
      </div>
    </AbsoluteFill>
  );
};

const XhsResultPreview: React.FC = () => {
  const localFrame = useCurrentFrame();
  const enter = interpolate(localFrame, [0, 18], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#07111c',
        opacity: enter,
        zIndex: 35,
      }}
    >
      <div
        style={{
          left: 96,
          position: 'absolute',
          top: 102,
          transform: `translateX(${interpolate(enter, [0, 1], [-24, 0])}px)`,
          width: 780,
        }}
      >
        <div
          style={{
            color: '#8eefff',
            fontFamily: 'Inter, PingFang SC, sans-serif',
            fontSize: 20,
            fontWeight: 850,
            letterSpacing: 4.2,
            marginBottom: 25,
          }}
        >
          ONE-CLICK RESULT
        </div>
        <div
          style={{
            color: '#fff',
            fontFamily: 'PingFang SC, Noto Sans CJK SC, sans-serif',
            fontSize: 67,
            fontWeight: 850,
            letterSpacing: -3,
            lineHeight: 1.05,
          }}
        >
          一键剪辑生成，
          <br />
          已发布到小红书。
        </div>
        <div
          style={{
            color: '#aab9c8',
            fontFamily: 'PingFang SC, sans-serif',
            fontSize: 25,
            lineHeight: 1.65,
            marginTop: 34,
          }}
        >
          真实赛事素材检索 · 字幕与镜头自动编排
          <br />
          社区技能包为 Agent 提供可复用能力
        </div>
      </div>
      <div
        style={{
          backgroundColor: '#000',
          border: '1px solid rgba(255,255,255,.18)',
          borderRadius: 24,
          boxShadow: '0 30px 72px rgba(0,0,0,.42)',
          height: 944,
          left: 1062,
          overflow: 'hidden',
          position: 'absolute',
          top: 68,
          transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`,
          width: 531,
        }}
      >
        <OffthreadVideo
          src={staticFile(XHS_DEMO_SRC)}
          trimBefore={0}
          volume={0}
          style={{height: '100%', objectFit: 'cover', width: '100%'}}
        />
      </div>
    </AbsoluteFill>
  );
};

const Lecture: React.FC<{
  faceTrack: FaceTrackManifest;
  subtitles: SubtitleSegment[];
}> = ({faceTrack, subtitles}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const screenTimeMs = Math.max(0, ((frame - SCREEN_START_FRAME) / fps) * 1000);
  const segment =
    subtitles.find(
      (candidate) =>
        screenTimeMs >= candidate.start_ms && screenTimeMs < candidate.end_ms,
    ) ?? null;
  const previewMode = frame >= XHS_PREVIEW_START_FRAME && frame < XHS_PREVIEW_END_FRAME;
  const screenEnter = interpolate(frame, [SCREEN_START_FRAME, SCREEN_START_FRAME + 18], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const pipEnter = interpolate(frame, [SCREEN_START_FRAME + 2, SCREEN_START_FRAME + 20], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.back(1.15)),
  });

  return (
    <AbsoluteFill style={{backgroundColor: '#05080d'}}>
      <Sequence from={0} durationInFrames={SCREEN_START_FRAME}>
        <Intro />
      </Sequence>

      <Sequence
        from={SCREEN_START_FRAME}
        durationInFrames={MOONCUT_EPIC_LECTURE_FRAMES - SCREEN_START_FRAME}
      >
        <AbsoluteFill
          style={{
            backgroundColor: '#05080d',
            opacity: screenEnter,
            overflow: 'hidden',
          }}
        >
          <OffthreadVideo
            src={staticFile(SCREEN_SRC)}
            volume={0}
            style={{
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center top',
              transform: `scale(${interpolate(screenEnter, [0, 1], [1.018, 1])})`,
              width: '100%',
            }}
          />
          <div
            style={{
              background: 'linear-gradient(180deg, rgba(1,6,12,.42), transparent 15%, transparent 82%, rgba(1,6,12,.30))',
              inset: 0,
              pointerEvents: 'none',
              position: 'absolute',
            }}
          />
        </AbsoluteFill>
      </Sequence>

      {frame >= SCREEN_START_FRAME ? (
        <>
          <div
            style={{
              backgroundColor: 'rgba(5,12,20,.88)',
              border: '1px solid rgba(255,255,255,.16)',
              borderRadius: 999,
              color: '#eaf7ff',
              fontFamily: 'Inter, PingFang SC, sans-serif',
              fontSize: 20,
              fontWeight: 780,
              left: 40,
              letterSpacing: 0.4,
              padding: '11px 18px',
              position: 'absolute',
              top: 34,
              zIndex: 50,
            }}
          >
            {chapterAt(screenTimeMs)}
          </div>

          <Sequence
            from={SCREEN_START_FRAME}
            durationInFrames={MOONCUT_EPIC_LECTURE_FRAMES - SCREEN_START_FRAME}
          >
            <div
              style={{
                backgroundColor: '#07101a',
                border: '4px solid rgba(255,255,255,.92)',
                borderRadius: '50%',
                boxShadow: '0 18px 42px rgba(0,0,0,.30), 0 0 0 2px rgba(89,222,255,.68)',
                height: 252,
                opacity: pipEnter,
                overflow: 'hidden',
                position: 'absolute',
                right: 48,
                top: 42,
                transform: `scale(${0.88 + pipEnter * 0.12})`,
                width: 252,
                zIndex: 55,
              }}
            >
              <FaceTrackedVideo
                faceTrack={faceTrack}
                framing={{
                  anchor: [0.5, 0.45],
                  aspectRatio: 1,
                  edgeMode: 'pad',
                  faceFill: 0.68,
                  maxZoom: 4,
                  shape: 'circle',
                }}
                motion={{recenterDurationMs: 650}}
                sourceAspectRatio={16 / 9}
                sourceTimeMs={(frame / fps) * 1000}
                src={staticFile(TALKING_HEAD_SRC)}
                trackingElapsedMs={((frame - SCREEN_START_FRAME) / fps) * 1000}
                trimBefore={SCREEN_START_FRAME}
                volume={1}
              />
            </div>
          </Sequence>
        </>
      ) : null}

      {previewMode ? (
        <Sequence
          from={XHS_PREVIEW_START_FRAME}
          durationInFrames={XHS_PREVIEW_END_FRAME - XHS_PREVIEW_START_FRAME}
        >
          <XhsResultPreview />
        </Sequence>
      ) : null}
      {frame >= SCREEN_START_FRAME ? (
        <Caption previewMode={previewMode} segment={segment} />
      ) : null}

      <Sequence from={SCREEN_START_FRAME - 4} durationInFrames={42}>
        <Audio
          src={staticFile('sfx/transition-whoosh-tech.mp3')}
          volume={10 ** (-21 / 20)}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

export const MoonCutEpicDemo: React.FC<{
  faceTrack: FaceTrackManifest;
  subtitles: SubtitleSegment[];
}> = ({faceTrack, subtitles}) => {
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <Sequence from={0} durationInFrames={MOONCUT_EPIC_LECTURE_FRAMES}>
        <Lecture faceTrack={faceTrack} subtitles={subtitles} />
      </Sequence>
      <Sequence
        from={MOONCUT_EPIC_LECTURE_FRAMES}
        durationInFrames={MOONCUT_EPIC_APPEND_FRAMES}
      >
        <OffthreadVideo
          src={staticFile(FINAL_DEMO_SRC)}
          volume={1}
          style={{height: '100%', objectFit: 'cover', width: '100%'}}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
