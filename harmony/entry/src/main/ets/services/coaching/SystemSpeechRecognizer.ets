import { speechRecognizer } from '@kit.CoreSpeechKit';
import { CoachMetricsEngine } from './CoachMetricsEngine';

/**
 * Core Speech Kit adapter. It emits only provider callbacks; if engine creation
 * or microphone sharing fails, ASR stays explicitly unavailable.
 */
export class SystemSpeechRecognizer {
  private engine?: speechRecognizer.SpeechRecognitionEngine;
  private sessionId: string = '';
  private running: boolean = false;
  private wantRunning: boolean = false;
  private restartTimer: number = -1;
  private committedTranscript: string = '';
  private sessionPrefix: string = '';
  private currentSessionTranscript: string = '';
  private readonly metrics: CoachMetricsEngine;

  constructor(metrics: CoachMetricsEngine) { this.metrics = metrics; }

  async prepare(): Promise<void> {
    try {
      const extraParams: Record<string, Object> = { 'locate': 'CN', 'recognizerMode': 'short' };
      this.engine = await speechRecognizer.createEngine({
        language: 'zh-CN',
        online: 1,
        extraParams
      });
      const listener: speechRecognizer.RecognitionListener = {
        onStart: (_sessionId: string, _eventMessage: string): void => {
          this.metrics.setSpeechAvailability(true, '实时识别中');
        },
        onEvent: (_sessionId: string, _eventCode: number, _eventMessage: string): void => {},
        onResult: (_sessionId: string, result: speechRecognizer.SpeechRecognitionResult): void => {
          const separator = this.sessionPrefix && result.result ? ' ' : '';
          this.currentSessionTranscript = `${this.sessionPrefix}${separator}${result.result}`.trim();
          this.metrics.ingestTranscript(this.currentSessionTranscript, result.isFinal);
        },
        onComplete: (_sessionId: string, _eventMessage: string): void => {
          this.running = false;
          if (this.currentSessionTranscript) this.committedTranscript = this.currentSessionTranscript;
          if (this.wantRunning) {
            this.metrics.setSpeechAvailability(true, '语音识别正在续接');
            this.scheduleRestart();
          } else {
            this.metrics.setSpeechAvailability(true, '语音识别已暂停');
          }
        },
        onError: (_sessionId: string, _errorCode: number, errorMessage: string): void => {
          this.running = false;
          this.wantRunning = false;
          this.metrics.setSpeechAvailability(false, `识别中断：${errorMessage}`);
        }
      };
      this.engine.setListener(listener);
      this.metrics.setSpeechAvailability(true, '语音识别已就绪');
    } catch (_) {
      this.engine = undefined;
      this.metrics.setSpeechAvailability(false, '当前设备不支持中文语音识别');
    }
  }

  async start(resetTranscript: boolean = true): Promise<void> {
    if (this.running) return;
    if (resetTranscript) {
      this.committedTranscript = '';
      this.currentSessionTranscript = '';
    }
    this.wantRunning = true;
    if (!this.engine) await this.prepare();
    if (!this.engine) { this.wantRunning = false; return; }
    this.sessionId = `mooncut-${Date.now()}`;
    this.sessionPrefix = this.committedTranscript;
    this.currentSessionTranscript = this.sessionPrefix;
    try {
      const audioInfo: speechRecognizer.AudioInfo = {
        audioType: 'pcm',
        sampleRate: 16000,
        soundChannel: 1,
        sampleBit: 16
      };
      const extraParams: Record<string, Object> = {
        'recognitionMode': 0,
        'vadBegin': 5000,
        'vadEnd': 10000,
        'maxAudioDuration': 60000
      };
      const params: speechRecognizer.StartParams = { sessionId: this.sessionId, audioInfo, extraParams };
      this.engine.startListening(params);
      this.running = true;
      this.metrics.setSpeechAvailability(true, '实时识别中');
    } catch (_) {
      this.running = false;
      this.wantRunning = false;
      this.metrics.setSpeechAvailability(false, '语音识别无法与当前录制共享麦克风');
    }
  }

  writeAudio(audio: Uint8Array): void {
    if (!this.engine || !this.running || audio.byteLength === 0) return;
    try {
      this.engine.writeAudio(this.sessionId, audio);
    } catch (_) {
      this.running = false;
      this.wantRunning = false;
      try { this.engine.cancel(this.sessionId); } catch (_) {}
      this.metrics.setSpeechAvailability(false, '语音流写入中断');
    }
  }

  async stop(): Promise<void> {
    this.wantRunning = false;
    if (this.restartTimer >= 0) clearTimeout(this.restartTimer);
    this.restartTimer = -1;
    if (this.engine && this.running) {
      try { this.engine.finish(this.sessionId); } catch (_) {
        try { this.engine.cancel(this.sessionId); } catch (_) {}
      }
    }
    this.running = false;
    if (this.metrics.metrics.isSpeechAvailable) this.metrics.setSpeechAvailability(true, '语音识别已暂停');
  }

  async release(): Promise<void> {
    await this.stop();
    try { this.engine?.shutdown(); } catch (_) {}
    this.engine = undefined;
  }

  private scheduleRestart(): void {
    if (this.restartTimer >= 0) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = -1;
      if (this.wantRunning) void this.start(false);
    }, 220);
  }
}
