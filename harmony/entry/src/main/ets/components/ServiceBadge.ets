import { ThemeTokens } from '../core/design/AppTheme';
import { StatusPill } from '../core/design/DesignSystem';

@Component
export struct ServiceBadge {
  @Prop connected: boolean;
  @Prop loading: boolean = false;
  @Prop theme: ThemeTokens;

  build() {
    StatusPill({
      theme: this.theme,
      text: this.loading ? '检查中' : this.connected ? '已真实连接' : '服务失败',
      icon: this.loading ? '◌' : this.connected ? '✓' : '!',
      tint: this.loading ? this.theme.accent : this.connected ? this.theme.success : this.theme.warning
    })
  }
}
