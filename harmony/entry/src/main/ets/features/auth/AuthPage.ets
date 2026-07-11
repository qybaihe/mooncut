import { AuthUser, OtpPurpose } from '../../core/api/APIModels';
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
  @State passwordLogin: boolean = false;
  @State email: string = '';
  @State password: string = '';
  @State code: string = '';
  @State otpSent: boolean = false;
  @State resendRemaining: number = 0;
  @State expiresRemaining: number = 0;
  @State loading: boolean = false;
  @State errorMessage: string = '';
  @State errorDiagnostic: string = '';
  private countdownTimer: number = -1;

  aboutToDisappear(): void { this.stopCountdown(); }

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

        Text(this.registering ? '创建账号' : '登录').fontSize(30).fontWeight(FontWeight.Bold)
          .fontColor(this.theme.textPrimary).width('100%')
        Text(this.registering ? '验证邮箱并设置密码，验证码 10 分钟内有效。' : '推荐使用邮箱验证码登录，也可使用已有密码。')
          .fontSize(16).lineHeight(23).fontColor(this.theme.textSecondary).width('100%')

        this.serviceStatus()

        Column({ space: 14 }) {
          Row() {
            Button('登录').layoutWeight(1).height(42)
              .backgroundColor(this.registering ? Color.Transparent : this.theme.accentSoft)
              .fontColor(this.registering ? this.theme.textSecondary : this.theme.accent)
              .onClick(() => this.switchAccountMode(false))
            Button('注册').layoutWeight(1).height(42)
              .backgroundColor(this.registering ? this.theme.accentSoft : Color.Transparent)
              .fontColor(this.registering ? this.theme.accent : this.theme.textSecondary)
              .onClick(() => this.switchAccountMode(true))
          }.backgroundColor(this.theme.inset).borderRadius(12).padding(3)

          if (!this.registering) {
            Row() {
              Button('验证码登录').layoutWeight(1).height(38)
                .backgroundColor(this.passwordLogin ? Color.Transparent : this.theme.surface)
                .fontColor(this.passwordLogin ? this.theme.textSecondary : this.theme.accent)
                .onClick(() => this.switchLoginMethod(false))
              Button('密码登录').layoutWeight(1).height(38)
                .backgroundColor(this.passwordLogin ? this.theme.surface : Color.Transparent)
                .fontColor(this.passwordLogin ? this.theme.accent : this.theme.textSecondary)
                .onClick(() => this.switchLoginMethod(true))
            }.backgroundColor(this.theme.inset).borderRadius(10).padding(3)
          }

          TextInput({ placeholder: '邮箱', text: this.email })
            .type(InputType.Email).height(52).backgroundColor(this.theme.inset).borderRadius(12)
            .fontColor(this.theme.textPrimary).enabled(!this.loading)
            .onChange((value: string) => this.emailChanged(value))

          if (this.passwordLogin || this.registering) {
            TextInput({ placeholder: '密码（8～128 位）', text: this.password })
              .type(InputType.Password).height(52).backgroundColor(this.theme.inset).borderRadius(12)
              .fontColor(this.theme.textPrimary).enabled(!this.loading)
              .onChange((value: string) => { this.password = value; })
          }

          if (!this.passwordLogin) {
            if (this.otpSent) {
              TextInput({ placeholder: '6 位邮箱验证码', text: this.code })
                .type(InputType.Number).maxLength(6).height(52).backgroundColor(this.theme.inset).borderRadius(12)
                .fontColor(this.theme.textPrimary).enabled(!this.loading)
                .onChange((value: string) => { this.code = value.replace(/[^0-9]/g, '').slice(0, 6); })
              Row() {
                Text(this.expiresRemaining > 0 ? `验证码 ${this.minuteLabel()} 后过期` : '验证码已过期，请重新获取')
                  .fontSize(12).fontColor(this.expiresRemaining > 0 ? this.theme.textTertiary : this.theme.warning)
                Blank()
                Button(this.resendRemaining > 0 ? `${this.resendRemaining}s 后重发` : '重新发送')
                  .fontSize(13).height(36).fontColor(this.theme.accent).backgroundColor(Color.Transparent)
                  .enabled(!this.loading && this.resendRemaining === 0).onClick(() => this.sendOtp())
              }.width('100%')
            }

            Button(this.loading ? '请稍候…' : this.otpSent ? (this.registering ? '验证并创建账号' : '验证并登录') : '发送验证码')
              .width('100%').height(54).borderRadius(14)
              .backgroundColor(this.theme.accent).fontColor('#FFFFFF').fontSize(17).fontWeight(FontWeight.Bold)
              .enabled(this.canSubmitOtp()).onClick(() => this.otpSent ? this.verifyOtp() : this.sendOtp())
          } else {
            Button(this.loading ? '请稍候…' : '使用密码登录').width('100%').height(54).borderRadius(14)
              .backgroundColor(this.theme.accent).fontColor('#FFFFFF').fontSize(17).fontWeight(FontWeight.Bold)
              .enabled(this.canPasswordLogin()).onClick(() => this.submitPasswordLogin())
          }
        }
        .width('100%').padding(20).backgroundColor(this.theme.surface).borderRadius(this.theme.cardRadius)
        .border({ width: 1, color: this.theme.hairline })

        if (this.errorMessage) {
          Column({ space: 8 }) {
            Text(this.errorMessage).fontSize(13).fontColor(this.theme.danger).width('100%')
            if (this.errorDiagnostic) {
              Text(`诊断：${this.errorDiagnostic}`).fontSize(11).fontColor(this.theme.textTertiary).width('100%')
            }
          }.padding(14).width('100%').backgroundColor(this.theme.surface).borderRadius(12)
        }

        Column({ space: 6 }) {
          Text('🔒  隐私与安全').fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.theme.textSecondary).width('100%')
          Text('会话 Cookie 仅保存在系统 Asset Store。生产环境固定访问 mooncut.me，并使用系统 HTTPS 信任链；App 不包含 Agent、Tunnel 或模型密钥。')
            .fontSize(11).lineHeight(18).fontColor(this.theme.textTertiary).width('100%')
        }.width('100%')
      }.width('100%').padding({ left: 24, right: 24, bottom: 40 })
    }.width('100%').height('100%').backgroundColor(this.theme.canvas)
  }

  @Builder
  private serviceStatus() {
    Column({ space: 9 }) {
      Row() {
        Text('账号与助手').fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.theme.textPrimary)
        Blank()
        ServiceBadge({ connected: this.store.serviceConnected, loading: this.store.restoringSession, theme: this.theme })
      }.width('100%')
      Text(this.store.assistantAvailable
        ? `助手在线 · ${this.store.models?.routing?.script ?? this.store.models?.available[0] ?? '模型已配置'}`
        : (this.store.serviceError || '正在检查边缘服务'))
        .fontSize(12).fontColor(this.store.assistantAvailable ? this.theme.textSecondary : this.theme.warning).width('100%')
      Divider().color(this.theme.hairline)
      Row() {
        Text('剪辑节点').fontSize(14).fontColor(this.theme.textPrimary)
        Blank()
        Text(this.store.editingAvailable ? '在线' : '暂不可用').fontSize(13)
          .fontColor(this.store.editingAvailable ? this.theme.success : this.theme.warning)
      }.width('100%')
      if (!this.store.editingAvailable && this.store.agentError) {
        Text(this.store.agentError).fontSize(11).fontColor(this.theme.textTertiary).width('100%')
      }
      Button('重新检查服务').height(38).fontColor(this.theme.accent).backgroundColor(this.theme.accentSoft)
        .onClick(() => { void this.store.refreshHealth(); })
    }.width('100%').padding(16).backgroundColor(this.theme.surface).borderRadius(this.theme.cardRadius)
      .border({ width: 1, color: this.theme.hairline })
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

  private switchAccountMode(registering: boolean): void {
    if (this.registering === registering) return;
    this.registering = registering;
    this.passwordLogin = false;
    this.resetOtpState();
  }

  private switchLoginMethod(passwordLogin: boolean): void {
    if (this.passwordLogin === passwordLogin) return;
    this.passwordLogin = passwordLogin;
    this.resetOtpState();
  }

  private emailChanged(value: string): void {
    if (this.email !== value && this.otpSent) this.resetOtpState();
    this.email = value;
  }

  private canSubmitOtp(): boolean {
    if (!this.store.api.configuration.isConfigured || this.loading || !this.validEmail()) return false;
    if (!this.otpSent) return true;
    if (!/^\d{6}$/.test(this.code)) return false;
    return !this.registering || this.validPassword();
  }

  private canPasswordLogin(): boolean {
    return this.store.api.configuration.isConfigured && !this.loading && this.validEmail() && this.validPassword();
  }

  private validEmail(): boolean {
    const normalized = this.email.trim().toLowerCase();
    return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  }

  private validPassword(): boolean { return this.password.length >= 8 && this.password.length <= 128; }

  private async sendOtp(): Promise<void> {
    if (!this.validEmail()) { this.showError('请输入有效邮箱', 'INVALID_EMAIL'); return; }
    this.loading = true; this.clearError();
    try {
      const purpose = this.registering ? OtpPurpose.REGISTER : OtpPurpose.LOGIN;
      const response = await this.store.api.sendOtp(this.email, purpose);
      this.email = response.email;
      this.otpSent = true;
      this.code = '';
      this.resendRemaining = response.resendAfterSec;
      this.expiresRemaining = response.expiresInSec;
      this.startCountdown();
    } catch (error) { this.captureError(error as object); }
    finally { this.loading = false; }
  }

  private async verifyOtp(): Promise<void> {
    if (!this.canSubmitOtp()) { this.showError('请填写有效的邮箱、验证码和密码', 'INVALID_INPUT'); return; }
    this.loading = true; this.clearError();
    try {
      const purpose = this.registering ? OtpPurpose.REGISTER : OtpPurpose.LOGIN;
      const user = await this.store.api.verifyOtp(
        this.email, this.code, purpose, this.registering ? this.password : undefined
      );
      this.stopCountdown();
      this.onAuthenticated(user);
    } catch (error) { this.captureError(error as object); }
    finally { this.loading = false; }
  }

  private async submitPasswordLogin(): Promise<void> {
    if (!this.canPasswordLogin()) { this.showError('请输入有效邮箱和 8～128 位密码', 'INVALID_INPUT'); return; }
    this.loading = true; this.clearError();
    try { this.onAuthenticated(await this.store.api.login(this.email, this.password)); }
    catch (error) { this.captureError(error as object); }
    finally { this.loading = false; }
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.countdownTimer = setInterval(() => {
      if (this.resendRemaining > 0) this.resendRemaining -= 1;
      if (this.expiresRemaining > 0) this.expiresRemaining -= 1;
      if (this.resendRemaining === 0 && this.expiresRemaining === 0) this.stopCountdown();
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer >= 0) clearInterval(this.countdownTimer);
    this.countdownTimer = -1;
  }

  private resetOtpState(): void {
    this.stopCountdown();
    this.otpSent = false;
    this.code = '';
    this.resendRemaining = 0;
    this.expiresRemaining = 0;
    this.clearError();
  }

  private minuteLabel(): string {
    const minutes = Math.floor(this.expiresRemaining / 60);
    const seconds = this.expiresRemaining % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  private captureError(error: object): void {
    this.errorMessage = presentError(error);
    this.errorDiagnostic = error instanceof APIError ? error.code : '';
    if (error instanceof APIError && (error.code === 'OTP_EXPIRED' || error.code === 'OTP_INVALID' || error.code === 'OTP_LOCKED')) {
      this.otpSent = false;
      this.code = '';
      this.stopCountdown();
    }
  }

  private showError(message: string, diagnostic: string): void {
    this.errorMessage = message;
    this.errorDiagnostic = diagnostic;
  }

  private clearError(): void { this.errorMessage = ''; this.errorDiagnostic = ''; }
}
