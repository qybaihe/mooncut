/** `circle` is the only tracked mode; `native` preserves the source composition. */
export type SpeakerMode = 'circle' | 'native';
export type Visual = 'event' | 'gpt-release' | 'coding' | 'opinion' | 'closing';

export type TimelineBeat = {
  start: number;
  end: number;
  transcript: string;
  speakerMode: SpeakerMode;
  visual: Visual;
  kicker: string;
  title: string;
  keywords: string[];
};

export type VideoTimeline = {
  fps: number;
  durationInFrames: number;
  beats: TimelineBeat[];
};

// Generated from the source-video transcript, then manually corrected for proper nouns.
// This is the contract that an ASR + LLM pipeline should produce for later videos.
export const demoTimeline: VideoTimeline = {
  fps: 30,
  durationInFrames: 774,
  beats: [
    {
      start: 0,
      end: 113,
      transcript: '我现在在这个北京探月计划黑客松的现场。',
      speakerMode: 'circle',
      visual: 'event',
      kicker: 'BEIJING | PHYSICAL AI',
      title: '探月计划黑客松现场',
      keywords: ['北京', 'Physical AI', 'Hackathon'],
    },
    {
      start: 113,
      end: 228,
      transcript: '今天发布了一个特别重磅的炸弹，OpenAI 出了 GPT-5.6。',
      speakerMode: 'circle',
      visual: 'gpt-release',
      kicker: 'OPENAI | PRODUCT RELEASE',
      title: 'GPT-5.6 正式发布',
      keywords: ['Sol', 'Terra', 'Luna'],
    },
    {
      start: 228,
      end: 326,
      transcript: '这个模型我拿到手实测了一下，哇，真的是太震撼了！',
      speakerMode: 'native',
      visual: 'opinion',
      kicker: 'HANDS-ON IMPRESSION',
      title: '实测后的第一反应',
      keywords: ['现场实测', '太震撼了'],
    },
    {
      start: 326,
      end: 432,
      transcript: '一下子前端能力，简直就是飞一样的提升。',
      speakerMode: 'circle',
      visual: 'coding',
      kicker: 'FRONT-END BUILD',
      title: '前端能力，飞一样提升',
      keywords: ['Build', 'Preview', 'Iterate'],
    },
    {
      start: 432,
      end: 530,
      transcript: '我感觉已经追平国内的 GLM 5.2 了。',
      speakerMode: 'native',
      visual: 'opinion',
      kicker: 'PERSONAL JUDGMENT',
      title: '这是我的现场判断',
      keywords: ['主观实测', '体验追平'],
    },
    {
      start: 530,
      end: 774,
      transcript: '我相信有了 GPT-5.6 的加持，我们这次一定能做一个特别厉害的东西来给大家看。',
      speakerMode: 'circle',
      visual: 'closing',
      kicker: 'NEXT BUILD',
      title: '做出更厉害的东西',
      keywords: ['GPT-5.6', '实测', '继续迭代'],
    },
  ],
};
