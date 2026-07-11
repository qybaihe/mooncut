import { ThemeTokens } from '../core/design/AppTheme';

@Component
export struct ToastView {
  @Prop message: string;
  @Prop isError: boolean;
  @Prop theme: ThemeTokens;

  build() {
    if (this.message) {
      Row({ space: 8 }) {
        Text(this.isError ? '⚠' : '✓')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
        Text(this.message)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
      }
      .constraintSize({ minHeight: 48, maxWidth: '92%' })
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })
      .backgroundColor(this.isError ? this.theme.danger : '#DB202226')
      .borderRadius(999)
      .margin({ left: 22, right: 22, bottom: 88 })
      .shadow({ radius: 16, color: '#2E000000', offsetY: 8 })
    }
  }
}
