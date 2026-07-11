import { AppStore } from '../../app/AppStore';
import { PetCompanion } from '../../components/PetCompanion';
import { themeTokens } from '../../core/design/AppTheme';
import { PetEvent, petMessage, splitDraftSentences } from '../../core/models/AppModels';

@Component
export struct CoachPage {
  @ObjectLink store: AppStore;
  onOpenScript: () => void = () => {};
  onStartPractice: (draft: string) => void = () => {};
  onOpenSettings: () => void = () => {};

  aboutToAppear(): void {
    this.store.applyPet(this.store.currentDraft ? PetEvent.IDLE : PetEvent.EMPTY_WORKSPACE);
    this.store.applyPet(PetEvent.PET_MESSAGE,
      this.store.currentDraft ? '稿子在，随时可以进镜头练。' : '先写好稿子，我们再一起练开口。');
  }

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Row() {
          Blank(); Text('陪练').fontSize(20).fontWeight(FontWeight.Bold); Blank()
          Button('☼').backgroundColor(Color.Transparent).fontSize(27).fontColor(themeTokens(this.store.themeMode).accent)
            .accessibilityText('切换主题').onClick(() => this.store.cycleTheme())
          Button('⚙').backgroundColor(Color.Transparent).fontSize(24).fontColor(themeTokens(this.store.themeMode).accent)
            .accessibilityText('打开设置').onClick(() => this.onOpenSettings())
        }
          .width('100%').height(54)
        Text('实时口播陪练').fontSize(14).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).accent).width('100%')
        Text('中间是你，周围是指标。').fontSize(30).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        Text('进入沉浸台后：前摄画面居中，语速 / 词量 / 音量 / 停顿 / 镜头朝向围绕显示；建议来自真实教练接口。')
          .fontSize(16).lineHeight(25).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')

        Column({ space: 12 }) {
          Text('系统原生能力').fontSize(18).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
          Row({ space: 8 }) {
            this.capability('〽', 'Speech', '语音转写')
            this.capability('◎', 'Vision', '面部朝向')
            this.capability('▣', 'AV', '前摄录制')
          }.width('100%')
          Text('镜头朝向为视觉估算（姿态/框位置），不是精确“眼神接触率”。权限或硬件不可用时会明确标“不可用”。')
            .fontSize(12).lineHeight(18).fontColor(themeTokens(this.store.themeMode).textTertiary).width('100%')
        }.padding(18).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
          .borderRadius(themeTokens(this.store.themeMode).cardRadius).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })

        Column({ space: 16 }) {
          Text('当前稿件').fontSize(18).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
          if (this.store.currentDraft) {
            Text(this.store.currentDraft).fontSize(17).lineHeight(26).maxLines(6).textOverflow({ overflow: TextOverflow.Ellipsis })
              .fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
            Row() {
              Text(`${this.characterCount()} 字 · 约 ${this.estimatedSeconds()} 秒`).fontSize(13).fontColor(themeTokens(this.store.themeMode).textSecondary)
              Blank()
              Text(`${this.sentenceCount()} 句`).fontSize(12).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).accent)
                .padding({ left: 8, right: 8, top: 4, bottom: 4 }).backgroundColor(themeTokens(this.store.themeMode).accentSoft).borderRadius(10)
            }.width('100%')
            Button('进入镜头陪练台').width('100%').height(54).borderRadius(14).fontSize(18).fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF').backgroundColor(themeTokens(this.store.themeMode).accent)
              .onClick(() => this.onStartPractice(this.store.currentDraft))
            Button('编辑稿件').width('100%').height(46).fontColor(themeTokens(this.store.themeMode).accent)
              .backgroundColor(themeTokens(this.store.themeMode).accentSoft).onClick(() => this.onOpenScript())
          } else {
            Text('▱').fontSize(58).fontColor(themeTokens(this.store.themeMode).textTertiary)
            Text('还没有口播稿').fontSize(23).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
            Text('先在脚本助手生成稿件，再进入提词陪练。').fontSize(15).fontColor(themeTokens(this.store.themeMode).textTertiary).textAlign(TextAlign.Center)
            Button('去写稿').width('100%').height(54).borderRadius(14).fontSize(18).fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF').backgroundColor(themeTokens(this.store.themeMode).accent).onClick(() => this.onOpenScript())
          }
        }
        .padding(20).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
        .borderRadius(themeTokens(this.store.themeMode).cardRadius).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })

        Column({ space: 14 }) {
          Text('沉浸台里你会看到').fontSize(18).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
          this.pipeline(1, '中间：真实前摄画面', '相机预览，可镜像')
          this.pipeline(2, '上方：五项实时指标', '语速 · 词量 · 音量 · 停顿 · 镜头朝向')
          this.pipeline(3, '中部：对稿 + ASR 字幕', '当前句高亮，识别原文滚动')
          this.pipeline(4, '下方：教练建议 + 小月', '真实 /v1/assistant/coach + 宠物状态')
        }
        .padding(20).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
        .borderRadius(themeTokens(this.store.themeMode).cardRadius).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })

        this.petCard()
      }
      .padding({ left: 18, right: 18, bottom: 100 }).width('100%')
    }
    .width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  @Builder
  private petCard() {
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
        Text('小月会跟着陪练状态变').fontSize(15).fontWeight(FontWeight.Bold)
          .fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        Text(this.store.petOverride || petMessage(this.store.petState)).fontSize(12).lineHeight(18)
          .fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Text('听你说 · 分析中 · 偏镜头 · 声音小 · 正向反馈').fontSize(10)
          .fontColor(themeTokens(this.store.themeMode).textTertiary).width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.padding(14).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
      .borderRadius(themeTokens(this.store.themeMode).cardRadius)
      .border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
      .accessibilityGroup(true)
  }

  @Builder
  private capability(icon: string, title: string, detail: string) {
    Column({ space: 5 }) {
      Text(icon).fontSize(20).fontColor(themeTokens(this.store.themeMode).accent).width('100%')
      Text(title).fontSize(13).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
      Text(detail).fontSize(11).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
    }.padding(12).layoutWeight(1).backgroundColor(themeTokens(this.store.themeMode).inset).borderRadius(12)
      .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private pipeline(index: number, title: string, detail: string) {
    Row({ space: 14 }) {
      Text(`${index}`).fontSize(13).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
        .width(26).height(26).textAlign(TextAlign.Center).backgroundColor(themeTokens(this.store.themeMode).accent).borderRadius(13)
      Column({ space: 2 }) {
        Text(title).fontSize(16).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
        Text(detail).fontSize(13).fontColor(themeTokens(this.store.themeMode).textSecondary)
      }.alignItems(HorizontalAlign.Start)
    }.width('100%')
  }

  private characterCount(): number { return this.store.currentDraft.replace(/\s/g, '').length; }
  private estimatedSeconds(): number { return Math.max(20, Math.round(this.characterCount() / 4.1)); }
  private sentenceCount(): number {
    return splitDraftSentences(this.store.currentDraft).length;
  }
}
