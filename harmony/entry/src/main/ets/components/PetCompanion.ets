import { ThemeTokens } from '../core/design/AppTheme';
import {
  PetAnimationState, petAnimationDurationMs, petAnimationFrameCount, petAnimationRow, petMessage
} from '../core/models/AppModels';

@Component
export struct PetCompanion {
  @Prop @Watch('onStateChanged') state: PetAnimationState;
  @Prop message: string = '';
  @Prop theme: ThemeTokens;
  @Prop happiness: number = 68;
  @Prop @Watch('onMotionChanged') reducedMotion: boolean = false;
  @Prop compact: boolean = false;
  onPet: () => void = () => {};
  @State heartVisible: boolean = false;
  @State frame: number = 0;
  private animationTimer: number = -1;

  aboutToAppear(): void { this.startAnimation(); }
  aboutToDisappear(): void { this.stopAnimation(); }

  build() {
    if (this.compact) {
      this.petButton()
    } else {
      Row({ space: 14 }) {
        this.petButton()
        Column({ space: 7 }) {
          Row() {
            Text('小月').fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.theme.textPrimary)
            Blank()
            Text(`${this.mood()} · ${this.happiness}`).fontSize(10).fontColor(this.theme.textTertiary)
          }.width('100%')
          Text(this.message || petMessage(this.state)).fontSize(14).fontColor(this.theme.textSecondary)
          Stack({ alignContent: Alignment.Start }) {
            Row().height(5).width('100%').borderRadius(3).backgroundColor(this.theme.inset)
            Row().height(5).width(`${this.happiness}%`).borderRadius(3).backgroundColor('#FF6D8C')
          }.width('100%').height(5)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')
      .padding(16)
      .backgroundColor(this.theme.surface)
      .borderRadius(this.theme.cardRadius)
      .border({ width: this.theme.usesMemphisChrome ? 1.5 : 1, color: this.theme.hairline })
    }
  }

  @Builder
  private petButton() {
    Button() {
      Stack({ alignContent: Alignment.Bottom }) {
        Stack({ alignContent: Alignment.TopStart }) {
          Image($r('app.media.happydog_spritesheet'))
            .width(this.compact ? 416 : 544).height(this.compact ? 504 : 666).objectFit(ImageFit.Fill)
            .translate({
              x: -this.frame * (this.compact ? 52 : 68),
              y: -petAnimationRow(this.state) * (this.compact ? 56 : 74)
            })
        }.width(this.compact ? 52 : 68).height(this.compact ? 56 : 74).clip(true).translate({ y: -2 })
        if (this.heartVisible && !this.reducedMotion) {
          Text('♥').fontSize(this.compact ? 19 : 24).fontColor('#FF667F').translate({ x: this.compact ? 17 : 22, y: this.compact ? -21 : -27 })
        }
      }.width(this.compact ? 56 : 72).height(this.compact ? 60 : 78)
    }
    .width(this.compact ? 56 : 72).height(this.compact ? 60 : 78).padding(0).backgroundColor(this.theme.accentSoft).borderRadius(this.compact ? 15 : 18)
    .accessibilityText(`摸摸小月，当前开心值 ${this.happiness}`)
    .accessibilityDescription('轻点会增加开心值')
    .onClick(() => this.pet())
  }

  private mood(): string {
    if (this.happiness >= 90) return '超开心';
    if (this.happiness >= 72) return '很开心';
    return '陪着你';
  }

  private pet(): void {
    this.heartVisible = !this.reducedMotion;
    this.onPet();
    setTimeout(() => { this.heartVisible = false; }, 920);
  }

  private onStateChanged(): void {
    this.frame = 0;
    this.startAnimation();
  }

  private onMotionChanged(): void {
    this.frame = 0;
    this.startAnimation();
  }

  private startAnimation(): void {
    this.stopAnimation();
    if (this.reducedMotion) { this.frame = 0; return; }
    const count = petAnimationFrameCount(this.state);
    const interval = Math.max(80, Math.round(petAnimationDurationMs(this.state) / count));
    this.animationTimer = setInterval(() => { this.frame = (this.frame + 1) % count; }, interval);
  }

  private stopAnimation(): void {
    if (this.animationTimer >= 0) clearInterval(this.animationTimer);
    this.animationTimer = -1;
  }
}
