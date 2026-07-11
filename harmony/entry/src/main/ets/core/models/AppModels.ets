export enum AppTab {
  CREATE = 'create',
  COACH = 'coach',
  JOBS = 'jobs',
  COMMUNITY = 'community'
}

export enum ThemeMode {
  LIGHT = 'light',
  DARK = 'dark',
  MEMPHIS = 'memphis'
}

export enum ClipStage {
  EMPTY = 'empty',
  READY = 'ready',
  UPLOADING = 'uploading',
  QUEUED = 'queued',
  PROCESSING = 'processing',
  DOWNLOADING = 'downloading',
  DONE = 'done',
  FAILED = 'failed'
}

export enum PetAnimationState {
  IDLE = 'idle',
  RUNNING = 'running',
  WAVING = 'waving',
  JUMPING = 'jumping',
  FAILED = 'failed',
  WAITING = 'waiting',
  REVIEW = 'review'
}

export enum PetEvent {
  IDLE = 'idle',
  EMPTY_WORKSPACE = 'emptyWorkspace',
  SCRIPT_REQUESTING = 'scriptRequesting',
  UPLOADING = 'uploading',
  JOB_QUEUED = 'jobQueued',
  JOB_RUNNING = 'jobRunning',
  JOB_DOWNLOADING = 'jobDownloading',
  JOB_COMPLETED = 'jobCompleted',
  JOB_FAILED = 'jobFailed',
  RECORDING = 'recording',
  COACH_LISTENING = 'coachListening',
  COACH_ANALYZING = 'coachAnalyzing',
  COACH_OFF_CAMERA = 'coachOffCamera',
  COACH_LOW_VOLUME = 'coachLowVolume',
  COACH_POSITIVE = 'coachPositive',
  COACH_REVIEW = 'coachReview',
  PERMISSION_OR_NETWORK_FAILURE = 'permissionOrNetworkFailure',
  PET_MESSAGE = 'petMessage'
}

export function petEventState(event: PetEvent): PetAnimationState {
  switch (event) {
    case PetEvent.EMPTY_WORKSPACE: return PetAnimationState.WAITING;
    case PetEvent.SCRIPT_REQUESTING:
    case PetEvent.UPLOADING:
    case PetEvent.JOB_QUEUED:
    case PetEvent.JOB_RUNNING:
    case PetEvent.JOB_DOWNLOADING:
    case PetEvent.COACH_ANALYZING: return PetAnimationState.RUNNING;
    case PetEvent.RECORDING:
    case PetEvent.COACH_LISTENING: return PetAnimationState.WAVING;
    case PetEvent.COACH_OFF_CAMERA: return PetAnimationState.WAITING;
    case PetEvent.COACH_LOW_VOLUME:
    case PetEvent.COACH_REVIEW: return PetAnimationState.REVIEW;
    case PetEvent.JOB_COMPLETED:
    case PetEvent.COACH_POSITIVE: return PetAnimationState.JUMPING;
    case PetEvent.JOB_FAILED:
    case PetEvent.PERMISSION_OR_NETWORK_FAILURE: return PetAnimationState.FAILED;
    case PetEvent.PET_MESSAGE:
    case PetEvent.IDLE: return PetAnimationState.IDLE;
  }
  return PetAnimationState.IDLE;
}

export function petEventMessage(event: PetEvent): string {
  switch (event) {
    case PetEvent.RECORDING:
    case PetEvent.COACH_LISTENING: return '我在听，慢慢说～';
    case PetEvent.COACH_OFF_CAMERA: return '我好像没看见你，看向镜头试试？';
    case PetEvent.COACH_LOW_VOLUME: return '声音有点小，再靠近一点麦克风。';
    default: return '';
  }
}

export interface VideoAsset {
  id: string;
  name: string;
  sizeLabel: string;
  uri: string;
  durationLabel?: string;
  source: 'upload' | 'recording';
}

export function splitDraftSentences(text: string): string[] {
  const result: string[] = [];
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    current += character;
    if (character === '。' || character === '！' || character === '？' || character === '\n') {
      const sentence = current.trim();
      if (sentence) result.push(sentence);
      current = '';
    }
  }
  const trailing = current.trim();
  if (trailing) result.push(trailing);
  return result;
}

export function petMessage(state: PetAnimationState): string {
  switch (state) {
    case PetAnimationState.RUNNING: return '正在努力跑进度！';
    case PetAnimationState.WAVING: return '准备好啦，一起开口。';
    case PetAnimationState.JUMPING: return '完成了！你真棒 ✦';
    case PetAnimationState.FAILED: return '没关系，我们再来一次。';
    case PetAnimationState.WAITING: return '我陪你等灵感。';
    case PetAnimationState.REVIEW: return '这句很有感觉，再读一遍？';
    default: return '我在这儿，慢慢来。';
  }
}

export function petAnimationRow(state: PetAnimationState): number {
  switch (state) {
    case PetAnimationState.IDLE: return 0;
    case PetAnimationState.WAVING: return 3;
    case PetAnimationState.JUMPING: return 4;
    case PetAnimationState.FAILED: return 5;
    case PetAnimationState.WAITING: return 6;
    case PetAnimationState.RUNNING: return 7;
    case PetAnimationState.REVIEW: return 8;
  }
  return 0;
}

export function petAnimationFrameCount(state: PetAnimationState): number {
  switch (state) {
    case PetAnimationState.WAVING: return 4;
    case PetAnimationState.JUMPING: return 5;
    case PetAnimationState.FAILED: return 8;
    default: return 6;
  }
}

export function petAnimationDurationMs(state: PetAnimationState): number {
  switch (state) {
    case PetAnimationState.WAVING:
    case PetAnimationState.JUMPING: return 1400;
    case PetAnimationState.FAILED: return 2080;
    default: return 1560;
  }
}
