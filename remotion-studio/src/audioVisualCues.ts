export type AudioVisualEvent =
  | 'card-land'
  | 'chapter-turn'
  | 'cursor-click'
  | 'data-glitch'
  | 'impact-pulse'
  | 'number-pop'
  | 'scene-transition-fast'
  | 'scene-transition-tech'
  | 'status-correct'
  | 'status-error'
  | 'status-warning'
  | 'text-pop'
  | 'text-typing';

export type SfxDescriptor = {
  id: string;
  labelZh: string;
  src: string;
  durationMs: number;
  sourceUrl: string;
  defaultGainDb: number;
};

/**
 * The project-owned, speech-safe SFX catalog. `defaultGainDb` is deliberately
 * a playback value, not a destructive normalization target.
 */
export const sfxLibrary = {
  'emphasis-impact-cinematic': {
    id: 'emphasis-impact-cinematic',
    labelZh: '电影感强冲击',
    src: 'sfx/emphasis-impact-cinematic.mp3',
    durationMs: 2088,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-cinematic-impact-boom-05-352465/',
    defaultGainDb: -9,
  },
  'emphasis-impact-soft': {
    id: 'emphasis-impact-soft',
    labelZh: '柔和重点落点',
    src: 'sfx/emphasis-impact-soft.mp3',
    durationMs: 1440,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-ground-impact-352053/',
    defaultGainDb: -10,
  },
  'narrative-page-turn': {
    id: 'narrative-page-turn',
    labelZh: '翻页转章',
    src: 'sfx/narrative-page-turn.mp3',
    durationMs: 1228,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-page-turn-305789/',
    defaultGainDb: -20,
  },
  'status-correct-ding': {
    id: 'status-correct-ding',
    labelZh: '完成对勾',
    src: 'sfx/status-correct-ding.mp3',
    durationMs: 1320,
    sourceUrl: 'https://pixabay.com/sound-effects/technology-correct-472358/',
    defaultGainDb: -15,
  },
  'status-error': {
    id: 'status-error',
    labelZh: '错误提示',
    src: 'sfx/status-error.mp3',
    durationMs: 1080,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-error-notification-352286/',
    defaultGainDb: -21,
  },
  'status-warning': {
    id: 'status-warning',
    labelZh: '风险提示',
    src: 'sfx/status-warning.mp3',
    durationMs: 1541,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-warning-notification-199277/',
    defaultGainDb: -21,
  },
  'tech-glitch': {
    id: 'tech-glitch',
    labelZh: '数字故障',
    src: 'sfx/tech-glitch.mp3',
    durationMs: 2784,
    sourceUrl: 'https://pixabay.com/sound-effects/technology-glitchy-effect-511315/',
    defaultGainDb: -24,
  },
  'text-pop-bubble': {
    id: 'text-pop-bubble',
    labelZh: '气泡文字弹出',
    src: 'sfx/text-pop-bubble.mp3',
    durationMs: 1080,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-bubble-pop-08-351339/',
    defaultGainDb: -6,
  },
  'text-pop-happy': {
    id: 'text-pop-happy',
    labelZh: '轻快文字弹出',
    src: 'sfx/text-pop-happy.mp3',
    durationMs: 1032,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-happy-pop-2-185287/',
    defaultGainDb: -18,
  },
  'text-typing-keyboard': {
    id: 'text-typing-keyboard',
    labelZh: '键盘打字',
    src: 'sfx/text-typing-keyboard.mp3',
    durationMs: 8098,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-typing-keyboard-asmr-356116/',
    defaultGainDb: -24,
  },
  'transition-whoosh-quick': {
    id: 'transition-whoosh-quick',
    labelZh: '快速转场',
    src: 'sfx/transition-whoosh-quick.mp3',
    durationMs: 1032,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-quick-whoosh-405448/',
    defaultGainDb: -15,
  },
  'transition-whoosh-tech': {
    id: 'transition-whoosh-tech',
    labelZh: '科技界面转场',
    src: 'sfx/transition-whoosh-tech.mp3',
    durationMs: 1992,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-modern-interface-swoosh-whoosh-small-02-230467/',
    defaultGainDb: -8,
  },
  'ui-click-mouse': {
    id: 'ui-click-mouse',
    labelZh: '鼠标点击',
    src: 'sfx/ui-click-mouse.mp3',
    durationMs: 1056,
    sourceUrl: 'https://pixabay.com/sound-effects/film-special-effects-mouse-click-351398/',
    defaultGainDb: -10,
  },
} as const satisfies Record<string, SfxDescriptor>;

export type SfxId = keyof typeof sfxLibrary;

export type AudioVisualPreset = {
  id: string;
  labelZh: string;
  event: AudioVisualEvent;
  sfxId: SfxId;
  /** Start the sound this many frames before the visual anchor. */
  audioLeadFrames: number;
  gainDb: number;
  noteZh: string;
};

/**
 * Future generators should use these semantic preset IDs instead of choosing
 * arbitrary files or hard-coding dB values in a composition.
 */
export const audioVisualPresets = {
  'card-land': {
    id: 'card-land',
    labelZh: '重点卡片落位',
    event: 'card-land',
    sfxId: 'emphasis-impact-soft',
    audioLeadFrames: 0,
    gainDb: -10,
    noteZh: '用于核心数字、结论或重卡片完成落位；不要用于普通字幕。',
  },
  'chapter-page-turn': {
    id: 'chapter-page-turn',
    labelZh: '章节翻页',
    event: 'chapter-turn',
    sfxId: 'narrative-page-turn',
    audioLeadFrames: 0,
    gainDb: -20,
    noteZh: '仅在画面确实呈现翻页、报告或章节切换时使用。',
  },
  'cursor-click': {
    id: 'cursor-click',
    labelZh: '可见光标点击',
    event: 'cursor-click',
    sfxId: 'ui-click-mouse',
    audioLeadFrames: 0,
    gainDb: -10,
    noteZh: '锚点应是光标抵达并完成点击的帧，而非光标开始移动的帧。',
  },
  'data-glitch': {
    id: 'data-glitch',
    labelZh: '科技故障',
    event: 'data-glitch',
    sfxId: 'tech-glitch',
    audioLeadFrames: 0,
    gainDb: -24,
    noteZh: '必须与真实的 glitch、异常或科技反转画面成对出现。',
  },
  'impact-major': {
    id: 'impact-major',
    labelZh: '主高潮冲击',
    event: 'impact-pulse',
    sfxId: 'emphasis-impact-cinematic',
    audioLeadFrames: 0,
    gainDb: -9,
    noteZh: '每一节最多一到两次；对齐大字、闪白和视觉 pulse 的落点。',
  },
  'number-pop': {
    id: 'number-pop',
    labelZh: '正向数字弹出',
    event: 'number-pop',
    sfxId: 'text-pop-happy',
    audioLeadFrames: 0,
    gainDb: -18,
    noteZh: '适合轻量正向数字，严肃内容优先用 card-land 或静音。',
  },
  'scene-transition-fast': {
    id: 'scene-transition-fast',
    labelZh: '快速场景转场',
    event: 'scene-transition-fast',
    sfxId: 'transition-whoosh-quick',
    audioLeadFrames: 3,
    gainDb: -15,
    noteZh: '音频起点提前三帧，让主能量与滑动或推镜中点对齐。',
  },
  'scene-transition-tech': {
    id: 'scene-transition-tech',
    labelZh: '科技界面转场',
    event: 'scene-transition-tech',
    sfxId: 'transition-whoosh-tech',
    audioLeadFrames: 3,
    gainDb: -8,
    noteZh: '音频起点提前三帧，适配 UI、Dashboard、AI 或数据面板切换。',
  },
  'status-correct': {
    id: 'status-correct',
    labelZh: '完成验证',
    event: 'status-correct',
    sfxId: 'status-correct-ding',
    audioLeadFrames: 0,
    gainDb: -15,
    noteZh: '只对齐可见对勾、验证通过或正确答案，不用于普通操作结束。',
  },
  'status-error': {
    id: 'status-error',
    labelZh: '错误反馈',
    event: 'status-error',
    sfxId: 'status-error',
    audioLeadFrames: 0,
    gainDb: -21,
    noteZh: '用于叉号、错误示范或失败操作；不要用于真实事故。',
  },
  'status-warning': {
    id: 'status-warning',
    labelZh: '风险提醒',
    event: 'status-warning',
    sfxId: 'status-warning',
    audioLeadFrames: 0,
    gainDb: -21,
    noteZh: '用于避坑和注意事项；风险尚未发生时不要使用错误提示音。',
  },
  'text-pop-bubble': {
    id: 'text-pop-bubble',
    labelZh: '气泡/贴纸弹出',
    event: 'text-pop',
    sfxId: 'text-pop-bubble',
    audioLeadFrames: 0,
    gainDb: -6,
    noteZh: '对齐气泡或贴纸完成膨胀的帧，不用于严肃商务内容。',
  },
  'text-typing': {
    id: 'text-typing',
    labelZh: '逐字输入',
    event: 'text-typing',
    sfxId: 'text-typing-keyboard',
    audioLeadFrames: 0,
    gainDb: -24,
    noteZh: '从首字符开始，到最后一个字符结束；必须设置 durationMs 截断。',
  },
} as const satisfies Record<string, AudioVisualPreset>;

export type AudioVisualPresetId = keyof typeof audioVisualPresets;

export type TimedBeat = {
  id?: string;
  startMs: number;
  endMs: number;
};

export type AudioVisualCueAnchor =
  | {type: 'absolute'; atMs: number}
  | {type: 'beat'; beatId: string; offsetMs?: number};

/** A generator-friendly request: semantic preset plus the visual event anchor. */
export type AudioVisualCue = {
  id: string;
  preset: AudioVisualPresetId;
  anchor: AudioVisualCueAnchor;
  /** Use for typing, glitch and intentionally shortened tails. */
  durationMs?: number;
  /** Rare per-cue override. Prefer creating a preset for a systematic change. */
  gainDb?: number;
  disabled?: boolean;
};

export type ResolvedAudioVisualCue = AudioVisualCue & {
  asset: (typeof sfxLibrary)[SfxId];
  presetDefinition: (typeof audioVisualPresets)[AudioVisualPresetId];
  anchorMs: number;
  playbackStartMs: number;
  durationMs: number;
  gainDb: number;
};

export const dbToVolume = (db: number) => 10 ** (db / 20);

const getAnchorMs = (anchor: AudioVisualCueAnchor, beats: TimedBeat[]) => {
  if (anchor.type === 'absolute') return anchor.atMs;
  const beat = beats.find((candidate) => candidate.id === anchor.beatId);
  if (!beat) throw new Error(`Audio-visual cue references unknown beat: ${anchor.beatId}`);
  return beat.startMs + (anchor.offsetMs ?? 0);
};

export const resolveAudioVisualCues = ({
  beats,
  cues,
  fps,
}: {
  beats: TimedBeat[];
  cues: AudioVisualCue[];
  fps: number;
}): ResolvedAudioVisualCue[] => cues
  .filter((cue) => !cue.disabled)
  .map((cue) => {
    const presetDefinition = audioVisualPresets[cue.preset];
    const asset = sfxLibrary[presetDefinition.sfxId];
    const anchorMs = getAnchorMs(cue.anchor, beats);
    const playbackStartMs = Math.max(0, anchorMs - presetDefinition.audioLeadFrames / fps * 1000);
    return {
      ...cue,
      asset,
      presetDefinition,
      anchorMs,
      playbackStartMs,
      durationMs: cue.durationMs ?? asset.durationMs,
      gainDb: cue.gainDb ?? presetDefinition.gainDb,
    };
  })
  .sort((left, right) => left.playbackStartMs - right.playbackStartMs);

/**
 * Keeps the catalog intentional. A warning is returned instead of muting a
 * cue automatically so a generator can make an explicit editorial decision.
 */
export const validateAudioVisualCueSpacing = ({
  cues,
  minimumGapMs = 1500,
}: {
  cues: ResolvedAudioVisualCue[];
  minimumGapMs?: number;
}) => cues.slice(1).flatMap((cue, index) => {
  const previous = cues[index];
  const gapMs = cue.playbackStartMs - previous.playbackStartMs;
  return gapMs < minimumGapMs
    ? [`${previous.id} and ${cue.id} are only ${Math.round(gapMs)}ms apart (minimum ${minimumGapMs}ms).`]
    : [];
});
