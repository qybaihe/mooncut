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
import {FullscreenImpactText} from '../extensions/community-motion/FullscreenImpactText';
import {MacDesktop, MacFloatingVideoWindow, MacWindow} from '../extensions/community-motion/MacDesktop';
import {
  DEFAULT_TALKING_HEAD_GENERATION_PRESET,
  type TalkingHeadGenerationPreset,
} from '../presets/default-talking-head';
import subtitles from '../generated-horizontal-subtitles.json';
import type {HorizontalBeat, HorizontalVisual} from '../horizontal-timeline';
import {horizontalTimeline} from '../horizontal-timeline';
import './horizontal-launch.css';

type SubtitleWord = {
  text: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
  character_start: number;
  character_end: number;
};
type SubtitleSegment = {text: string; start_ms: number; end_ms: number};

const emphasisWords = new Set([
  '北京', '探月', '计划', '黑客松', '超级', '无敌', '重磅', 'GPT', '五点', '六',
  '发布', '实测', '前端', '页面', '震撼', '不一样', '自动', '剪辑', '口播', '系统',
  '初版', '效果',
]);

const displayCaptionWord = (
  word: SubtitleWord,
  index: number,
  entries: Array<{word: SubtitleWord; sourceIndex: number}>,
) => {
  if (word.text === 'GPT') return 'GPT-';
  if (word.text === '五点' && entries[index - 1]?.word.text === 'GPT') return '5.';
  if (
    word.text === '六' &&
    entries[index - 1]?.word.text === '五点' &&
    entries[index - 2]?.word.text === 'GPT'
  ) return '6';
  return word.text;
};

const activeBeat = (frame: number) =>
  horizontalTimeline.beats.find((beat) => frame >= beat.start && frame < beat.end) ??
  horizontalTimeline.beats[horizontalTimeline.beats.length - 1];

type MotionMode = 'baseline' | 'effects-lab';
type WindowTones = TalkingHeadGenerationPreset['windows'];

const impactMoments = [
  // The impact itself lands on the spoken keyword, not merely after it.
  {from: 450, duration: 42, text: 'GPT-5.6\n正式发布', accent: '#65d9b6'},
  {from: 565, duration: 32, text: '太震撼了', accent: '#ffd166'},
  {from: 802, duration: 44, text: '自动剪辑', accent: '#ff7951'},
] as const;

const isInsideImpactMoment = (frame: number) =>
  impactMoments.some((moment) => frame >= moment.from && frame < moment.from + moment.duration);

const ImpactMoments = () => (
  <>
    {impactMoments.map((moment) => (
      <Sequence from={moment.from} durationInFrames={moment.duration} key={moment.text}>
        <FullscreenImpactText
          accent={moment.accent}
          backdropOpacity={0.88}
          duration={moment.duration}
          text={moment.text}
        />
      </Sequence>
    ))}
  </>
);

const EventStage = ({
  appName,
  duration,
  enhanced,
  localFrame,
  tone,
}: {
  appName: string;
  duration: number;
  enhanced: boolean;
  localFrame: number;
  tone: WindowTones['utilityTone'];
}) => {
  const posterScroll = interpolate(localFrame, [0, duration], [0, 1420], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const backdropScale = enhanced
    ? interpolate(localFrame, [0, duration], [1.035, 1.1], {
        easing: Easing.inOut(Easing.cubic),
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  const backdropX = enhanced ? interpolate(localFrame, [0, duration], [-18, 18]) : 0;
  const {fps} = useVideoConfig();
  const phoneIn = enhanced
    ? spring({frame: localFrame - 8, fps, config: {damping: 18, stiffness: 118}})
    : 1;
  const focusIn = enhanced
    ? spring({frame: localFrame - 30, fps, config: {damping: 17, stiffness: 120}})
    : 0;

  return (
    <div className="h-event-stage">
      <Img
        className="h-event-backdrop"
        src={staticFile('assets/moonshot-wechat-article.webp')}
        style={{transform: `translateX(${backdropX}px) scale(${backdropScale})`}}
      />
      <div className="h-event-wash" />
      <div
        className="h-event-phone"
        style={{
          opacity: phoneIn,
          transform: enhanced ? `translateY(${(1 - phoneIn) * 34}px) scale(${0.97 + phoneIn * 0.03})` : undefined,
        }}
      >
        <div className="h-phone-bar"><span>9:41</span><b>探月计划</b><span>•••</span></div>
        <div className="h-phone-viewport">
          <Img
            className="h-event-poster"
            src={staticFile('assets/moonshot-wechat-article.webp')}
            style={{transform: `translateY(${-posterScroll}px)`}}
          />
        </div>
      </div>
      {enhanced ? (
        <div
          style={{
            border: '2px solid #ffb36f',
            boxShadow: `0 0 ${18 + focusIn * 20}px rgba(255, 179, 111, ${0.18 + focusIn * 0.28}), 0 0 0 8px rgba(255, 179, 111, ${focusIn * 0.08})`,
            height: 734,
            left: 63,
            opacity: focusIn,
            pointerEvents: 'none',
            position: 'absolute',
            top: 197,
            transform: `scale(${0.985 + focusIn * 0.015})`,
            transformOrigin: 'center',
            width: 404,
            zIndex: 2,
          }}
        >
          <span
            style={{
              background: '#ffb36f',
              color: '#21130d',
              fontFamily: 'Menlo, Monaco, monospace',
              fontSize: 11,
              fontWeight: 800,
              left: 12,
              letterSpacing: 1.2,
              padding: '6px 8px',
              position: 'absolute',
              top: -31,
            }}
          >
            POSTER · VERIFIED
          </span>
        </div>
      ) : null}
      <MacWindow
        bodyClassName="h-event-facts"
        className="h-event-facts-window"
        kind="utility"
        title={`活动信息 · ${appName}`}
        tone={tone}
        toolbar={<span className="h-native-live"><i /> LIVE</span>}
      >
        <div className="h-fact-primary"><b>PHYSICAL AI</b><span>HACKATHON</span></div>
        <div className="h-fact-grid">
          <span><small>DATE</small><b>07.10–07.12</b></span>
          <span><small>CITY</small><b>北京 · 中关村</b></span>
          <span><small>FORMAT</small><b>48H 极限创造</b></span>
          <span><small>STATUS</small><b className="h-live"><i /> LIVE</b></span>
        </div>
        <div className="h-source-line">活动信息经主办方海报与公开赛事页交叉核验</div>
      </MacWindow>
    </div>
  );
};

const BrowserEvidenceFocus = ({
  localFrame,
  pageShift,
  visual,
}: {
  localFrame: number;
  pageShift: number;
  visual: 'release' | 'design';
}) => {
  const {fps} = useVideoConfig();
  const inProgress = spring({frame: localFrame - 18, fps, config: {damping: 18, stiffness: 130}});
  const config = visual === 'release'
    ? {left: 274, top: 102 + pageShift, width: 912, height: 246, label: 'OFFICIAL RELEASE'}
    : {left: 500, top: 89 + pageShift, width: 770, height: 274, label: 'DESIGN EVIDENCE'};
  const clickProgress = interpolate(localFrame, [36, 50], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const clickOpacity = interpolate(localFrame, [36, 42, 54], [0, 0.6, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{inset: 0, opacity: inProgress, pointerEvents: 'none', position: 'absolute', zIndex: 4}}>
      <div
        style={{
          border: '2px solid #72e2bf',
          boxShadow: `0 0 0 2400px rgba(0, 0, 0, ${0.22 * inProgress}), 0 0 ${18 + inProgress * 22}px rgba(114, 226, 191, 0.55)`,
          height: config.height,
          left: config.left,
          position: 'absolute',
          top: config.top,
          transform: `scale(${0.97 + inProgress * 0.03})`,
          transformOrigin: 'center',
          width: config.width,
        }}
      >
        <span
          style={{
            background: '#72e2bf',
            color: '#07130f',
            fontFamily: 'Menlo, Monaco, monospace',
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 1.2,
            padding: '7px 10px',
            position: 'absolute',
            right: -2,
            top: -33,
          }}
        >
          {config.label}
        </span>
        <div
          style={{
            border: '2px solid #ffd166',
            borderRadius: '50%',
            height: 46,
            left: config.width * 0.66 - 23,
            opacity: clickOpacity,
            position: 'absolute',
            top: config.height * 0.55 - 23,
            transform: `scale(${0.25 + clickProgress * 1.7})`,
            width: 46,
          }}
        />
      </div>
    </div>
  );
};

const BrowserStage = ({
  enhanced,
  visual,
  duration,
  localFrame,
  tone,
}: {
  enhanced: boolean;
  visual: 'release' | 'design';
  duration: number;
  localFrame: number;
  tone: WindowTones['browserTone'];
}) => {
  const isRelease = visual === 'release';
  const pageShift = interpolate(localFrame, [0, duration], [0, isRelease ? -105 : -72], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const cursorX = interpolate(localFrame, [0, duration], [860, 1130], {extrapolateRight: 'clamp'});
  const cursorY = interpolate(localFrame, [0, duration], [510, 360], {extrapolateRight: 'clamp'});
  const scrollProgress = interpolate(localFrame, [0, duration], [9, 72], {extrapolateRight: 'clamp'});
  const asset = isRelease ? 'assets/openai-gpt56-release-hero.png' : 'assets/openai-gpt56-design-verified.png';

  return (
    <div className="h-browser-stage">
      <MacWindow
        bodyClassName="h-browser-app"
        className="h-browser-window"
        kind="browser"
        title={isRelease ? 'GPT-5.6 — Safari' : 'GPT-5.6 Design — Safari'}
        tone={tone}
      >
        <div className="h-browser-bar">
          <div className="h-browser-navigation"><span>‹</span><span>›</span></div>
          <div className="h-address">openai.com/index/gpt-5-6/{isRelease ? '' : '#a-leap-forward-in-design'}</div>
          <div className="h-browser-actions"><span>↻</span><span>⋯</span></div>
        </div>
        <div className="h-browser-viewport">
          <Img className="h-browser-page" src={staticFile(asset)} style={{transform: `translateY(${pageShift}px) scale(1.015)`}} />
          <div className="h-cursor" style={{left: cursorX, top: cursorY}}><span /></div>
          <div className="h-scroll-track"><i style={{top: `${scrollProgress}%`}} /></div>
        </div>
        {enhanced ? <BrowserEvidenceFocus localFrame={localFrame} pageShift={pageShift} visual={visual} /> : null}
        <div className="h-verified"><i>✓</i><span>OPENAI OFFICIAL</span><b>VERIFIED SOURCE</b></div>
      </MacWindow>
    </div>
  );
};

const PipelineStage = ({
  appName,
  duration,
  enhanced,
  localFrame,
  tone,
}: {
  appName: string;
  duration: number;
  enhanced: boolean;
  localFrame: number;
  tone: WindowTones['appTone'];
}) => {
  const nodes = [
    {step: '01', label: '口播视频', meta: 'MP4 · 1080P'},
    {step: '02', label: 'ASR 转写', meta: '逐词时间戳'},
    {step: '03', label: '语义分镜', meta: '重点 · 节奏'},
    {step: '04', label: '真实素材', meta: '搜索 · 核验'},
    {step: '05', label: 'Remotion', meta: '字幕 · 渲染'},
  ];
  const progress = interpolate(localFrame, [0, duration - 8], [0, 100], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateRight: 'clamp',
  });
  const activeIndex = Math.min(nodes.length - 1, Math.floor((progress / 100) * nodes.length));

  return (
    <div className="h-pipeline-stage">
      <MacWindow
        bodyClassName="h-pipeline-workspace"
        className="h-pipeline-window"
        kind="app"
        title={`${appName} · Workflow`}
        tone={tone}
        toolbar={<span className="h-native-live"><i /> RUNNING</span>}
      >
      <div className="h-pipeline-line"><span style={{width: `${progress}%`}} /></div>
      <div className="h-pipeline-nodes">
        {nodes.map((node, index) => {
          const revealAt = index * 12;
          const reveal = interpolate(localFrame, [revealAt, revealAt + 16], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div
              className={`h-pipeline-node ${index < activeIndex ? 'is-done' : ''} ${index === activeIndex ? 'is-active' : ''}`}
              key={node.step}
              style={{opacity: reveal, transform: `translateY(${(1 - reveal) * 24}px)`}}
            >
              <small>{node.step}</small>
              <b>{node.label}</b>
              <span>{node.meta}</span>
              <i>{index < activeIndex ? '✓' : index === activeIndex ? '●' : '○'}</i>
            </div>
          );
        })}
      </div>
      <div className="h-pipeline-evidence">
        {[
          ['assets/moonshot-wechat-article.webp', '活动海报'],
          ['assets/openai-gpt56-release-hero.png', '官方发布页'],
          ['assets/openai-gpt56-design-verified.png', '设计案例'],
        ].map(([asset, label], index) => {
          const evidenceIn = enhanced
            ? spring({frame: localFrame - 48 - index * 6, fps: 30, config: {damping: 17, stiffness: 132}})
            : 1;
          return (
            <div
              key={asset}
              style={{
                opacity: evidenceIn,
                transform: enhanced ? `translateY(${(1 - evidenceIn) * 22}px) scale(${0.96 + evidenceIn * 0.04})` : undefined,
                transformOrigin: 'left center',
              }}
            >
              <Img src={staticFile(asset)} /><span>{label}</span>
            </div>
          );
        })}
      </div>
      <div className="h-pipeline-log">
        {[
          ['00:06', 'ASR COMPLETE', '136 TOKENS'],
          ['00:12', 'STORY BEATS', '10 SCENES'],
          ['00:18', 'SOURCE CHECK', '3 VERIFIED'],
          ['00:24', 'CAPTION FX', 'WORD LEVEL'],
        ].map(([time, label, value], index) => {
          const reveal = interpolate(localFrame, [34 + index * 9, 46 + index * 9], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return <div key={label} style={{opacity: reveal}}><small>{time}</small><b>{label}</b><span>{value}</span><i /></div>;
        })}
      </div>
      <div className="h-pipeline-io">
        <div><small>INPUT</small><b>横屏口播 · 41.1 秒</b><span>画面 + 原声</span></div>
        <i>→</i>
        <div><small>OUTPUT</small><b>完整剧情化视频</b><span>真实素材 + 动态字幕 + 自动分镜</span></div>
      </div>
      </MacWindow>
    </div>
  );
};

const waveform = Array.from({length: 54}, (_, index) => 18 + ((index * 37) % 54));

const EditorStage = ({
  appName,
  frame,
  src,
  tone,
}: {
  appName: string;
  frame: number;
  src: string;
  tone: WindowTones['appTone'];
}) => {
  const {fps} = useVideoConfig();
  const currentMs = (frame / fps) * 1000;
  const currentSegment = (subtitles.segments as SubtitleSegment[]).find(
    (segment) => currentMs >= segment.start_ms && currentMs < segment.end_ms,
  );
  const playhead = (frame / horizontalTimeline.durationInFrames) * 100;

  return (
    <MacWindow
      bodyClassName="h-editor-window-body"
      className="h-editor-stage"
      kind="app"
      title={`${appName} · Auto Cut`}
      tone={tone}
      toolbar={<span className="h-native-live"><i /> LIVE</span>}
    >
      <div className="h-editor-topbar">
        <b>AUTO CUT · PROJECT 01</b>
        <span><i /> PROCESSING LIVE</span>
        <small>1920 × 1080 · 30 FPS</small>
      </div>
      <div className="h-editor-main">
        <div className="h-editor-preview">
          <OffthreadVideo src={staticFile(src)} volume={0} />
          <div className="h-preview-safe" />
          <div className="h-preview-caption">{currentSegment?.text.replace(/\n/g, '') ?? '整套系统自动完成剪辑'}</div>
        </div>
        <div className="h-editor-inspector">
          <div className="h-inspector-title"><b>语义分镜</b><span>AUTO</span></div>
          {[
            ['00:12', 'GPT-5.6 发布', 'OFFICIAL PAGE'],
            ['00:18', '前端效果震撼', 'FOCUS PERSON'],
            ['00:24', '自动剪口播', 'PIPELINE'],
            ['00:35', '初版测试', 'FULL SCREEN'],
          ].map(([time, text, tag], index) => (
            <div className={`h-inspector-row ${index === 2 ? 'is-selected' : ''}`} key={time}>
              <small>{time}</small><b>{text}</b><span>{tag}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="h-editor-timeline">
        <div className="h-track-labels"><span>VIDEO</span><span>ASSETS</span><span>CAPTION</span><span>AUDIO</span></div>
        <div className="h-tracks">
          <div className="h-track h-track-video"><i style={{width: '100%'}}>TALKING HEAD · 41.1s</i></div>
          <div className="h-track h-track-assets"><i style={{left: '29%', width: '18%'}}>OPENAI</i><i style={{left: '47%', width: '16%'}}>DESIGN</i><i style={{left: '63%', width: '24%'}}>PIPELINE</i></div>
          <div className="h-track h-track-caption"><i style={{width: '100%'}}>WORD-LEVEL SUBTITLES</i></div>
          <div className="h-track h-track-audio">{waveform.map((height, index) => <i key={index} style={{height}} />)}</div>
          <div className="h-playhead" style={{left: `${playhead}%`}}><i /></div>
        </div>
      </div>
    </MacWindow>
  );
};

const BetaStage = ({
  appName,
  localFrame,
  tone,
}: {
  appName: string;
  localFrame: number;
  tone: WindowTones['utilityTone'];
}) => {
  const rows = [
    ['ASR', '逐词时间戳已生成'],
    ['SOURCES', '官方页面已核验'],
    ['CAPTIONS', '重点词动画已生成'],
  ];
  return (
    <div className="h-beta-stage">
      <MacWindow
        bodyClassName="h-beta-stack"
        className="h-beta-window"
        kind="utility"
        title={`${appName} · Beta Check`}
        tone={tone}
        toolbar={<span className="h-native-live"><i /> READY</span>}
      >
        {rows.map(([label, detail], index) => {
          const reveal = interpolate(localFrame, [index * 7, index * 7 + 12], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div key={label} style={{opacity: reveal, transform: `translateX(${(1 - reveal) * -28}px)`}}>
              <span>0{index + 1}</span><b>{label}</b><small>{detail}</small><i>✓</i>
            </div>
          );
        })}
      </MacWindow>
      <div className="h-beta-note"><b>V0.1</b><span>测试不是终点<br />它是下一次迭代的输入</span></div>
    </div>
  );
};

const Stage = ({
  beat,
  enhanced,
  frame,
  localFrame,
  preset,
  src,
}: {
  beat: HorizontalBeat;
  enhanced: boolean;
  frame: number;
  localFrame: number;
  preset: TalkingHeadGenerationPreset;
  src: string;
}) => {
  const duration = beat.end - beat.start;
  if (beat.visual === 'event') {
    return <EventStage appName={preset.desktop.applicationName} duration={duration} enhanced={enhanced} localFrame={localFrame} tone={preset.windows.utilityTone} />;
  }
  if (beat.visual === 'release' || beat.visual === 'design') {
    return <BrowserStage duration={duration} enhanced={enhanced} localFrame={localFrame} tone={preset.windows.browserTone} visual={beat.visual} />;
  }
  if (beat.visual === 'pipeline') return <PipelineStage appName={preset.desktop.applicationName} duration={duration} enhanced={enhanced} localFrame={localFrame} tone={preset.windows.appTone} />;
  if (beat.visual === 'editor') return <EditorStage appName={preset.desktop.applicationName} frame={frame} src={src} tone={preset.windows.appTone} />;
  if (beat.visual === 'beta') return <BetaStage appName={preset.desktop.applicationName} localFrame={localFrame} tone={preset.windows.utilityTone} />;
  return null;
};

const Speaker = ({
  beat,
  localFrame,
  src,
  tone,
}: {
  beat: HorizontalBeat;
  localFrame: number;
  src: string;
  tone: WindowTones['cameraTone'];
}) => {
  const {fps} = useVideoConfig();
  const entrance = spring({frame: localFrame, fps, config: {damping: 20, stiffness: 120}});
  if (beat.speakerMode === 'embedded') return null;
  const className = `h-speaker h-speaker-${beat.speakerMode}`;

  if (beat.speakerMode !== 'hero') {
    return (
      <MacFloatingVideoWindow
        className={className}
        title={beat.speakerMode === 'side' ? '现场记录 · Camera' : 'Camera'}
        tone={tone}
        toolbar={<span className="h-camera-live"><i /> LIVE</span>}
        style={{opacity: entrance, transform: `translateY(${(1 - entrance) * 26}px)`}}
      >
        <OffthreadVideo className="h-speaker-video" src={staticFile(src)} volume={0} />
      </MacFloatingVideoWindow>
    );
  }

  return (
    <div className={className} style={{opacity: entrance}}>
      <OffthreadVideo className="h-speaker-video" src={staticFile(src)} volume={0} />
      <div className="h-hero-shade" />
    </div>
  );
};

const HeroAccents = ({visual, localFrame}: {visual: HorizontalVisual; localFrame: number}) => {
  const {fps} = useVideoConfig();
  const pop = spring({frame: localFrame, fps, config: {damping: 16, stiffness: 145}});
  if (visual === 'intro') {
    return <div className="h-intro-badge" style={{transform: `translateY(${(1 - pop) * 20}px)`, opacity: pop}}><i /> 现场记录 · BEIJING</div>;
  }
  if (visual === 'reaction') {
    return <div className="h-reaction-stamp" style={{transform: `rotate(-4deg) scale(${0.82 + pop * 0.18})`, opacity: pop}}>WOW<br /><span>FRONT-END</span></div>;
  }
  if (visual === 'closing') {
    return (
      <div className="h-closing-status" style={{opacity: pop}}>
        <span><i /> ASR READY</span><span><i /> SOURCES VERIFIED</span><span><i /> RENDERING</span>
      </div>
    );
  }
  return null;
};

const DynamicCaption = ({frame}: {frame: number}) => {
  const {fps} = useVideoConfig();
  const currentMs = (frame / fps) * 1000;
  const segment = (subtitles.segments as SubtitleSegment[]).find(
    (item) => currentMs >= item.start_ms && currentMs < item.end_ms,
  );
  if (!segment) return null;

  const allWords = subtitles.words as SubtitleWord[];
  const words = allWords.map((word, sourceIndex) => ({word, sourceIndex})).filter(
    ({word}) => word.start_ms >= segment.start_ms - 80 && word.start_ms < segment.end_ms,
  );
  const segmentText = segment.text.replace(/\s+/g, '');
  let textCursor = 0;
  const captionEntries = words.map((entry, index) => {
    const wordStart = segmentText.indexOf(entry.word.text, textCursor);
    if (wordStart < 0) return {...entry, punctuation: ''};
    const wordEnd = wordStart + entry.word.text.length;
    const nextText = words[index + 1]?.word.text;
    const nextStart = nextText ? segmentText.indexOf(nextText, wordEnd) : segmentText.length;
    const between = nextStart >= wordEnd ? segmentText.slice(wordEnd, nextStart) : '';
    textCursor = wordEnd;
    const punctuation = /^[，。！？、；：,.!?…—“”‘’（）()]*$/.test(between) ? between : '';
    return {...entry, punctuation};
  });
  const activeWordIndex = words.reduce((bestIndex, entry, index) => {
    const active = currentMs >= entry.word.start_ms && currentMs < entry.word.end_ms + 60;
    if (!active) return bestIndex;
    if (bestIndex === -1 || entry.word.start_ms > words[bestIndex].word.start_ms) return index;
    return bestIndex;
  }, -1);

  return (
    <div className="h-caption">
      <div className="h-caption-words">
        {captionEntries.map(({word, punctuation}, index) => {
          const active = index === activeWordIndex;
          const spoken = currentMs >= word.end_ms || (activeWordIndex >= 0 && index < activeWordIndex);
          const emphasized = emphasisWords.has(word.text);
          const startFrame = (word.start_ms / 1000) * fps;
          const pop = active
            ? spring({frame: Math.max(0, frame - startFrame), fps, config: {damping: 13, stiffness: 230}})
            : 0;
          return (
            <span
              className={`h-caption-word ${spoken ? 'is-spoken' : ''} ${active ? 'is-active' : ''} ${emphasized ? 'is-emphasis' : ''}`}
              key={`${word.start_ms}-${word.text}-${index}`}
              style={{transform: `translateY(${active ? -2 : 0}px) scale(${active ? 1 + pop * (emphasized ? 0.11 : 0.07) : 1})`}}
            >
              {displayCaptionWord(word, index, words)}{punctuation}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export const HorizontalLaunchVideo: React.FC<{
  generationPreset?: TalkingHeadGenerationPreset;
  talkingHeadSrc: string;
  motionMode?: MotionMode;
}> = ({
  generationPreset = DEFAULT_TALKING_HEAD_GENERATION_PRESET,
  talkingHeadSrc,
  motionMode = 'baseline',
}) => {
  const frame = useCurrentFrame();
  const beat = activeBeat(frame);
  const localFrame = frame - beat.start;
  const enhanced = motionMode === 'effects-lab';
  const impactIsActive = enhanced && isInsideImpactMoment(frame);
  const desktopIsEnabled = generationPreset.rules.desktopScenes.some((visual) => visual === beat.visual);
  const reveal = interpolate(localFrame, [0, 15], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill className={`h-canvas h-visual-${beat.visual}`}>
      <OffthreadVideo className="h-audio-source" src={staticFile(talkingHeadSrc)} />
      {desktopIsEnabled ? (
        <MacDesktop
          applicationName={generationPreset.desktop.applicationName}
          shade={generationPreset.desktop.shade}
          showDock={generationPreset.desktop.showDock}
          showMenuBar={generationPreset.desktop.showMenuBar}
        />
      ) : null}
      <AbsoluteFill className="h-stage"><Stage beat={beat} enhanced={enhanced} frame={frame} localFrame={localFrame} preset={generationPreset} src={talkingHeadSrc} /></AbsoluteFill>
      <Speaker beat={beat} localFrame={localFrame} src={talkingHeadSrc} tone={generationPreset.windows.cameraTone} />
      {!impactIsActive ? (
        <>
          <div className={`h-title h-title-${beat.speakerMode}`} style={{opacity: reveal, transform: `translateY(${(1 - reveal) * 20}px)`}}>
            <div className="h-kicker">{beat.kicker}</div>
            <h1>{beat.title}</h1>
          </div>
          <HeroAccents localFrame={localFrame} visual={beat.visual} />
          <DynamicCaption frame={frame} />
        </>
      ) : null}
      {enhanced ? <ImpactMoments /> : null}
      <div className="h-progress"><span style={{width: `${(frame / horizontalTimeline.durationInFrames) * 100}%`}} /></div>
    </AbsoluteFill>
  );
};
