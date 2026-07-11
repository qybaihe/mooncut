import { ThemeTokens } from '../core/design/AppTheme';

@Component
export struct ServiceBadge {
  @Prop connected: boolean;
  @Prop loading: boolean = false;
  @Prop theme: ThemeTokens;

  build() {
    Row({ space: 7 }) {
      Text(this.loading ? '◌' : this.connected ? '✓' : '!')
        .fontSize(14).fontWeight(FontWeight.Bold)
        .fontColor(this.connected ? this.theme.success : this.theme.danger)
      Text(this.loading ? '正在连接' : this.connected ? '已真实连接' : '服务不可用')
        .fontSize(13).fontWeight(FontWeight.Bold)
        .fontColor(this.connected ? this.theme.success : this.theme.danger)
    }
    .backgroundColor(this.connected ? '#E2F1EA' : '#F8E5E3')
    .borderRadius(18)
    .padding({ left: 12, right: 12, top: 8, bottom: 8 })
  }
}
