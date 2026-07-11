import { AuthUser } from '../../core/api/APIModels';
import { APIError } from '../../core/api/APIError';
import { presentError } from '../../core/api/ErrorPresentation';
import { ThemeTokens } from '../../core/design/AppTheme';
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
        Blank().height(40)
        Row() {
          Text('MoonCut').fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.theme.textPrimary)
          Blank()
          Button('☼').fontSize(26).fontColor(this.theme.accent).backgroundColor(Color.Transparent)
            .accessibilityText('切换主题').onClick(() => this.store.cycleTheme())
        }.width('100%')
        this.moonLogo()

        Text(this.registering ? '创建账号' : '登录').fontSize(30).fontWeight(FontWeight.Bold).fontColor(this.theme.textPrimary).width('100%')
        Text('从想法到能发布的口播成片。登录后可上传剪辑、脚本助手与真实陪练。')
          .fontSize(16).fontColor(this.theme.textSecondary).textAlign(TextAlign.Start).width('100%')

        Column({ space: 9 }) {
          Row() {
            Text('服务状态').fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.theme.textPrimary)
            Blank()
            ServiceBadge({ connected: this.store.serviceConnected, loading: this.store.restoringSession, theme: this.theme })
          }.width('100%')
          if (this.store.health?.ok === true) {
            Text(`规划模型：${this.store.health?.plannerModel ?? '—'} · 网关${this.store.health?.gatewayReachable === true ? '可达' : '不可达'}`)
              .fontSize(12).fontColor(this.theme.textSecondary).width('100%')
          } else if (this.store.serviceError) {
            Text(this.store.serviceError).fontSize(12).fontColor(this.theme.warning).width('100%')
            Button('重新检查服务').height(38).fontColor(this.theme.accent).backgroundColor(this.theme.accentSoft)
              .onClick(() => { void this.store.refreshHealth(); })
          } else {
            Text(`正在检查 ${this.store.api.configuration.baseUrl}`).fontSize(12).fontColor(this.theme.textTertiary).width('100%')
          }
          Text('认证方式：邮箱会话 Cookie（不使用 API Key）').fontSize(11).fontColor(this.theme.textTertiary).width('100%')
        }.width('100%').padding(16).backgroundColor(this.theme.surface).borderRadius(this.theme.cardRadius)
          .border({ width: 1, color: this.theme.hairline })

        Column({ space: 14 }) {
          Row() {
            Button('登录').layoutWeight(1).height(42)
              .backgroundColor(this.registering ? Color.Transparent : this.theme.accentSoft)
              .fontColor(this.registering ? this.theme.textSecondary : this.theme.accent)
              .onClick(() => { this.registering = false; this.errorMessage = ''; this.errorDiagnostic = ''; })
            Button('注册').layoutWeight(1).height(42)
              .backgroundColor(this.registering ? this.theme.accentSoft : Color.Transparent)
              .fontColor(this.registering ? this.theme.accent : this.theme.textSecondary)
              .onClick(() => { this.registering = true; this.errorMessage = ''; this.errorDiagnostic = ''; })
          }
          .backgroundColor(this.theme.inset).borderRadius(12).padding(3)

          TextInput({ placeholder: '邮箱', text: this.email })
            .type(InputType.Email).height(52).backgroundColor(this.theme.inset).borderRadius(12)
            .fontColor(this.theme.textPrimary).onChange((value: string) => { this.email = value; })
          TextInput({ placeholder: '密码（至少 8 位）', text: this.password })
            .type(InputType.Password).height(52).backgroundColor(this.theme.inset).borderRadius(12)
            .fontColor(this.theme.textPrimary).onChange((value: string) => { this.password = value; })

          Button(this.loading ? '请稍候…' : this.registering ? '注册并开始' : '登录')
            .width('100%').height(54).borderRadius(14)
            .backgroundColor(this.theme.accent).fontColor('#FFFFFF').fontSize(17).fontWeight(FontWeight.Bold)
            .enabled(!this.loading && this.email.trim().length > 0 && this.password.length >= 8).onClick(() => this.submit())
        }
        .width('100%').padding(20).backgroundColor(this.theme.surface).borderRadius(this.theme.cardRadius)
        .border({ width: 1, color: this.theme.hairline })

        if (this.errorMessage) {
          Column({ space: 8 }) {
            Text(this.errorMessage).fontSize(13).fontColor(this.theme.danger).width('100%')
            if (this.errorDiagnostic) {
              Text(`诊断：${this.errorDiagnostic}`).fontSize(11).fontColor(this.theme.textTertiary).width('100%')
            }
            Button('重试').height(40).fontColor(this.theme.accent).backgroundColor(this.theme.accentSoft).onClick(() => this.submit())
          }.padding(14).width('100%').backgroundColor(this.theme.surface).borderRadius(12)
        }

        Column({ space: 6 }) {
          Text('🔒  隐私与安全').fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.theme.textSecondary).width('100%')
          Text('会话由服务端 HttpOnly Cookie 维持，App 不会把 Cookie 明文保存到 Preferences，也不会嵌入服务 API Key。生产环境仅信任固定 Host 与 mooncut-ca。')
            .fontSize(11).lineHeight(18).fontColor(this.theme.textTertiary).width('100%')
        }.width('100%')
      }
      .width('100%').padding({ left: 24, right: 24, bottom: 40 })
    }
    .width('100%').height('100%').backgroundColor(this.theme.canvas)
  }

  @Builder
  private moonLogo() {
    Row({ space: 10 }) {
      Stack() {
        Text('●').fontSize(23).fontColor(this.theme.accent)
        Text('◒').fontSize(23).fontColor(this.theme.inset).translate({ x: 5, y: -3 })
      }.width(36).height(36).backgroundColor(this.theme.inset).borderRadius(10)
      Column({ space: 1 }) {
        Text('MoonCut').fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.theme.textPrimary)
        Text('口播创作').fontSize(11).fontColor(this.theme.textSecondary)
      }.alignItems(HorizontalAlign.Start)
    }.accessibilityGroup(true).accessibilityText('MoonCut 口播创作')
  }

  private async submit(): Promise<void> {
    if (!this.email.trim() || this.password.length < 8) {
      this.errorMessage = '请输入有效邮箱和至少 8 位密码'; return;
    }
    this.loading = true; this.errorMessage = ''; this.errorDiagnostic = '';
    try {
      const user = this.registering
        ? await this.store.api.register(this.email.trim(), this.password)
        : await this.store.api.login(this.email.trim(), this.password);
      this.onAuthenticated(user);
    } catch (error) {
      this.errorMessage = presentError(error as object);
      this.errorDiagnostic = error instanceof APIError ? error.code : '';
    } finally { this.loading = false; }
  }
}
