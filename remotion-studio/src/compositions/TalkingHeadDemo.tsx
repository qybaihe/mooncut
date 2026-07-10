import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {dbToVolume, getBgmTrack} from '../bgm';
import {
  FaceTrackedVideo,
  type FaceFramingProfile,
  type FaceTrackManifest,
} from '../components/FaceTrackedVideo';
import subtitles from '../generated-subtitles.json';
import type {TimelineBeat, VideoTimeline} from '../timeline';
import './talking-head.css';

export type TalkingHeadDemoProps = {
  timeline: VideoTimeline;
  talkingHeadSrc: string | null;
  faceTrack: FaceTrackManifest | null;
  sourceAspectRatio?: number;
  bgmTrackId?: string | null;
  bgmGainOffsetDb?: number;
  sourceSegments?: SourceTimeSegment[];
};
export type SourceTimeSegment = {
  outputStartFrame: number;
  outputEndFrame: number;
  sourceStartFrame: number;
};
type SubtitleWord = {text: string; start_ms: number; end_ms: number; confidence: number};
type SubtitleSegment = {text: string; start_ms: number; end_ms: number};

const pipFraming: FaceFramingProfile = {
  aspectRatio: 1,
  faceFill: 0.68,
  anchor: [0.5, 0.45],
  shape: 'circle',
  maxZoom: 4,
  edgeMode: 'pad',
};

const emphasisWords = new Set([
  '北京', '探月', '计划', '黑客', 'OpenAI', 'GPT', '5.6', '实测', '震撼',
  '前端', '能力', '飞', '提升', 'GLM', '加持', '厉害',
]);

const activeBeat = (frame: number, beats: TimelineBeat[]) =>
  beats.find((beat) => frame >= beat.start && frame < beat.end) ?? beats[beats.length - 1];

const speakerModeRunStart = (beat: TimelineBeat, beats: TimelineBeat[]) => {
  let index = beats.indexOf(beat);
  while (index > 0 && beats[index - 1].speakerMode === beat.speakerMode) index -= 1;
  return beats[Math.max(0, index)]?.start ?? beat.start;
};

export const validateSourceSegments = (
  segments: readonly SourceTimeSegment[],
  durationInFrames: number,
) => {
  if (segments.length === 0) return segments;
  let expectedStart = 0;
  for (const segment of segments) {
    const values = [segment.outputStartFrame, segment.outputEndFrame, segment.sourceStartFrame];
    if (!values.every(Number.isInteger) || segment.sourceStartFrame < 0) {
      throw new Error('TalkingHeadDemo source segments require non-negative integer frames');
    }
    if (segment.outputStartFrame !== expectedStart || segment.outputEndFrame <= segment.outputStartFrame) {
      throw new Error('TalkingHeadDemo source segments must be ordered, contiguous, and non-overlapping');
    }
    expectedStart = segment.outputEndFrame;
  }
  if (expectedStart !== durationInFrames) {
    throw new Error('TalkingHeadDemo source segments must cover the complete output timeline');
  }
  return segments;
};

const resolveSourceTiming = (frame: number, segments: readonly SourceTimeSegment[]) => {
  const segment = segments.find(
    (item) => frame >= item.outputStartFrame && frame < item.outputEndFrame,
  );
  if (!segment) return {sourceFrame: frame, trimBefore: 0};
  const trimBefore = segment.sourceStartFrame - segment.outputStartFrame;
  if (trimBefore < 0) {
    throw new Error('TalkingHeadDemo source segments require non-negative trimBefore offsets');
  }
  return {
    sourceFrame: segment.sourceStartFrame + (frame - segment.outputStartFrame),
    trimBefore,
  };
};

const BrowserChrome = ({url, dark = false}: {url: string; dark?: boolean}) => (
  <div className={`browser-bar ${dark ? 'browser-bar-dark' : ''}`}>
    <i /><i /><i />
    <span>{url}</span>
  </div>
);

const ScrollingDocument = ({
  asset,
  badge,
  dark = false,
  duration,
  from,
  localFrame,
  mode = 'browser',
  to,
  url,
}: {
  asset: string;
  badge: string;
  dark?: boolean;
  duration: number;
  from: number;
  localFrame: number;
  mode?: 'browser' | 'wechat';
  to: number;
  url: string;
}) => {
  const {fps} = useVideoConfig();
  const entrance = spring({frame: localFrame, fps, config: {damping: 18, stiffness: 115}});
  const scroll = interpolate(localFrame, [10, Math.max(11, duration - 8)], [from, to], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  if (mode === 'wechat') {
    return (
      <div className="wechat-reader" style={{opacity: entrance, transform: `translateY(${(1 - entrance) * 36}px) scale(${0.95 + entrance * 0.05})`}}>
        <div className="wechat-status"><b>公众号</b><span>PraxisGrowth</span><i>•••</i></div>
        <div className="document-viewport wechat-viewport">
          <Img className="wechat-long-image" src={staticFile(asset)} style={{transform: `translateY(${-scroll}px)`}} />
        </div>
        <div className="capture-badge">{badge}</div>
      </div>
    );
  }

  return (
    <div className="browser-window browser-capture" style={{opacity: entrance, transform: `translateY(${(1 - entrance) * 38}px) scale(${0.95 + entrance * 0.05})`}}>
      <BrowserChrome url={url} dark={dark} />
      <div className="document-viewport browser-document-viewport">
        <Img className="browser-long-image" src={staticFile(asset)} style={{transform: `translateY(${-scroll}px)`}} />
      </div>
      <div className="capture-badge">{badge}</div>
      <div className="scroll-indicator"><span style={{height: `${28 + (localFrame / duration) * 54}px`}} /></div>
    </div>
  );
};

const OpinionStage = ({beat, localFrame}: {beat: TimelineBeat; localFrame: number}) => {
  const reveal = interpolate(localFrame, [4, 22], [0, 1], {easing: Easing.out(Easing.cubic), extrapolateRight: 'clamp'});
  return (
    <div className="opinion-stage" style={{opacity: reveal}}>
      <div className="opinion-rule" />
      {beat.keywords.map((keyword, index) => <span key={keyword} style={{transform: `translateY(${(1 - reveal) * (22 + index * 8)}px)`}}>{keyword}</span>)}
    </div>
  );
};

const ClosingStage = ({localFrame}: {localFrame: number}) => {
  const rise = interpolate(localFrame, [0, 46], [36, 0], {extrapolateRight: 'clamp'});
  const opacity = interpolate(localFrame, [0, 22], [0, 1], {extrapolateRight: 'clamp'});
  return (
    <div className="closing-stage" style={{opacity, transform: `translateY(${rise}px)`}}>
      <div className="build-stamp">BUILD NEXT</div>
      <div className="closing-grid"><span>01<br /><b>IDEA</b></span><span>02<br /><b>TEST</b></span><span>03<br /><b>SHIP</b></span></div>
    </div>
  );
};

const Background = ({beat, localFrame}: {beat: TimelineBeat; localFrame: number}) => {
  const duration = beat.end - beat.start;
  if (beat.visual === 'event') {
    return <ScrollingDocument asset="assets/moonshot-wechat-article.webp" badge="公众号原文海报" duration={duration} from={0} localFrame={localFrame} mode="wechat" to={1050} url="PraxisGrowth" />;
  }
  if (beat.visual === 'gpt-release') {
    return <ScrollingDocument asset="assets/openai-gpt56-full.png" badge="OPENAI · JUL 9, 2026" dark duration={duration} from={0} localFrame={localFrame} to={1180} url="openai.com/index/gpt-5-6" />;
  }
  if (beat.visual === 'coding') {
    return <ScrollingDocument asset="assets/openai-gpt56-design.png" badge="A LEAP FORWARD IN DESIGN" dark duration={duration} from={0} localFrame={localFrame} to={220} url="openai.com/index/gpt-5-6#design" />;
  }
  if (beat.visual === 'opinion') return <OpinionStage beat={beat} localFrame={localFrame} />;
  return <ClosingStage localFrame={localFrame} />;
};

const PlaceholderSpeaker = () => (
  <div className="speaker-video-placeholder">
    <div className="speaker-face" />
    <div className="speaker-torso" />
    <div className="speaker-name">YOUR TALKING HEAD</div>
  </div>
);

const Speaker = ({
  beat,
  faceTrack,
  localFrame,
  sourceAspectRatio,
  sourceTimeMs,
  trimBefore,
  src,
}: {
  beat: TimelineBeat;
  faceTrack: FaceTrackManifest | null;
  localFrame: number;
  sourceAspectRatio: number;
  sourceTimeMs: number;
  trimBefore: number;
  src: string | null;
}) => {
  const {fps} = useVideoConfig();
  const entrance = spring({frame: localFrame, fps, config: {damping: 18, stiffness: 130}});

  if (beat.speakerMode === 'native') {
    return (
      <div className="speaker speaker-native" style={{opacity: entrance}}>
        {src ? (
          <>
            <OffthreadVideo className="speaker-native-blur" src={staticFile(src)} trimBefore={trimBefore} volume={0} />
            <div className="speaker-native-shade" />
            <div className="speaker-native-video">
              <OffthreadVideo
                className="speaker-native-source"
                src={staticFile(src)}
                trimBefore={trimBefore}
              />
            </div>
          </>
        ) : <PlaceholderSpeaker />}
      </div>
    );
  }

  return (
    <div className="speaker speaker-circle" style={{opacity: entrance, transform: `translateY(${(1 - entrance) * -22}px)`}}>
      {src ? (
        <FaceTrackedVideo
          className="speaker-video"
          faceTrack={faceTrack}
          framing={pipFraming}
          sourceAspectRatio={sourceAspectRatio}
          sourceTimeMs={sourceTimeMs}
          src={staticFile(src)}
          trimBefore={trimBefore}
        />
      ) : <PlaceholderSpeaker />}
    </div>
  );
};

const DynamicCaption = ({frame}: {frame: number}) => {
  const {fps} = useVideoConfig();
  const currentMs = (frame / fps) * 1000;
  const segment = (subtitles.segments as SubtitleSegment[]).find((item) => currentMs >= item.start_ms && currentMs < item.end_ms);
  if (!segment) return null;

  const words = (subtitles.words as SubtitleWord[]).filter(
    (word) => word.end_ms > segment.start_ms && word.start_ms < segment.end_ms,
  );

  return (
    <div className="caption">
      <span className="caption-dot" />
      <div className="caption-words">
        {words.map((word, index) => {
          const active = currentMs >= word.start_ms && currentMs < word.end_ms + 70;
          const spoken = currentMs >= word.end_ms;
          const emphasized = emphasisWords.has(word.text);
          const startFrame = (word.start_ms / 1000) * fps;
          const pop = active ? spring({frame: Math.max(0, frame - startFrame), fps, config: {damping: 13, stiffness: 220}}) : 0;
          const scale = active ? 1 + pop * (emphasized ? 0.28 : 0.14) : emphasized ? 1.05 : 1;
          return (
            <span className={`caption-word ${active ? 'caption-word-active' : ''} ${spoken ? 'caption-word-spoken' : ''} ${emphasized ? 'caption-word-emphasis' : ''}`} key={`${word.start_ms}-${word.text}-${index}`} style={{transform: `translateY(${active ? -4 : 0}px) scale(${scale})`}}>
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export const TalkingHeadDemo: React.FC<TalkingHeadDemoProps> = ({
  bgmGainOffsetDb = 0,
  bgmTrackId = null,
  faceTrack,
  sourceAspectRatio = 9 / 16,
  sourceSegments = [],
  timeline,
  talkingHeadSrc,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const validatedSourceSegments = React.useMemo(
    () => validateSourceSegments(sourceSegments, timeline.durationInFrames),
    [sourceSegments, timeline.durationInFrames],
  );
  const beat = activeBeat(frame, timeline.beats);
  const localFrame = frame - beat.start;
  const speakerLocalFrame = frame - speakerModeRunStart(beat, timeline.beats);
  const {sourceFrame, trimBefore} = resolveSourceTiming(frame, validatedSourceSegments);
  const sourceTimeMs = (sourceFrame / fps) * 1000;
  const reveal = interpolate(localFrame, [0, 16], [0, 1], {easing: Easing.out(Easing.cubic), extrapolateRight: 'clamp'});
  const bgmTrack = bgmTrackId ? getBgmTrack(bgmTrackId) : null;

  return (
    <AbsoluteFill className="canvas">
      {bgmTrack ? (
        <Audio
          loop
          name={`BGM · ${bgmTrack.title}`}
          src={staticFile(bgmTrack.file)}
          volume={dbToVolume(bgmTrack.mix.gainDb + bgmGainOffsetDb)}
        />
      ) : null}
      <AbsoluteFill className={`background background-${beat.visual}`}><Background beat={beat} localFrame={localFrame} /></AbsoluteFill>
      <div className={`title-block title-${beat.speakerMode}`} style={{opacity: reveal, transform: `translateY(${(1 - reveal) * 22}px)`}}>
        <div className="eyebrow">{beat.kicker}</div>
        <h1>{beat.title}</h1>
      </div>
      <Speaker
        beat={beat}
        faceTrack={faceTrack}
        localFrame={speakerLocalFrame}
        sourceAspectRatio={sourceAspectRatio}
        sourceTimeMs={sourceTimeMs}
        trimBefore={trimBefore}
        src={talkingHeadSrc}
      />
      <DynamicCaption frame={sourceFrame} />
      <div className="progress"><div style={{width: `${(frame / timeline.durationInFrames) * 100}%`}} /></div>
    </AbsoluteFill>
  );
};
