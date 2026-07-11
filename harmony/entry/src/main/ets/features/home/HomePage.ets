import { AppStore } from '../../app/AppStore';
import { themeTokens } from '../../core/design/AppTheme';
import {
  ErrorBanner, MemphisAccent, PrimaryButton, SecondaryButton, StudioEmptyState, cardBorderWidth, cardShadow
} from '../../core/design/DesignSystem';
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
      Column({ space: 18 }) {
        Row() {
          ServiceBadge({
            connected: this.store.serviceConnected,
            loading: this.store.restoringSession,
            theme: themeTokens(this.store.themeMode)
          })
          Blank()
          Button('☼').fontSize(24).fontColor(themeTokens(this.store.themeMode).accent)
            .backgroundColor(themeTokens(this.store.themeMode).inset).width(40).height(40).borderRadius(20)
            .accessibilityText('切换主题')
            .onClick(() => this.store.cycleTheme())
          Button('⚙').fontSize(22).fontColor(themeTokens(this.store.themeMode).accent)
            .backgroundColor(themeTokens(this.store.themeMode).inset).width(40).height(40).borderRadius(20)
            .margin({ left: 8 })
            .accessibilityText('打开设置')
            .onClick(() => this.onOpenSettings())
        }.width('100%')

        Stack({ alignContent: Alignment.TopEnd }) {
          Column({ space: 8 }) {
            Text('创作')
              .fontSize(34)
              .fontWeight(FontWeight.Bold)
              .fontColor(themeTokens(this.store.themeMode).textPrimary)
              .width('100%')
            Text(`你好，${this.store.user?.email.split('@')[0] ?? '创作者'}`)
              .fontSize(22)
              .fontWeight(FontWeight.Bold)
              .fontColor(themeTokens(this.store.themeMode).textPrimary)
              .width('100%')
            Text('把想法变成能发布的口播成片。剪辑与助手均连接真实服务，失败会明确提示。')
              .fontSize(15)
              .lineHeight(23)
              .fontColor(themeTokens(this.store.themeMode).textSecondary)
              .width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start)
          MemphisAccent({ theme: themeTokens(this.store.themeMode), style: 'corner' })
        }.width('100%')

        if (this.store.serviceError) {
          ErrorBanner({
            theme: themeTokens(this.store.themeMode),
            message: `服务暂不可用：${this.store.serviceError}`,
            retryTitle: '重新连接',
            onRetry: () => { void this.store.refreshHealth(true); }
          })
        }

        Column({ space: 12 }) {
          PrimaryButton({
            theme: themeTokens(this.store.themeMode),
            label: '✂  开始剪辑',
            onTap: () => this.onOpenEdit()
          })
          Row({ space: 10 }) {
            Column() {
              SecondaryButton({
                theme: themeTokens(this.store.themeMode),
                label: '▤  脚本助手',
                onTap: () => this.onOpenScript()
              })
            }.layoutWeight(1)
            Column() {
              SecondaryButton({
                theme: themeTokens(this.store.themeMode),
                label: '♩  口播陪练',
                onTap: () => this.onOpenCoach()
              })
            }.layoutWeight(1)
          }.width('100%')
        }.width('100%')

        if (this.store.activeJobId) {
          this.continueCard('继续任务', `活跃剪辑任务 ${this.shortJobId()}…`, '↻', () => this.onOpenJobs())
        }
        if (this.store.currentDraft) {
          this.continueCard('继续稿件', this.draftPreview(), '▤', () => this.onOpenScript())
        }
        if (!this.store.activeJobId && !this.store.currentDraft) {
          StudioEmptyState({
            theme: themeTokens(this.store.themeMode),
            icon: '☾',
            title: '还没有进行中的创作',
            description: '从剪辑一段口播或写一份稿件开始。'
          })
        }

        this.petStrip()
      }
      .padding({ left: 16, right: 16, top: 10, bottom: 28 })
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(themeTokens(this.store.themeMode).canvas)
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
        Text('小月')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(themeTokens(this.store.themeMode).textPrimary)
          .width('100%')
        Text(this.store.petOverride || petMessage(this.store.petState))
          .fontSize(12)
          .lineHeight(18)
          .fontColor(themeTokens(this.store.themeMode).textSecondary)
          .width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }
    .padding(12)
    .width('100%')
    .backgroundColor(themeTokens(this.store.themeMode).surface)
    .borderRadius(themeTokens(this.store.themeMode).cardRadius)
    .border({ width: cardBorderWidth(themeTokens(this.store.themeMode)), color: themeTokens(this.store.themeMode).hairline })
    .shadow(cardShadow(themeTokens(this.store.themeMode)))
    .accessibilityGroup(true)
  }

  @Builder
  private continueCard(title: string, detail: string, icon: string, action: () => void) {
    Row({ space: 12 }) {
      Text(icon)
        .fontSize(18)
        .fontColor(themeTokens(this.store.themeMode).accent)
        .width(42)
        .height(42)
        .textAlign(TextAlign.Center)
        .backgroundColor(themeTokens(this.store.themeMode).accentSoft)
        .borderRadius(11)
      Column({ space: 3 }) {
        Text(title)
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(themeTokens(this.store.themeMode).textPrimary)
          .width('100%')
        Text(detail)
          .fontSize(13)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontColor(themeTokens(this.store.themeMode).textSecondary)
          .width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Text('›').fontSize(24).fontColor(themeTokens(this.store.themeMode).textTertiary)
    }
    .padding(14)
    .width('100%')
    .backgroundColor(themeTokens(this.store.themeMode).surface)
    .borderRadius(themeTokens(this.store.themeMode).cardRadius)
    .border({ width: cardBorderWidth(themeTokens(this.store.themeMode)), color: themeTokens(this.store.themeMode).hairline })
    .shadow(cardShadow(themeTokens(this.store.themeMode)))
    .onClick(action)
  }

  private shortJobId(): string {
    return this.store.activeJobId.slice(0, 8);
  }

  private draftPreview(): string {
    return this.store.currentDraft.length > 48 ? `${this.store.currentDraft.slice(0, 48)}…` : this.store.currentDraft;
  }
}
