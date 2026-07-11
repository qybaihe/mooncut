import { audio } from '@kit.AudioKit';
import { CoachMetricsEngine } from './CoachMetricsEngine';

/** Captures real PCM solely for RMS. Failure leaves microphone metrics unavailable. */
export class AudioRmsMeter {
  private capturer?: audio.AudioCapturer;
  private running: boolean = false;
  private readonly metrics: CoachMetricsEngine;
  private readonly onAudio?: (audio: Uint8Array) => void;

  constructor(metrics: CoachMetricsEngine, onAudio?: (audio: Uint8Array) => void) {
    this.metrics = metrics;
    this.onAudio = onAudio;
  }

  async start(): Promise<void> {
    await this.stop();
    const options: audio.AudioCapturerOptions = {
      streamInfo: {
        samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
        channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
        encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
      },
      capturerInfo: {
        source: audio.SourceType.SOURCE_TYPE_MIC,
        capturerFlags: 0
      }
    };
    try {
      this.capturer = await audio.createAudioCapturer(options);
      await this.capturer.start();
      this.running = true;
      this.metrics.setMicrophoneActive(true);
      void this.readLoop();
    } catch (_) {
      this.running = false;
      this.metrics.setMicrophoneActive(false);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.capturer) {
      try { await this.capturer.stop(); } catch (_) {}
      try { await this.capturer.release(); } catch (_) {}
    }
    this.capturer = undefined;
    this.metrics.setMicrophoneActive(false);
  }

  private async readLoop(): Promise<void> {
    while (this.running && this.capturer) {
      try {
        const buffer = await this.capturer.read(2048, true);
        this.metrics.ingestRms(this.calculateRms(buffer));
        this.onAudio?.(new Uint8Array(buffer));
      } catch (_) {
        this.running = false;
        this.metrics.setMicrophoneActive(false);
      }
    }
  }

  private calculateRms(buffer: ArrayBuffer): number {
    const samples = new Int16Array(buffer);
    if (samples.length === 0) return 0;
    let squareSum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const normalized = samples[index] / 32768;
      squareSum += normalized * normalized;
    }
    return Math.sqrt(squareSum / samples.length);
  }
}
