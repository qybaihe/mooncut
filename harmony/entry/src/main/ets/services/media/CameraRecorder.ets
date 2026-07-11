import { common } from '@kit.AbilityKit';
import { camera } from '@kit.CameraKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { media } from '@kit.MediaKit';
import { FaceObservation } from '../coaching/CoachMetricsEngine';

export enum CameraAvailability {
  PREPARING = 'preparing',
  READY = 'ready',
  DENIED = 'denied',
  UNAVAILABLE = 'unavailable'
}

export enum CameraRecordingState {
  IDLE = 'idle',
  RECORDING = 'recording',
  PAUSED = 'paused',
  FINISHING = 'finishing'
}

/**
 * Camera Kit + AVRecorder equivalent of the iOS CameraRecorder. It never
 * creates a placeholder file when camera preparation or recording fails.
 */
@Observed
export class CameraRecorder {
  availability: CameraAvailability = CameraAvailability.PREPARING;
  recordingState: CameraRecordingState = CameraRecordingState.IDLE;
  availabilityMessage: string = '正在准备相机…';
  elapsedSeconds: number = 0;
  outputPath: string = '';
  isMirrored: boolean = true;
  faceDetectionAvailable: boolean = false;
  onFaceObservation?: (face?: FaceObservation) => void;

  private manager?: camera.CameraManager;
  private input?: camera.CameraInput;
  private previewOutput?: camera.PreviewOutput;
  private videoOutput?: camera.VideoOutput;
  private metadataOutput?: camera.MetadataOutput;
  private session?: camera.VideoSession;
  private recorder?: media.AVRecorder;
  private outputFile?: fs.File;
  private timer: number = -1;

  get canRecord(): boolean { return this.availability === CameraAvailability.READY; }

  async prepare(context: common.UIAbilityContext, previewSurfaceId: string): Promise<void> {
    this.availability = CameraAvailability.PREPARING;
    this.availabilityMessage = '正在准备相机…';
    try {
      this.manager = camera.getCameraManager(context);
      const cameras = this.manager.getSupportedCameras();
      const front = cameras.find((item) => item.cameraPosition === camera.CameraPosition.CAMERA_POSITION_FRONT);
      if (!front) throw new Error('设备没有可用前置相机');
      const capability = this.manager.getSupportedOutputCapability(front, camera.SceneMode.NORMAL_VIDEO);
      const previewProfile = capability.previewProfiles[0];
      const videoProfile = capability.videoProfiles[0];
      if (!previewProfile || !videoProfile) throw new Error('设备不支持视频预览或录制');

      this.outputPath = `${context.cacheDir}/mooncut-recording-${Date.now()}.mp4`;
      this.outputFile = fs.openSync(this.outputPath, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      this.recorder = await media.createAVRecorder();
      const profile: media.AVRecorderProfile = {
        audioBitrate: 96000,
        audioChannels: 2,
        audioCodec: media.CodecMimeType.AUDIO_AAC,
        audioSampleRate: 48000,
        fileFormat: media.ContainerFormatType.CFT_MPEG_4,
        videoBitrate: 4_000_000,
        videoCodec: media.CodecMimeType.VIDEO_AVC,
        videoFrameWidth: videoProfile.size.width,
        videoFrameHeight: videoProfile.size.height,
        videoFrameRate: videoProfile.frameRateRange?.max ?? 30
      };
      await this.recorder.prepare({
        audioSourceType: media.AudioSourceType.AUDIO_SOURCE_TYPE_MIC,
        videoSourceType: media.VideoSourceType.VIDEO_SOURCE_TYPE_SURFACE_YUV,
        profile,
        url: `fd://${this.outputFile.fd}`
      });
      const recorderSurfaceId = await this.recorder.getInputSurface();

      this.input = this.manager.createCameraInput(front);
      await this.input.open();
      this.previewOutput = this.manager.createPreviewOutput(previewProfile, previewSurfaceId);
      this.videoOutput = this.manager.createVideoOutput(videoProfile, recorderSurfaceId);
      const faceType = capability.supportedMetadataObjectTypes?.find((type) => type === camera.MetadataObjectType.FACE_DETECTION);
      if (faceType !== undefined) {
        this.metadataOutput = this.manager.createMetadataOutput([faceType]);
        this.metadataOutput.on('metadataObjectsAvailable', (_error, objects) => {
          const object = objects[0];
          if (!object) { this.onFaceObservation?.(); return; }
          const box = object.boundingBox;
          const scaleX = box.width <= 1 ? 1 : previewProfile.size.width;
          const scaleY = box.height <= 1 ? 1 : previewProfile.size.height;
          this.onFaceObservation?.({
            centerX: (box.topLeftX + box.width / 2) / scaleX,
            centerY: (box.topLeftY + box.height / 2) / scaleY,
            width: box.width / scaleX,
            height: box.height / scaleY
          });
        });
        this.faceDetectionAvailable = true;
      }
      this.session = this.manager.createSession(camera.SceneMode.NORMAL_VIDEO) as camera.VideoSession;
      this.session.beginConfig();
      this.session.addInput(this.input);
      this.session.addOutput(this.previewOutput);
      this.session.addOutput(this.videoOutput);
      if (this.metadataOutput) this.session.addOutput(this.metadataOutput);
      await this.session.commitConfig();
      await this.session.start();
      await this.setMirror(this.isMirrored);
      this.availability = CameraAvailability.READY;
      this.availabilityMessage = '';
    } catch (error) {
      const failedPath = this.outputPath;
      await this.release();
      if (failedPath) {
        try { fs.unlinkSync(failedPath); } catch (_) {}
      }
      this.outputPath = '';
      this.availability = CameraAvailability.UNAVAILABLE;
      this.availabilityMessage = error instanceof Error ? error.message : '镜头暂时不可用，无法进行真实录制。';
    }
  }

  async start(): Promise<void> {
    if (!this.canRecord || !this.recorder || this.recordingState !== CameraRecordingState.IDLE) return;
    this.elapsedSeconds = 0;
    await this.recorder.start();
    this.recordingState = CameraRecordingState.RECORDING;
    this.startTimer();
  }

  async pause(): Promise<void> {
    if (!this.recorder || this.recordingState !== CameraRecordingState.RECORDING) return;
    await this.recorder.pause();
    this.stopTimer();
    this.recordingState = CameraRecordingState.PAUSED;
  }

  async resume(): Promise<void> {
    if (!this.recorder || this.recordingState !== CameraRecordingState.PAUSED) return;
    await this.recorder.resume();
    this.recordingState = CameraRecordingState.RECORDING;
    this.startTimer();
  }

  async finish(): Promise<string> {
    if (!this.recorder || (this.recordingState !== CameraRecordingState.RECORDING && this.recordingState !== CameraRecordingState.PAUSED)) return '';
    this.recordingState = CameraRecordingState.FINISHING;
    this.stopTimer();
    await this.recorder.stop();
    const result = this.outputPath;
    await this.release(false);
    this.recordingState = CameraRecordingState.IDLE;
    const info = fs.statSync(result);
    return info.size > 0 ? result : '';
  }

  async cancel(): Promise<void> {
    this.stopTimer();
    if (this.recorder && (this.recordingState === CameraRecordingState.RECORDING || this.recordingState === CameraRecordingState.PAUSED)) {
      try { await this.recorder.stop(); } catch (_) {}
    }
    const discarded = this.outputPath;
    await this.release();
    if (discarded) {
      try { fs.unlinkSync(discarded); } catch (_) {}
    }
    this.recordingState = CameraRecordingState.IDLE;
    this.elapsedSeconds = 0;
    this.outputPath = '';
  }

  async toggleMirror(): Promise<void> { await this.setMirror(!this.isMirrored); }

  async release(closeFile: boolean = true): Promise<void> {
    this.stopTimer();
    try { await this.session?.stop(); } catch (_) {}
    try { this.session?.release(); } catch (_) {}
    try { this.previewOutput?.release(); } catch (_) {}
    try { this.videoOutput?.release(); } catch (_) {}
    try { this.metadataOutput?.off('metadataObjectsAvailable'); } catch (_) {}
    try { this.metadataOutput?.release(); } catch (_) {}
    try { await this.input?.close(); } catch (_) {}
    try { await this.recorder?.release(); } catch (_) {}
    if (closeFile && this.outputFile) {
      try { fs.closeSync(this.outputFile); } catch (_) {}
    } else if (this.outputFile) {
      try { fs.closeSync(this.outputFile); } catch (_) {}
    }
    this.session = undefined; this.previewOutput = undefined; this.videoOutput = undefined;
    this.metadataOutput = undefined; this.input = undefined; this.recorder = undefined; this.outputFile = undefined;
    this.faceDetectionAvailable = false;
  }

  private async setMirror(enabled: boolean): Promise<void> {
    if (this.recordingState !== CameraRecordingState.IDLE) return;
    try {
      if (this.videoOutput?.isMirrorSupported()) this.videoOutput.enableMirror(enabled);
      this.isMirrored = enabled;
    } catch (_) {}
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => { this.elapsedSeconds += 1; }, 1000);
  }

  private stopTimer(): void {
    if (this.timer >= 0) clearInterval(this.timer);
    this.timer = -1;
  }
}
