import { ThemeTokens } from '../core/design/AppTheme';

@Component
export struct ToastView {
  @Prop message: string;
  @Prop isError: boolean;
  @Prop theme: ThemeTokens;

  build() {
    if (this.message) {
      Text(this.message)
        .fontSize(14)
        .fontColor('#FFFFFF')
        .backgroundColor(this.isError ? this.theme.danger : '#DE202226')
        .borderRadius(18)
        .padding({ left: 18, right: 18, top: 11, bottom: 11 })
        .margin({ left: 22, right: 22, bottom: 88 })
        .shadow({ radius: 18, color: '#35000000', offsetY: 8 })
    }
  }
}
