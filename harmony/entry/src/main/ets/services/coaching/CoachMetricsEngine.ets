export interface LiveCoachMetrics {
  pace: number;
  wordCount: number;
  volume: number;
  pauseCount: number;
  faceOrientationScore?: number;
  facePresent: boolean;
  elapsedSeconds: number;
  partialTranscript: string;
  isSpeechAvailable: boolean;
  isVisionAvailable: boolean;
  isMicrophoneActive: boolean;
  speechStatus: string;
  visionStatus: string;
}

export interface FaceObservation {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  yaw?: number;
  roll?: number;
}

export interface CoachLocalAdvice {
  category: 'pace' | 'volume' | 'pause' | 'camera' | 'steady';
  advice: string;
  positive: boolean;
}

interface TimelineSample { atMs: number; count: number; }
interface FaceOrientationResult { present: boolean; score?: number; status: string; }

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

export function countSpokenUnits(text: string): number {
  const han = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const fallback = Math.floor(text.replace(/\s/g, '').length / 2);
  return Math.max(han, latinWords > 0 ? latinWords : fallback);
}

export function estimateFaceOrientation(face?: FaceObservation): FaceOrientationResult {
  if (!face) return {present: false, score: 0, status: '镜头朝向（估算）· 未检测到面部'};
  const yawScore = face.yaw === undefined ? 1 : Math.max(0, 1 - Math.abs(face.yaw) / 0.75);
  const rollScore = face.roll === undefined ? 1 : Math.max(0, 1 - Math.abs(face.roll) / 0.75);
  const centerDistance = Math.hypot(face.centerX - 0.5, face.centerY - 0.5);
  const centerScore = 1 - Math.min(1, centerDistance * 2.1);
  const area = face.width * face.height;
  const sizeScore = area < 0.04 ? area / 0.04 : area > 0.45 ? Math.max(0.4, 1 - (area - 0.45)) : 1;
  const score = clamp(yawScore * 0.42 + rollScore * 0.20 + centerScore * 0.28 + sizeScore * 0.10, 0, 1);
  const percent = Math.round(score * 100);
  const status = percent >= 70
    ? `镜头朝向（估算）· 正对较好 ${percent}%`
    : percent >= 45 ? `镜头朝向（估算）· 略偏 ${percent}%` : `镜头朝向（估算）· 请看向镜头 ${percent}%`;
  return {present: true, score, status};
}

@Observed
export class CoachMetricsEngine {
  metrics: LiveCoachMetrics = {
    pace: 0,
    wordCount: 0,
    volume: 0,
    pauseCount: 0,
    facePresent: false,
    elapsedSeconds: 0,
    partialTranscript: '',
    isSpeechAvailable: false,
    isVisionAvailable: false,
    isMicrophoneActive: false,
    speechStatus: '等待语音识别',
    visionStatus: '等待视觉分析'
  };
  private startedAtMs: number = 0;
  private lastSpeechAtMs: number = 0;
  private lastPauseAtMs: number = 0;
  private timeline: TimelineSample[] = [];
  private smoothedVolume: number = 0;
  private lastVolumeAtMs: number = 0;

  reset(nowMs: number = Date.now()): void {
    this.startedAtMs = nowMs;
    this.lastSpeechAtMs = nowMs;
    this.lastPauseAtMs = nowMs;
    this.timeline = [];
    this.smoothedVolume = 0;
    this.lastVolumeAtMs = nowMs;
    this.metrics.pace = 0;
    this.metrics.wordCount = 0;
    this.metrics.volume = 0;
    this.metrics.pauseCount = 0;
    this.metrics.elapsedSeconds = 0;
    this.metrics.partialTranscript = '';
    this.metrics.speechStatus = this.metrics.isSpeechAvailable ? '语音识别已就绪' : '语音识别不可用';
  }

  setSpeechAvailability(available: boolean, message: string): void {
    this.metrics.isSpeechAvailable = available;
    this.metrics.speechStatus = message;
  }

  setMicrophoneActive(active: boolean): void {
    this.metrics.isMicrophoneActive = active;
    if (!active) this.metrics.volume = 0;
  }

  setVisionAvailability(available: boolean, message: string): void {
    this.metrics.isVisionAvailable = available;
    this.metrics.visionStatus = message;
    if (!available) this.metrics.faceOrientationScore = undefined;
    this.metrics.facePresent = available && this.metrics.facePresent;
  }

  ingestTranscript(text: string, isFinal: boolean = false, nowMs: number = Date.now()): void {
    const count = countSpokenUnits(text);
    const previousCount = this.metrics.wordCount;
    const elapsedSeconds = Math.max(0.5, (nowMs - (this.startedAtMs || nowMs)) / 1000);
    this.timeline.push({atMs: nowMs, count});
    this.timeline = this.timeline.filter((sample) => nowMs - sample.atMs <= 12_000);
    let pace = count / elapsedSeconds * 60;
    if (this.timeline.length >= 2) {
      const first = this.timeline[0];
      const deltaSeconds = Math.max(0.8, (nowMs - first.atMs) / 1000);
      const instant = Math.max(0, count - first.count) / deltaSeconds * 60;
      pace = this.metrics.pace === 0 ? instant : this.metrics.pace * 0.65 + instant * 0.35;
    }
    let speechStatus = isFinal ? '已确认一段话' : '正在听你说…';
    if (count > previousCount) {
      this.lastSpeechAtMs = nowMs;
    } else if (count > 0 && nowMs - this.lastSpeechAtMs > 1350 && nowMs - this.lastPauseAtMs > 1350) {
      this.metrics.pauseCount += 1;
      this.lastPauseAtMs = nowMs;
      this.lastSpeechAtMs = nowMs;
      speechStatus = '检测到停顿';
    }
    this.metrics.partialTranscript = text;
    this.metrics.wordCount = count;
    this.metrics.pace = pace;
    this.metrics.elapsedSeconds = elapsedSeconds;
    this.metrics.speechStatus = speechStatus;
  }

  ingestRms(rms: number, nowMs: number = Date.now()): void {
    const target = clamp(rms * 9, 0, 1);
    const delta = Math.max(1, nowMs - (this.lastVolumeAtMs || nowMs));
    const timeConstant = target > this.smoothedVolume ? 120 : 420;
    const alpha = 1 - Math.exp(-delta / timeConstant);
    this.smoothedVolume += (target - this.smoothedVolume) * alpha;
    this.lastVolumeAtMs = nowMs;
    this.metrics.volume = clamp(this.smoothedVolume, 0, 1);
    this.metrics.isMicrophoneActive = true;
  }

  ingestFace(face?: FaceObservation): void {
    const result = estimateFaceOrientation(face);
    this.metrics.isVisionAvailable = true;
    this.metrics.facePresent = result.present;
    this.metrics.faceOrientationScore = result.score;
    this.metrics.visionStatus = result.status;
  }

  tick(nowMs: number = Date.now()): void {
    if (this.startedAtMs > 0) this.metrics.elapsedSeconds = Math.max(0, (nowMs - this.startedAtMs) / 1000);
    if (this.metrics.wordCount > 0 && nowMs - this.lastSpeechAtMs > 1350 && nowMs - this.lastPauseAtMs > 1350) {
      this.metrics.pauseCount += 1;
      this.metrics.speechStatus = '检测到停顿';
      this.lastPauseAtMs = nowMs;
      this.lastSpeechAtMs = nowMs;
    }
  }

  localAdvice(): CoachLocalAdvice {
    const value = this.metrics;
    if (value.isVisionAvailable && !value.facePresent) return {category: 'camera', advice: '回到画面中央，我在这里等你。', positive: false};
    if (value.isVisionAvailable && (value.faceOrientationScore ?? 1) < 0.55) return {category: 'camera', advice: '目光落在镜头附近，构图会更稳。', positive: false};
    if (value.isSpeechAvailable && value.pace > 295) return {category: 'pace', advice: '下一句慢一点，把关键词留出来。', positive: false};
    if (value.isMicrophoneActive && value.wordCount > 0 && value.volume < 0.12) return {category: 'volume', advice: '声音再送出来一点，保持自然。', positive: false};
    if (value.pauseCount >= 6) return {category: 'pause', advice: '重点之后停半拍，观众更容易跟上。', positive: false};
    return {category: 'steady', advice: '状态很稳，继续自然表达。', positive: true};
  }
}
