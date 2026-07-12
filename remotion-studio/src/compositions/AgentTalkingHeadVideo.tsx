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

export type AgentEditBeatKind = 'speaker' | 'desktop' | 'quote' | 'impact' | 'evidence' | 'illustration' | 'diagram';
export type SpeakerLayout = 'native' | 'circle';
export type AgentEvidencePanel = {
  evidenceId: string;
  role: 'primary' | 'supporting' | 'contrast' | 'step';
  purpose: string;
  scrollStartPct?: number;
  scrollEndPct?: number;
};

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
  evidencePanels?: AgentEvidencePanel[];
  evidenceMode?: 'single' | 'parallel' | 'comparison' | 'sequence';
  generatedVisualId?: string;
  diagramId?: string;
  desktopTemplate?: 'editorial' | 'workflow' | 'comparison' | 'dashboard';
  visualItems?: Array<{title: string; detail: string; value?: string}>;
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
  kind: 'generated-illustration' | 'handdrawn-diagram';
  label: string;
  purpose: string;
  prompt: string;
  src: string;
  localPath: string;
  metadataPath: string;
  model: string;
  generatedAt: string;
  sourceJsonPath?: string;
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
    beat.kind === 'illustration' || beat.kind === 'diagram' ||
    (beat.kind === 'evidence' && Boolean(beat.evidenceId || beat.evidencePanels?.length))
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
}) => {
  const template = beat.desktopTemplate ?? (beat.visualItems?.some((item) => item.value) ? 'dashboard' : 'editorial');
  const items = beat.visualItems?.length
    ? beat.visualItems.slice(0, 4)
    : beat.keywords.slice(0, 4).map((keyword, index) => ({
        title: keyword,
        detail: index === 0 ? beat.body : `围绕「${keyword}」展开当前讲解`,
        value: template === 'dashboard' ? `${String(index + 1).padStart(2, '0')}` : undefined,
      }));
  return (
    <MacWindow
      kind="app"
      title={`${spec.title} · ${template.toUpperCase()}`}
      tone="dark"
      toolbar={<span style={{color: spec.accent, fontSize: 13, fontWeight: 850}}>● SEMANTIC CANVAS · 16:9</span>}
      style={{height: 864, left: 192, opacity: enter, position: 'absolute', top: 104, transform: `translateX(${(1 - enter) * 42}px) scale(${0.985 + enter * 0.015})`, width: 1536, zIndex: 2}}
    >
      <div style={{background: 'radial-gradient(circle at 88% 8%, rgba(101,217,182,.14), transparent 34%), linear-gradient(145deg,#0b1110,#111a17)', boxSizing: 'border-box', height: '100%', overflow: 'hidden', padding: '54px 60px', position: 'relative'}}>
        <div style={{display: 'grid', gap: 48, gridTemplateColumns: 'minmax(0, 1.08fr) minmax(430px, .92fr)', height: '100%'}}>
          <section style={{display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0}}>
            <div>
              <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 15, fontWeight: 850, letterSpacing: 2.2}}>MOONCUT · {template.toUpperCase()}</div>
              <h1 style={{color: '#f7fbf8', fontSize: 68, letterSpacing: '-0.05em', lineHeight: 1.04, margin: '22px 0 20px', maxWidth: 780}}>{beat.headline}</h1>
              <p style={{color: 'rgba(240,248,244,.7)', fontSize: 27, lineHeight: 1.5, margin: 0, maxWidth: 760}}>{beat.body}</p>
            </div>
            <div style={{display: 'flex', gap: 10}}>
              {[0, 1, 2, 3].map((index) => <div key={index} style={{background: index === 0 ? spec.accent : 'rgba(255,255,255,.16)', borderRadius: 99, height: 7, width: index === 0 ? 86 : 28}} />)}
            </div>
          </section>
          <section style={{alignContent: 'center', display: 'grid', gap: 16, gridTemplateColumns: template === 'workflow' ? '1fr' : 'repeat(2,minmax(0,1fr))'}}>
            {items.map((item, index) => (
              <React.Fragment key={`${item.title}-${index}`}>
                <div style={{background: index === 0 ? `${spec.accent}18` : 'rgba(255,255,255,.055)', border: `1px solid ${index === 0 ? `${spec.accent}66` : 'rgba(255,255,255,.11)'}`, borderRadius: 22, boxShadow: '0 18px 42px rgba(0,0,0,.18)', minHeight: template === 'workflow' ? 112 : 182, padding: template === 'workflow' ? '22px 26px' : '26px', position: 'relative'}}>
                  <div style={{alignItems: 'center', display: 'flex', gap: 14}}>
                    <div style={{alignItems: 'center', background: index === 0 ? spec.accent : 'rgba(255,255,255,.1)', borderRadius: 14, color: index === 0 ? '#07100d' : '#fff', display: 'flex', fontFamily: 'Menlo, monospace', fontSize: 16, fontWeight: 900, height: 42, justifyContent: 'center', width: 42}}>{item.value ?? index + 1}</div>
                    <div style={{color: '#fff', fontSize: 24, fontWeight: 830}}>{item.title}</div>
                  </div>
                  <div style={{color: 'rgba(255,255,255,.56)', fontSize: 17, lineHeight: 1.45, marginTop: 15}}>{item.detail}</div>
                  {template === 'dashboard' ? <div style={{background: 'rgba(255,255,255,.08)', borderRadius: 99, bottom: 20, height: 7, left: 26, overflow: 'hidden', position: 'absolute', right: 26}}><div style={{background: spec.accent, height: '100%', width: `${42 + index * 14}%`}} /></div> : null}
                </div>
                {template === 'workflow' && index < items.length - 1 ? <div style={{color: spec.accent, fontSize: 26, height: 12, lineHeight: '12px', paddingLeft: 38}}>↓</div> : null}
              </React.Fragment>
            ))}
          </section>
        </div>
      </div>
    </MacWindow>
  );
};

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
        height: 788,
        left: 260,
        opacity: enter,
        position: 'absolute',
        top: 104,
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
      style={{height: 816, left: 160, opacity: enter, position: 'absolute', top: 118, transform: `translateY(${(1 - enter) * 34}px)`, width: 1450, zIndex: 2}}
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

const evidencePanelsForBeat = (beat: AgentEditBeat): AgentEvidencePanel[] => beat.evidencePanels?.length
  ? beat.evidencePanels.slice(0, 3)
  : beat.evidenceId
    ? [{evidenceId: beat.evidenceId, role: 'primary', purpose: beat.body || beat.headline}]
    : [];

const safeHostname = (url: string) => {
  try { return new URL(url).hostname; } catch { return url; }
};

const EvidencePanelWindow = ({
  asset,
  beatDurationFrames,
  enter,
  index,
  localFrame,
  panel,
  style,
}: {
  asset: AgentEvidenceAsset;
  beatDurationFrames: number;
  enter: number;
  index: number;
  localFrame: number;
  panel: AgentEvidencePanel;
  style: React.CSSProperties;
}) => {
  const scrollStart = panel.scrollStartPct ?? Math.min(12, index * 4);
  const scrollEnd = panel.scrollEndPct ?? Math.min(62, 24 + index * 9);
  const scroll = asset.kind === 'webpage'
    ? interpolate(localFrame, [0, Math.max(1, beatDurationFrames - 1)], [scrollStart, scrollEnd], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0;
  return (
    <MacWindow
      kind="browser"
      title={`${asset.label} — Safari`}
      tone="light"
      toolbar={<span style={{color: '#376f61', fontFamily: 'Menlo, monospace', fontSize: 11, fontWeight: 850}}>{panel.role.toUpperCase()} · VERIFIED</span>}
      style={{...style, opacity: enter, transform: `translateY(${(1 - enter) * (18 + index * 7)}px) scale(${0.98 + enter * 0.02})`, zIndex: 2 + index}}
    >
      <div style={{background: '#e8ecea', borderBottom: '1px solid rgba(0,0,0,.12)', boxSizing: 'border-box', display: 'flex', gap: 12, height: 46, padding: '8px 14px'}}>
        <span style={{color: '#6b7470', fontSize: 21}}>‹  ›</span>
        <div style={{background: 'rgba(255,255,255,.86)', border: '1px solid rgba(0,0,0,.09)', borderRadius: 8, color: '#4d5753', flex: 1, fontSize: 13, lineHeight: '28px', overflow: 'hidden', padding: '0 13px', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{safeHostname(asset.url)}</div>
      </div>
      <div style={{background: '#f6f7f6', bottom: 0, left: 0, overflow: 'hidden', position: 'absolute', right: 0, top: 46}}>
        <Img
          src={staticFile(asset.src)}
          style={asset.kind === 'x-post'
            ? {boxSizing: 'border-box', height: '100%', objectFit: 'contain', padding: 18, width: '100%'}
            : {height: 'auto', minHeight: '118%', objectFit: 'cover', objectPosition: 'top center', transform: `translateY(-${scroll}%)`, width: '100%'}}
        />
        <div style={{background: 'linear-gradient(transparent,rgba(0,0,0,.76))', bottom: 0, height: 92, left: 0, position: 'absolute', right: 0}} />
        <div style={{bottom: 15, color: '#fff', fontSize: 16, fontWeight: 760, left: 18, position: 'absolute', right: 18}}>{panel.purpose}</div>
      </div>
    </MacWindow>
  );
};

const EvidenceBeat = ({beat, beatDurationFrames, enter, localFrame, spec}: {
  beat: AgentEditBeat;
  beatDurationFrames: number;
  enter: number;
  localFrame: number;
  spec: AgentEditSpec;
}) => {
  const panels = evidencePanelsForBeat(beat)
    .map((panel) => ({panel, asset: (spec.evidenceAssets ?? []).find((asset) => asset.id === panel.evidenceId)}))
    .filter((item): item is {panel: AgentEvidencePanel; asset: AgentEvidenceAsset} => Boolean(item.asset));
  const mode = beat.evidenceMode ?? (panels.length > 1 ? 'parallel' : 'single');
  if (panels.length === 0) {
    return <MacFloatingVideoWindow title="Source Monitor · Original Footage" tone="dark" style={{height: 702, left: 110, opacity: enter, position: 'absolute', top: 145, width: 1248, zIndex: 2}}><NativeSourceVideo spec={spec} /></MacFloatingVideoWindow>;
  }
  if (panels.length === 1) {
    const [{panel, asset}] = panels;
    return <>
      <EvidencePanelWindow asset={asset} beatDurationFrames={beatDurationFrames} enter={enter} index={0} localFrame={localFrame} panel={panel} style={{height: 702, left: 86, position: 'absolute', top: 142, width: 1248}} />
      <MacWindow kind="utility" title="Evidence Inspector" tone="dark" style={{height: 620, opacity: enter, position: 'absolute', right: 88, top: 182, width: 430, zIndex: 4}}>
        <div style={{padding: '42px 38px'}}>
          <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 13, fontWeight: 900}}>REAL WEB EVIDENCE · 01</div>
          <h2 style={{color: '#fff', fontSize: 42, letterSpacing: '-.035em', lineHeight: 1.12, margin: '24px 0'}}>{beat.headline}</h2>
          <p style={{color: 'rgba(255,255,255,.62)', fontSize: 21, lineHeight: 1.55}}>{beat.body}</p>
          <KeywordChips accent={spec.accent} keywords={beat.keywords} />
          <div style={{bottom: 30, color: 'rgba(255,255,255,.38)', fontFamily: 'Menlo, monospace', fontSize: 12, left: 38, position: 'absolute'}}>{safeHostname(asset.url)}</div>
        </div>
      </MacWindow>
    </>;
  }
  const width = panels.length === 2 ? 820 : 560;
  const height = Math.round(width * 9 / 16);
  const gap = panels.length === 2 ? 40 : 40;
  const totalWidth = width * panels.length + gap * (panels.length - 1);
  const left = (1920 - totalWidth) / 2;
  return <>
    <div style={{left: 82, maxWidth: 1310, opacity: enter, position: 'absolute', top: 68, zIndex: 3}}>
      <div style={{color: spec.accent, fontFamily: 'Menlo, monospace', fontSize: 14, fontWeight: 900, letterSpacing: 2}}>{mode.toUpperCase()} EVIDENCE · {String(panels.length).padStart(2, '0')} SOURCES</div>
      <h2 style={{color: '#fff', fontSize: 48, letterSpacing: '-.04em', margin: '13px 0 8px'}}>{beat.headline}</h2>
      <p style={{color: 'rgba(255,255,255,.62)', fontSize: 21, margin: 0}}>{beat.body}</p>
    </div>
    {panels.map(({panel, asset}, index) => <EvidencePanelWindow key={asset.id} asset={asset} beatDurationFrames={beatDurationFrames} enter={enter} index={index} localFrame={localFrame} panel={panel} style={{height, left: left + index * (width + gap), position: 'absolute', top: panels.length === 2 ? 250 : 270, width}} />)}
    <div style={{bottom: 112, display: 'flex', gap: 12, left, opacity: enter, position: 'absolute', right: left, zIndex: 8}}>
      {panels.map(({panel, asset}, index) => <div key={asset.id} style={{background: 'rgba(7,12,11,.88)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, color: 'rgba(255,255,255,.72)', flex: 1, fontSize: 14, padding: '12px 15px'}}><strong style={{color: index === 0 ? spec.accent : '#fff'}}>{panel.role.toUpperCase()}</strong> · {safeHostname(asset.url)}</div>)}
    </div>
  </>;
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
  const visual = (spec.generatedVisuals ?? []).find((asset) => asset.id === beat.generatedVisualId && asset.kind === 'generated-illustration');
  return (
    <>
      <MacWindow
        kind="app"
        title="MoonCut Creative Preview"
        tone="dark"
        toolbar={<span style={{color: '#ffd166', fontFamily: 'Menlo, monospace', fontSize: 12, fontWeight: 900}}>AI GENERATED EXAMPLE</span>}
        style={{height: 729, left: 72, opacity: enter, position: 'absolute', top: 144, transform: `scale(${0.97 + enter * 0.03})`, width: 1296, zIndex: 2}}
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

const DiagramBeat = ({beat, enter, spec}: {beat: AgentEditBeat; enter: number; spec: AgentEditSpec}) => {
  const diagram = (spec.generatedVisuals ?? []).find((asset) => asset.id === beat.diagramId && asset.kind === 'handdrawn-diagram');
  return <>
    <MacWindow
      kind="app"
      title="MoonCut Hand-drawn Explainer"
      tone="light"
      toolbar={<span style={{color: '#2f6c5d', fontFamily: 'Menlo, monospace', fontSize: 12, fontWeight: 900}}>EXCALIDRAW · EDITABLE SOURCE</span>}
      style={{height: 765, left: 66, opacity: enter, position: 'absolute', top: 132, transform: `scale(${0.97 + enter * 0.03})`, width: 1360, zIndex: 2}}
    >
      <div style={{background: '#fffdf7', height: '100%', overflow: 'hidden', position: 'relative'}}>
        {diagram ? <Img src={staticFile(diagram.src)} style={{height: '100%', objectFit: 'contain', padding: 24, width: '100%'}} /> : <div style={{alignItems: 'center', color: '#66716d', display: 'flex', fontSize: 28, height: '100%', justifyContent: 'center'}}>手绘图不可用</div>}
        <div style={{background: '#fff4c2', border: '1px solid #d6b94d', borderRadius: 999, bottom: 24, color: '#5a4910', fontFamily: 'Menlo, monospace', fontSize: 13, fontWeight: 900, left: 28, padding: '9px 14px', position: 'absolute'}}>解释性手绘图 · 非事实证据</div>
      </div>
    </MacWindow>
    <MacWindow kind="utility" title="Diagram Notes" tone="dark" style={{height: 610, opacity: enter, position: 'absolute', right: 70, top: 190, width: 390, zIndex: 4}}>
      <div style={{padding: '42px 34px'}}>
        <div style={{color: '#ffd166', fontFamily: 'Menlo, monospace', fontSize: 13, fontWeight: 900}}>HAND-DRAWN LOGIC</div>
        <h2 style={{color: '#fff', fontSize: 40, letterSpacing: '-.04em', lineHeight: 1.12, margin: '24px 0'}}>{beat.headline}</h2>
        <p style={{color: 'rgba(255,255,255,.62)', fontSize: 20, lineHeight: 1.55}}>{beat.body}</p>
        <KeywordChips accent={spec.accent} keywords={beat.keywords} />
        <div style={{bottom: 30, color: 'rgba(255,255,255,.38)', fontSize: 12, left: 34, position: 'absolute'}}>{diagram?.purpose ?? 'STRUCTURE OVER DECORATION'}</div>
      </div>
    </MacWindow>
  </>;
};

export const AgentTalkingHeadVideo: React.FC<AgentTalkingHeadVideoProps> = ({faceTrack, spec}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames, width, height} = useVideoConfig();
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
  const designScale = Math.min(width / 1920, height / 1080);
  const designLeft = (width - 1920 * designScale) / 2;
  const designTop = (height - 1080 * designScale) / 2;

  return (
    <AbsoluteFill style={{background: '#050908', color: '#fff', fontFamily: 'Inter, "PingFang SC", sans-serif', overflow: 'hidden'}}>
      <div style={{height: 1080, left: designLeft, overflow: 'hidden', position: 'absolute', top: designTop, transform: `scale(${designScale})`, transformOrigin: 'top left', width: 1920}}>
      <MacDesktop applicationName="MoonCut" shade={0.42} showDock={false} showMenuBar />
      <div style={{background: 'rgba(255,255,255,.12)', height: 3, left: 0, position: 'absolute', right: 0, top: 32, zIndex: 10}}>
        <div style={{background: spec.accent, boxShadow: `0 0 18px ${spec.accent}`, height: '100%', width: `${progress * 100}%`}} />
      </div>

      {beat.kind === 'desktop' ? <DesktopBeat beat={beat} enter={enter} spec={spec} /> : null}
      {beat.kind === 'speaker' ? <SpeakerBeat beat={beat} enter={cameraEnter} spec={spec} /> : null}
      {beat.kind === 'quote' ? <QuoteBeat beat={beat} enter={enter} spec={spec} /> : null}
      {beat.kind === 'evidence' ? <EvidenceBeat beat={beat} beatDurationFrames={beatDurationFrames} enter={enter} localFrame={localFrame} spec={spec} /> : null}
      {beat.kind === 'illustration' ? <IllustrationBeat beat={beat} enter={enter} spec={spec} /> : null}
      {beat.kind === 'diagram' ? <DiagramBeat beat={beat} enter={enter} spec={spec} /> : null}
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
      </div>
    </AbsoluteFill>
  );
};
