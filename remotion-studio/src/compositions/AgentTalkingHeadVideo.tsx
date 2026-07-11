import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {FaceTrackedVideo, type FaceTrackManifest} from '../components/FaceTrackedVideo';
import {FullscreenImpactText} from '../extensions/community-motion/FullscreenImpactText';
import {MacDesktop, MacFloatingVideoWindow, MacWindow} from '../extensions/community-motion/MacDesktop';

export type AgentEditBeatKind = 'speaker' | 'desktop' | 'quote' | 'impact' | 'evidence' | 'illustration';
export type SpeakerLayout = 'native' | 'circle';

export type AgentCameraPolicy = {
  mode: 'track-small-overlays-only';
  trackedLayout: 'circle';
  nativeReframe: 'preserve-source';
  minimumLayoutHoldMs: number;
  transitionMs: number;
  recenterDurationMs: number;
};

export type AgentEditBeat = {
  startMs: number;
  endMs: number;
  kind: AgentEditBeatKind;
  headline: string;
  body: string;
  keywords: string[];
  impactText?: string;
  /** Absolute source-timeline time where the impact pulse lands. */
  impactAtMs?: number;
  evidenceId?: string;
  generatedVisualId?: string;
  /** Explicit in generated specs; optional here so existing v1 jobs remain renderable. */
  speakerLayout?: SpeakerLayout;
};

export type AgentEvidenceAsset = {
  id: string;
  kind: 'webpage' | 'x-post';
  label: string;
  url: string;
  src: string;
  localPath: string;
  evidencePath: string;
};

export type AgentGeneratedVisualAsset = {
  id: string;
  kind: 'generated-illustration';
  label: string;
  purpose: string;
  prompt: string;
  src: string;
  localPath: string;
  metadataPath: string;
  model: string;
  generatedAt: string;
};

export type AgentEditSpec = {
  schemaVersion: 'mooncut.edit.v1';
  title: string;
  summary: string;
  accent: string;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  source: {src: string; aspectRatio: number};
  transcript: string;
  subtitles: Array<{index: number; text: string; start_ms: number; end_ms: number}>;
  beats: AgentEditBeat[];
  evidenceAssets: AgentEvidenceAsset[];
  generatedVisuals?: AgentGeneratedVisualAsset[];
  generationPreset: 'macos-sonoma-native';
  cameraPolicy?: AgentCameraPolicy;
};

export type AgentTalkingHeadVideoProps = {
  spec: AgentEditSpec;
  faceTrack: FaceTrackManifest | null;
};

export const DEFAULT_AGENT_EDIT_SPEC: AgentEditSpec = {
  schemaVersion: 'mooncut.edit.v1',
  title: 'MoonCut 口播剪辑',
  summary: '原生 macOS 桌面语言与稳定人物构图',
  accent: '#65d9b6',
  fps: 30,
  durationInFrames: 300,
  width: 1920,
  height: 1080,
  source: {src: 'media/talking-head-horizontal.mp4', aspectRatio: 16 / 9},
  transcript: '',
  subtitles: [],
  beats: [
    {
      startMs: 0,
      endMs: 10_000,
      kind: 'desktop',
      headline: 'MoonCut 智能剪辑',
      body: '从口播素材到原生 macOS 风格成片',
      keywords: ['语义分镜', '稳定跟脸', '自动渲染'],
      speakerLayout: 'circle',
    },
  ],
  evidenceAssets: [],
  generatedVisuals: [],
  generationPreset: 'macos-sonoma-native',
  cameraPolicy: {
    mode: 'track-small-overlays-only',
    trackedLayout: 'circle',
    nativeReframe: 'preserve-source',
    minimumLayoutHoldMs: 2500,
    transitionMs: 220,
    recenterDurationMs: 650,
  },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const beatAt = (spec: AgentEditSpec, timeMs: number) =>
  spec.beats.find((beat) => timeMs >= beat.startMs && timeMs < beat.endMs) ??
  spec.beats[spec.beats.length - 1];

/** Face tracking is a crop tool for supporting-content overlays, never a global camera effect. */
export const resolveSpeakerLayout = (beat: AgentEditBeat): SpeakerLayout => {
  const semanticLayout = beat.kind === 'desktop' || beat.kind === 'quote' ||
    beat.kind === 'illustration' || (beat.kind === 'evidence' && Boolean(beat.evidenceId))
    ? 'circle'
    : 'native';
  // The renderer owns this invariant so a malformed/legacy spec cannot turn
  // face tracking back on for a large speaker shot.
  return beat.speakerLayout === semanticLayout ? beat.speakerLayout : semanticLayout;
};

const speakerLayoutRunStartMs = (spec: AgentEditSpec, beat: AgentEditBeat) => {
  let index = spec.beats.indexOf(beat);
  const layout = resolveSpeakerLayout(beat);
  while (index > 0 && resolveSpeakerLayout(spec.beats[index - 1]) === layout) index -= 1;
  return spec.beats[Math.max(0, index)]?.startMs ?? beat.startMs;
};

const subtitleAt = (spec: AgentEditSpec, timeMs: number) =>
  spec.subtitles.find((segment) => timeMs >= segment.start_ms && timeMs < segment.end_ms);

const CaptionText = ({text, keywords, accent}: {text: string; keywords: string[]; accent: string}) => {
  const cleaned = text.replace(/\s*\n\s*/gu, '');
  const matches = keywords
    .flatMap((keyword) => {
      const index = cleaned.indexOf(keyword);
      return index >= 0 ? [{index, keyword}] : [];
    })
    .sort((left, right) => left.index - right.index);
  if (matches.length === 0) return <>{cleaned}</>;
  const spans: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    if (match.index > cursor) spans.push(cleaned.slice(cursor, match.index));
    spans.push(<strong key={`${match.index}-${match.keyword}`} style={{color: accent}}>{match.keyword}</strong>);
    cursor = match.index + match.keyword.length;
  }
  if (cursor < cleaned.length) spans.push(cleaned.slice(cursor));
  return <>{spans}</>;
};

const NativeSourceVideo = ({spec, volume = 1}: {spec: AgentEditSpec; volume?: number}) => (
  <div style={{background: '#050706', height: '100%', overflow: 'hidden', position: 'relative', width: '100%'}}>
    <OffthreadVideo
      src={staticFile(spec.source.src)}
      volume={0}
      style={{filter: 'blur(28px) brightness(.48)', height: '116%', left: '-8%', objectFit: 'cover', position: 'absolute', top: '-8%', width: '116%'}}
    />
    <OffthreadVideo
      src={staticFile(spec.source.src)}
      volume={volume}
      style={{height: '100%', objectFit: 'contain', position: 'absolute', width: '100%'}}
    />
  </div>
);

const TrackedSpeakerBubble = ({
  enter,
  faceTrack,
  spec,
  timeMs,
  trackingElapsedMs,
}: {
  enter: number;
  faceTrack: FaceTrackManifest | null;
  spec: AgentEditSpec;
  timeMs: number;
  trackingElapsedMs: number;
}) => (
  <div
    style={{
      background: '#0b1110',
      border: '4px solid rgba(255,255,255,.9)',
      borderRadius: '50%',
      boxShadow: '0 24px 64px rgba(0,0,0,.5)',
      height: 238,
      opacity: enter,
      overflow: 'hidden',
      position: 'absolute',
      right: 58,
      top: 62,
      transform: `scale(${0.92 + enter * 0.08})`,
      width: 238,
      zIndex: 24,
    }}
  >
    <FaceTrackedVideo
      faceTrack={faceTrack}
      framing={{
        aspectRatio: 1,
        faceFill: 0.68,
        anchor: [0.5, 0.45],
        shape: 'circle',
        maxZoom: 4,
        edgeMode: 'pad',
      }}
      motion={{recenterDurationMs: spec.cameraPolicy?.recenterDurationMs ?? 650}}
      sourceAspectRatio={spec.source.aspectRatio}
      sourceTimeMs={timeMs}
      src={staticFile(spec.source.src)}
      trackingElapsedMs={trackingElapsedMs}
      volume={1}
    />
  </div>
);

const KeywordChips = ({accent, keywords}: {accent: string; keywords: string[]}) => (
  <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 34}}>
    {keywords.map((keyword) => (
      <span
        key={keyword}
        style={{
          background: `${accent}18`,
          border: `1px solid ${accent}70`,
          borderRadius: 999,
          color: '#effff9',
          fontSize: 22,
          fontWeight: 720,
          padding: '11px 18px',
        }}
      >
        {keyword}
      </span>
    ))}
  </div>
);

const DesktopBeat = ({
  beat,
  enter,
  spec,
}: {
  beat: AgentEditBeat;
  enter: number;
  spec: AgentEditSpec;
}) => (
  <>
    <MacWindow
      kind="app"
      title={`${spec.title} · Story Beat`}
      tone="dark"
      toolbar={<span style={{color: spec.accent, fontSize: 13, fontWeight: 800}}>● LIVE</span>}
      style={{
        height: 700,
        left: 76,
        opacity: enter,
        position: 'absolute',
        right: 76,
        top: 164,
        transform: `translateX(${(1 - enter) * 42}px)`,
        width: 1768,
        zIndex: 2,
      }}
    >
      <div style={{boxSizing: 'border-box', height: '100%', padding: '76px 82px'}}>
        <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 16, fontWeight: 800, letterSpacing: 2}}>MOONCUT · SEMANTIC EDIT</div>
        <h1 style={{color: '#f7fbf8', fontSize: 72, letterSpacing: '-0.045em', lineHeight: 1.08, margin: '24px 0 22px', maxWidth: 920}}>{beat.headline}</h1>
        <p style={{color: 'rgba(240,248,244,.72)', fontSize: 30, lineHeight: 1.55, margin: 0, maxWidth: 900}}>{beat.body}</p>
        <KeywordChips accent={spec.accent} keywords={beat.keywords} />
        <div style={{bottom: 52, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, 1fr)', left: 82, position: 'absolute', right: 82}}>
          {['ASR TIMING', 'FACE TRACK', 'REMOTION'].map((label, index) => (
            <div key={label} style={{borderTop: '1px solid rgba(255,255,255,.13)', paddingTop: 14}}>
              <small style={{color: 'rgba(255,255,255,.4)', fontSize: 12, letterSpacing: 1.5}}>{label}</small>
              <div style={{color: index === 1 ? spec.accent : '#fff', fontFamily: 'Menlo, monospace', fontSize: 17, fontWeight: 800, marginTop: 8}}>{index === 0 ? 'WORD LEVEL' : index === 1 ? 'LOCKED' : 'FRAME DRIVEN'}</div>
            </div>
          ))}
        </div>
      </div>
    </MacWindow>
  </>
);

const SpeakerBeat = ({
  beat,
  enter,
  spec,
}: {
  beat: AgentEditBeat;
  enter: number;
  spec: AgentEditSpec;
}) => (
  <>
    <MacFloatingVideoWindow
      title="Camera · Focus"
      tone="dark"
      style={{
        height: 760,
        left: 260,
        opacity: enter,
        position: 'absolute',
        top: 122,
        transform: `translateY(${(1 - enter) * 30}px) scale(${0.965 + enter * 0.035})`,
        width: 1400,
        zIndex: 2,
      }}
    >
      <NativeSourceVideo spec={spec} />
      <div style={{background: 'linear-gradient(transparent, rgba(0,0,0,.82))', bottom: 0, height: 220, left: 0, position: 'absolute', right: 0}} />
      <div style={{bottom: 44, left: 54, position: 'absolute', right: 54}}>
        <div style={{color: spec.accent, fontSize: 14, fontWeight: 850, letterSpacing: 2}}>SPEAKER FOCUS</div>
        <div style={{color: '#fff', fontSize: 48, fontWeight: 850, letterSpacing: '-.03em', marginTop: 8}}>{beat.headline}</div>
      </div>
    </MacFloatingVideoWindow>
  </>
);

const QuoteBeat = ({
  beat,
  enter,
  spec,
}: {
  beat: AgentEditBeat;
  enter: number;
  spec: AgentEditSpec;
}) => (
  <>
    <MacWindow
      kind="utility"
      title="Key Message · Notes"
      tone="light"
      style={{height: 650, left: 130, opacity: enter, position: 'absolute', top: 190, transform: `translateY(${(1 - enter) * 34}px)`, width: 1450, zIndex: 2}}
    >
      <div style={{boxSizing: 'border-box', height: '100%', padding: '66px 72px'}}>
        <div style={{color: '#376f61', fontFamily: 'Menlo, monospace', fontSize: 15, fontWeight: 900, letterSpacing: 2}}>KEY MESSAGE</div>
        <div style={{color: '#14201d', fontSize: 70, fontWeight: 860, letterSpacing: '-.045em', lineHeight: 1.2, marginTop: 34}}>“{beat.headline}”</div>
        <p style={{color: 'rgba(20,32,29,.62)', fontSize: 28, lineHeight: 1.55, marginTop: 28}}>{beat.body}</p>
        <KeywordChips accent="#376f61" keywords={beat.keywords} />
      </div>
    </MacWindow>
  </>
);

const EvidenceBeat = ({
  beat,
  beatDurationFrames,
  enter,
  localFrame,
  spec,
}: {
  beat: AgentEditBeat;
  beatDurationFrames: number;
  enter: number;
  localFrame: number;
  spec: AgentEditSpec;
}) => {
  const evidence = (spec.evidenceAssets ?? []).find((asset) => asset.id === beat.evidenceId);
  const scroll = evidence?.kind === 'webpage'
    ? interpolate(localFrame, [0, Math.max(1, beatDurationFrames - 1)], [0, -24], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0;
  const hostname = evidence ? new URL(evidence.url).hostname : 'source footage';

  return (
    <>
      {evidence ? (
        <>
          <MacWindow
            kind="browser"
            title={`${evidence.label} — Safari`}
            tone="light"
            toolbar={<span style={{color: '#376f61', fontFamily: 'Menlo, monospace', fontSize: 12}}>VERIFIED SOURCE</span>}
            style={{height: 730, left: 90, opacity: enter, position: 'absolute', top: 145, transform: `scale(${0.97 + enter * 0.03})`, width: 1240, zIndex: 2}}
          >
            <div style={{background: '#e8ecea', borderBottom: '1px solid rgba(0,0,0,.12)', boxSizing: 'border-box', display: 'flex', gap: 16, height: 52, padding: '10px 18px'}}>
              <span style={{color: '#6b7470', fontSize: 24}}>‹  ›</span>
              <div style={{background: 'rgba(255,255,255,.8)', border: '1px solid rgba(0,0,0,.1)', borderRadius: 9, color: '#4d5753', flex: 1, fontSize: 15, lineHeight: '30px', overflow: 'hidden', padding: '0 18px', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{evidence.url}</div>
            </div>
            <div style={{background: '#f6f7f6', bottom: 0, left: 0, overflow: 'hidden', position: 'absolute', right: 0, top: 52}}>
              <Img
                src={staticFile(evidence.src)}
                style={evidence.kind === 'x-post'
                  ? {height: '100%', objectFit: 'contain', padding: 32, width: '100%'}
                  : {height: 'auto', minHeight: '106%', objectFit: 'cover', objectPosition: 'top center', transform: `translateY(${scroll}%)`, width: '100%'}}
              />
            </div>
          </MacWindow>
        </>
      ) : (
        <MacFloatingVideoWindow
          title="Source Monitor · Original Footage"
          tone="dark"
          toolbar={<span style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 12}}>● SOURCE</span>}
          style={{height: 730, left: 90, opacity: enter, position: 'absolute', top: 145, transform: `scale(${0.97 + enter * 0.03})`, width: 1240, zIndex: 2}}
        >
          <NativeSourceVideo spec={spec} />
        </MacFloatingVideoWindow>
      )}
    <MacWindow
      kind="utility"
      title="Inspector"
      tone="dark"
      style={{height: 590, opacity: enter, position: 'absolute', right: 90, top: 215, transform: `translateX(${(1 - enter) * 30}px)`, width: 420, zIndex: 3}}
    >
      <div style={{padding: '44px 38px'}}>
        <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 13, fontWeight: 900}}>{evidence ? 'REAL WEB EVIDENCE' : 'VISIBLE CONTEXT'}</div>
        <h2 style={{color: '#fff', fontSize: 42, letterSpacing: '-.035em', lineHeight: 1.15, margin: '24px 0'}}>{beat.headline}</h2>
        <p style={{color: 'rgba(255,255,255,.62)', fontSize: 22, lineHeight: 1.55}}>{beat.body}</p>
        <KeywordChips accent={spec.accent} keywords={beat.keywords} />
        <div style={{bottom: 34, color: 'rgba(255,255,255,.38)', fontFamily: 'Menlo, monospace', fontSize: 12, left: 38, position: 'absolute', right: 38}}>{hostname}</div>
      </div>
    </MacWindow>
    </>
  );
};

const IllustrationBeat = ({
  beat,
  enter,
  spec,
}: {
  beat: AgentEditBeat;
  enter: number;
  spec: AgentEditSpec;
}) => {
  const visual = (spec.generatedVisuals ?? []).find((asset) => asset.id === beat.generatedVisualId);
  return (
    <>
      <MacWindow
        kind="app"
        title="MoonCut Creative Preview"
        tone="dark"
        toolbar={<span style={{color: '#ffd166', fontFamily: 'Menlo, monospace', fontSize: 12, fontWeight: 900}}>AI GENERATED EXAMPLE</span>}
        style={{height: 730, left: 88, opacity: enter, position: 'absolute', top: 145, transform: `scale(${0.97 + enter * 0.03})`, width: 1260, zIndex: 2}}
      >
        <div style={{background: '#0b1110', height: '100%', overflow: 'hidden', position: 'relative'}}>
          {visual ? (
            <Img
              src={staticFile(visual.src)}
              style={{height: '100%', objectFit: 'cover', width: '100%'}}
            />
          ) : (
            <div style={{alignItems: 'center', color: 'rgba(255,255,255,.55)', display: 'flex', fontSize: 28, height: '100%', justifyContent: 'center'}}>示例图不可用</div>
          )}
          <div style={{background: 'linear-gradient(transparent, rgba(0,0,0,.82))', bottom: 0, height: 180, left: 0, position: 'absolute', right: 0}} />
          <div style={{background: 'rgba(5,9,8,.82)', border: '1px solid rgba(255,209,102,.65)', borderRadius: 999, bottom: 28, color: '#ffd166', fontFamily: 'Menlo, monospace', fontSize: 15, fontWeight: 900, left: 30, letterSpacing: 1.4, padding: '10px 16px', position: 'absolute'}}>AI 生成示例 · 非事实证据</div>
        </div>
      </MacWindow>
      <MacWindow
        kind="utility"
        title="Example Inspector"
        tone="dark"
        style={{height: 590, opacity: enter, position: 'absolute', right: 88, top: 215, transform: `translateX(${(1 - enter) * 30}px)`, width: 420, zIndex: 3}}
      >
        <div style={{padding: '44px 38px'}}>
          <div style={{color: '#ffd166', fontFamily: 'Menlo, monospace', fontSize: 13, fontWeight: 900}}>ILLUSTRATIVE ONLY</div>
          <h2 style={{color: '#fff', fontSize: 42, letterSpacing: '-.035em', lineHeight: 1.15, margin: '24px 0'}}>{beat.headline}</h2>
          <p style={{color: 'rgba(255,255,255,.62)', fontSize: 22, lineHeight: 1.55}}>{beat.body}</p>
          <KeywordChips accent={spec.accent} keywords={beat.keywords} />
          <div style={{bottom: 34, color: 'rgba(255,255,255,.38)', fontFamily: 'Menlo, monospace', fontSize: 12, left: 38, position: 'absolute', right: 38}}>{visual?.model ?? 'generated visual'}</div>
        </div>
      </MacWindow>
    </>
  );
};

export const AgentTalkingHeadVideo: React.FC<AgentTalkingHeadVideoProps> = ({faceTrack, spec}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const timeMs = frame / fps * 1000;
  const beat = beatAt(spec, timeMs);
  const subtitle = subtitleAt(spec, timeMs);
  const beatStartFrame = Math.round(beat.startMs / 1000 * fps);
  const beatDurationFrames = Math.max(12, Math.round((beat.endMs - beat.startMs) / 1000 * fps));
  const impactAtFrame = Number.isFinite(beat.impactAtMs)
    ? Math.round((beat.impactAtMs! - beat.startMs) / 1000 * fps)
    : undefined;
  const localFrame = Math.max(0, frame - beatStartFrame);
  const enter = spring({frame: localFrame, fps, config: {damping: 18, stiffness: 120}});
  const speakerLayout = resolveSpeakerLayout(beat);
  const layoutStartFrame = Math.round(speakerLayoutRunStartMs(spec, beat) / 1000 * fps);
  const layoutLocalFrame = Math.max(0, frame - layoutStartFrame);
  const transitionFrames = Math.max(1, Math.round((spec.cameraPolicy?.transitionMs ?? 220) / 1000 * fps));
  const cameraEnter = interpolate(layoutLocalFrame, [0, transitionFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const progress = clamp(frame / Math.max(1, durationInFrames - 1), 0, 1);

  return (
    <AbsoluteFill style={{background: '#050908', color: '#fff', fontFamily: 'Inter, "PingFang SC", sans-serif', overflow: 'hidden'}}>
      <MacDesktop applicationName="MoonCut" shade={0.42} showDock={false} showMenuBar />
      <div style={{background: 'rgba(255,255,255,.12)', height: 3, left: 0, position: 'absolute', right: 0, top: 32, zIndex: 10}}>
        <div style={{background: spec.accent, boxShadow: `0 0 18px ${spec.accent}`, height: '100%', width: `${progress * 100}%`}} />
      </div>

      {beat.kind === 'desktop' ? <DesktopBeat beat={beat} enter={enter} spec={spec} /> : null}
      {beat.kind === 'speaker' ? <SpeakerBeat beat={beat} enter={cameraEnter} spec={spec} /> : null}
      {beat.kind === 'quote' ? <QuoteBeat beat={beat} enter={enter} spec={spec} /> : null}
      {beat.kind === 'evidence' ? <EvidenceBeat beat={beat} beatDurationFrames={beatDurationFrames} enter={enter} localFrame={localFrame} spec={spec} /> : null}
      {beat.kind === 'illustration' ? <IllustrationBeat beat={beat} enter={enter} spec={spec} /> : null}
      {beat.kind === 'impact' ? (
        <>
          <AbsoluteFill style={{zIndex: 1}}>
            <NativeSourceVideo spec={spec} />
          </AbsoluteFill>
          <Sequence
            from={beatStartFrame}
            durationInFrames={beatDurationFrames}
            name="Fullscreen impact"
          >
            <FullscreenImpactText
              accent={spec.accent}
              backdropOpacity={0.8}
              duration={beatDurationFrames}
              impactAtFrame={impactAtFrame}
              text={beat.impactText ?? beat.headline}
            />
          </Sequence>
        </>
      ) : null}

      {speakerLayout === 'circle' ? (
        <TrackedSpeakerBubble
          enter={cameraEnter}
          faceTrack={faceTrack}
          spec={spec}
          timeMs={timeMs}
          trackingElapsedMs={layoutLocalFrame / fps * 1000}
        />
      ) : null}

      {subtitle ? (
        <div
          style={{
            background: 'rgba(5,10,9,.82)',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 18,
            bottom: 42,
            boxShadow: '0 18px 50px rgba(0,0,0,.32)',
            fontSize: 35,
            fontWeight: 820,
            left: '50%',
            letterSpacing: '.01em',
            lineHeight: 1.3,
            maxWidth: 1240,
            padding: '17px 30px 19px',
            position: 'absolute',
            textAlign: 'center',
            textShadow: '0 3px 12px rgba(0,0,0,.75)',
            transform: 'translateX(-50%)',
            zIndex: 40,
          }}
        >
          <CaptionText accent={spec.accent} keywords={beat.keywords} text={subtitle.text} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
