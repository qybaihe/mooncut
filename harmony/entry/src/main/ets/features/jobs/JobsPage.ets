import { AppStore } from '../../app/AppStore';
import { APIError } from '../../core/api/APIError';
import { presentError } from '../../core/api/ErrorPresentation';
import { RenderQueueItem, RenderQueueSummary, jobStageTitle } from '../../core/api/APIModels';
import { AppTab, PetEvent } from '../../core/models/AppModels';
import { themeTokens } from '../../core/design/AppTheme';

@Component
export struct JobsPage {
  @ObjectLink store: AppStore;
  onOpenSettings: () => void = () => {};
  onOpenEdit: () => void = () => {};
  @State summary: RenderQueueSummary = { running: 0, queued: 0, completedToday: 0 };
  @State active: RenderQueueItem[] = [];
  @State recent: RenderQueueItem[] = [];
  @State loading: boolean = true;
  @State errorMessage: string = '';
  @State errorDiagnostic: string = '';
  @State updatedAt: string = '';
  private refreshTimer: number = -1;
  private refreshing: boolean = false;
  private visible: boolean = false;

  aboutToAppear(): void {
    this.visible = true;
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), 3000);
  }
  aboutToDisappear(): void {
    this.visible = false;
    if (this.refreshTimer >= 0) clearInterval(this.refreshTimer);
    this.refreshTimer = -1;
  }

  private queueCount(): number { return this.summary.running + this.summary.queued; }

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Row() {
          Blank(); Text('任务').fontSize(20).fontWeight(FontWeight.Bold); Blank()
          Button('☼').fontSize(25).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
            .accessibilityText('切换主题').onClick(() => this.store.cycleTheme())
          Button('⚙').fontSize(23).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
            .accessibilityText('打开设置').onClick(() => this.onOpenSettings())
          Button('↻').fontSize(23).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
            .accessibilityText('刷新任务').onClick(() => this.refresh())
        }
          .width('100%').height(54)
        Text('▤  实时制作线').fontSize(14).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).accent).width('100%')
        Text(this.queueCount() > 0 ? 'MoonCut 正在开工。' : '制作线已就绪。').fontSize(28).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        Text('每条约 3 秒刷新。共享队列只显示友好匿名名，不公开用户与文件信息。')
          .fontSize(16).lineHeight(24).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')

        if (this.loading) {
          Row({ space: 10 }) {
            LoadingProgress().width(24).height(24).color(themeTokens(this.store.themeMode).accent)
            Text('加载队列…').fontSize(14).fontColor(themeTokens(this.store.themeMode).textSecondary)
          }.padding(16).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(14)
        }

        Row({ space: 10 }) {
          this.statTile('ϟ', `${this.summary.running}`, '运行中', themeTokens(this.store.themeMode).accent)
          this.statTile('⌛', `${this.summary.queued}`, '排队', themeTokens(this.store.themeMode).warning)
          this.statTile('✓', `${this.summary.completedToday}`, '今日完成', themeTokens(this.store.themeMode).success)
        }.width('100%')

        if (this.errorMessage) {
          Column({ space: 8 }) {
            Text(this.errorMessage).fontSize(14).fontColor(themeTokens(this.store.themeMode).danger).width('100%')
            if (this.errorDiagnostic) {
              Text(`诊断：${this.errorDiagnostic}`).fontSize(12).fontColor(themeTokens(this.store.themeMode).textTertiary).width('100%')
            }
            Button('重试真实请求').fontSize(14).fontColor(themeTokens(this.store.themeMode).accent)
              .backgroundColor(Color.Transparent).onClick(() => this.refresh())
          }.padding(14).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
            .borderRadius(themeTokens(this.store.themeMode).cardRadius)
        }
        this.liveStrip()
        if (this.active.length > 0) {
          Text('ϟ  进行中').fontSize(18).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%').margin({ top: 4 })
          ForEach(this.active, (item: RenderQueueItem) => { this.jobCard(item) })
        }
        if (this.recent.length > 0) {
          Text('↻  最近动态').fontSize(18).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%').margin({ top: 8 })
          ForEach(this.recent, (item: RenderQueueItem) => { this.jobCard(item) })
        }
        if (!this.loading && !this.errorMessage && this.active.length === 0 && this.recent.length === 0) {
          Column({ space: 12 }) {
            Text('▣').fontSize(34).fontColor(themeTokens(this.store.themeMode).textTertiary)
            Text('制作线空闲').fontSize(20).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
            Text('上传剪辑后，这里会显示真实排队与阶段进度。匿名队列不暴露邮箱和文件名。')
              .fontSize(14).lineHeight(21).textAlign(TextAlign.Center).fontColor(themeTokens(this.store.themeMode).textSecondary)
            Button('去剪辑').height(44).backgroundColor(themeTokens(this.store.themeMode).accent).fontColor('#FFFFFF')
              .onClick(() => this.onOpenEdit())
          }.padding(22).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
            .borderRadius(themeTokens(this.store.themeMode).cardRadius)
        }
      }
      .padding({ left: 18, right: 18, bottom: 100 }).width('100%')
    }
    .width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  @Builder
  private liveStrip() {
    Row({ space: 10 }) {
      Text('●').fontSize(13).fontColor(this.queueCount() > 0 ? themeTokens(this.store.themeMode).success : themeTokens(this.store.themeMode).textTertiary)
      Text(this.queueCount() > 0 ? `${this.queueCount()} 个任务正在流转` : '当前没有进行中的任务')
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor(themeTokens(this.store.themeMode).textPrimary)
      Blank()
      if (this.updatedAt) {
        Text(this.shortTime(this.updatedAt, true)).fontSize(12).fontColor(themeTokens(this.store.themeMode).textTertiary)
      }
      Button('↻').width(36).height(36).fontSize(18).fontColor(themeTokens(this.store.themeMode).accent)
        .backgroundColor(themeTokens(this.store.themeMode).inset).borderRadius(18)
        .accessibilityText('刷新队列').onClick(() => this.refresh())
    }.padding({ left: 14, right: 10, top: 10, bottom: 10 }).width('100%')
      .backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(14)
      .border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
  }

  @Builder
  private statTile(icon: string, value: string, label: string, tint: string) {
    Column({ space: 10 }) {
      Text(icon).fontSize(20).fontColor(tint).width('100%')
      Text(value).fontSize(26).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
      Text(label).fontSize(13).fontWeight(FontWeight.Medium).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
    }.padding(14).layoutWeight(1).height(116).backgroundColor(themeTokens(this.store.themeMode).surface)
      .borderRadius(themeTokens(this.store.themeMode).cardRadius).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
  }

  @Builder
  private jobCard(item: RenderQueueItem) {
    Column({ space: 12 }) {
      Row() {
        Text(item.status === 'completed' ? '✓' : item.status === 'failed' ? '!' : 'ϟ').fontSize(20)
          .fontColor(item.status === 'completed' ? themeTokens(this.store.themeMode).success : item.status === 'failed' ? themeTokens(this.store.themeMode).danger : themeTokens(this.store.themeMode).accent)
        Column({ space: 3 }) {
          Text(item.name).fontSize(17).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
          Text(jobStageTitle(item.stage)).fontSize(13).fontColor(themeTokens(this.store.themeMode).textSecondary)
        }.alignItems(HorizontalAlign.Start).margin({ left: 12 })
        Blank()
        Column({ space: 5 }) {
          Text(item.status === 'completed' ? '已完成' : item.status === 'failed' ? '失败' : item.status === 'queued' ? '排队' : '制作中')
            .fontSize(13).fontWeight(FontWeight.Bold)
            .fontColor(item.status === 'completed' ? themeTokens(this.store.themeMode).success : item.status === 'failed' ? themeTokens(this.store.themeMode).danger : themeTokens(this.store.themeMode).accent)
          if (item.mine) {
            Text('我的').fontSize(11).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).accent)
              .padding({ left: 7, right: 7, top: 3, bottom: 3 }).backgroundColor(themeTokens(this.store.themeMode).accentSoft).borderRadius(10)
          }
        }.alignItems(HorizontalAlign.End)
      }.width('100%')
      if (this.hasProgress(item) || (item.status !== 'queued' && item.status !== 'running')) {
        Progress({ value: this.progressValue(item), total: 1, type: ProgressType.Linear }).width('100%').height(8)
          .color(item.status === 'completed' ? themeTokens(this.store.themeMode).success : themeTokens(this.store.themeMode).accent)
      } else {
        Row({ space: 8 }) {
          LoadingProgress().width(18).height(18).color(themeTokens(this.store.themeMode).accent)
          Text('等待服务更新').fontSize(13).fontColor(themeTokens(this.store.themeMode).textTertiary)
        }.width('100%')
      }
      Row() {
        if (this.hasProgress(item)) {
          Text(`${Math.round(this.progressValue(item) * 100)}%`).fontSize(13).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).accent)
        } else if (item.status !== 'queued' && item.status !== 'running') {
          Text(item.status).fontSize(13).fontColor(themeTokens(this.store.themeMode).textTertiary)
        }
        Blank()
        if (item.status === 'queued' && item.queuePosition !== undefined) {
          Text(item.queuePosition === 1 ? '即将开始' : `前方 ${item.queuePosition - 1} 个`)
            .fontSize(13).fontWeight(FontWeight.Medium).fontColor(themeTokens(this.store.themeMode).warning)
            .margin({ right: 10 })
        }
        Text(this.shortTime(item.updatedAt, false)).fontSize(12).fontColor(themeTokens(this.store.themeMode).textTertiary)
      }.width('100%')
    }
    .padding(18).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
    .borderRadius(themeTokens(this.store.themeMode).cardRadius).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
  }

  private async refresh(): Promise<void> {
    if (!this.visible || this.refreshing) return;
    this.refreshing = true;
    try {
      const snapshot = await this.store.api.renderQueue();
      if (!this.visible) return;
      this.summary = snapshot.summary; this.active = snapshot.active; this.recent = snapshot.recent;
      this.updatedAt = snapshot.updatedAt ?? ''; this.errorMessage = ''; this.errorDiagnostic = '';
      if (snapshot.active.some((item: RenderQueueItem) => item.mine && (item.status === 'running' || item.status === 'queued'))) {
        this.store.applyPet(PetEvent.JOB_RUNNING);
      }
    } catch (error) {
      if (!this.visible) return;
      this.errorMessage = presentError(error as object);
      this.errorDiagnostic = error instanceof APIError ? error.code : '';
      this.store.handleError(error as object);
      if (error instanceof APIError && error.unauthorized) this.store.selectedTab = AppTab.CREATE;
    } finally {
      this.refreshing = false;
      if (this.visible) this.loading = false;
    }
  }

  private shortTime(iso: string, includeSeconds: boolean): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const hours = date.getHours() < 10 ? `0${date.getHours()}` : `${date.getHours()}`;
    const minutes = date.getMinutes() < 10 ? `0${date.getMinutes()}` : `${date.getMinutes()}`;
    const seconds = date.getSeconds() < 10 ? `0${date.getSeconds()}` : `${date.getSeconds()}`;
    return includeSeconds ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`;
  }

  private progressValue(item: RenderQueueItem): number { return Math.min(1, Math.max(0, item.progress)); }
  private hasProgress(item: RenderQueueItem): boolean { return item.progress > 0; }
}
