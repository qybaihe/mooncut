import { ThemeTokens } from './AppTheme';

/** Shared chrome helpers mirroring iOS DesignSystem.swift */

export function cardBorderWidth(theme: ThemeTokens): number {
  return theme.usesMemphisChrome ? 1.5 : 1;
}

export function cardShadow(theme: ThemeTokens): ShadowOptions {
  if (theme.usesMemphisChrome) {
    return { radius: 0, color: '#1F000000', offsetX: 3, offsetY: 3 } as ShadowOptions;
  }
  return { radius: 12, color: '#0A000000', offsetX: 0, offsetY: 4 } as ShadowOptions;
}

export function tintWithAlpha(hexOrColor: string, alphaHex: string): string {
  // Prefer explicit soft surfaces from theme; fallback for accent-like tints.
  if (hexOrColor.startsWith('#') && hexOrColor.length === 7) {
    return `#${alphaHex}${hexOrColor.slice(1)}`;
  }
  return hexOrColor;
}

@Component
export struct MoonCard {
  @Prop theme: ThemeTokens;
  @Prop radius: number = -1;
  @Prop paddingValue: number = 16;
  @BuilderParam content: () => void = this.defaultContent;

  @Builder
  defaultContent() {
  }

  build() {
    Column() {
      this.content()
    }
    .width('100%')
    .padding(this.paddingValue)
    .backgroundColor(this.theme.surface)
    .borderRadius(this.radius >= 0 ? this.radius : this.theme.cardRadius)
    .border({ width: cardBorderWidth(this.theme), color: this.theme.hairline })
    .shadow(cardShadow(this.theme))
  }
}

@Component
export struct PrimaryButton {
  @Prop theme: ThemeTokens;
  @Prop label: string = '';
  @Prop isEnabled: boolean = true;
  @Prop loading: boolean = false;
  onTap: () => void = () => {};

  build() {
    Button(this.loading ? '请稍候…' : this.label)
      .width('100%')
      .height(54)
      .borderRadius(14)
      .fontSize(17)
      .fontWeight(FontWeight.Bold)
      .fontColor('#FFFFFF')
      .backgroundColor(this.isEnabled && !this.loading ? this.theme.accent : tintWithAlpha(this.theme.accent, '66'))
      .enabled(this.isEnabled && !this.loading)
      .onClick(() => this.onTap())
  }
}

@Component
export struct SecondaryButton {
  @Prop theme: ThemeTokens;
  @Prop label: string = '';
  @Prop isEnabled: boolean = true;
  onTap: () => void = () => {};

  build() {
    Button(this.label)
      .width('100%')
      .height(48)
      .borderRadius(13)
      .fontSize(15)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.theme.textPrimary)
      .backgroundColor(this.theme.inset)
      .border({ width: 1, color: this.theme.hairline })
      .enabled(this.isEnabled)
      .onClick(() => this.onTap())
  }
}

@Component
export struct DestructiveButton {
  @Prop theme: ThemeTokens;
  @Prop label: string = '';
  onTap: () => void = () => {};

  build() {
    Button(this.label)
      .width('100%')
      .height(52)
      .borderRadius(14)
      .fontSize(17)
      .fontWeight(FontWeight.Bold)
      .fontColor('#FFFFFF')
      .backgroundColor(this.theme.danger)
      .onClick(() => this.onTap())
  }
}

@Component
export struct StatusPill {
  @Prop theme: ThemeTokens;
  @Prop text: string = '';
  @Prop icon: string = '';
  @Prop tint: string = '';

  private color(): string {
    return this.tint || this.theme.accent;
  }

  build() {
    Row({ space: 6 }) {
      if (this.icon) {
        Text(this.icon).fontSize(12).fontWeight(FontWeight.Bold).fontColor(this.color())
      }
      Text(this.text)
        .fontSize(12)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.color())
    }
    .padding({ left: 10, right: 10, top: 6, bottom: 6 })
    .constraintSize({ minHeight: 30 })
    .backgroundColor(this.softFill())
    .borderRadius(999)
  }

  private softFill(): string {
    // Neutral soft fill so success/warning/danger tints stay readable.
    return this.theme.inset;
  }
}

@Component
export struct ErrorBanner {
  @Prop theme: ThemeTokens;
  @Prop message: string = '';
  @Prop diagnostic: string = '';
  @Prop retryTitle: string = '重试';
  onRetry: (() => void) | undefined = undefined;

  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('⚠').fontSize(16).fontColor(this.theme.danger)
        Text(this.message)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.danger)
          .layoutWeight(1)
      }.width('100%')
      if (this.diagnostic) {
        Text(`诊断：${this.diagnostic}`)
          .fontSize(11)
          .fontColor(this.theme.textTertiary)
          .width('100%')
      }
      if (this.onRetry) {
        Button(this.retryTitle)
          .height(40)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.textPrimary)
          .backgroundColor(this.theme.inset)
          .border({ width: 1, color: this.theme.hairline })
          .borderRadius(12)
          .onClick(() => {
            if (this.onRetry) {
              this.onRetry();
            }
          })
      }
    }
    .width('100%')
    .padding(14)
    .backgroundColor(tintWithAlpha(this.theme.danger, '14'))
    .borderRadius(12)
    .border({ width: 1, color: tintWithAlpha(this.theme.danger, '40') })
  }
}

@Component
export struct StudioSectionHeader {
  @Prop theme: ThemeTokens;
  @Prop eyebrow: string = '';
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop icon: string = '✦';

  build() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        Text(this.icon).fontSize(13).fontColor(this.theme.accent)
        Text(this.eyebrow)
          .fontSize(13)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.theme.accent)
      }.width('100%')
      Text(this.title)
        .fontSize(28)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.theme.textPrimary)
        .width('100%')
      if (this.subtitle) {
        Text(this.subtitle)
          .fontSize(15)
          .lineHeight(23)
          .fontColor(this.theme.textSecondary)
          .width('100%')
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}

@Component
export struct StudioStatTile {
  @Prop theme: ThemeTokens;
  @Prop icon: string = '';
  @Prop value: string = '';
  @Prop label: string = '';
  @Prop tint: string = '';

  private color(): string {
    return this.tint || this.theme.accent;
  }

  build() {
    Column({ space: 10 }) {
      Text(this.icon)
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.color())
        .width(28)
        .height(28)
        .textAlign(TextAlign.Center)
        .backgroundColor(this.theme.accentSoft)
        .borderRadius(8)
      Text(this.value)
        .fontSize(26)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.theme.textPrimary)
        .width('100%')
      Text(this.label)
        .fontSize(12)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.theme.textSecondary)
        .width('100%')
    }
    .padding(14)
    .layoutWeight(1)
    .height(116)
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(this.theme.surface)
    .borderRadius(this.theme.usesMemphisChrome ? 12 : 14)
    .border({ width: cardBorderWidth(this.theme), color: this.theme.hairline })
    .shadow(cardShadow(this.theme))
  }
}

@Component
export struct StudioEmptyState {
  @Prop theme: ThemeTokens;
  @Prop icon: string = '☾';
  @Prop title: string = '';
  @Prop description: string = '';
  @Prop actionTitle: string = '';
  onAction: (() => void) | undefined = undefined;

  build() {
    Column({ space: 14 }) {
      if (this.theme.usesMemphisChrome) {
        MemphisAccent({ theme: this.theme, style: 'burst' })
      }
      Text(this.icon)
        .fontSize(34)
        .fontColor(this.theme.accent)
        .width(72)
        .height(72)
        .textAlign(TextAlign.Center)
        .backgroundColor(this.theme.accentSoft)
        .borderRadius(20)
        .border({
          width: this.theme.usesMemphisChrome ? 1.5 : 0,
          color: this.theme.usesMemphisChrome ? this.theme.ink : Color.Transparent
        })
      Text(this.title)
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.theme.textPrimary)
        .textAlign(TextAlign.Center)
      Text(this.description)
        .fontSize(14)
        .lineHeight(21)
        .fontColor(this.theme.textSecondary)
        .textAlign(TextAlign.Center)
        .width('100%')
      if (this.actionTitle && this.onAction) {
        PrimaryButton({
          theme: this.theme,
          label: this.actionTitle,
          onTap: () => {
            if (this.onAction) {
              this.onAction();
            }
          }
        })
      }
    }
    .width('100%')
    .padding(22)
    .backgroundColor(this.theme.surface)
    .borderRadius(this.theme.cardRadius)
    .border({ width: cardBorderWidth(this.theme), color: this.theme.hairline })
    .shadow(cardShadow(this.theme))
  }
}

@Component
export struct MemphisAccent {
  @Prop theme: ThemeTokens;
  @Prop style: string = 'corner'; // corner | strip | burst

  build() {
    if (!this.theme.usesMemphisChrome) {
      // No decoration outside Memphis.
    } else if (this.style === 'strip') {
      Row({ space: 8 }) {
        Column().width(36).height(10).backgroundColor(this.theme.stickerYellow).borderRadius(999)
        Column().width(12).height(12).backgroundColor(this.theme.stickerPink).borderRadius(6)
        Column().width(22).height(10).backgroundColor(this.theme.stickerMint).borderRadius(2)
          .rotate({ angle: 12 })
      }
      .hitTestBehavior(HitTestMode.None)
    } else if (this.style === 'burst') {
      Stack() {
        Column()
          .width(56)
          .height(56)
          .borderRadius(28)
          .border({ width: 2, color: tintWithAlpha(this.theme.ink, '33') })
        Column()
          .width(18)
          .height(18)
          .backgroundColor(this.theme.stickerYellow)
          .borderRadius(9)
          .opacity(0.85)
        Column()
          .width(8)
          .height(28)
          .backgroundColor(this.theme.stickerCyan)
          .borderRadius(4)
          .rotate({ angle: 35 })
          .offset({ x: 16, y: -10 })
      }
      .width(64)
      .height(64)
      .hitTestBehavior(HitTestMode.None)
    } else {
      Stack({ alignContent: Alignment.TopEnd }) {
        Column()
          .width(48)
          .height(48)
          .backgroundColor(this.theme.stickerYellow)
          .borderRadius(24)
          .opacity(0.55)
          .offset({ x: 10, y: -8 })
        Column()
          .width(28)
          .height(12)
          .backgroundColor(this.theme.stickerCyan)
          .borderRadius(4)
          .opacity(0.5)
          .rotate({ angle: -18 })
          .offset({ x: -28, y: 18 })
      }
      .width(64)
      .height(48)
      .hitTestBehavior(HitTestMode.None)
    }
  }
}

@Component
export struct MoonLogo {
  @Prop theme: ThemeTokens;
  @Prop compact: boolean = false;

  build() {
    Row({ space: 10 }) {
      Stack() {
        Column()
          .width(36)
          .height(36)
          .backgroundColor(this.theme.inset)
          .borderRadius(10)
        Column()
          .width(18)
          .height(18)
          .backgroundColor(this.theme.accent)
          .borderRadius(9)
        Column()
          .width(17)
          .height(17)
          .backgroundColor(this.theme.inset)
          .borderRadius(9)
          .offset({ x: 5, y: -3 })
      }
      .width(36)
      .height(36)
      if (!this.compact) {
        Column({ space: 1 }) {
          Text('MoonCut').fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.theme.textPrimary)
          Text('口播创作').fontSize(11).fontColor(this.theme.textSecondary)
        }.alignItems(HorizontalAlign.Start)
      }
    }
    .accessibilityGroup(true)
    .accessibilityText('MoonCut 口播创作')
  }
}

@Component
export struct StudioProgressTrack {
  @Prop theme: ThemeTokens;
  @Prop progress: number = 0;
  @Prop tint: string = '';
  @Prop indeterminate: boolean = false;

  private color(): string {
    return this.tint || this.theme.accent;
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Column()
        .width('100%')
        .height(this.theme.usesMemphisChrome ? 10 : 7)
        .backgroundColor(this.theme.inset)
        .borderRadius(999)
      if (this.indeterminate) {
        Column()
          .width('28%')
          .height(this.theme.usesMemphisChrome ? 10 : 7)
          .backgroundColor(tintWithAlpha(this.color(), '59'))
          .borderRadius(999)
      } else {
        Column()
          .width(`${Math.round(Math.min(1, Math.max(0, this.progress)) * 100)}%`)
          .height(this.theme.usesMemphisChrome ? 10 : 7)
          .backgroundColor(this.color())
          .borderRadius(999)
          .constraintSize({ minWidth: 6 })
      }
    }
    .width('100%')
    .height(this.theme.usesMemphisChrome ? 10 : 7)
    .border({
      width: this.theme.usesMemphisChrome ? 1 : 0,
      color: this.theme.usesMemphisChrome ? tintWithAlpha(this.theme.ink, '59') : Color.Transparent
    })
    .borderRadius(999)
  }
}
