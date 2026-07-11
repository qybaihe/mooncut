import { AuthUser } from '../../core/api/APIModels';
import { APIError } from '../../core/api/APIError';
import { presentError } from '../../core/api/ErrorPresentation';
import { ThemeTokens } from '../../core/design/AppTheme';
import {
  ErrorBanner, MemphisAccent, MoonLogo, PrimaryButton, cardBorderWidth, cardShadow
} from '../../core/design/DesignSystem';
import { AppStore } from '../../app/AppStore';
import { ServiceBadge } from '../../components/ServiceBadge';

@Component
export struct AuthPage {
  @ObjectLink store: AppStore;
  @Prop theme: ThemeTokens;
  onAuthenticated: (user: AuthUser) => void = () => {};
  @State registering: boolean = false;
  @State email: string = '';
  @State password: string = '';
  @State loading: boolean = false;
  @State errorMessage: string = '';
  @State errorDiagnostic: string = '';

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Blank().height(36)
        Row() {
          MoonLogo({ theme: this.theme })
          Blank()
          Button('☼')
            .fontSize(22)
            .fontColor(this.theme.accent)
            .backgroundColor(this.theme.inset)
            .width(40)
            .height(40)
            .borderRadius(20)
            .accessibilityText('切换主题')
            .onClick(() => this.store.cycleTheme())
        }.width('100%')

        Stack({ alignContent: Alignment.TopEnd }) {
          Column({ space: 8 }) {
            Text(this.registering ? '创建账号' : '登录')
              .fontSize(30)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.theme.textPrimary)
              .width('100%')
            Text('从想法到能发布的口播成片。登录后可上传剪辑、脚本助手与真实陪练。')
              .fontSize(15)
              .lineHeight(23)
              .fontColor(this.theme.textSecondary)
              .width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start)
          MemphisAccent({ theme: this.theme, style: 'corner' })
        }.width('100%')

        Column({ space: 10 }) {
          Row() {
            Text('服务状态').fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.theme.textPrimary)
            Blank()
            ServiceBadge({
              connected: this.store.serviceConnected,
              loading: this.store.restoringSession,
              theme: this.theme
            })
          }.width('100%')
          if (this.store.health?.ok === true) {
            Text(`规划模型：${this.store.health?.plannerModel ?? '—'} · 网关${this.store.health?.gatewayReachable === true ? '可达' : '不可达'}`)
              .fontSize(12)
              .fontColor(this.theme.textSecondary)
              .width('100%')
          } else if (this.store.serviceError) {
            Text(this.store.serviceError).fontSize(12).fontColor(this.theme.warning).width('100%')
            Button('重新检查服务')
              .height(38)
              .fontColor(this.theme.accent)
              .backgroundColor(this.theme.accentSoft)
              .borderRadius(12)
              .onClick(() => { void this.store.refreshHealth(); })
          } else {
            Text(`正在检查 ${this.store.api.configuration.baseUrl}`)
              .fontSize(12)
              .fontColor(this.theme.textTertiary)
              .width('100%')
          }
          Text('认证方式：邮箱会话 Cookie（不使用 API Key）')
            .fontSize(11)
            .fontColor(this.theme.textTertiary)
            .width('100%')
        }
        .width('100%')
        .padding(16)
        .backgroundColor(this.theme.surface)
        .borderRadius(this.theme.cardRadius)
        .border({ width: cardBorderWidth(this.theme), color: this.theme.hairline })
        .shadow(cardShadow(this.theme))

        Column({ space: 14 }) {
          Row() {
            Button('登录')
              .layoutWeight(1)
              .height(42)
              .borderRadius(10)
              .backgroundColor(this.registering ? Color.Transparent : this.theme.accentSoft)
              .fontColor(this.registering ? this.theme.textSecondary : this.theme.accent)
              .fontWeight(FontWeight.Medium)
              .onClick(() => { this.registering = false; this.errorMessage = ''; this.errorDiagnostic = ''; })
            Button('注册')
              .layoutWeight(1)
              .height(42)
              .borderRadius(10)
              .backgroundColor(this.registering ? this.theme.accentSoft : Color.Transparent)
              .fontColor(this.registering ? this.theme.accent : this.theme.textSecondary)
              .fontWeight(FontWeight.Medium)
              .onClick(() => { this.registering = true; this.errorMessage = ''; this.errorDiagnostic = ''; })
          }
          .backgroundColor(this.theme.inset)
          .borderRadius(12)
          .padding(3)

          TextInput({ placeholder: '邮箱', text: this.email })
            .type(InputType.Email)
            .height(52)
            .backgroundColor(this.theme.inset)
            .borderRadius(12)
            .fontColor(this.theme.textPrimary)
            .onChange((value: string) => { this.email = value; })
          TextInput({ placeholder: '密码（至少 8 位）', text: this.password })
            .type(InputType.Password)
            .height(52)
            .backgroundColor(this.theme.inset)
            .borderRadius(12)
            .fontColor(this.theme.textPrimary)
            .onChange((value: string) => { this.password = value; })

          PrimaryButton({
            theme: this.theme,
            label: this.registering ? '注册并开始' : '登录',
            loading: this.loading,
            isEnabled: !this.loading && this.email.trim().length > 0 && this.password.length >= 8,
            onTap: () => this.submit()
          })
        }
        .width('100%')
        .padding(20)
        .backgroundColor(this.theme.surface)
        .borderRadius(this.theme.cardRadius)
        .border({ width: cardBorderWidth(this.theme), color: this.theme.hairline })
        .shadow(cardShadow(this.theme))

        if (this.errorMessage) {
          ErrorBanner({
            theme: this.theme,
            message: this.errorMessage,
            diagnostic: this.errorDiagnostic,
            retryTitle: '重试',
            onRetry: () => this.submit()
          })
        }

        Column({ space: 6 }) {
          Text('🔒  隐私与安全')
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.theme.textSecondary)
            .width('100%')
          Text('会话由服务端 HttpOnly Cookie 维持，App 不会把 Cookie 明文保存到 Preferences，也不会嵌入服务 API Key。生产环境仅信任固定 Host 与 mooncut-ca。')
            .fontSize(11)
            .lineHeight(18)
            .fontColor(this.theme.textTertiary)
            .width('100%')
        }.width('100%')
      }
      .width('100%')
      .padding({ left: 22, right: 22, bottom: 40 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.canvas)
  }

  private async submit(): Promise<void> {
    if (!this.email.trim() || this.password.length < 8) {
      this.errorMessage = '请输入有效邮箱和至少 8 位密码';
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.errorDiagnostic = '';
    try {
      const user = this.registering
        ? await this.store.api.register(this.email.trim(), this.password)
        : await this.store.api.login(this.email.trim(), this.password);
      this.onAuthenticated(user);
    } catch (error) {
      this.errorMessage = presentError(error as object);
      this.errorDiagnostic = error instanceof APIError ? error.code : '';
    } finally {
      this.loading = false;
    }
  }
}
