import React from 'react';
import {
  AbsoluteFill,
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
import asr from '../data/argentina-egypt-asr.json';
import {
  ARGENTINA_EGYPT_DURATION_IN_FRAMES,
  ARGENTINA_EGYPT_FPS,
  CROSSFADE_FRAMES,
  argentinaEgyptEditClips,
  isSourceMsKept,
  outputFrameToSourceMs,
  sourceMsToOutputFrame,
} from '../argentina-egypt-timeline';
import './argentina-egypt-analysis.css';

type SubtitleWord = {
  text: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
};

type SubtitleSegment = {
  index: number;
  text: string;
  start_ms: number;
  end_ms: number;
};

type NormalizedWord = SubtitleWord & {emphasis?: boolean};

const VIDEO_SRC = 'media/argentina-egypt-original.mp4';
const HIGHLIGHT_SRC = 'media/fifa-official-m95-highlights.mp4';
const SOURCE_ROOT = 'argentina-egypt/sources';

type AnalysisVersion = 'web' | 'official-highlights';
type AnalysisProps = {version?: AnalysisVersion};

type HighlightCue = {
  sourceStartMs: number;
  sourceEndMs: number;
  highlightStartSec: number;
  highlightEndSec: number;
  minute: string;
  label: string;
  detail: string;
  score: string;
  tone: 'argentina' | 'egypt' | 'var';
};

// Every cue stays inside a continuous-PTS region of the authorised FIFA file.
// The source has four ~4.1s video timestamp gaps, so no cue crosses those gaps.
const HIGHLIGHT_CUES: HighlightCue[] = [
  {sourceStartMs: 18575, sourceEndMs: 21615, highlightStartSec: 8.9, highlightEndSec: 11.97, minute: '15′', label: '埃及率先破门', detail: '官方时间 15′ · 口播原音“12 分钟”', score: '0:1', tone: 'egypt'},
  {sourceStartMs: 21935, sourceEndMs: 27375, highlightStartSec: 28.493, highlightEndSec: 33.029, minute: '21′', label: '梅西点球被扑', detail: '门后回放 · 梅西反应', score: '0:1', tone: 'argentina'},
  {sourceStartMs: 27375, sourceEndMs: 42135, highlightStartSec: 55.354, highlightEndSec: 64.36, minute: 'VAR', label: '埃及进球被取消', detail: '裁判手势 · 前序身体接触慢镜', score: '0:1', tone: 'var'},
  {sourceStartMs: 42135, sourceEndMs: 49640, highlightStartSec: 64.393, highlightEndSec: 72.498, minute: '67′', label: '莫斯塔法·齐科', detail: '埃及扩大领先优势', score: '0:2', tone: 'egypt'},
  {sourceStartMs: 56200, sourceEndMs: 57987, highlightStartSec: 75.133, highlightEndSec: 77.78, minute: '79′', label: '罗梅罗门前抢点', detail: '扳回一球前的传中与门前进攻', score: '0:2', tone: 'argentina'},
  {sourceStartMs: 57987, sourceEndMs: 61195, highlightStartSec: 81.948, highlightEndSec: 83.783, minute: '79′', label: '罗梅罗进球成立', detail: '比分更新为 1:2', score: '1:2', tone: 'argentina'},
  {sourceStartMs: 61195, sourceEndMs: 65195, highlightStartSec: 90.12, highlightEndSec: 94.956, minute: '83′', label: '梅西扳平比分', detail: '入球结果与庆祝镜头', score: '2:2', tone: 'argentina'},
  {sourceStartMs: 65195, sourceEndMs: 71200, highlightStartSec: 98.625, highlightEndSec: 107.531, minute: '90+2′', label: '恩佐·费尔南德斯绝杀', detail: '绝杀进攻后半段 · 官方庆祝镜头', score: '3:2', tone: 'argentina'},
  {sourceStartMs: 77810, sourceEndMs: 83969, highlightStartSec: 60.391, highlightEndSec: 64.36, minute: 'VAR', label: '埃及进球判罚回看', detail: '取消手势与前序犯规近景', score: 'NO GOAL', tone: 'var'},
  {sourceStartMs: 83969, sourceEndMs: 88554, highlightStartSec: 107.531, highlightEndSec: 114.847, minute: '90+2′', label: '阿根廷绝杀回放', detail: '门后慢镜 · 裁判判罚有效', score: 'GOAL', tone: 'argentina'},
];

const isOfficialHighlightActive = (sourceMs: number) =>
  HIGHLIGHT_CUES.some((cue) => sourceMs >= cue.sourceStartMs && sourceMs < cue.sourceEndMs);

const emphasisTerms = new Set([
  '阿根廷',
  '埃及',
  '梅西',
  '恩佐',
  '绝杀',
  'VAR',
  '2:0',
  '3:2',
  '惊天大逆转',
  '没有问题的',
]);

const mergedWords = new Map<number, {text: string; end_ms: number; emphasis?: boolean}>([
  [4960, {text: '3:2', end_ms: 5760, emphasis: true}],
  [39800, {text: '利马', end_ms: 40120, emphasis: true}],
  [48720, {text: '2:0', end_ms: 49640, emphasis: true}],
  [68755, {text: '3:2', end_ms: 69435, emphasis: true}],
  [87289, {text: '没有问题的', end_ms: 88554, emphasis: true}],
  [95834, {text: '阿尔瓦雷斯', end_ms: 96714, emphasis: true}],
  [97834, {text: '萨拉赫', end_ms: 98314, emphasis: true}],
  [101897, {text: '萨拉赫', end_ms: 102377, emphasis: true}],
  [103577, {text: '阿尔瓦雷斯', end_ms: 104457, emphasis: true}],
]);

const mergedWordFollowers = new Set([
  48760,
  49200,
  88009,
  88234,
  96554,
  98154,
  102217,
  104297,
]);

const normalizeWords = (): NormalizedWord[] =>
  (asr.words as SubtitleWord[]).flatMap((word) => {
    if (mergedWordFollowers.has(word.start_ms)) return [];
    if (word.text === '呃' || word.text === '啊' || word.text === '一一') return [];

    const merged = mergedWords.get(word.start_ms);
    const normalized: NormalizedWord = merged
      ? {...word, text: merged.text, end_ms: merged.end_ms, emphasis: merged.emphasis}
      : {...word, emphasis: emphasisTerms.has(word.text)};
    const midpoint = (normalized.start_ms + normalized.end_ms) / 2;
    return isSourceMsKept(midpoint) ? [normalized] : [];
  });

const normalizedWords = normalizeWords();
const subtitleSegments = asr.segments as SubtitleSegment[];

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const getSceneInfo = (sourceMs: number) => {
  if (sourceMs < 12015) {
    return {kicker: 'ROUND OF 16 · FULL TIME', title: '0:2 → 3:2', section: 'MATCH REACTION'};
  }
  if (sourceMs < 27375) {
    return {kicker: 'OFFICIAL MATCH TIMELINE', title: '一度落后，点球又失手', section: 'FIRST HALF'};
  }
  if (sourceMs < 42135) {
    return {kicker: 'VIDEO REVIEW', title: 'VAR 取消埃及进球', section: 'DISALLOWED GOAL'};
  }
  if (sourceMs < 52760) {
    return {kicker: '67′ · MOSTAFA ZIKO', title: '比分来到 0:2', section: 'EGYPT LEAD'};
  }
  if (sourceMs < 71355) {
    return {kicker: '79′ · 83′ · 90+2′', title: '13 分钟连进 3 球', section: 'THE COMEBACK'};
  }
  return {kicker: 'TACTICAL REVIEW', title: '争议判罚：关键在球权', section: 'VAR ANALYSIS'};
};

const Flag = ({team}: {team: 'argentina' | 'egypt'}) => (
  <span className={`aea-flag aea-flag-${team}`} aria-label={team} />
);

const ScoreBug = () => (
  <div className="aea-score-bug">
    <Flag team="argentina" />
    <b>ARG</b>
    <strong>3</strong>
    <i>FT</i>
    <strong>2</strong>
    <b>EGY</b>
    <Flag team="egypt" />
  </div>
);

const BrowserChrome = ({url}: {url: string}) => (
  <div className="aea-browser-chrome">
    <div className="aea-browser-dots"><i /><i /><i /></div>
    <div className="aea-browser-address"><span>⌕</span>{url}</div>
    <div className="aea-browser-menu">•••</div>
  </div>
);

const BrowserWindow = ({
  asset,
  badge,
  sourceEndMs,
  sourceMs,
  sourceStartMs,
  scrollTo,
  url,
}: {
  asset: string;
  badge: string;
  sourceEndMs: number;
  sourceMs: number;
  sourceStartMs: number;
  scrollTo: number;
  url: string;
}) => {
  const range = Math.max(1000, sourceEndMs - sourceStartMs);
  const scroll = interpolate(
    sourceMs,
    [sourceStartMs, sourceStartMs + range * 0.16, sourceEndMs - range * 0.18, sourceEndMs],
    [0, 0, scrollTo, scrollTo],
    {easing: Easing.inOut(Easing.cubic), ...clamp},
  );
  const thumb = interpolate(sourceMs, [sourceStartMs, sourceEndMs], [0, 420], clamp);

  return (
    <div className="aea-browser-window">
      <BrowserChrome url={url} />
      <div className="aea-browser-viewport">
        <Img
          className="aea-browser-document"
          src={staticFile(`${SOURCE_ROOT}/${asset}`)}
          style={{transform: `translateY(${-scroll}px)`}}
        />
        <div className="aea-browser-shade" />
      </div>
      <div className="aea-browser-badge"><span>OFFICIAL</span>{badge}</div>
      <div className="aea-scroll-track"><i style={{transform: `translateY(${thumb}px)`}} /></div>
    </div>
  );
};

const OfficialTimeline = ({sourceMs}: {sourceMs: number}) => {
  const events = [
    {minute: "15′", label: '易卜拉欣', score: '0:1', activeAt: 15135, team: 'egypt'},
    {minute: "21′", label: '梅西点球被扑', score: '0:1', activeAt: 21935, team: 'argentina'},
    {minute: "67′", label: '齐科', score: '0:2', activeAt: 42135, team: 'egypt'},
    {minute: "79′", label: '罗梅罗', score: '1:2', activeAt: 56200, team: 'argentina'},
    {minute: "83′", label: '梅西', score: '2:2', activeAt: 61195, team: 'argentina'},
    {minute: '90+2′', label: '恩佐', score: '3:2', activeAt: 65195, team: 'argentina'},
  ] as const;
  const activeIndex = [...events].reverse().findIndex((event) => sourceMs >= event.activeAt);
  const resolvedIndex = activeIndex < 0 ? 0 : events.length - 1 - activeIndex;

  return (
    <div className="aea-timeline-strip">
      <div className="aea-timeline-line" />
      {events.map((event, index) => (
        <div className={`aea-timeline-event ${index <= resolvedIndex ? 'is-past' : ''} ${index === resolvedIndex ? 'is-active' : ''}`} key={event.minute}>
          <span className={`aea-event-dot aea-event-${event.team}`} />
          <b>{event.minute}</b>
          <small>{event.label}</small>
          <strong>{event.score}</strong>
        </div>
      ))}
    </div>
  );
};

const HookScene = ({frame, sourceMs}: {frame: number; sourceMs: number}) => {
  const {fps} = useVideoConfig();
  const enter = 0.72 + spring({frame, fps, config: {damping: 16, stiffness: 95}}) * 0.28;
  const arrow = interpolate(frame, [8, 30], [0, 1], clamp);
  return (
    <div className="aea-hook-scene">
      <div className="aea-pitch-orbit aea-pitch-orbit-a" />
      <div className="aea-pitch-orbit aea-pitch-orbit-b" />
      <div className="aea-hook-lockup" style={{opacity: enter, transform: `translateY(${(1 - enter) * 36}px)`}}>
        <div className="aea-hook-score">
          <span>0:2</span>
          <i style={{clipPath: `inset(0 ${(1 - arrow) * 100}% 0 0)`}}>→</i>
          <strong>3:2</strong>
        </div>
        <div className="aea-hook-rule" />
        <div className="aea-hook-subtitle"><b>13 分钟</b><span>连进 3 球</span><em>惊天大逆转</em></div>
      </div>
      <div className="aea-hook-goals">
        <span><b>79′</b> ROMERO</span>
        <span><b>83′</b> MESSI</span>
        <span><b>90+2′</b> ENZO</span>
      </div>
      {sourceMs > 4300 && <div className="aea-result-chip"><Flag team="argentina" /> ARGENTINA 3—2 EGYPT <Flag team="egypt" /></div>}
    </div>
  );
};

const FirstHalfScene = ({sourceMs}: {sourceMs: number}) => (
  <div className="aea-browser-scene">
    <BrowserWindow
      asset="fifa-report-page-2-timeline.png"
      badge="FIFA · FULL TIME MATCH REPORT"
      sourceStartMs={12015}
      sourceEndMs={27375}
      sourceMs={sourceMs}
      scrollTo={260}
      url="fdp.fifa.org / FullTimeMatchReport-English.pdf"
    />
    <div className="aea-official-correction">
      <div><span>口播原音</span><strong>“12 分钟”</strong></div>
      <i>≠</i>
      <div><span>官方报告</span><strong>15′</strong></div>
      <small>字幕忠实原音 · 信息卡采用官方时间</small>
    </div>
    <OfficialTimeline sourceMs={sourceMs} />
  </div>
);

const VarArticleScene = ({sourceMs}: {sourceMs: number}) => (
  <div className="aea-browser-scene">
    <BrowserWindow
      asset="caf-article-full.png"
      badge="CAF · OFFICIAL MATCH REPORT"
      sourceStartMs={27375}
      sourceEndMs={42135}
      sourceMs={sourceMs}
      scrollTo={1050}
      url="cafonline.com / fifa-world-cup / argentina-egypt"
    />
    <div className="aea-var-float">
      <div className="aea-var-mark">VAR</div>
      <div><b>进球取消</b><span>进攻发起阶段犯规</span></div>
    </div>
    {sourceMs >= 37960 && (
      <div className="aea-lima-name-card"><span>利马</span><b>利桑德罗·马丁内斯</b><small>ARGENTINA · DEFENDER</small></div>
    )}
  </div>
);

const EgyptTwoScene = ({sourceMs}: {sourceMs: number}) => (
  <div className="aea-browser-scene">
    <BrowserWindow
      asset="afc-article-full.png"
      badge="AFC · OFFICIAL MATCH REPORT"
      sourceStartMs={42135}
      sourceEndMs={52760}
      sourceMs={sourceMs}
      scrollTo={1680}
      url="the-afc.com / FIFA World Cup / Argentina 3-2 Egypt"
    />
    <div className="aea-two-nil-card">
      <span>67′</span>
      <div><b>MOSTAFA ZIKO</b><small>EGYPT</small></div>
      <strong>0:2</strong>
    </div>
  </div>
);

const OfficialHighlightClip = ({cue, durationInFrames}: {cue: HighlightCue; durationInFrames: number}) => {
  const localFrame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fadeFrames = Math.min(5, Math.max(1, Math.floor(durationInFrames / 5)));
  const fadeIn = interpolate(localFrame, [0, fadeFrames], [0, 1], clamp);
  const fadeOut = interpolate(
    localFrame,
    [durationInFrames - fadeFrames - 1, durationInFrames - 1],
    [1, 0],
    clamp,
  );
  const playbackRate = (cue.highlightEndSec - cue.highlightStartSec) / (durationInFrames / fps);

  return (
    <OffthreadVideo
      className="aea-highlight-video"
      muted
      playbackRate={playbackRate}
      src={staticFile(HIGHLIGHT_SRC)}
      style={{opacity: Math.min(fadeIn, fadeOut)}}
      trimAfter={Math.ceil(cue.highlightEndSec * fps)}
      trimBefore={Math.floor(cue.highlightStartSec * fps)}
    />
  );
};

const OfficialHighlightTrack = () => (
  <>
    {HIGHLIGHT_CUES.map((cue) => {
      const from = sourceMsToOutputFrame(cue.sourceStartMs);
      const end = sourceMsToOutputFrame(cue.sourceEndMs);
      const durationInFrames = end - from;
      return (
        <Sequence
          durationInFrames={durationInFrames}
          from={from}
          key={`${cue.sourceStartMs}-${cue.highlightStartSec}`}
          name={`FIFA M95 · ${cue.label}`}
        >
          <OfficialHighlightClip cue={cue} durationInFrames={durationInFrames} />
        </Sequence>
      );
    })}
  </>
);

const OfficialHighlightScene = ({sourceMs}: {sourceMs: number}) => {
  const cue = HIGHLIGHT_CUES.find(
    (item) => sourceMs >= item.sourceStartMs && sourceMs < item.sourceEndMs,
  ) ?? HIGHLIGHT_CUES[0];
  const progress = interpolate(sourceMs, [cue.sourceStartMs, cue.sourceEndMs], [0, 1], clamp);
  const detail = cue.minute === 'VAR' && sourceMs >= 37960 && sourceMs < 42135
    ? '利马（利桑德罗·马丁内斯）· 前序犯规慢镜'
    : cue.detail;

  return (
    <div className="aea-highlight-window">
      <div className="aea-highlight-topbar">
        <div><span>FIFA</span><b>OFFICIAL MATCH HIGHLIGHTS</b></div>
        <small>M95 · fifa.com/en/watch/JzfSs2Jwd7yn9Ffowg7YQ</small>
      </div>
      <div className="aea-highlight-content">
        <div className="aea-highlight-stage">
          <OfficialHighlightTrack />
          <div className="aea-highlight-vignette" />
          <div className="aea-highlight-watermark">AUTHORISED FIFA FOOTAGE</div>
        </div>
        <div className={`aea-highlight-event aea-highlight-event-${cue.tone}`}>
          <span>{cue.minute}</span>
          <b>{cue.label}</b>
          <small>{detail}</small>
          <strong>{cue.score}</strong>
          <div className="aea-highlight-progress"><i style={{width: `${progress * 100}%`}} /></div>
        </div>
      </div>
    </div>
  );
};

const ComebackScene = ({frame, sourceMs}: {frame: number; sourceMs: number}) => {
  const scoreStep = sourceMs < 56680 ? 0 : sourceMs < 61195 ? 1 : sourceMs < 65195 ? 2 : 3;
  const scores = ['0:2', '1:2', '2:2', '3:2'];
  const currentScore = scores[scoreStep];
  const scorePop = spring({frame: frame % 120, fps: ARGENTINA_EGYPT_FPS, config: {damping: 13, stiffness: 125}});
  const goals = [
    {minute: '79′', scorer: '克里斯蒂安·罗梅罗', score: '1:2'},
    {minute: '83′', scorer: '梅西', score: '2:2'},
    {minute: '90+2′', scorer: '恩佐·费尔南德斯', score: '3:2'},
  ];

  return (
    <div className="aea-comeback-scene">
      <div className="aea-comeback-grid" />
      <div className="aea-comeback-score" style={{transform: `scale(${0.94 + scorePop * 0.06})`}}>
        <Flag team="argentina" />
        <span>ARG</span>
        <strong>{currentScore}</strong>
        <span>EGY</span>
        <Flag team="egypt" />
      </div>
      <div className="aea-goal-stack">
        {goals.map((goal, index) => (
          <div className={`aea-goal-row ${scoreStep > index ? 'is-scored' : ''}`} key={goal.minute}>
            <b>{goal.minute}</b><span>{goal.scorer}</span><strong>{goal.score}</strong>
          </div>
        ))}
      </div>
      <div className="aea-thirteen-minutes"><span>LAST</span><strong>13</strong><b>MINUTES</b><small>THREE GOALS</small></div>
    </div>
  );
};

const AnalysisOverview = ({sourceMs}: {sourceMs: number}) => {
  const conclusionVisible = sourceMs > 77810;
  return (
    <div className="aea-analysis-overview">
      <div className="aea-analysis-question">同样有身体接触，为什么一个无效、一个有效？</div>
      <div className="aea-incident-grid">
        <div className="aea-incident-card aea-incident-red">
          <span>EGYPT ATTACK</span><b>对利马犯规</b><strong>进攻由犯规获利</strong><em>NO GOAL</em>
        </div>
        <div className="aea-versus">VS</div>
        <div className="aea-incident-card aea-incident-blue">
          <span>ARGENTINA ATTACK</span><b>阿尔瓦雷斯断球</b><strong>球权已完成转换</strong><em>GOAL</em>
        </div>
      </div>
      {conclusionVisible && <div className="aea-analysis-key"><span>判断轴</span><b>球权是否已经转换</b></div>}
    </div>
  );
};

type TacticalMode = 'egypt' | 'argentina';

const TacticalPitch = ({mode, sourceMs}: {mode: TacticalMode; sourceMs: number}) => {
  const progress = interpolate(
    sourceMs,
    mode === 'egypt' ? [88554, 93834] : [93834, 107337],
    [0, 1],
    {easing: Easing.out(Easing.cubic), ...clamp},
  );
  const egypt = mode === 'egypt';
  return (
    <div className={`aea-tactical-panel aea-tactical-${mode}`}>
      <svg className="aea-pitch-svg" viewBox="0 0 1000 560">
        <defs>
          <marker id={`arrow-${mode}`} markerHeight="8" markerWidth="8" orient="auto" refX="6" refY="3">
            <path d="M0,0 L0,6 L7,3 z" fill={egypt ? '#ff725e' : '#65c7ff'} />
          </marker>
          <filter id={`glow-${mode}`}><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect className="aea-pitch-border" x="18" y="18" width="964" height="524" rx="8" />
        <line className="aea-pitch-line" x1="500" y1="18" x2="500" y2="542" />
        <circle className="aea-pitch-line" cx="500" cy="280" r="72" />
        <rect className="aea-pitch-line" x="18" y="155" width="140" height="250" />
        <rect className="aea-pitch-line" x="842" y="155" width="140" height="250" />
        {egypt ? (
          <>
            <path className="aea-route aea-route-red" d="M170 380 C285 315, 350 315, 475 275" markerEnd="url(#arrow-egypt)" style={{strokeDashoffset: 290 * (1 - progress)}} />
            <circle className="aea-player aea-player-egypt" cx="170" cy="380" r="25" />
            <text x="132" y="430">埃及持球人</text>
            <circle className="aea-player aea-player-argentina" cx="438" cy="260" r="25" />
            <text x="402" y="230">利马</text>
            <circle className="aea-contact-ring" cx="465" cy="278" r="48" style={{opacity: progress}} />
            <text className="aea-contact-label" x="500" y="355" style={{opacity: progress}}>犯规发生在进攻发起阶段</text>
          </>
        ) : (
          <>
            <path className="aea-route aea-route-blue" d="M205 365 C305 320, 385 302, 468 282" markerEnd="url(#arrow-argentina)" style={{strokeDashoffset: 285 * (1 - progress)}} />
            <path className="aea-route aea-route-gold" d="M490 276 C615 205, 742 185, 850 250" markerEnd="url(#arrow-argentina)" style={{strokeDashoffset: 340 * (1 - progress)}} />
            <circle className="aea-player aea-player-egypt" cx="205" cy="365" r="25" />
            <text x="176" y="414">萨拉赫</text>
            <circle className="aea-player aea-player-argentina" cx="468" cy="282" r="25" filter="url(#glow-argentina)" />
            <text x="418" y="248">阿尔瓦雷斯</text>
            <circle className="aea-ball" cx={205 + (468 - 205) * progress} cy={365 + (282 - 365) * progress} r="9" />
            <text className="aea-contact-label aea-possession-label" x="560" y="352" style={{opacity: progress}}>断球完成 → 新进攻回合</text>
          </>
        )}
      </svg>
      <div className="aea-tactical-legend">
        <span><i className="aea-dot-arg" />阿根廷</span><span><i className="aea-dot-egy" />埃及</span><span><i className="aea-dot-ball" />球权</span>
      </div>
      <div className={`aea-tactical-verdict ${egypt ? 'is-no-goal' : 'is-goal'}`}>
        <span>{egypt ? 'VAR CHECK' : 'POSSESSION CHECK'}</span>
        <b>{egypt ? '犯规获利' : '先完成断球'}</b>
        <strong>{egypt ? '进球无效' : '绝杀有效'}</strong>
      </div>
    </div>
  );
};

const TacticalScene = ({sourceMs}: {sourceMs: number}) => {
  if (sourceMs < 88554) return <AnalysisOverview sourceMs={sourceMs} />;
  if (sourceMs < 93834) return <TacticalPitch mode="egypt" sourceMs={sourceMs} />;
  return <TacticalPitch mode="argentina" sourceMs={sourceMs} />;
};

const Scene = ({frame, sourceMs, version}: {frame: number; sourceMs: number; version: AnalysisVersion}) => {
  if (version === 'official-highlights' && isOfficialHighlightActive(sourceMs)) {
    return <OfficialHighlightScene sourceMs={sourceMs} />;
  }
  if (sourceMs < 12015) return <HookScene frame={frame} sourceMs={sourceMs} />;
  if (sourceMs < 27375) return <FirstHalfScene sourceMs={sourceMs} />;
  if (sourceMs < 42135) return <VarArticleScene sourceMs={sourceMs} />;
  if (sourceMs < 52760) return <EgyptTwoScene sourceMs={sourceMs} />;
  if (sourceMs < 71355) return <ComebackScene frame={frame} sourceMs={sourceMs} />;
  return <TacticalScene sourceMs={sourceMs} />;
};

const clipFade = (localFrame: number, durationInFrames: number, isFirst: boolean, isLast: boolean) => {
  const fadeIn = isFirst
    ? 1
    : interpolate(localFrame, [0, CROSSFADE_FRAMES - 1], [0, 1], clamp);
  const fadeOut = isLast
    ? 1
    : interpolate(
      localFrame,
      [durationInFrames - CROSSFADE_FRAMES, durationInFrames - 1],
      [1, 0],
      clamp,
    );
  return Math.min(fadeIn, fadeOut);
};

const EditedClipVideo = ({
  durationInFrames,
  isFirst,
  isLast,
  layer,
  objectFit,
  sourceEndFrame,
  trimStartFrame,
}: {
  durationInFrames: number;
  isFirst: boolean;
  isLast: boolean;
  layer: 'blur' | 'speaker';
  objectFit: 'cover' | 'contain';
  sourceEndFrame: number;
  trimStartFrame: number;
}) => {
  const localFrame = useCurrentFrame();
  const fade = clipFade(localFrame, durationInFrames, isFirst, isLast);
  return (
    <OffthreadVideo
      className={`aea-source-video aea-source-video-${layer}`}
      muted={layer === 'blur'}
      src={staticFile(VIDEO_SRC)}
      trimAfter={sourceEndFrame}
      trimBefore={trimStartFrame}
      volume={layer === 'speaker' ? fade : 0}
      style={{opacity: fade, objectFit}}
    />
  );
};

const EditedVideoTrack = ({layer, objectFit}: {layer: 'blur' | 'speaker'; objectFit: 'cover' | 'contain'}) => (
  <>
    {argentinaEgyptEditClips.map((clip, index) => (
      <Sequence
        durationInFrames={clip.durationInFrames}
        from={clip.outputStartFrame}
        key={`${layer}-${clip.index}`}
        name={`${layer === 'speaker' ? 'A-roll' : 'Blur fill'} ${index + 1}`}
      >
        <EditedClipVideo
          durationInFrames={clip.durationInFrames}
          isFirst={index === 0}
          isLast={index === argentinaEgyptEditClips.length - 1}
          layer={layer}
          objectFit={objectFit}
          sourceEndFrame={clip.sourceEndFrame}
          trimStartFrame={clip.trimStartFrame}
        />
      </Sequence>
    ))}
  </>
);

const focusAmountAtFrame = (frame: number, sourceMs: number) => {
  const focusRanges = [
    [8640, 12000],
    [49640, 52440],
    [76290, 77810],
  ] as const;
  const active = focusRanges.find(([start, end]) => sourceMs >= start - 500 && sourceMs <= end + 500);
  if (!active) return 0;
  const [start, end] = active;
  const sourceRate = 1000 / ARGENTINA_EGYPT_FPS;
  const estimatedStartFrame = frame - (sourceMs - start) / sourceRate;
  const estimatedEndFrame = frame + (end - sourceMs) / sourceRate;
  return interpolate(
    frame,
    [estimatedStartFrame - 8, estimatedStartFrame + 8, estimatedEndFrame - 8, estimatedEndFrame + 8],
    [0, 1, 1, 0],
    {easing: Easing.inOut(Easing.cubic), ...clamp},
  );
};

const getFocusLabel = (sourceMs: number) => {
  if (sourceMs < 12015) return '心潮澎湃 · 热血沸腾';
  if (sourceMs < 52760) return '0:2 · 命悬一线';
  return '我发表一下我的观点';
};

const SpeakerLayer = ({frame, sourceMs}: {frame: number; sourceMs: number}) => {
  const focus = focusAmountAtFrame(frame, sourceMs);
  const left = interpolate(focus, [0, 1], [1510, 1070]);
  const top = interpolate(focus, [0, 1], [92, 0]);
  const width = interpolate(focus, [0, 1], [338, 760]);
  const height = interpolate(focus, [0, 1], [600, 1080]);
  const borderRadius = interpolate(focus, [0, 1], [18, 0]);

  return (
    <>
      <div className="aea-speaker-blur" style={{opacity: focus}}>
        <EditedVideoTrack layer="blur" objectFit="cover" />
        <div className="aea-speaker-blur-shade" />
      </div>
      <div
        className="aea-speaker-frame"
        style={{
          borderRadius,
          height,
          left,
          top,
          width,
          boxShadow: `0 24px 70px rgba(0,0,0,${0.36 * (1 - focus)})`,
        }}
      >
        <EditedVideoTrack layer="speaker" objectFit={focus > 0.55 ? 'contain' : 'cover'} />
        <div className="aea-live-tag" style={{opacity: 1 - focus}}><i /> ANALYSIS</div>
      </div>
      {focus > 0.02 && (
        <div className="aea-focus-quote" style={{opacity: focus, transform: `translateY(${(1 - focus) * 20}px)`}}>
          <span>REACTION</span><b>{getFocusLabel(sourceMs)}</b>
        </div>
      )}
    </>
  );
};

const DynamicCaption = ({frame, sourceMs}: {frame: number; sourceMs: number}) => {
  const {fps} = useVideoConfig();
  const segment = subtitleSegments.find(
    (item) => sourceMs >= item.start_ms - 40 && sourceMs < item.end_ms + 80,
  );
  if (!segment) return null;
  const words = normalizedWords.filter(
    (word) => word.end_ms > segment.start_ms && word.start_ms < segment.end_ms,
  );
  if (words.length === 0) return null;

  return (
    <div className="aea-caption-wrap">
      <div className="aea-caption-source">原声字幕</div>
      <div className="aea-caption-words">
        {words.map((word, index) => {
          const active = sourceMs >= word.start_ms - 35 && sourceMs < word.end_ms + 75;
          const spoken = sourceMs >= word.end_ms;
          const emphasized = word.emphasis || emphasisTerms.has(word.text);
          const activeDurationFrames = Math.max(0, ((sourceMs - word.start_ms) / 1000) * fps);
          const pop = active
            ? spring({frame: activeDurationFrames, fps, config: {damping: 12, stiffness: 230}})
            : 0;
          const scale = active ? 1 + pop * (emphasized ? 0.23 : 0.17) : emphasized ? 1.04 : 1;
          return (
            <span
              className={`aea-caption-word ${spoken ? 'is-spoken' : ''} ${active ? 'is-active' : ''} ${emphasized ? 'is-emphasis' : ''}`}
              key={`${word.start_ms}-${word.text}-${index}`}
              style={{transform: `translateY(${active ? -4 : 0}px) scale(${scale})`}}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const SourceRail = ({sourceMs, version}: {sourceMs: number; version: AnalysisVersion}) => {
  const sources = version === 'official-highlights' && isOfficialHighlightActive(sourceMs)
    ? ['FIFA OFFICIAL HIGHLIGHTS · M95']
    : sourceMs < 27375
    ? ['FIFA OFFICIAL REPORT']
    : sourceMs < 52760
      ? [sourceMs < 42135 ? 'CAF OFFICIAL' : 'AFC OFFICIAL']
      : sourceMs < 71355
        ? ['FIFA TIMELINE']
        : ['TACTICAL ILLUSTRATION', 'NO MATCH FOOTAGE'];
  return <div className="aea-source-rail">{sources.map((source) => <span key={source}>{source}</span>)}</div>;
};

export const ArgentinaEgyptAnalysis: React.FC<AnalysisProps> = ({version = 'web'}) => {
  const frame = useCurrentFrame();
  const sourceMs = outputFrameToSourceMs(frame);
  const sceneInfo = getSceneInfo(sourceMs);
  const sceneReveal = interpolate(frame, [0, 10], [.82, 1], {easing: Easing.out(Easing.cubic), ...clamp});

  return (
    <AbsoluteFill className="argentina-analysis">
      <AbsoluteFill className="aea-background">
        <div className="aea-background-glow" />
        <div className="aea-background-noise" />
        <Scene frame={frame} sourceMs={sourceMs} version={version} />
      </AbsoluteFill>
      <div className="aea-header" style={{opacity: sceneReveal}}>
        <div className="aea-section-index">{sceneInfo.section}</div>
        <div className="aea-title-block">
          <span>{sceneInfo.kicker}</span>
          <h1>{sceneInfo.title}</h1>
        </div>
      </div>
      <ScoreBug />
      <SourceRail sourceMs={sourceMs} version={version} />
      <SpeakerLayer frame={frame} sourceMs={sourceMs} />
      <DynamicCaption frame={frame} sourceMs={sourceMs} />
      <div className="aea-progress"><i style={{width: `${(frame / ARGENTINA_EGYPT_DURATION_IN_FRAMES) * 100}%`}} /></div>
    </AbsoluteFill>
  );
};
