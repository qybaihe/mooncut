import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { AppStore } from '../../app/AppStore';
import { PetEvent, VideoAsset, splitDraftSentences } from '../../core/models/AppModels';
import { CameraAvailability, CameraRecorder, CameraRecordingState } from '../../services/media/CameraRecorder';
import { AudioRmsMeter } from '../../services/coaching/AudioRmsMeter';
import { CoachMetricsEngine } from '../../services/coaching/CoachMetricsEngine';
import { SystemSpeechRecognizer } from '../../services/coaching/SystemSpeechRecognizer';
import { PetCompanion } from '../../components/PetCompanion';
import { themeTokens } from '../../core/design/AppTheme';
import { presentError } from '../../core/api/ErrorPresentation';

@Component
export struct TeleprompterPage {
  @ObjectLink store: AppStore;
  @Prop draft: string;
  onBack: () => void = () => {};
  onSendToEdit: (asset: VideoAsset) => void = () => {};
  @State recorder: CameraRecorder = new CameraRecorder();
  @State countdown: number = -1;
  @State reviewing: boolean = false;
  @State reviewUri: string = '';
  @State errorMessage: string = '';
  @State metricsEngine: CoachMetricsEngine = new CoachMetricsEngine();
  @State coachingActive: boolean = false;
  @State practiceSession: boolean = false;
  @State practicePaused: boolean = false;
  @State coachAdvice: string = '看镜头，按自己的节奏开始。';
  @State coachCategory: string = 'steady';
  @State coachPositive: boolean = true;
  @State coachModel: string = '';
  @State coachConnected: boolean = true;
  @State coachAnalyzing: boolean = false;
  @State showsSettings: boolean = false;
  private xComponentController: XComponentController = new XComponentController();
  private audioMeter?: AudioRmsMeter;
  private speechRecognizer?: SystemSpeechRecognizer;
  private metricsTimer: number = -1;
  private coachTimer: number = -1;
  private lastCoachFingerprint: string = '';
  private lastRemoteAdviceAt: number = 0;
  private lastAdvice: string = '';
  private tearingDown: boolean = false;
  private handedOff: boolean = false;
  private countdownGeneration: number = 0;

  aboutToDisappear(): void { this.countdownGeneration += 1; this.countdown = -1; void this.teardown(); }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      XComponent({ id: 'mooncut-camera-preview', type: XComponentType.SURFACE, controller: this.xComponentController })
        .width('100%').height('100%').backgroundColor('#000000')
        .scale({ x: this.recorder.isMirrored ? -1 : 1, y: 1 })
        .accessibilityLevel('no')
        .onLoad(() => this.prepareCamera())
      Column() { Blank() }.width('100%').height('100%')
        .linearGradient({ angle: 180, colors: [['#99000000', 0], ['#00000000', 0.42], ['#C9000000', 1]] })

      if (this.reviewing && this.reviewUri) {
        this.reviewPanel()
      } else {
        this.teleprompterOverlay()
      }

      if (this.countdown >= 0) {
        Text(this.countdown === 0 ? '开始' : `${this.countdown}`).fontSize(this.countdown === 0 ? 46 : 82)
          .fontWeight(FontWeight.Bold).fontColor('#FFFFFF').shadow({ radius: 20, color: '#99000000' })
      }
      if (!this.coachingActive && this.recorder.availability !== CameraAvailability.READY &&
        this.recorder.availability !== CameraAvailability.PREPARING) {
        this.permissionOverlay()
      }
      if (this.showsSettings) {
        this.settingsPanel()
      }
    }.width('100%').height('100%').backgroundColor('#000000')
  }

  @Builder
  private teleprompterOverlay() {
    Column() {
      Row() {
        Button('关闭').backgroundColor('#66000000').fontColor('#FFFFFF').onClick(() => { void this.exitTeleprompter(); })
        Blank()
        Text(this.formatTime(this.recorder.elapsedSeconds)).fontSize(17).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
        Blank()
        Button(this.recorder.isMirrored ? '镜像' : '原向').backgroundColor('#66000000').fontColor('#FFFFFF')
          .accessibilityText(this.recorder.isMirrored ? '当前镜像预览，轻点切换原向' : '当前原向预览，轻点切换镜像')
          .enabled(this.recorder.recordingState === CameraRecordingState.IDLE).onClick(() => this.recorder.toggleMirror())
        Button('☷').backgroundColor('#66000000').fontColor('#FFFFFF').accessibilityText('打开陪练设置')
          .onClick(() => { this.showsSettings = true; })
      }.width('100%').padding({ left: 14, right: 14, top: 14 })
      if (this.coachingActive) {
        this.metricsHud()
      }
      Blank()
      Column({ space: 8 }) {
        Text(this.coachingActive ? '实时提词' : '提词预览').fontSize(13).fontColor('#BFFFFFFF').width('100%')
        if (this.coachingActive && this.previousSentence()) {
          Text(this.previousSentence()).fontSize(Math.max(16, this.store.promptFontSize - 9)).fontColor('#72FFFFFF')
            .textAlign(TextAlign.Center).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Text(this.coachingActive ? this.activeSentence() : (this.draft || '还没有口播稿'))
          .fontSize(this.coachingActive ? this.store.promptFontSize : Math.max(22, this.store.promptFontSize - 4))
          .fontWeight(FontWeight.Bold).lineHeight(this.store.promptFontSize + 11)
          .fontColor('#FFFFFF').textAlign(TextAlign.Center).maxLines(this.coachingActive ? 3 : 5)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.coachingActive && this.nextSentence()) {
          Text(this.nextSentence()).fontSize(Math.max(16, this.store.promptFontSize - 9)).fontColor('#72FFFFFF')
            .textAlign(TextAlign.Center).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }.padding(18).width('100%').backgroundColor('#8A000000').borderRadius(18)
      if (this.coachingActive) {
        Text(this.metricsEngine.metrics.partialTranscript || '正在等待真实语音转写…')
          .fontSize(14).fontColor('#DFFFFFFF').textAlign(TextAlign.Center).maxLines(2)
          .padding({ left: 12, right: 12, top: 8, bottom: 8 }).width('100%')
        Row({ space: 8 }) {
          Text(this.coachPositive ? '✓' : '!').fontSize(17).fontColor(this.coachPositive ? '#6DE0A7' : '#FFD26D')
          Text(this.coachAnalyzing ? '教练正在分析…' : this.coachAdvice).fontSize(14).fontWeight(FontWeight.Medium).fontColor('#FFFFFF').layoutWeight(1)
          if (this.coachModel) { Text(this.coachModel).fontSize(10).fontColor('#8FFFFFFF') }
          PetCompanion({
            state: this.store.petState,
            message: this.store.petOverride,
            theme: themeTokens(this.store.themeMode),
            happiness: this.store.petHappiness,
            reducedMotion: this.store.reducedMotion,
            compact: true,
            onPet: () => this.store.touchPet()
          })
        }.padding(12).width('100%').backgroundColor('#A8212429').borderRadius(14)
      }
      if (this.errorMessage) {
        Text(this.errorMessage).fontSize(13).fontColor('#FFFF8E87').textAlign(TextAlign.Center).margin({ top: 8 })
      }
      Row({ space: 14 }) {
        if (this.recorder.recordingState === CameraRecordingState.IDLE && !this.coachingActive) {
          Button('只陪练').height(58).layoutWeight(1).backgroundColor('#66FFFFFF').fontColor('#FFFFFF').fontSize(16).fontWeight(FontWeight.Bold)
            .enabled(this.metricsEngine.metrics.isSpeechAvailable || this.recorder.canRecord)
            .accessibilityText('只陪练不录制').onClick(() => this.startSession(true))
          Button('开始录制').height(58).layoutWeight(1).backgroundColor('#E34A42').fontColor('#FFFFFF').fontSize(18).fontWeight(FontWeight.Bold)
            .enabled(this.recorder.canRecord).accessibilityText('开始录制并陪练').onClick(() => this.startSession(false))
        } else {
          Button(this.practiceSession ? (this.practicePaused ? '继续' : '暂停') : (this.recorder.recordingState === CameraRecordingState.PAUSED ? '继续' : '暂停')).height(58).layoutWeight(1)
            .enabled(this.practiceSession || this.recorder.recordingState === CameraRecordingState.RECORDING ||
              this.recorder.recordingState === CameraRecordingState.PAUSED)
            .backgroundColor('#CCFFFFFF').fontColor('#17181C').onClick(() => this.togglePause())
          Button('完成').height(58).layoutWeight(1).backgroundColor('#FFFFFF').fontColor('#17181C').fontWeight(FontWeight.Bold)
            .enabled(this.practiceSession || this.recorder.recordingState === CameraRecordingState.RECORDING ||
              this.recorder.recordingState === CameraRecordingState.PAUSED)
            .onClick(() => this.finish())
        }
      }.width('100%').margin({ top: 12 })
    }.padding({ left: 14, right: 14, bottom: 18 }).width('100%').height('100%')
  }

  @Builder
  private metricsHud() {
    Row({ space: 7 }) {
      this.metricTile('语速', this.metricsEngine.metrics.isSpeechAvailable ? `${Math.round(this.metricsEngine.metrics.pace)}` : '—', '字/分')
      this.metricTile('词量', this.metricsEngine.metrics.isSpeechAvailable ? `${this.metricsEngine.metrics.wordCount}` : '—', '字')
      this.metricTile('音量', this.metricsEngine.metrics.isMicrophoneActive ? `${Math.round(this.metricsEngine.metrics.volume * 100)}` : '—', '%')
      this.metricTile('停顿', this.metricsEngine.metrics.isSpeechAvailable ? `${this.metricsEngine.metrics.pauseCount}` : '—', '次')
      this.metricTile('镜头', this.metricsEngine.metrics.isVisionAvailable ? `${Math.round((this.metricsEngine.metrics.faceOrientationScore ?? 0) * 100)}` : '—', '估算')
    }.width('100%').padding({ top: 8 })
  }

  @Builder
  private metricTile(label: string, value: string, unit: string) {
    Column({ space: 1 }) {
      Text(value).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
      Text(`${label} ${unit}`).fontSize(9).fontColor('#AFFFFFFF').maxLines(1)
    }.layoutWeight(1).height(50).justifyContent(FlexAlign.Center).backgroundColor('#8A111419').borderRadius(10)
  }

  @Builder
  private reviewPanel() {
    Column({ space: 16 }) {
      Text('录制复核').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
      Video({ src: this.reviewUri }).width('100%').height(420).controls(true).objectFit(ImageFit.Contain).backgroundColor('#000000')
      Button('✂  交给剪辑').width('100%').height(56).backgroundColor(themeTokens(this.store.themeMode).accent).fontColor('#FFFFFF').fontSize(18).fontWeight(FontWeight.Bold)
        .onClick(() => this.handoff())
      Button('重新录制').width('100%').height(52).backgroundColor('#DDFFFFFF').fontColor('#17181C')
        .onClick(() => this.restartRecording())
      Button('返回稿件').width('100%').height(48).backgroundColor(Color.Transparent).fontColor('#FFFFFF')
        .onClick(() => { void this.exitTeleprompter(); })
    }.padding(20).width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor('#F2000000')
  }

  @Builder
  private permissionOverlay() {
    Column({ space: 16 }) {
      Text(this.recorder.availability === CameraAvailability.DENIED ? '需要相机与麦克风权限' : '相机不可用')
        .fontSize(23).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
      Text(this.recorder.availabilityMessage).fontSize(15).lineHeight(22).fontColor('#CFFFFFFF').textAlign(TextAlign.Center)
      if (this.recorder.availability === CameraAvailability.DENIED) {
        Button('打开系统权限设置').height(50).width('100%').backgroundColor(themeTokens(this.store.themeMode).accent).fontColor('#FFFFFF')
          .onClick(() => this.openPermissionSettings())
      }
      if (this.metricsEngine.metrics.isSpeechAvailable) {
        Button('只陪练（无需相机）').height(50).width('100%').backgroundColor('#66FFFFFF').fontColor('#FFFFFF')
          .onClick(() => this.startSession(true))
      }
      Button('退出').height(50).width('100%').backgroundColor('#FFFFFF').fontColor('#17181C')
        .onClick(() => { void this.exitTeleprompter(); })
    }.padding(24).width('82%').backgroundColor('#EE25272C').borderRadius(18)
  }

  @Builder
  private settingsPanel() {
    Column() {
      Blank()
      Column({ space: 16 }) {
        Row() {
          Text('陪练设置').fontSize(21).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
          Blank()
          Button('完成').backgroundColor(Color.Transparent).fontColor(themeTokens(this.store.themeMode).accent).onClick(() => { this.showsSettings = false; })
        }.width('100%')
        Text(`提词字号  ${this.store.promptFontSize}`).fontSize(14).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Slider({ value: this.store.promptFontSize, min: 22, max: 44, step: 1 })
          .selectedColor(themeTokens(this.store.themeMode).accent).onChange((value: number) => this.store.setPromptFontSize(value))
        Text(`推进节奏  ${this.store.promptSpeed}`).fontSize(14).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Slider({ value: this.store.promptSpeed, min: 1, max: 6, step: 1 })
          .selectedColor(themeTokens(this.store.themeMode).accent).onChange((value: number) => this.store.setPromptSpeed(value))
        Row() {
          this.capabilityLabel('Speech', this.metricsEngine.metrics.isSpeechAvailable)
          this.capabilityLabel('Vision', this.metricsEngine.metrics.isVisionAvailable)
          this.capabilityLabel('Camera', this.recorder.canRecord)
        }.width('100%')
        Text('语速/词量/停顿来自系统语音识别；音量来自麦克风 RMS；镜头朝向来自前摄人脸框估算。不可用时显示“不可用”，不会生成替代指标。')
          .fontSize(12).lineHeight(19).fontColor(themeTokens(this.store.themeMode).textTertiary).width('100%')
      }.padding(20).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius({ topLeft: 22, topRight: 22 })
    }.width('100%').height('100%').backgroundColor('#66000000')
  }

  @Builder
  private capabilityLabel(name: string, available: boolean) {
    Column({ space: 4 }) {
      Text(name).fontSize(12).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
      Text(available ? '可用' : '不可用').fontSize(11)
        .fontColor(available ? themeTokens(this.store.themeMode).success : themeTokens(this.store.themeMode).danger)
    }.layoutWeight(1).padding(10).backgroundColor(themeTokens(this.store.themeMode).inset).borderRadius(10)
  }

  private async prepareCamera(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    const permissions: Permissions[] = ['ohos.permission.CAMERA', 'ohos.permission.MICROPHONE'];
    const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, permissions);
    const cameraGranted = result.authResults[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    const microphoneGranted = result.authResults[1] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    if (microphoneGranted) await this.prepareCoaching();
    if (!cameraGranted || !microphoneGranted) {
      this.recorder.availability = CameraAvailability.DENIED;
      this.recorder.availabilityMessage = !cameraGranted && !microphoneGranted
        ? '相机与麦克风权限未开启。只陪练至少需要麦克风权限。'
        : !cameraGranted ? '相机权限未开启；仍可使用只陪练。' : '麦克风权限未开启，无法录制带声音的视频。';
      this.store.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
      return;
    }
    const surfaceId = this.xComponentController.getXComponentSurfaceId();
    this.recorder.onFaceObservation = (face) => this.metricsEngine.ingestFace(face);
    await this.recorder.prepare(context, surfaceId);
    if (!this.recorder.canRecord) this.store.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
    this.metricsEngine.setVisionAvailability(this.recorder.faceDetectionAvailable,
      this.recorder.faceDetectionAvailable ? '镜头朝向（估算）· 检测中' : '镜头朝向（估算）· 当前设备不可用');
    if (!this.speechRecognizer) await this.prepareCoaching();
  }

  private async prepareCoaching(): Promise<void> {
    if (this.speechRecognizer) return;
    this.speechRecognizer = new SystemSpeechRecognizer(this.metricsEngine);
    this.audioMeter = new AudioRmsMeter(this.metricsEngine, (audio: Uint8Array) => {
      this.speechRecognizer?.writeAudio(audio);
    });
    await this.speechRecognizer.prepare();
  }

  private async openPermissionSettings(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    const permissions: Permissions[] = ['ohos.permission.CAMERA', 'ohos.permission.MICROPHONE'];
    try {
      const results = await abilityAccessCtrl.createAtManager().requestPermissionOnSetting(context, permissions);
      if (results.every((value) => value === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED)) {
        await this.prepareCamera();
      } else {
        this.recorder.availability = CameraAvailability.DENIED;
        this.recorder.availabilityMessage = '仍未获得相机或麦克风权限。你可以再次打开系统权限设置。';
      }
    } catch (error) {
      this.errorMessage = `无法打开系统权限设置：${presentError(error as object)}`;
      this.store.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
    }
  }

  private async startSession(practiceOnly: boolean): Promise<void> {
    const generation = ++this.countdownGeneration;
    this.practiceSession = practiceOnly;
    if (!practiceOnly) {
      for (const value of [3, 2, 1, 0]) {
        this.countdown = value;
        await new Promise<void>((resolve) => setTimeout(resolve, 450));
        if (generation !== this.countdownGeneration) { this.countdown = -1; return; }
      }
      this.countdown = -1;
    }
    try {
      if (!practiceOnly) await this.recorder.start();
      await this.startCoaching(true);
      this.store.applyPet(practiceOnly ? PetEvent.COACH_LISTENING : PetEvent.RECORDING);
    }
    catch (error) {
      this.errorMessage = presentError(error as object);
      this.store.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
    }
  }

  private async togglePause(): Promise<void> {
    try {
      if (this.practiceSession) {
        if (this.practicePaused) {
          this.practicePaused = false; await this.startCoaching(false); this.store.applyPet(PetEvent.COACH_LISTENING);
        } else {
          this.practicePaused = true; await this.stopCoaching(false); this.store.applyPet(PetEvent.COACH_REVIEW);
        }
      } else if (this.recorder.recordingState === CameraRecordingState.RECORDING) {
        await this.recorder.pause(); await this.stopCoaching(false); this.store.applyPet(PetEvent.COACH_REVIEW);
      } else {
        await this.recorder.resume(); await this.startCoaching(false); this.store.applyPet(PetEvent.RECORDING);
      }
    } catch (error) {
      this.errorMessage = presentError(error as object);
      this.store.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
    }
  }

  private async finish(): Promise<void> {
    try {
      await this.stopCoaching(false);
      if (this.practiceSession) {
        this.store.applyPet(PetEvent.COACH_REVIEW);
        this.store.applyPet(PetEvent.PET_MESSAGE, '陪练先告一段落，需要的话我们再来一轮。');
        this.store.showToast('陪练先告一段落，需要的话可以再来一轮');
        this.practiceSession = false;
        this.practicePaused = false;
        return;
      }
      const path = await this.recorder.finish();
      if (!path) throw new Error('没有真实录制文件，无法进入复核');
      this.reviewUri = `file://${path}`; this.reviewing = true; this.store.applyPet(PetEvent.JOB_COMPLETED);
    } catch (error) {
      this.errorMessage = presentError(error as object);
      this.store.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
    }
  }

  private async restartRecording(): Promise<void> {
    const previousPath = this.recorder.outputPath;
    this.reviewing = false;
    this.reviewUri = '';
    if (previousPath) {
      try { fs.unlinkSync(previousPath); } catch (_) {}
    }
    await this.prepareCamera();
  }

  private async startCoaching(reset: boolean): Promise<void> {
    if (reset) this.metricsEngine.reset();
    this.coachingActive = true;
    await this.speechRecognizer?.start(reset);
    await this.audioMeter?.start();
    this.stopCoachTimers();
    this.metricsTimer = setInterval(() => {
      this.metricsEngine.tick();
      this.syncPetFromMetrics();
      if (Date.now() - this.lastRemoteAdviceAt > 8000) {
        const local = this.metricsEngine.localAdvice();
        this.coachAdvice = local.advice; this.coachCategory = local.category; this.coachPositive = local.positive;
      }
    }, 500);
    this.coachTimer = setInterval(() => this.requestCoachIfNeeded(), 4000);
  }

  private async stopCoaching(release: boolean): Promise<void> {
    this.coachingActive = false;
    this.stopCoachTimers();
    await this.audioMeter?.stop();
    if (release) await this.speechRecognizer?.release(); else await this.speechRecognizer?.stop();
  }

  private async requestCoachIfNeeded(): Promise<void> {
    const metrics = this.metricsEngine.metrics;
    if (!metrics.isSpeechAvailable && metrics.wordCount === 0) return;
    const sentence = this.currentSentence(metrics.wordCount);
    const fingerprint = `${metrics.wordCount}-${Math.round(metrics.pace)}-${metrics.pauseCount}-${sentence}-${metrics.facePresent}`;
    if (fingerprint === this.lastCoachFingerprint) return;
    this.lastCoachFingerprint = fingerprint; this.coachAnalyzing = true;
    this.store.applyPet(PetEvent.COACH_ANALYZING);
    try {
      const response = await this.store.api.coachAdvice({
        transcript: metrics.partialTranscript,
        currentScript: this.draft,
        currentSentence: sentence,
        lastAdvice: this.lastAdvice || undefined,
        metrics: {
          pace: metrics.pace, wordCount: metrics.wordCount, volume: metrics.volume, pauseCount: metrics.pauseCount,
          eyeContact: metrics.faceOrientationScore, elapsedSeconds: metrics.elapsedSeconds
        }
      });
      this.coachAdvice = response.advice; this.coachCategory = response.category ?? 'steady';
      this.coachPositive = response.positive ?? false; this.coachModel = response.model ?? '';
      this.coachConnected = true; this.lastAdvice = response.advice; this.lastRemoteAdviceAt = Date.now();
      if (response.petMessage) this.store.applyPet(PetEvent.PET_MESSAGE, response.petMessage);
      this.store.applyPet(this.coachPositive ? PetEvent.COACH_POSITIVE : PetEvent.COACH_REVIEW);
    } catch (_) {
      this.coachConnected = false;
      if (!this.coachAdvice) this.coachAdvice = '教练暂时未连接，本地真实指标仍在工作。';
      this.store.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
    }
    this.coachAnalyzing = false;
  }

  private currentSentence(wordCount: number): string {
    const sentences = splitDraftSentences(this.draft);
    if (!sentences.length) return this.draft;
    let cumulative = 0;
    for (const sentence of sentences) {
      cumulative += Math.max(1, Math.floor(sentence.replace(/\s/g, '').length / 2));
      if (wordCount < cumulative) return sentence;
    }
    return sentences[sentences.length - 1];
  }

  private syncPetFromMetrics(): void {
    const metrics = this.metricsEngine.metrics;
    if (metrics.isVisionAvailable && !metrics.facePresent) {
      this.store.applyPet(PetEvent.COACH_OFF_CAMERA);
      return;
    }
    if (metrics.isMicrophoneActive && metrics.volume < 0.1 && metrics.wordCount > 3) {
      this.store.applyPet(PetEvent.COACH_LOW_VOLUME);
      return;
    }
    if (this.coachAnalyzing) {
      this.store.applyPet(PetEvent.COACH_ANALYZING);
      return;
    }
    this.store.applyPet(this.practiceSession ? PetEvent.COACH_LISTENING : PetEvent.RECORDING);
  }

  private sentences(): string[] {
    return splitDraftSentences(this.draft);
  }

  private activeSentenceIndex(): number {
    const sentences = this.sentences();
    if (!sentences.length) return 0;
    const spoken = this.metricsEngine.metrics.wordCount;
    if (spoken > 0) {
      let cumulative = 0;
      for (let index = 0; index < sentences.length; index += 1) {
        cumulative += Math.max(1, Math.floor(sentences[index].replace(/\s/g, '').length / 2));
        if (spoken < cumulative) return index;
      }
      return sentences.length - 1;
    }
    const interval = Math.max(3, 9 - Math.round(this.store.promptSpeed));
    return Math.min(sentences.length - 1, Math.floor(this.recorder.elapsedSeconds / interval));
  }

  private activeSentence(): string {
    const sentences = this.sentences();
    return sentences[this.activeSentenceIndex()] ?? this.draft;
  }

  private previousSentence(): string {
    const sentences = this.sentences();
    return sentences[this.activeSentenceIndex() - 1] ?? '';
  }

  private nextSentence(): string {
    const sentences = this.sentences();
    return sentences[this.activeSentenceIndex() + 1] ?? '';
  }

  private stopCoachTimers(): void {
    if (this.metricsTimer >= 0) clearInterval(this.metricsTimer);
    if (this.coachTimer >= 0) clearInterval(this.coachTimer);
    this.metricsTimer = -1; this.coachTimer = -1;
  }

  private async teardown(): Promise<void> {
    if (this.tearingDown) return;
    this.tearingDown = true;
    this.countdownGeneration += 1;
    this.countdown = -1;
    await this.stopCoaching(true);
    if (!this.reviewing) await this.recorder.cancel();
    else {
      await this.recorder.release();
      if (!this.handedOff && this.recorder.outputPath) {
        try { fs.unlinkSync(this.recorder.outputPath); } catch (_) {}
      }
    }
  }

  private async exitTeleprompter(): Promise<void> {
    await this.teardown();
    this.onBack();
  }

  private handoff(): void {
    if (!this.recorder.outputPath) return;
    const info = fs.statSync(this.recorder.outputPath);
    const asset: VideoAsset = {
      id: `${Date.now()}`,
      name: '刚刚录制的口播.mp4',
      sizeLabel: info.size < 1048576 ? `${Math.round(info.size / 1024)} KB` : `${(info.size / 1048576).toFixed(1)} MB`,
      uri: `file://${this.recorder.outputPath}`,
      durationLabel: this.formatTime(this.recorder.elapsedSeconds),
      source: 'recording'
    };
    this.handedOff = true;
    this.onSendToEdit(asset);
  }

  private formatTime(seconds: number): string {
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  }
}
