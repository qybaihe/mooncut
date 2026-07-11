import { AppStore } from '../../app/AppStore';
import { themeTokens } from '../../core/design/AppTheme';
import { PetCompanion } from '../../components/PetCompanion';
import { ServiceBadge } from '../../components/ServiceBadge';
import { petMessage } from '../../core/models/AppModels';

@Component
export struct HomePage {
  @ObjectLink store: AppStore;
  onOpenEdit: () => void = () => {};
  onOpenScript: () => void = () => {};
  onOpenCoach: () => void = () => {};
  onOpenJobs: () => void = () => {};
  onOpenSettings: () => void = () => {};

  build() {
    Scroll() {
      Column({ space: 20 }) {
        Row() {
          ServiceBadge({ connected: this.store.serviceConnected, loading: this.store.restoringSession, theme: themeTokens(this.store.themeMode) })
          Blank()
          Button('☼').fontSize(28).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
            .accessibilityText('切换主题')
            .onClick(() => this.store.cycleTheme())
          Button('⚙').fontSize(26).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
            .accessibilityText('打开设置')
            .onClick(() => this.onOpenSettings())
        }.width('100%')

        Text('创作').fontSize(40).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        Text(`你好，${this.store.user?.email.split('@')[0] ?? '创作者'}`)
          .fontSize(27).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        Text('把想法变成能发布的口播成片。剪辑与助手均连接真实服务，失败会明确提示。')
          .fontSize(16).lineHeight(25).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        if (this.store.serviceError) {
          Column({ space: 8 }) {
            Text(`服务暂不可用：${this.store.serviceError}`).fontSize(14).lineHeight(21)
              .fontColor(themeTokens(this.store.themeMode).danger).width('100%')
            Button('重新连接').height(40).fontColor(themeTokens(this.store.themeMode).accent)
              .backgroundColor(themeTokens(this.store.themeMode).accentSoft).onClick(() => { void this.store.refreshHealth(true); })
          }.padding(14).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
            .borderRadius(12).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
        }
        if (!this.store.editingAvailable) {
          Text(`剪辑节点暂不可用：${this.store.agentError || '节点未配置或正在维护'}。账号、脚本助手和陪练仍可使用。`)
            .fontSize(13).lineHeight(20).fontColor(themeTokens(this.store.themeMode).warning).width('100%')
            .padding(12).backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(12)
        }

        Button('✂  开始剪辑').width('100%').height(58).borderRadius(14)
          .fontSize(19).fontWeight(FontWeight.Bold).fontColor('#FFFFFF').backgroundColor(themeTokens(this.store.themeMode).accent)
          .onClick(() => this.onOpenEdit())
        Row({ space: 12 }) {
          Button('▤  脚本助手').layoutWeight(1).height(54).borderRadius(14)
            .fontColor(themeTokens(this.store.themeMode).textPrimary).backgroundColor(themeTokens(this.store.themeMode).surface)
            .border({ width: 1, color: themeTokens(this.store.themeMode).hairline }).onClick(() => this.onOpenScript())
          Button('♩  口播陪练').layoutWeight(1).height(54).borderRadius(14)
            .fontColor(themeTokens(this.store.themeMode).textPrimary).backgroundColor(themeTokens(this.store.themeMode).surface)
            .border({ width: 1, color: themeTokens(this.store.themeMode).hairline }).onClick(() => this.onOpenCoach())
        }

        if (this.store.activeJobId) {
          this.continueCard('继续任务', `活跃剪辑任务 ${this.shortJobId()}…`, '↻', () => this.onOpenJobs())
        }
        if (this.store.currentDraft) {
          this.continueCard('继续稿件', this.draftPreview(), '▤', () => this.onOpenScript())
        }
        if (!this.store.activeJobId && !this.store.currentDraft) {
          Column({ space: 10 }) {
            Text('☾✦').fontSize(52).fontColor(themeTokens(this.store.themeMode).textTertiary)
            Text('还没有进行中的创作').fontSize(22).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
            Text('从剪辑一段口播或写一份稿件开始。').fontSize(15).fontColor(themeTokens(this.store.themeMode).textTertiary)
          }.width('100%').padding({ top: 30, bottom: 30 })
        }

        this.petStrip()
      }
      .padding({ left: 18, right: 18, top: 12, bottom: 28 }).width('100%')
    }
    .width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  @Builder
  private petStrip() {
    Row({ space: 12 }) {
      PetCompanion({
        state: this.store.petState,
        message: this.store.petOverride,
        theme: themeTokens(this.store.themeMode),
        happiness: this.store.petHappiness,
        reducedMotion: this.store.reducedMotion,
        compact: true,
        onPet: () => this.store.touchPet()
      })
      Column({ space: 4 }) {
        Text('小月').fontSize(15).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        Text(this.store.petOverride || petMessage(this.store.petState)).fontSize(12).lineHeight(18)
          .fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.padding(12).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
      .borderRadius(themeTokens(this.store.themeMode).cardRadius)
      .border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
      .accessibilityGroup(true)
  }

  @Builder
  private continueCard(title: string, detail: string, icon: string, action: () => void) {
    Row({ space: 12 }) {
      Text(icon).fontSize(21).fontColor(themeTokens(this.store.themeMode).accent)
        .width(42).height(42).textAlign(TextAlign.Center).backgroundColor(themeTokens(this.store.themeMode).accentSoft).borderRadius(11)
      Column({ space: 3 }) {
        Text(title).fontSize(16).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        Text(detail).fontSize(13).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Text('›').fontSize(25).fontColor(themeTokens(this.store.themeMode).textTertiary)
    }.padding(14).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
      .borderRadius(themeTokens(this.store.themeMode).cardRadius).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
      .onClick(action)
  }

  private shortJobId(): string { return this.store.activeJobId.slice(0, 8); }
  private draftPreview(): string {
    return this.store.currentDraft.length > 48 ? `${this.store.currentDraft.slice(0, 48)}…` : this.store.currentDraft;
  }
}
