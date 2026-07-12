import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import rawSubtitles from '../data/football-rules-subtitles.json';

export const FOOTBALL_RULES_FPS = 30;

type EditRange = {
  sourceStartMs: number;
  sourceEndMs: number;
  outputStartMs: number;
  outputEndMs: number;
};

// Cut only verified dead air: the opening hesitation, two chapter pauses and
// the trailing silence. Source timestamps remain available for auditability.
const editableRanges = [
  {sourceStartMs: 220, sourceEndMs: 89_161},
  {sourceStartMs: 89_915, sourceEndMs: 135_739},
  {sourceStartMs: 136_533, sourceEndMs: 163_323},
] as const;

const EDIT_RANGES: EditRange[] = editableRanges.reduce<EditRange[]>((ranges, range) => {
  const outputStartMs = ranges.at(-1)?.outputEndMs ?? 0;
  ranges.push({
    ...range,
    outputStartMs,
    outputEndMs: outputStartMs + range.sourceEndMs - range.sourceStartMs,
  });
  return ranges;
}, []);

export const FOOTBALL_RULES_DURATION_MS = EDIT_RANGES.at(-1)?.outputEndMs ?? 0;
export const FOOTBALL_RULES_DURATION_IN_FRAMES = Math.ceil(FOOTBALL_RULES_DURATION_MS / 1000 * FOOTBALL_RULES_FPS);

type Subtitle = {index: number; text: string; start_ms: number; end_ms: number};

const cleanCaption = (text: string) => text
  .replace(/\s+/gu, '')
  .replace('因因为', '因为')
  .replace('或或者', '或者');

const retimeSubtitles = (subtitles: readonly Subtitle[]) => subtitles.flatMap((subtitle) =>
  EDIT_RANGES.flatMap((range) => {
    const sourceStartMs = Math.max(subtitle.start_ms, range.sourceStartMs);
    const sourceEndMs = Math.min(subtitle.end_ms, range.sourceEndMs);
    if (sourceEndMs - sourceStartMs < 120) return [];
    return [{
      ...subtitle,
      text: cleanCaption(subtitle.text),
      start_ms: range.outputStartMs + sourceStartMs - range.sourceStartMs,
      end_ms: range.outputStartMs + sourceEndMs - range.sourceStartMs,
    }];
  }),
);

const SUBTITLES = retimeSubtitles(rawSubtitles.segments as Subtitle[]);

const chapters = [
  {id: 'intro', startMs: 0, endMs: 12_920, number: 'START', title: '5 点看懂足球', subtitle: '给 2026 世界杯新球迷的零基础速读'},
  {id: 'players', startMs: 12_920, endMs: 26_520, number: '01', title: '场上人员', subtitle: '每队 11 人 · 1 名守门员'},
  {id: 'time', startMs: 26_520, endMs: 56_980, number: '02', title: '时间与胜负', subtitle: '90 分钟 · 加时赛 · 点球大战'},
  {id: 'fouls', startMs: 56_980, endMs: 88_940, number: '03', title: '犯规判罚', subtitle: '黄牌警告 · 红牌罚下'},
  {id: 'restarts', startMs: 88_940, endMs: 134_765, number: '04', title: '五种发球', subtitle: '界外球 · 角球 · 球门球 · 任意球 · 点球'},
  {id: 'roles', startMs: 134_765, endMs: FOOTBALL_RULES_DURATION_MS, number: '05', title: '球员分工', subtitle: '门将 · 后卫 · 中场 · 前锋'},
] as const;

const emphasisMoments = [
  {atMs: 15_380, value: '11', suffix: '人', label: '每支球队的场上人数'},
  {atMs: 29_980, value: '90', suffix: '分钟', label: '常规比赛时间'},
  {atMs: 66_480, value: '黄 / 红', suffix: '牌', label: '依据犯规程度判罚'},
  {atMs: 95_526, value: '5', suffix: '种', label: '定位球 / 发球方式'},
  {atMs: 140_072, value: '4', suffix: '类', label: '场上位置分工'},
] as const;

const dbToVolume = (db: number) => 10 ** (db / 20);
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const FIFA_HIGHLIGHT_SRC = 'media/fifa-official-m95-highlights.mp4';

const SourceRanges = ({className, style, volume = 0}: {className?: string; style?: React.CSSProperties; volume?: number}) => (
  <>
    {EDIT_RANGES.map((range, index) => {
      const from = Math.round(range.outputStartMs / 1000 * FOOTBALL_RULES_FPS);
      const durationInFrames = Math.round((range.outputEndMs - range.outputStartMs) / 1000 * FOOTBALL_RULES_FPS);
      return (
        <Sequence from={from} durationInFrames={durationInFrames} key={`${range.sourceStartMs}-${range.sourceEndMs}`}>
          <OffthreadVideo
            className={className}
            src={staticFile('football-rules/source.mp4')}
            trimBefore={Math.round(range.sourceStartMs / 1000 * FOOTBALL_RULES_FPS)}
            trimAfter={Math.round(range.sourceEndMs / 1000 * FOOTBALL_RULES_FPS)}
            volume={volume}
            style={style}
          />
        </Sequence>
      );
    })}
  </>
);

const ChapterCard = ({chapter, localFrame}: {chapter: (typeof chapters)[number]; localFrame: number}) => {
  const {fps} = useVideoConfig();
  const enter = spring({frame: localFrame, fps, config: {damping: 16, stiffness: 150}});
  const leave = interpolate(localFrame, [fps * 2.3, fps * 3.05], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (localFrame > fps * 3.1) return null;
  return (
    <div style={{alignItems: 'flex-start', display: 'flex', left: 54, opacity: enter * leave, position: 'absolute', right: 54, top: 100, transform: `translateY(${(1 - enter) * 46}px)`, zIndex: 20}}>
      <div style={{background: '#d4ff54', borderRadius: 28, color: '#061306', fontFamily: 'Arial Black, PingFang SC, sans-serif', fontSize: 34, fontWeight: 950, letterSpacing: 1, minWidth: 116, padding: '24px 18px', textAlign: 'center'}}>{chapter.number}</div>
      <div style={{marginLeft: 24, paddingTop: 5}}>
        <div style={{color: 'rgba(236,255,231,.72)', fontSize: 22, fontWeight: 750, letterSpacing: 3}}>2026 WORLD CUP · BEGINNER GUIDE</div>
        <div style={{color: '#fff', fontSize: 64, fontWeight: 950, letterSpacing: '-.06em', lineHeight: 1.04, marginTop: 8}}>{chapter.title}</div>
        <div style={{color: '#d4ff54', fontSize: 27, fontWeight: 800, marginTop: 11}}>{chapter.subtitle}</div>
      </div>
    </div>
  );
};

const BrollLayer = ({kind, localFrame}: {kind: 'tactics' | 'cards'; localFrame: number}) => {
  const image = kind === 'tactics'
    ? 'football-rules/assets/tactics-formation-ai.png'
    : 'football-rules/assets/cards-set-pieces-ai.png';
  const zoom = interpolate(localFrame, [0, 420], [1.02, 1.13], {extrapolateRight: 'clamp'});
  return (
    <>
      <Img src={staticFile(image)} style={{height: '100%', objectFit: 'cover', transform: `scale(${zoom})`, width: '100%'}} />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(1,11,9,.25), rgba(1,10,8,.78) 70%, rgba(1,8,7,.92))'}} />
      <div style={{background: 'rgba(3,16,12,.76)', border: '1px solid rgba(212,255,84,.68)', borderRadius: 999, color: '#d4ff54', fontFamily: 'Menlo, monospace', fontSize: 17, fontWeight: 900, left: 44, letterSpacing: 1.5, padding: '11px 16px', position: 'absolute', top: 47, zIndex: 4}}>AI 足球示意 · 非赛事画面</div>
      <div style={{background: '#07140f', border: '4px solid rgba(255,255,255,.92)', borderRadius: '50%', boxShadow: '0 16px 48px rgba(0,0,0,.55)', height: 258, overflow: 'hidden', position: 'absolute', right: 44, top: 118, width: 258, zIndex: 5}}>
        <SourceRanges style={{height: '100%', objectFit: 'cover', transform: 'scale(1.42)', width: '100%'}} />
      </div>
    </>
  );
};

const FifaHighlightClip = ({durationInFrames, endSeconds, startSeconds}: {
  durationInFrames: number;
  endSeconds: number;
  startSeconds: number;
}) => {
  const frame = useCurrentFrame();
  const fade = Math.min(
    interpolate(frame, [0, 5], [0, 1], {extrapolateRight: 'clamp'}),
    interpolate(frame, [durationInFrames - 6, durationInFrames - 1], [1, 0], {extrapolateLeft: 'clamp'}),
  );
  return (
    <OffthreadVideo
      src={staticFile(FIFA_HIGHLIGHT_SRC)}
      trimBefore={Math.round(startSeconds * FOOTBALL_RULES_FPS)}
      trimAfter={Math.round(endSeconds * FOOTBALL_RULES_FPS)}
      // Crowd is deliberately 12 dB below narration: atmosphere, not a second foreground track.
      volume={dbToVolume(-25)}
      style={{height: '100%', objectFit: 'cover', opacity: fade, width: '100%'}}
    />
  );
};

const FifaHighlightMontage = () => (
  <AbsoluteFill style={{background: '#010403'}}>
    <Sequence from={0} durationInFrames={64} name="FIFA M95 heat montage · kickoff">
      <FifaHighlightClip startSeconds={8.9} endSeconds={11.03} durationInFrames={64} />
    </Sequence>
    <Sequence from={64} durationInFrames={66} name="FIFA M95 heat montage · attack">
      <FifaHighlightClip startSeconds={55.35} endSeconds={57.55} durationInFrames={66} />
    </Sequence>
    <Sequence from={130} durationInFrames={56} name="FIFA M95 heat montage · goal">
      <FifaHighlightClip startSeconds={81.95} endSeconds={83.82} durationInFrames={56} />
    </Sequence>
    <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,.24), transparent 42%, rgba(0,0,0,.78))'}} />
    <div style={{background: 'rgba(2,11,8,.8)', border: '1px solid rgba(212,255,84,.74)', borderRadius: 999, color: '#d4ff54', fontFamily: 'Menlo, monospace', fontSize: 16, fontWeight: 900, left: 40, letterSpacing: 1.2, padding: '10px 15px', position: 'absolute', top: 420, zIndex: 5}}>FIFA 官方赛事片段 · M95 阿根廷 vs 埃及</div>
  </AbsoluteFill>
);

const Caption = ({timeMs}: {timeMs: number}) => {
  const subtitle = SUBTITLES.find((item) => timeMs >= item.start_ms && timeMs < item.end_ms);
  if (!subtitle) return null;
  return (
    <div style={{bottom: 90, display: 'flex', justifyContent: 'center', left: 42, position: 'absolute', right: 42, zIndex: 30}}>
      <div style={{background: 'rgba(2,10,7,.84)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 22, boxShadow: '0 16px 48px rgba(0,0,0,.36)', color: '#fff', fontSize: 40, fontWeight: 880, letterSpacing: '.02em', lineHeight: 1.32, maxWidth: 910, padding: '18px 26px 20px', textAlign: 'center'}}>{subtitle.text}</div>
    </div>
  );
};

const Emphasis = ({timeMs}: {timeMs: number}) => {
  const moment = emphasisMoments.find((item) => timeMs >= item.atMs && timeMs < item.atMs + 1450);
  const {fps} = useVideoConfig();
  if (!moment) return null;
  const localFrame = (timeMs - moment.atMs) / 1000 * fps;
  const enter = spring({frame: localFrame, fps, config: {damping: 10, stiffness: 180, mass: .72}});
  const fade = interpolate(localFrame, [fps * .95, fps * 1.45], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <div style={{alignItems: 'center', display: 'flex', flexDirection: 'column', left: 0, opacity: enter * fade, position: 'absolute', right: 0, top: 420, transform: `scale(${.72 + enter * .28})`, zIndex: 18}}>
      <div style={{color: '#d4ff54', fontFamily: 'Arial Black, PingFang SC, sans-serif', fontSize: 142, fontWeight: 950, letterSpacing: '-.09em', lineHeight: .9, textShadow: '0 12px 42px rgba(0,0,0,.5)'}}>{moment.value}<span style={{fontSize: 58, letterSpacing: '-.04em', marginLeft: 12}}>{moment.suffix}</span></div>
      <div style={{background: 'rgba(2,13,9,.7)', borderRadius: 999, color: '#fff', fontSize: 26, fontWeight: 800, marginTop: 19, padding: '10px 20px'}}>{moment.label}</div>
    </div>
  );
};

const audioCues = [
  {atMs: 0, src: 'sfx/narrative-page-turn.mp3', db: -22},
  {atMs: 1_800, src: 'sfx/emphasis-impact-cinematic.mp3', db: -24},
  {atMs: 12_920, src: 'sfx/narrative-page-turn.mp3', db: -22},
  {atMs: 15_380, src: 'sfx/emphasis-impact-soft.mp3', db: -19},
  {atMs: 26_520, src: 'sfx/narrative-page-turn.mp3', db: -22},
  {atMs: 29_980, src: 'sfx/emphasis-impact-soft.mp3', db: -19},
  {atMs: 56_980, src: 'sfx/narrative-page-turn.mp3', db: -22},
  {atMs: 59_250, src: 'sfx/transition-whoosh-quick.mp3', db: -18},
  {atMs: 66_480, src: 'sfx/emphasis-impact-soft.mp3', db: -20},
  {atMs: 79_040, src: 'sfx/status-warning.mp3', db: -24},
  {atMs: 88_940, src: 'sfx/narrative-page-turn.mp3', db: -22},
  {atMs: 95_526, src: 'sfx/emphasis-impact-soft.mp3', db: -20},
  {atMs: 134_765, src: 'sfx/narrative-page-turn.mp3', db: -22},
  {atMs: 140_072, src: 'sfx/emphasis-impact-soft.mp3', db: -20},
] as const;

export const FootballRulesExplainer: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const timeMs = frame / fps * 1000;
  const chapter = chapters.find((item) => timeMs >= item.startMs && timeMs < item.endMs) ?? chapters.at(-1)!;
  const chapterFrame = Math.max(0, frame - Math.round(chapter.startMs / 1000 * fps));
  const tacticsActive = timeMs >= 12_920 && timeMs < 26_520;
  const cardsActive = timeMs >= 56_980 && timeMs < 98_200;
  const visualLocalFrame = Math.max(0, frame - Math.round((tacticsActive ? 12_920 : 56_980) / 1000 * fps));
  const narrationActive = SUBTITLES.some((subtitle) => timeMs >= subtitle.start_ms - 150 && timeMs <= subtitle.end_ms + 220);
  const bgmFade = Math.min(
    interpolate(frame, [0, fps], [0, 1], {extrapolateRight: 'clamp'}),
    interpolate(frame, [durationInFrames - fps * 1.4, durationInFrames], [1, 0], {extrapolateLeft: 'clamp'}),
  );

  return (
    <AbsoluteFill style={{background: '#04110b', color: '#fff', fontFamily: 'Inter, PingFang SC, sans-serif', overflow: 'hidden'}}>
      <SourceRanges style={{filter: 'blur(28px) brightness(.3) saturate(.72)', height: '115%', left: '-7.5%', objectFit: 'cover', position: 'absolute', top: '-7.5%', width: '115%'}} />
      <SourceRanges style={{height: '100%', objectFit: 'cover', width: '100%'}} />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(1,11,8,.2), transparent 35%, rgba(1,9,7,.72) 88%, rgba(1,8,6,.96))'}} />

      {tacticsActive ? <AbsoluteFill style={{zIndex: 8}}><BrollLayer kind="tactics" localFrame={visualLocalFrame} /></AbsoluteFill> : null}
      {cardsActive ? <AbsoluteFill style={{zIndex: 8}}><BrollLayer kind="cards" localFrame={visualLocalFrame} /></AbsoluteFill> : null}
      {timeMs < 6_200 ? <AbsoluteFill style={{zIndex: 9}}><FifaHighlightMontage /></AbsoluteFill> : null}

      <div style={{background: '#d4ff54', height: 6, left: 0, position: 'absolute', top: 0, transformOrigin: 'left', transform: `scaleX(${clamp(frame / Math.max(1, durationInFrames - 1), 0, 1)})`, width: '100%', zIndex: 26}} />
      {!tacticsActive && !cardsActive ? (
        <div style={{alignItems: 'center', display: 'flex', gap: 12, left: 44, position: 'absolute', top: 46, zIndex: 21}}>
          <span style={{background: '#d4ff54', borderRadius: '50%', height: 11, width: 11}} />
          <span style={{color: '#ecffea', fontFamily: 'Menlo, monospace', fontSize: 17, fontWeight: 800, letterSpacing: 2}}>小陈看球 · WORLD CUP 2026</span>
        </div>
      ) : null}
      <ChapterCard chapter={chapter} localFrame={chapterFrame} />
      <Emphasis timeMs={timeMs} />
      <Caption timeMs={timeMs} />

      <AbsoluteFill style={{height: 1, opacity: 0, width: 1}}>
        <SourceRanges volume={1} style={{height: 1, width: 1}} />
      </AbsoluteFill>
      <Audio
        src={staticFile('audio/bgm/generated/football-rules-2026-ai-loop.mp3')}
        volume={() => dbToVolume(narrationActive ? -27 : -21) * bgmFade}
      />
      {audioCues.map((cue) => (
        <Sequence from={Math.round(cue.atMs / 1000 * fps)} key={`${cue.src}-${cue.atMs}`} name="Football explainer cue">
          <Audio src={staticFile(cue.src)} volume={dbToVolume(cue.db)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
