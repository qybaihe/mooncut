export type HorizontalSpeakerMode = 'hero' | 'side' | 'pip' | 'embedded';

export type HorizontalVisual =
  | 'intro'
  | 'event'
  | 'release'
  | 'design'
  | 'reaction'
  | 'pipeline'
  | 'editor'
  | 'beta'
  | 'closing';

export type HorizontalBeat = {
  start: number;
  end: number;
  speakerMode: HorizontalSpeakerMode;
  visual: HorizontalVisual;
  kicker: string;
  title: string;
};

export const horizontalTimeline = {
  fps: 30,
  durationInFrames: 1232,
  beats: [
    {
      start: 0,
      end: 150,
      speakerMode: 'hero',
      visual: 'intro',
      kicker: 'BEIJING · JUL 10–12',
      title: '探月计划\nPhysical AI 黑客松',
    },
    {
      start: 150,
      end: 380,
      speakerMode: 'side',
      visual: 'event',
      kicker: '48H · ON SITE',
      title: '在现场，把想法做出来',
    },
    {
      start: 380,
      end: 495,
      speakerMode: 'pip',
      visual: 'release',
      kicker: 'OPENAI · JUL 9, 2026',
      title: 'GPT-5.6 正式发布',
    },
    {
      start: 495,
      end: 565,
      speakerMode: 'pip',
      visual: 'design',
      kicker: 'OFFICIAL DESIGN SHOWCASE',
      title: '前端页面，现场实测',
    },
    {
      start: 565,
      end: 620,
      speakerMode: 'hero',
      visual: 'reaction',
      kicker: 'FIRST IMPRESSION',
      title: '太震撼了',
    },
    {
      start: 620,
      end: 735,
      speakerMode: 'pip',
      visual: 'design',
      kicker: 'BUILD WITH GPT-5.6',
      title: '做一点不一样的东西',
    },
    {
      start: 735,
      end: 905,
      speakerMode: 'pip',
      visual: 'pipeline',
      kicker: 'AUTO VIDEO SYSTEM',
      title: '让口播自己完成剪辑',
    },
    {
      start: 905,
      end: 1075,
      speakerMode: 'embedded',
      visual: 'editor',
      kicker: 'ASR → STORYBOARD → RENDER',
      title: '整套流程自动跑通',
    },
    {
      start: 1075,
      end: 1145,
      speakerMode: 'side',
      visual: 'beta',
      kicker: 'V0.1 · LIVE TEST',
      title: '现在还是初版',
    },
    {
      start: 1145,
      end: 1232,
      speakerMode: 'hero',
      visual: 'closing',
      kicker: 'THIS VIDEO IS THE DEMO',
      title: '你看到的，就是效果',
    },
  ] satisfies HorizontalBeat[],
};

