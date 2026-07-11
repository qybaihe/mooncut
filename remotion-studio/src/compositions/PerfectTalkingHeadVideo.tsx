import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
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
import {MacDesktop, MacFloatingVideoWindow, MacWindow} from '../extensions/community-motion/MacDesktop';

export type PerfectBeatVisual =
  | 'speaker-focus'
  | 'metrics'
  | 'pipeline'
  | 'source-full'
  | 'impact'
  | 'model-compare'
  | 'product-ui'
  | 'distribution'
  | 'closing';

export type PerfectBeat = {
  startMs: number;
  endMs: number;
  visual: PerfectBeatVisual;
  headline: string;
  body: string;
  keywords: string[];
  assetId?: string;
  metrics?: Array<{label: string; value: string; unit?: string}>;
  speakerLayout?: 'native' | 'circle';
};

export type PerfectTalkingHeadSpec = {
  schemaVersion: 'mooncut.perfect-talking-head.v1';
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
  beats: PerfectBeat[];
  assets: Array<{id: string; src: string; label: string}>;
  bgm?: {src: string; title: string; gainDb: number; fadeInMs: number; fadeOutMs: number};
  sfx: Array<{id: string; src: string; atMs: number; gainDb: number; durationMs: number}>;
  cameraPolicy?: {
    mode: 'track-small-overlays-only';
    trackedLayout: 'circle';
    nativeReframe: 'preserve-source';
    minimumLayoutHoldMs: number;
    transitionMs: number;
    recenterDurationMs: number;
  };
};

export type PerfectTalkingHeadVideoProps = {
  spec: PerfectTalkingHeadSpec;
  faceTrack: FaceTrackManifest | null;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const dbToVolume = (db: number) => 10 ** (db / 20);

export const assertPerfectTalkingHeadSpec = (value: unknown): PerfectTalkingHeadSpec => {
  if (!value || typeof value !== 'object') throw new Error('Perfect talking-head spec must be an object');
  const candidate = value as Partial<PerfectTalkingHeadSpec>;
  if (candidate.schemaVersion !== 'mooncut.perfect-talking-head.v1') {
    throw new Error(`Unsupported perfect talking-head schema: ${String(candidate.schemaVersion)}`);
  }
  if (!Array.isArray(candidate.beats) || candidate.beats.length === 0) {
    throw new Error('Perfect talking-head spec requires timed beats');
  }
  if (!Array.isArray(candidate.subtitles) || !Array.isArray(candidate.sfx)) {
    throw new Error('Perfect talking-head spec requires subtitle and SFX arrays');
  }
  return candidate as PerfectTalkingHeadSpec;
};

const beatAt = (spec: PerfectTalkingHeadSpec, timeMs: number) =>
  spec.beats.find((beat) => timeMs >= beat.startMs && timeMs < beat.endMs) ??
  spec.beats[spec.beats.length - 1];

const subtitleAt = (spec: PerfectTalkingHeadSpec, timeMs: number) =>
  spec.subtitles.find((subtitle) => timeMs >= subtitle.start_ms && timeMs < subtitle.end_ms);

const KeywordText = ({accent, keywords, text}: {accent: string; keywords: string[]; text: string}) => {
  const escaped = keywords
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  if (escaped.length === 0) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gu'));
  const keywordSet = new Set(keywords);
  return (
    <>
      {parts.map((part, index) => keywordSet.has(part)
        ? <strong key={`${part}-${index}`} style={{color: accent}}>{part}</strong>
        : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>)}
    </>
  );
};

const NativeSpeaker = ({spec}: {spec: PerfectTalkingHeadSpec}) => (
  <div style={{background: '#030606', height: '100%', overflow: 'hidden', position: 'relative', width: '100%'}}>
    <OffthreadVideo src={staticFile(spec.source.src)} volume={0} style={{filter: 'blur(28px) brightness(.5)', height: '116%', left: '-8%', objectFit: 'cover', position: 'absolute', top: '-8%', width: '116%'}} />
    <OffthreadVideo src={staticFile(spec.source.src)} volume={0} style={{height: '100%', objectFit: 'contain', position: 'absolute', width: '100%'}} />
  </div>
);

const CircleSpeaker = ({faceTrack, spec, trackingElapsedMs}: {
  faceTrack: FaceTrackManifest | null;
  spec: PerfectTalkingHeadSpec;
  trackingElapsedMs: number;
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
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
      sourceTimeMs={frame / fps * 1000}
      src={staticFile(spec.source.src)}
      trackingElapsedMs={trackingElapsedMs}
      volume={0}
    />
  );
};

const circleSpeakerVisuals = new Set<PerfectBeatVisual>([
  'metrics',
  'pipeline',
  'model-compare',
  'product-ui',
  'distribution',
]);

const usesCircleSpeaker = (beat: PerfectBeat) => circleSpeakerVisuals.has(beat.visual);

const speakerLayoutRunStartMs = (spec: PerfectTalkingHeadSpec, beat: PerfectBeat) => {
  let index = spec.beats.indexOf(beat);
  const circle = usesCircleSpeaker(beat);
  while (index > 0 && usesCircleSpeaker(spec.beats[index - 1]) === circle) index -= 1;
  return spec.beats[Math.max(0, index)]?.startMs ?? beat.startMs;
};

const SceneTitle = ({accent, beat}: {accent: string; beat: PerfectBeat}) => (
  <div style={{left: 68, position: 'absolute', top: 64, zIndex: 8}}>
    <div style={{color: accent, fontFamily: 'Menlo, monospace', fontSize: 14, fontWeight: 900, letterSpacing: 2.4}}>
      MOONCUT · LIVE BUILD LOG
    </div>
    <div style={{color: '#fff', fontSize: 45, fontWeight: 900, letterSpacing: '-.035em', marginTop: 10}}>
      {beat.headline}
    </div>
  </div>
);

const SpeakerFocusScene = ({beat, enter, spec}: {
  beat: PerfectBeat;
  enter: number;
  spec: PerfectTalkingHeadSpec;
}) => (
  <>
    <MacFloatingVideoWindow
      title="Camera · Native Framing"
      tone="dark"
      toolbar={<span style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 12}}>● SOURCE FRAME</span>}
      style={{
        height: 820,
        left: 150,
        opacity: enter,
        position: 'absolute',
        top: 108,
        transform: `translateY(${(1 - enter) * 26}px) scale(${0.97 + enter * 0.03})`,
        width: 1620,
        zIndex: 2,
      }}
    >
      <NativeSpeaker spec={spec} />
      <div style={{background: 'linear-gradient(transparent 48%, rgba(2,5,5,.88))', inset: 0, position: 'absolute'}} />
      <div style={{bottom: 78, left: 68, position: 'absolute', right: 68}}>
        <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 14, fontWeight: 900, letterSpacing: 2}}>SPEAKER FOCUS</div>
        <div style={{color: '#fff', fontSize: 55, fontWeight: 900, letterSpacing: '-.04em', marginTop: 10}}>{beat.headline}</div>
        <div style={{color: 'rgba(255,255,255,.68)', fontSize: 25, marginTop: 10}}>{beat.body}</div>
      </div>
    </MacFloatingVideoWindow>
  </>
);

const MetricsScene = ({beat, enter, localFrame, spec}: {
  beat: PerfectBeat;
  enter: number;
  localFrame: number;
  spec: PerfectTalkingHeadSpec;
}) => {
  const {fps} = useVideoConfig();
  const pop = spring({frame: localFrame - 7, fps, config: {damping: 13, stiffness: 170}});
  return (
    <>
      <SceneTitle accent={spec.accent} beat={beat} />
      <MacWindow
        kind="app"
        title="Build Metrics"
        tone="dark"
        style={{height: 690, left: 76, opacity: enter, position: 'absolute', top: 190, width: 1768, zIndex: 2}}
      >
        <div style={{display: 'grid', gap: 26, gridTemplateColumns: `repeat(${Math.max(1, beat.metrics?.length ?? 1)}, 1fr)`, height: '100%', padding: '88px 60px 64px'}}>
          {(beat.metrics ?? []).map((metric, index) => (
            <div key={metric.label} style={{
              alignItems: 'center',
              background: index === 0 ? `linear-gradient(155deg, ${spec.accent}22, rgba(255,255,255,.035))` : 'rgba(255,255,255,.035)',
              border: `1px solid ${index === 0 ? `${spec.accent}88` : 'rgba(255,255,255,.12)'}`,
              borderRadius: 28,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              transform: `translateY(${(1 - pop) * (24 + index * 10)}px) scale(${0.94 + pop * 0.06})`,
            }}>
              <div style={{color: '#fff', fontFamily: 'Menlo, monospace', fontSize: 94, fontWeight: 950, letterSpacing: '-.07em'}}>
                {metric.value}<small style={{color: spec.accent, fontSize: 34, marginLeft: 8}}>{metric.unit}</small>
              </div>
              <div style={{color: 'rgba(255,255,255,.58)', fontSize: 23, fontWeight: 750, marginTop: 18}}>{metric.label}</div>
            </div>
          ))}
        </div>
      </MacWindow>
    </>
  );
};

const PipelineScene = ({beat, enter, localFrame, spec}: {
  beat: PerfectBeat;
  enter: number;
  localFrame: number;
  spec: PerfectTalkingHeadSpec;
}) => {
  const nodes = beat.keywords.length > 0 ? beat.keywords : ['理解', '规划', '剪辑', '成片'];
  return (
    <>
      <SceneTitle accent={spec.accent} beat={beat} />
      <MacWindow kind="app" title="Agent Pipeline" tone="dark" style={{height: 690, left: 92, opacity: enter, position: 'absolute', top: 190, width: 1736, zIndex: 2}}>
        <div style={{height: '100%', padding: '96px 72px 60px'}}>
          <div style={{color: 'rgba(255,255,255,.6)', fontSize: 25, lineHeight: 1.5}}>{beat.body}</div>
          <div style={{alignItems: 'center', display: 'grid', gap: 18, gridTemplateColumns: `repeat(${nodes.length}, 1fr)`, marginTop: 90}}>
            {nodes.map((node, index) => {
              const reveal = interpolate(localFrame, [index * 12, index * 12 + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
              return (
                <div key={node} style={{position: 'relative'}}>
                  {index > 0 ? <div style={{background: `linear-gradient(90deg, ${spec.accent}, rgba(255,255,255,.18))`, height: 3, left: -36, position: 'absolute', top: 53, width: 54}} /> : null}
                  <div style={{
                    background: reveal > 0.7 ? `${spec.accent}20` : 'rgba(255,255,255,.035)',
                    border: `1px solid ${reveal > 0.7 ? spec.accent : 'rgba(255,255,255,.14)'}`,
                    borderRadius: 24,
                    color: '#fff',
                    fontSize: 25,
                    fontWeight: 850,
                    opacity: reveal,
                    padding: '38px 18px',
                    textAlign: 'center',
                    transform: `translateY(${(1 - reveal) * 24}px)`,
                  }}>
                    <small style={{color: spec.accent, display: 'block', fontFamily: 'Menlo, monospace', fontSize: 13, marginBottom: 12}}>0{index + 1}</small>
                    {node}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </MacWindow>
    </>
  );
};

const SourceFullScene = ({beat, enter, spec}: {beat: PerfectBeat; enter: number; spec: PerfectTalkingHeadSpec}) => (
  <AbsoluteFill style={{background: '#030606', opacity: enter}}>
    <OffthreadVideo src={staticFile(spec.source.src)} volume={0} style={{height: '100%', objectFit: 'cover', width: '100%'}} />
    <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(0,0,0,.72), transparent 52%), linear-gradient(transparent 65%, rgba(0,0,0,.68))'}} />
    <div style={{left: 68, position: 'absolute', top: 64}}>
      <div style={{background: 'rgba(0,0,0,.55)', border: '1px solid rgba(255,255,255,.24)', borderRadius: 999, color: '#fff', display: 'inline-block', fontFamily: 'Menlo, monospace', fontSize: 13, fontWeight: 850, padding: '10px 16px'}}>REAL SOURCE B-ROLL</div>
      <div style={{fontSize: 55, fontWeight: 950, letterSpacing: '-.04em', marginTop: 24, maxWidth: 760}}>{beat.headline}</div>
      <div style={{color: 'rgba(255,255,255,.72)', fontSize: 25, lineHeight: 1.5, marginTop: 14, maxWidth: 680}}>{beat.body}</div>
      {beat.metrics && beat.metrics.length > 0 ? (
        <div style={{display: 'flex', gap: 16, marginTop: 24}}>
          {beat.metrics.map((metric) => (
            <div key={metric.label} style={{background: 'rgba(0,0,0,.62)', border: `1px solid ${spec.accent}88`, borderRadius: 18, minWidth: 155, padding: '18px 22px'}}>
              <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 34, fontWeight: 950}}>{metric.value}{metric.unit}</div>
              <div style={{color: 'rgba(255,255,255,.58)', fontSize: 15, marginTop: 7}}>{metric.label}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  </AbsoluteFill>
);

const ImpactScene = ({beat, enter, localFrame, spec}: {beat: PerfectBeat; enter: number; localFrame: number; spec: PerfectTalkingHeadSpec}) => {
  const {fps} = useVideoConfig();
  const hit = spring({frame: localFrame - 24, fps, config: {damping: 11, stiffness: 220, mass: 0.7}});
  return (
    <AbsoluteFill style={{background: '#020404', opacity: enter}}>
      <OffthreadVideo src={staticFile(spec.source.src)} volume={0} style={{filter: 'brightness(.42) saturate(.8)', height: '100%', objectFit: 'cover', transform: `scale(${1 + hit * 0.035})`, width: '100%'}} />
      <AbsoluteFill style={{alignItems: 'center', display: 'flex', justifyContent: 'center'}}>
        <div style={{textAlign: 'center', transform: `scale(${0.72 + hit * 0.28})`}}>
          <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 17, fontWeight: 900, letterSpacing: 4}}>STILL SHIPPING · 22:30</div>
          <div style={{color: '#fff', fontSize: 128, fontWeight: 950, letterSpacing: '-.07em', marginTop: 22, textShadow: '0 12px 48px rgba(0,0,0,.6)'}}>{beat.headline}</div>
          <div style={{color: 'rgba(255,255,255,.7)', fontSize: 28, marginTop: 16}}>{beat.body}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const ModelCompareScene = ({beat, enter, localFrame, spec}: {
  beat: PerfectBeat;
  enter: number;
  localFrame: number;
  spec: PerfectTalkingHeadSpec;
}) => {
  const latest = interpolate(localFrame, [18, 58], [0.35, 1], {easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <>
      <SceneTitle accent={spec.accent} beat={beat} />
      <MacWindow kind="app" title="Model Comparison · Visual QA" tone="dark" style={{height: 700, left: 92, opacity: enter, position: 'absolute', top: 185, width: 1736, zIndex: 2}}>
        <div style={{display: 'grid', gap: 36, gridTemplateColumns: '1fr 1fr', height: '100%', padding: '80px 70px'}}>
          <div style={{background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 26, padding: 44}}>
            <div style={{color: 'rgba(255,255,255,.45)', fontFamily: 'Menlo, monospace', fontSize: 14}}>PREVIOUS MODEL</div>
            <div style={{color: '#fff', fontSize: 40, fontWeight: 900, marginTop: 18}}>基础可用</div>
            <div style={{background: 'rgba(255,255,255,.1)', borderRadius: 999, height: 16, marginTop: 70, overflow: 'hidden'}}><div style={{background: 'rgba(255,255,255,.35)', height: '100%', width: '58%'}} /></div>
          </div>
          <div style={{background: `${spec.accent}16`, border: `1px solid ${spec.accent}`, borderRadius: 26, boxShadow: `0 0 45px ${spec.accent}18`, padding: 44}}>
            <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 14}}>LATEST MODEL · TODAY</div>
            <div style={{color: '#fff', fontSize: 40, fontWeight: 900, marginTop: 18}}>明显更好</div>
            <div style={{background: 'rgba(255,255,255,.1)', borderRadius: 999, height: 16, marginTop: 70, overflow: 'hidden'}}><div style={{background: spec.accent, height: '100%', width: `${latest * 92}%`}} /></div>
            <div style={{color: spec.accent, fontSize: 24, fontWeight: 850, marginTop: 28}}>效果持续向上 ↑</div>
          </div>
        </div>
      </MacWindow>
    </>
  );
};

const ProductUIScene = ({beat, enter, localFrame, spec}: {
  beat: PerfectBeat;
  enter: number;
  localFrame: number;
  spec: PerfectTalkingHeadSpec;
}) => {
  const asset = spec.assets.find((candidate) => candidate.id === beat.assetId);
  const zoom = interpolate(localFrame, [0, 220], [1, 1.055], {extrapolateRight: 'clamp'});
  const cursor = interpolate(localFrame, [55, 100], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <>
      <SceneTitle accent={spec.accent} beat={beat} />
      <MacWindow kind="browser" title={`${asset?.label ?? 'MoonCut'} — Safari`} tone="light" style={{height: 720, left: 70, opacity: enter, position: 'absolute', top: 175, width: 1780, zIndex: 2}}>
        <div style={{background: '#f5f1e6', inset: 0, overflow: 'hidden', position: 'absolute'}}>
          {asset ? <Img src={staticFile(asset.src)} style={{height: '100%', objectFit: 'cover', objectPosition: 'top center', transform: `scale(${zoom})`, width: '100%'}} /> : null}
          <div style={{background: spec.accent, border: '4px solid #111', borderRadius: '50%', boxShadow: '5px 5px 0 #111', height: 34, left: `${49 + cursor * 7}%`, position: 'absolute', top: `${52 - cursor * 17}%`, transform: `scale(${0.8 + cursor * 0.2})`, width: 34}} />
        </div>
      </MacWindow>
    </>
  );
};

const DistributionScene = ({beat, enter, localFrame, spec}: {beat: PerfectBeat; enter: number; localFrame: number; spec: PerfectTalkingHeadSpec}) => {
  const steps = beat.keywords.length > 0 ? beat.keywords : ['上传', 'AI 剪辑', '邮箱', '小红书', '抖音'];
  return (
    <>
      <SceneTitle accent={spec.accent} beat={beat} />
      <MacWindow kind="app" title="MoonCut Automation · Delivery" tone="dark" style={{height: 700, left: 92, opacity: enter, position: 'absolute', top: 185, width: 1736, zIndex: 2}}>
        <div style={{height: '100%', padding: '90px 64px 58px'}}>
          <div style={{display: 'grid', gap: 18, gridTemplateColumns: `repeat(${steps.length}, 1fr)`, marginTop: 44}}>
            {steps.map((step, index) => {
              const show = interpolate(localFrame, [index * 18, index * 18 + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
              const complete = localFrame > index * 18 + 32;
              return (
                <div key={step} style={{position: 'relative'}}>
                  {index > 0 ? <div style={{background: complete ? spec.accent : 'rgba(255,255,255,.18)', height: 4, left: -30, position: 'absolute', top: 104, width: 42}} /> : null}
                  <div style={{
                    background: complete ? `${spec.accent}1d` : 'rgba(255,255,255,.035)',
                    border: `1px solid ${complete ? spec.accent : 'rgba(255,255,255,.14)'}`,
                    borderRadius: 26,
                    minHeight: 210,
                    opacity: show,
                    padding: '38px 24px',
                    textAlign: 'center',
                    transform: `translateY(${(1 - show) * 30}px) scale(${0.94 + show * 0.06})`,
                  }}>
                    <div style={{alignItems: 'center', background: complete ? spec.accent : 'rgba(255,255,255,.1)', borderRadius: '50%', color: complete ? '#07110e' : '#fff', display: 'inline-flex', fontFamily: 'Menlo, monospace', fontSize: 22, fontWeight: 950, height: 58, justifyContent: 'center', width: 58}}>{complete ? '✓' : index + 1}</div>
                    <div style={{color: '#fff', fontSize: 27, fontWeight: 900, marginTop: 28}}>{step}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{color: 'rgba(255,255,255,.58)', fontSize: 25, marginTop: 44, textAlign: 'center'}}>{beat.body}</div>
        </div>
      </MacWindow>
    </>
  );
};

const ClosingScene = ({beat, enter, localFrame, spec}: {
  beat: PerfectBeat;
  enter: number;
  localFrame: number;
  spec: PerfectTalkingHeadSpec;
}) => {
  const {fps} = useVideoConfig();
  const rise = spring({frame: localFrame - 5, fps, config: {damping: 16, stiffness: 120}});
  return (
    <>
      <MacFloatingVideoWindow title="Camera · Tomorrow" tone="dark" style={{height: 770, left: 130, opacity: enter, position: 'absolute', top: 125, width: 990, zIndex: 2}}>
        <NativeSpeaker spec={spec} />
      </MacFloatingVideoWindow>
      <MacWindow kind="utility" title="Ship Log" tone="dark" style={{height: 610, opacity: enter, position: 'absolute', right: 120, top: 205, transform: `translateX(${(1 - rise) * 45}px)`, width: 630, zIndex: 3}}>
        <div style={{padding: '70px 58px'}}>
          <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 15, fontWeight: 900, letterSpacing: 2}}>NEXT MILESTONE</div>
          <div style={{color: '#fff', fontSize: 76, fontWeight: 950, letterSpacing: '-.055em', lineHeight: 1.08, marginTop: 28}}>{beat.headline}</div>
          <div style={{color: 'rgba(255,255,255,.62)', fontSize: 27, lineHeight: 1.5, marginTop: 28}}>{beat.body}</div>
          <div style={{borderTop: '1px solid rgba(255,255,255,.14)', color: spec.accent, fontSize: 25, fontWeight: 900, marginTop: 54, paddingTop: 26}}>我们明天见 →</div>
        </div>
      </MacWindow>
    </>
  );
};

export const PerfectTalkingHeadVideo: React.FC<PerfectTalkingHeadVideoProps> = ({faceTrack, spec}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const timeMs = frame / fps * 1000;
  const beat = beatAt(spec, timeMs);
  const subtitle = subtitleAt(spec, timeMs);
  const beatStartFrame = Math.round(beat.startMs / 1000 * fps);
  const beatDurationFrames = Math.max(1, Math.round((beat.endMs - beat.startMs) / 1000 * fps));
  const localFrame = Math.max(0, frame - beatStartFrame);
  const entrance = spring({frame: localFrame, fps, config: {damping: 18, stiffness: 125}});
  const exit = interpolate(localFrame, [Math.max(0, beatDurationFrames - 8), beatDurationFrames], [1, 0.94], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const enter = clamp(entrance * exit, 0, 1);
  const circleSpeaker = usesCircleSpeaker(beat);
  const layoutStartFrame = Math.round(speakerLayoutRunStartMs(spec, beat) / 1000 * fps);
  const layoutLocalFrame = Math.max(0, frame - layoutStartFrame);
  const transitionFrames = Math.max(1, Math.round((spec.cameraPolicy?.transitionMs ?? 220) / 1000 * fps));
  const circleEnter = interpolate(layoutLocalFrame, [0, transitionFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const progress = frame / Math.max(1, durationInFrames - 1);
  const desktopScene = !['source-full', 'impact'].includes(beat.visual);
  const bgmFadeInFrames = Math.max(1, Math.round((spec.bgm?.fadeInMs ?? 900) / 1000 * fps));
  const bgmFadeOutFrames = Math.max(1, Math.round((spec.bgm?.fadeOutMs ?? 1200) / 1000 * fps));
  const bgmEnvelope = Math.min(
    interpolate(frame, [0, bgmFadeInFrames], [0, 1], {extrapolateRight: 'clamp'}),
    interpolate(frame, [durationInFrames - bgmFadeOutFrames, durationInFrames], [1, 0], {extrapolateLeft: 'clamp'}),
  );

  return (
    <AbsoluteFill style={{background: '#030706', color: '#fff', fontFamily: 'Inter, "PingFang SC", sans-serif', overflow: 'hidden'}}>
      <OffthreadVideo
        src={staticFile(spec.source.src)}
        volume={1}
        style={{height: 1, left: 0, opacity: 0, position: 'absolute', top: 0, width: 1}}
      />
      {spec.bgm ? (
        <Audio
          name={`BGM · ${spec.bgm.title}`}
          src={staticFile(spec.bgm.src)}
          volume={dbToVolume(spec.bgm.gainDb) * bgmEnvelope}
        />
      ) : null}
      {spec.sfx.map((effect) => (
        <Sequence
          key={`${effect.id}-${effect.atMs}`}
          from={Math.max(0, Math.round(effect.atMs / 1000 * fps))}
          durationInFrames={Math.max(1, Math.ceil(effect.durationMs / 1000 * fps))}
          name={`SFX · ${effect.id}`}
        >
          <Audio src={staticFile(effect.src)} volume={dbToVolume(effect.gainDb)} />
        </Sequence>
      ))}

      {desktopScene ? <MacDesktop applicationName="MoonCut" clockText="22:30" shade={0.42} showDock={false} showMenuBar /> : null}
      {beat.visual === 'speaker-focus' ? <SpeakerFocusScene beat={beat} enter={enter} spec={spec} /> : null}
      {beat.visual === 'metrics' ? <MetricsScene beat={beat} enter={enter} localFrame={localFrame} spec={spec} /> : null}
      {beat.visual === 'pipeline' ? <PipelineScene beat={beat} enter={enter} localFrame={localFrame} spec={spec} /> : null}
      {beat.visual === 'source-full' ? <SourceFullScene beat={beat} enter={enter} spec={spec} /> : null}
      {beat.visual === 'impact' ? <ImpactScene beat={beat} enter={enter} localFrame={localFrame} spec={spec} /> : null}
      {beat.visual === 'model-compare' ? <ModelCompareScene beat={beat} enter={enter} localFrame={localFrame} spec={spec} /> : null}
      {beat.visual === 'product-ui' ? <ProductUIScene beat={beat} enter={enter} localFrame={localFrame} spec={spec} /> : null}
      {beat.visual === 'distribution' ? <DistributionScene beat={beat} enter={enter} localFrame={localFrame} spec={spec} /> : null}
      {beat.visual === 'closing' ? <ClosingScene beat={beat} enter={enter} localFrame={localFrame} spec={spec} /> : null}

      {circleSpeaker ? (
        <div style={{
          background: '#0b1110',
          border: `4px solid ${spec.accent}`,
          borderRadius: '50%',
          boxShadow: '0 24px 64px rgba(0,0,0,.5)',
          height: 238,
          opacity: circleEnter,
          overflow: 'hidden',
          position: 'absolute',
          right: 58,
          top: 62,
          transform: `scale(${0.92 + circleEnter * 0.08})`,
          width: 238,
          zIndex: 24,
        }}>
          <CircleSpeaker
            faceTrack={faceTrack}
            spec={spec}
            trackingElapsedMs={layoutLocalFrame / fps * 1000}
          />
        </div>
      ) : null}

      <div style={{background: 'rgba(255,255,255,.12)', height: 3, left: 0, position: 'absolute', right: 0, top: desktopScene ? 32 : 0, zIndex: 50}}>
        <div style={{background: spec.accent, boxShadow: `0 0 18px ${spec.accent}`, height: '100%', width: `${progress * 100}%`}} />
      </div>

      {subtitle ? (
        <div style={{
          background: 'rgba(3,8,7,.84)',
          border: '1px solid rgba(255,255,255,.16)',
          borderRadius: 18,
          bottom: 36,
          boxShadow: '0 18px 54px rgba(0,0,0,.38)',
          fontSize: 34,
          fontWeight: 850,
          left: '50%',
          letterSpacing: '.005em',
          lineHeight: 1.35,
          maxWidth: 1380,
          padding: '16px 28px 18px',
          position: 'absolute',
          textAlign: 'center',
          textShadow: '0 3px 12px rgba(0,0,0,.82)',
          transform: 'translateX(-50%)',
          zIndex: 60,
        }}>
          <KeywordText accent={spec.accent} keywords={beat.keywords} text={subtitle.text} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
