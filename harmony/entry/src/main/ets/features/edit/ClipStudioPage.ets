import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { common } from '@kit.AbilityKit';
import { AppStore } from '../../app/AppStore';
import { APIError } from '../../core/api/APIError';
import { presentError, standardError } from '../../core/api/ErrorPresentation';
import { EditJob, jobStageTitle } from '../../core/api/APIModels';
import { themeTokens } from '../../core/design/AppTheme';
import { ClipStage, PetEvent, VideoAsset } from '../../core/models/AppModels';
import { VideoShareService } from '../../services/sharing/VideoShareService';

@Component
export struct ClipStudioPage {
  @ObjectLink store: AppStore;
  onBack: () => void = () => {};
  @State stage: ClipStage = ClipStage.EMPTY;
  @State asset: VideoAsset | null = null;
  @State job: EditJob | null = null;
  @State progress: number = 0;
  @State stageLabel: string = '';
  @State title: string = '';
  @State prompt: string = '按默认原生规范剪辑，突出口播重点';
  @State imageGeneration: string = 'auto';
  @State errorMessage: string = '';
  @State errorDiagnostic: string = '';
  @State localResultUri: string = '';
  @State publishCaption: string = '';
  @State publishing: boolean = false;
  @State showsPublish: boolean = false;
  @State sharing: boolean = false;
  @State previewMode: string = 'after';
  private polling: boolean = false;

  aboutToAppear(): void {
    if (this.store.pendingAsset) {
      this.asset = this.store.pendingAsset;
      this.title = this.store.clipTitle || this.store.pendingAsset.name;
      this.prompt = this.store.clipPrompt;
      this.imageGeneration = this.store.clipImageGeneration;
      this.stage = ClipStage.READY;
      this.store.setPendingAsset(null);
    }
    if (this.store.activeJobId && !this.job) this.restore(this.store.activeJobId);
  }

  aboutToDisappear(): void {
    this.polling = false;
    // The iOS ClipStudioViewModel lives above navigation. Keep the source asset
    // in AppStore so rebuilding this ArkUI page has the same continuation behavior.
    if (this.asset) {
      this.store.clipTitle = this.title;
      this.store.clipPrompt = this.prompt;
      this.store.clipImageGeneration = this.imageGeneration;
      this.store.setPendingAsset(this.asset);
    }
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column() {
        Row() {
          Button('‹ 创作').fontSize(17).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
            .onClick(() => this.onBack())
          Blank()
          Text('剪辑').fontSize(20).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
          Blank()
          Button('重置').fontSize(14).backgroundColor(Color.Transparent).fontColor(themeTokens(this.store.themeMode).textSecondary)
            .onClick(() => this.reset())
        }.width('100%').height(58).padding({ left: 6, right: 6 })

        Scroll() {
          Column({ space: 16 }) {
            if (this.stage === ClipStage.EMPTY) {
              this.emptyState()
            } else if (this.stage === ClipStage.READY) {
              this.readyState()
            } else if (this.stage === ClipStage.DONE) {
              this.doneState()
            } else if (this.stage === ClipStage.FAILED) {
              this.failedState()
            } else {
              this.processingState()
            }
          }.width('100%').padding({ left: 18, right: 18, top: 10, bottom: 100 })
        }.layoutWeight(1).width('100%')
      }
      .width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
      if (this.showsPublish) {
        Column().width('100%').height('100%').backgroundColor('#66000000').onClick(() => { this.showsPublish = false; })
        this.publishSheet()
      }
    }
    .width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  @Builder
  private emptyState() {
    Column({ space: 18 }) {
      Text('⇧').fontSize(62).fontColor(themeTokens(this.store.themeMode).textTertiary)
      Text('选择一条口播素材').fontSize(24).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
      Text('相册或文件中的 MP4 / MOV。将上传到真实服务进行剪辑，不会伪造进度。')
        .fontSize(16).lineHeight(24).textAlign(TextAlign.Center).fontColor(themeTokens(this.store.themeMode).textTertiary)
      Blank().height(28)
      Row({ space: 10 }) {
        Button('▣  从相册选择').layoutWeight(1).height(58).borderRadius(14)
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor('#FFFFFF').backgroundColor(themeTokens(this.store.themeMode).accent)
          .onClick(() => this.pickVideo())
        Button('▤  从文件选择').layoutWeight(1).height(58).borderRadius(14)
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).accent)
          .backgroundColor(themeTokens(this.store.themeMode).accentSoft).onClick(() => this.pickVideoFile())
      }.width('100%')
    }
    .width('100%').padding({ left: 18, right: 18, top: 52, bottom: 34 })
    .backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(themeTokens(this.store.themeMode).cardRadius)
    .border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
  }

  @Builder
  private readyState() {
    Column({ space: 16 }) {
      this.flowStepper(0)
      Text('素材已就绪').fontSize(22).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
      if (this.asset) {
        Video({ src: this.asset.uri }).width('100%').height(210).controls(true).objectFit(ImageFit.Contain)
          .backgroundColor(themeTokens(this.store.themeMode).videoWell)
      }
      Text(this.asset?.name ?? '').fontSize(16).fontWeight(FontWeight.Medium).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
      Text(this.asset?.sizeLabel ?? '').fontSize(13).fontColor(themeTokens(this.store.themeMode).textTertiary).width('100%')
      TextInput({ placeholder: '标题', text: this.title }).height(50).backgroundColor(themeTokens(this.store.themeMode).inset)
        .fontColor(themeTokens(this.store.themeMode).textPrimary).onChange((value: string) => { this.title = value; })
      TextArea({ placeholder: '剪辑提示', text: this.prompt }).height(96).backgroundColor(themeTokens(this.store.themeMode).inset)
        .fontColor(themeTokens(this.store.themeMode).textPrimary).onChange((value: string) => { this.prompt = value; })
      Text('配图').fontSize(13).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
      Row() {
        Button('自动').layoutWeight(1).height(40)
          .backgroundColor(this.imageGeneration === 'auto' ? themeTokens(this.store.themeMode).accentSoft : Color.Transparent)
          .fontColor(this.imageGeneration === 'auto' ? themeTokens(this.store.themeMode).accent : themeTokens(this.store.themeMode).textSecondary)
          .onClick(() => { this.imageGeneration = 'auto'; })
        Button('关闭').layoutWeight(1).height(40)
          .backgroundColor(this.imageGeneration === 'off' ? themeTokens(this.store.themeMode).accentSoft : Color.Transparent)
          .fontColor(this.imageGeneration === 'off' ? themeTokens(this.store.themeMode).accent : themeTokens(this.store.themeMode).textSecondary)
          .onClick(() => { this.imageGeneration = 'off'; })
      }.padding(3).width('100%').backgroundColor(themeTokens(this.store.themeMode).inset).borderRadius(12)
      Button('上传并创建真实任务').width('100%').height(56).borderRadius(14)
        .fontSize(18).fontWeight(FontWeight.Bold).fontColor('#FFFFFF').backgroundColor(themeTokens(this.store.themeMode).accent)
        .onClick(() => this.startProcessing())
      Button('更换素材').width('100%').height(48).fontColor(themeTokens(this.store.themeMode).accent)
        .backgroundColor(themeTokens(this.store.themeMode).accentSoft).onClick(() => this.reset())
    }
    .padding(20).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
    .borderRadius(themeTokens(this.store.themeMode).cardRadius).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
  }

  @Builder
  private processingState() {
    Column({ space: 20 }) {
      this.flowStepper(this.stage === ClipStage.UPLOADING ? 1 : 2)
      Text(this.stageLabel || '等待服务更新').fontSize(22).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
      if (this.stage !== ClipStage.UPLOADING && this.job?.progress === undefined) {
        LoadingProgress().width(30).height(30).color(themeTokens(this.store.themeMode).accent)
        Text('不确定，仍在等待服务更新').fontSize(16).fontColor(themeTokens(this.store.themeMode).textSecondary)
      } else {
        Progress({ value: this.progress, total: 1, type: ProgressType.Linear })
          .width('100%').height(10).color(themeTokens(this.store.themeMode).accent)
        Text(`${Math.round(this.progress * 100)}%`).fontSize(16).fontColor(themeTokens(this.store.themeMode).textSecondary)
      }
      Text('进度仅来自服务端 status/stage/progress，不会本地自增。')
        .fontSize(13).fontColor(themeTokens(this.store.themeMode).textTertiary).textAlign(TextAlign.Center)
    }
    .padding({ left: 20, right: 20, top: 60, bottom: 60 }).width('100%')
    .backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(themeTokens(this.store.themeMode).cardRadius)
  }

  @Builder
  private doneState() {
    Column({ space: 16 }) {
      this.flowStepper(2)
      Text('✓').fontSize(52).fontColor(themeTokens(this.store.themeMode).success)
      Text('成片已完成').fontSize(24).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
      Text(this.job?.result?.summary ?? 'MoonCut 已完成渲染和质量检查。')
        .fontSize(15).lineHeight(23).fontColor(themeTokens(this.store.themeMode).textSecondary).textAlign(TextAlign.Center)
      if (this.localResultUri && this.asset) {
        Row() {
          Button('原片').layoutWeight(1).height(40)
            .backgroundColor(this.previewMode === 'before' ? themeTokens(this.store.themeMode).accentSoft : Color.Transparent)
            .fontColor(this.previewMode === 'before' ? themeTokens(this.store.themeMode).accent : themeTokens(this.store.themeMode).textSecondary)
            .onClick(() => { this.previewMode = 'before'; })
          Button('成片').layoutWeight(1).height(40)
            .backgroundColor(this.previewMode === 'after' ? themeTokens(this.store.themeMode).accentSoft : Color.Transparent)
            .fontColor(this.previewMode === 'after' ? themeTokens(this.store.themeMode).accent : themeTokens(this.store.themeMode).textSecondary)
            .onClick(() => { this.previewMode = 'after'; })
        }.padding(3).width('100%').backgroundColor(themeTokens(this.store.themeMode).inset).borderRadius(12)
      }
      if (this.localResultUri) {
        Video({ src: this.previewMode === 'before' && this.asset ? this.asset.uri : this.localResultUri }).width('100%').height(220).controls(true)
          .objectFit(ImageFit.Contain).backgroundColor(themeTokens(this.store.themeMode).videoWell)
      }
      if (this.job?.result?.quality?.ok === true) {
        Text('质检通过，可下载或发布到社区').fontSize(14).fontColor(themeTokens(this.store.themeMode).success)
      }
      if (!this.localResultUri) {
        Button('重新下载成片').width('100%').height(54).borderRadius(14)
          .backgroundColor(themeTokens(this.store.themeMode).accent).fontColor('#FFFFFF')
          .onClick(() => { if (this.job) this.downloadIfNeeded(this.job); })
      }
      if (this.localResultUri) {
        Button(this.sharing ? '正在打开系统分享…' : '分享成片').width('100%').height(54).borderRadius(14)
          .enabled(!this.sharing).backgroundColor(themeTokens(this.store.themeMode).accent)
          .fontColor('#FFFFFF').onClick(() => this.shareResult())
      }
      if (this.job?.result?.quality?.ok === true) {
        Button('发布到社区')
          .width('100%').height(52).borderRadius(14).enabled(!this.publishing)
          .backgroundColor(themeTokens(this.store.themeMode).accentSoft)
          .fontColor(themeTokens(this.store.themeMode).accent)
          .onClick(() => { this.showsPublish = true; })
      } else {
        Text('质检未通过或结果未知时不显示发布入口。').fontSize(12).fontColor(themeTokens(this.store.themeMode).textTertiary)
      }
      if (this.errorMessage) {
        Column({ space: 7 }) {
          Text(this.errorMessage).fontSize(13).lineHeight(20).fontColor(themeTokens(this.store.themeMode).danger).width('100%')
          if (this.errorDiagnostic) {
            Text(`诊断：${this.errorDiagnostic}`).fontSize(12).fontColor(themeTokens(this.store.themeMode).textTertiary).width('100%')
          }
        }.padding(12).width('100%').backgroundColor(themeTokens(this.store.themeMode).inset).borderRadius(10)
      }
      Button('再剪一条').width('100%').height(48).fontColor(themeTokens(this.store.themeMode).accent)
        .backgroundColor(themeTokens(this.store.themeMode).accentSoft).onClick(() => this.reset())
    }
    .padding(22).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
    .borderRadius(themeTokens(this.store.themeMode).cardRadius)
  }

  @Builder
  private publishSheet() {
    Column({ space: 16 }) {
      Row() {
        Text('发布社区').fontSize(20).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
        Blank()
        Button('取消').backgroundColor(Color.Transparent).fontColor(themeTokens(this.store.themeMode).accent)
          .onClick(() => { this.showsPublish = false; })
      }.width('100%')
      TextArea({ placeholder: '说明', text: this.publishCaption }).height(110)
        .backgroundColor(themeTokens(this.store.themeMode).inset).fontColor(themeTokens(this.store.themeMode).textPrimary)
        .onChange((value: string) => { this.publishCaption = value; })
      Button(this.publishing ? '正在发布…' : '确认发布').width('100%').height(52).enabled(!this.publishing)
        .backgroundColor(themeTokens(this.store.themeMode).accent).fontColor('#FFFFFF')
        .onClick(() => this.publishToCommunity())
    }.padding(20).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
      .borderRadius({ topLeft: 22, topRight: 22 })
  }

  @Builder
  private flowStepper(current: number) {
    Row({ space: 6 }) {
      this.flowStep('素材', 0, current)
      Divider().layoutWeight(1).color(themeTokens(this.store.themeMode).hairline)
      this.flowStep('上传', 1, current)
      Divider().layoutWeight(1).color(themeTokens(this.store.themeMode).hairline)
      this.flowStep('成片', 2, current)
    }.width('100%')
  }

  @Builder
  private flowStep(label: string, index: number, current: number) {
    Column({ space: 4 }) {
      Text(index <= current ? '✓' : `${index + 1}`).fontSize(12).fontWeight(FontWeight.Bold)
        .fontColor(index <= current ? '#FFFFFF' : themeTokens(this.store.themeMode).textTertiary)
        .width(24).height(24).textAlign(TextAlign.Center)
        .backgroundColor(index <= current ? themeTokens(this.store.themeMode).accent : themeTokens(this.store.themeMode).inset).borderRadius(12)
      Text(label).fontSize(11).fontColor(index === current ? themeTokens(this.store.themeMode).textPrimary : themeTokens(this.store.themeMode).textTertiary)
    }
  }

  @Builder
  private failedState() {
    Column({ space: 16 }) {
      Text('!').fontSize(48).fontColor(themeTokens(this.store.themeMode).danger)
      Text('任务失败').fontSize(24).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
      Text(this.errorMessage || '服务返回失败').fontSize(15).fontColor(themeTokens(this.store.themeMode).textSecondary).textAlign(TextAlign.Center)
      if (this.errorDiagnostic) {
        Text(`诊断：${this.errorDiagnostic}`).fontSize(12).fontColor(themeTokens(this.store.themeMode).textTertiary)
      }
      Button('重新检查').width('100%').height(52).backgroundColor(themeTokens(this.store.themeMode).accent).fontColor('#FFFFFF')
        .onClick(() => this.store.activeJobId ? this.restore(this.store.activeJobId) : this.startProcessing())
      if (this.asset) {
        Button('保留素材，返回设置').width('100%').height(48).fontColor(themeTokens(this.store.themeMode).accent)
          .backgroundColor(themeTokens(this.store.themeMode).accentSoft)
          .onClick(() => { this.stage = ClipStage.READY; this.errorMessage = ''; this.errorDiagnostic = ''; })
      }
    }.padding(22).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(themeTokens(this.store.themeMode).cardRadius)
  }

  private async pickVideo(): Promise<void> {
    try {
      const picker = new photoAccessHelper.PhotoViewPicker();
      const options = new photoAccessHelper.PhotoSelectOptions();
      options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.VIDEO_TYPE;
      options.maxSelectNumber = 1;
      const result = await picker.select(options);
      if (!result.photoUris.length) return;
      this.selectAsset(result.photoUris[0]);
    } catch (error) { this.errorMessage = presentError(error as object); this.stage = ClipStage.FAILED; }
  }

  private async pickVideoFile(): Promise<void> {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 1;
      options.fileSuffixFilters = ['视频|mp4,mov'];
      const result = await new picker.DocumentViewPicker(context).select(options);
      if (result.length > 0) this.selectAsset(result[0]);
    } catch (error) {
      this.errorMessage = presentError(error as object);
      this.stage = ClipStage.FAILED;
    }
  }

  private selectAsset(uri: string): void {
    const file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    try {
      const stat = fs.statSync(file.fd);
      if (stat.size <= 0) throw new Error('选择的视频为空，请换一个文件');
      const encodedName = uri.split('/').pop()?.split('?')[0] ?? '本地视频.mp4';
      const name = decodeURIComponent(encodedName);
      this.asset = { id: `${Date.now()}`, name, sizeLabel: this.byteLabel(stat.size), uri, source: 'upload' };
      this.title = name; this.stage = ClipStage.READY; this.store.applyPet(PetEvent.IDLE);
    } finally {
      fs.closeSync(file);
    }
  }

  private async startProcessing(): Promise<void> {
    if (!this.asset) return;
    this.errorMessage = ''; this.errorDiagnostic = ''; this.stage = ClipStage.UPLOADING; this.stageLabel = '上传素材'; this.progress = 0;
    this.store.applyPet(PetEvent.UPLOADING);
    try {
      const file = fs.openSync(this.asset.uri, fs.OpenMode.READ_ONLY);
      const stat = fs.statSync(file.fd);
      const contentType = this.asset.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
      let session = await this.store.api.createUploadSession(this.asset.name, stat.size, contentType);
      let offset = session.receivedBytes;
      let retryCount = 0;
      try {
        while (offset < stat.size) {
          const length = Math.min(session.chunkBytes, stat.size - offset);
          const data = new ArrayBuffer(length);
          const read = fs.readSync(file.fd, data, { offset, length });
          if (read !== length) throw new Error(`视频读取中断：期望 ${length} 字节，实际 ${read} 字节`);
          try {
            session = await this.store.api.uploadChunk(session.id, offset, data);
            offset = session.receivedBytes;
            retryCount = 0;
            this.progress = offset / stat.size;
            this.stageLabel = `上传素材 ${Math.round(offset / stat.size * 100)}%`;
          } catch (error) {
            if (error instanceof APIError && !error.retryable) throw error;
            retryCount += 1;
            if (retryCount > 3) throw standardError(error as object);
            session = await this.store.api.getUploadSession(session.id);
            offset = session.receivedBytes;
            this.stageLabel = `网络恢复，继续上传 ${Math.round(offset / stat.size * 100)}%`;
          }
        }
      } finally { fs.closeSync(file); }
      const uploaded = await this.store.api.completeUploadSession(session.id);
      const created = await this.store.api.createEditJob(uploaded.assetId, this.title, this.prompt, this.imageGeneration);
      this.store.setActiveJobId(created.id); this.stage = ClipStage.QUEUED; this.stageLabel = '排队中';
      this.store.applyPet(PetEvent.JOB_QUEUED);
      await this.poll(created.id);
    } catch (error) { this.fail(error); }
  }

  private async restore(id: string): Promise<void> {
    this.stage = ClipStage.PROCESSING; this.stageLabel = '恢复任务';
    try {
      const current = await this.store.api.getEditJob(id); this.applyJob(current);
      if (current.status === 'queued' || current.status === 'running') await this.poll(id);
      else if (current.status === 'completed') await this.downloadIfNeeded(current);
    } catch (error) { this.fail(error); }
  }

  private async poll(id: string): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    while (this.polling) {
      try {
        const current = await this.store.api.getEditJob(id); this.applyJob(current);
        if (current.status === 'completed') { await this.downloadIfNeeded(current); break; }
        if (current.status === 'failed') break;
      } catch (error) {
        if (error instanceof APIError && error.unauthorized) {
          this.fail(error);
          break;
        }
        this.stageLabel = '不确定，仍在等待服务更新';
      }
      await new Promise<void>((resolve) => setTimeout(resolve, this.store.api.configuration.pollIntervalMs));
    }
    this.polling = false;
  }

  private applyJob(current: EditJob): void {
    this.job = current; this.store.setActiveJobId(current.id); this.stageLabel = jobStageTitle(current.stage);
    if (current.progress !== undefined) this.progress = Math.min(1, Math.max(0, current.progress));
    if (current.status === 'completed') {
      this.stage = ClipStage.DONE; this.progress = 1; this.store.applyPet(PetEvent.JOB_COMPLETED);
    } else if (current.status === 'failed') {
      this.errorMessage = current.error ?? '任务失败'; this.stage = ClipStage.FAILED; this.store.applyPet(PetEvent.JOB_FAILED);
    } else {
      this.stage = current.status === 'queued' ? ClipStage.QUEUED : ClipStage.PROCESSING;
      this.store.applyPet(current.status === 'queued' ? PetEvent.JOB_QUEUED : PetEvent.JOB_RUNNING);
    }
  }

  private async downloadIfNeeded(current: EditJob): Promise<void> {
    if (this.localResultUri) return;
    this.stage = ClipStage.DOWNLOADING; this.stageLabel = '下载成片'; this.store.applyPet(PetEvent.JOB_DOWNLOADING);
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const path = `${context.filesDir}/mooncut-${current.id}.mp4`;
      await this.store.api.downloadArtifact(current.id, path, 'video');
      this.localResultUri = `file://${path}`;
      this.previewMode = 'after'; this.stage = ClipStage.DONE; this.progress = 1; this.store.applyPet(PetEvent.JOB_COMPLETED);
      this.store.showToast('成片已就绪');
    } catch (error) {
      this.stage = ClipStage.DONE;
      this.errorMessage = `任务已完成，但成片下载失败：${presentError(error as object)}`;
      this.errorDiagnostic = error instanceof APIError ? error.code : '';
      this.store.showToast(this.errorMessage, true);
      this.store.applyPet(PetEvent.JOB_FAILED);
    }
  }

  private async publishToCommunity(): Promise<void> {
    if (!this.job || this.job.status !== 'completed' || this.job.result?.quality?.ok !== true) return;
    this.publishing = true;
    try {
      await this.store.api.publishCommunity(
        this.job.id,
        this.store.user?.email.split('@')[0],
        this.title || this.job.originalName,
        this.publishCaption || undefined
      );
      this.showsPublish = false;
      this.store.applyPet(PetEvent.JOB_COMPLETED);
      this.store.showToast('已发布到社区');
    } catch (error) {
      this.showsPublish = false;
      this.fail(error);
    }
    this.publishing = false;
  }

  private async shareResult(): Promise<void> {
    if (!this.localResultUri || this.sharing) return;
    this.sharing = true;
    try {
      const context = getContext(this) as common.UIAbilityContext;
      await VideoShareService.share(context, this.localResultUri, this.title || this.job?.originalName || 'MoonCut 成片');
    } catch (error) {
      this.store.showToast(`无法打开系统分享：${presentError(error as object)}`, true);
    }
    this.sharing = false;
  }

  private fail(error: object): void {
    this.errorMessage = presentError(error as object);
    this.errorDiagnostic = error instanceof APIError ? error.code : '';
    this.stage = ClipStage.FAILED; this.store.applyPet(PetEvent.JOB_FAILED);
    this.store.handleError(error);
  }

  private reset(): void {
    this.polling = false;
    this.removeOwnedAsset(this.asset);
    this.removeSandboxUri(this.localResultUri);
    this.store.clearClipWorkspace();
    this.asset = null; this.job = null; this.stage = ClipStage.EMPTY;
    this.progress = 0; this.errorMessage = ''; this.errorDiagnostic = ''; this.localResultUri = ''; this.publishCaption = '';
    this.sharing = false; this.showsPublish = false;
    this.imageGeneration = 'auto'; this.previewMode = 'after';
    this.store.setActiveJobId(''); this.store.applyPet(PetEvent.EMPTY_WORKSPACE);
  }

  private removeOwnedAsset(asset: VideoAsset | null): void {
    if (asset?.source === 'recording') this.removeSandboxUri(asset.uri);
  }

  private removeSandboxUri(uri: string): void {
    if (!uri.startsWith('file://')) return;
    try { fs.unlinkSync(uri.substring('file://'.length)); } catch (_) {}
  }

  private byteLabel(bytes: number): string {
    return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  }
}
